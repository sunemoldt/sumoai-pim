// Nightly backup of the PIM database to Google Drive.
// - Dumper hvidlistede tabeller som ét JSON-objekt.
// - Genererer produkter-backup CSV (EAN/UTF-8 BOM/semikolon).
// - Uploader til Drive-mappe "Comtek-PIM-Backups".
// - Sletter filer ældre end 7 dage.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const GOOGLE_DRIVE_API_KEY = Deno.env.get("GOOGLE_DRIVE_API_KEY") ?? "";

const GATEWAY = "https://connector-gateway.lovable.dev/google_drive";
const FOLDER_NAME = "Comtek-PIM-Backups";
const RETENTION_DAYS = 7;

// Tabeller der bliver inkluderet i backup. Token-tabeller (shopify_connection, shopify_oauth_state) ekskluderes bevidst.
const BACKUP_TABLES = [
  "analytics_settings",
  "attribute_definitions",
  "field_sync_policy",
  "import_logs",
  "master_products",
  "price_history",
  "price_settings",
  "product_analytics",
  "product_change_log",
  "product_recommendations",
  "product_translations",
  "product_variants",
  "quote_lines",
  "quotes",
  "shopify_processed_orders",
  "shopify_skipped_orders",
  "shopify_update_queue",
  "shopify_webhook_config",
  "supplier_products",
  "suppliers",
  "webhook_configs",
] as const;

// Disse tabeller kan blive store — cap til seneste 90 dage
const CAPPED_TABLES: Record<string, { column: string; days: number }> = {
  import_logs: { column: "created_at", days: 90 },
  product_change_log: { column: "created_at", days: 90 },
  product_analytics: { column: "period_start", days: 90 },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function driveHeaders(extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${LOVABLE_API_KEY}`,
    "X-Connection-Api-Key": GOOGLE_DRIVE_API_KEY,
    ...extra,
  };
}

async function driveFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: { ...driveHeaders(), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

async function ensureFolder(): Promise<string> {
  const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const list = await driveFetch(`/drive/v3/files?q=${q}&fields=files(id,name)`);
  if (list.files?.[0]?.id) return list.files[0].id;

  const created = await driveFetch(`/drive/v3/files?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  return created.id;
}

async function uploadFile(folderId: string, filename: string, mime: string, content: string): Promise<string> {
  const boundary = `----lovable-${crypto.randomUUID()}`;
  const metadata = { name: filename, parents: [folderId], mimeType: mime };
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mime}\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`;

  const res = await fetch(`${GATEWAY}/upload/drive/v3/files?uploadType=multipart&fields=id,name,size`, {
    method: "POST",
    headers: driveHeaders({ "Content-Type": `multipart/related; boundary=${boundary}` }),
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload ${filename} ${res.status}: ${text.slice(0, 500)}`);
  }
  const j = await res.json();
  return j.id;
}

async function deleteOldFiles(folderId: string): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false and createdTime < '${cutoff}'`);
  const list = await driveFetch(`/drive/v3/files?q=${q}&fields=files(id,name,createdTime)&pageSize=1000`);
  const files = (list.files ?? []) as Array<{ id: string; name: string }>;
  let deleted = 0;
  for (const f of files) {
    const res = await fetch(`${GATEWAY}/drive/v3/files/${f.id}`, { method: "DELETE", headers: driveHeaders() });
    if (res.ok || res.status === 204) deleted++;
    else console.warn(`[backup] kunne ikke slette ${f.name}: ${res.status}`);
  }
  return deleted;
}

function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(";")];
  for (const row of rows) {
    const cells = headers.map((h) => {
      const v = row[h];
      if (v === null || v === undefined) return "";
      const s = typeof v === "object" ? JSON.stringify(v) : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    });
    lines.push(cells.join(";"));
  }
  return "\uFEFF" + lines.join("\n");
}

async function dumpAllTables(sb: ReturnType<typeof createClient>): Promise<{ data: Record<string, unknown[]>; meta: Record<string, { count: number; capped?: boolean }> }> {
  const data: Record<string, unknown[]> = {};
  const meta: Record<string, { count: number; capped?: boolean }> = {};

  for (const table of BACKUP_TABLES) {
    const cap = CAPPED_TABLES[table];
    let query = sb.from(table).select("*");
    if (cap) {
      const since = new Date(Date.now() - cap.days * 24 * 60 * 60 * 1000).toISOString();
      query = query.gte(cap.column, since);
    }
    // Paginér i chunks á 1000 for at undgå PostgREST default limit
    const all: unknown[] = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data: rows, error } = await query.range(from, from + PAGE - 1);
      if (error) {
        console.error(`[backup] fejl ved ${table}:`, error.message);
        break;
      }
      const list = rows ?? [];
      all.push(...list);
      if (list.length < PAGE) break;
      from += PAGE;
      // Re-create query for next page (Supabase query objects are not re-runnable)
      query = sb.from(table).select("*");
      if (cap) {
        const since = new Date(Date.now() - cap.days * 24 * 60 * 60 * 1000).toISOString();
        query = query.gte(cap.column, since);
      }
    }
    data[table] = all;
    meta[table] = { count: all.length, ...(cap ? { capped: true } : {}) };
  }
  return { data, meta };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // No auth guard — cron-triggered, verify_jwt=false, no user input. Writes to internal Drive folder via service-role.


    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY mangler");
    if (!GOOGLE_DRIVE_API_KEY) throw new Error("GOOGLE_DRIVE_API_KEY mangler — connect Google Drive først");

    const startedAt = Date.now();
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const folderId = await ensureFolder();

    // 1) Dump alle tabeller
    const { data: tableData, meta } = await dumpAllTables(sb);

    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19); // 2026-06-10T07-30-00

    // 2) Upload JSON dump
    const dumpPayload = {
      generated_at: now.toISOString(),
      project: "comtek-pim",
      tables: meta,
      data: tableData,
    };
    const jsonId = await uploadFile(
      folderId,
      `pim-backup-${stamp}.json`,
      "application/json",
      JSON.stringify(dumpPayload),
    );

    // 3) Upload EAN-CSV (master_products)
    const masterRows = (tableData.master_products as Record<string, unknown>[]) ?? [];
    const csv = rowsToCsv(masterRows);
    const csvId = csv
      ? await uploadFile(folderId, `produkter-backup-${stamp}.csv`, "text/csv;charset=utf-8", csv)
      : null;

    // 4) Slet filer ældre end 7 dage
    const deleted = await deleteOldFiles(folderId);

    const elapsedMs = Date.now() - startedAt;

    // 5) Log til import_logs så det er synligt i UI
    const totalRows = Object.values(meta).reduce((a, b) => a + b.count, 0);
    await sb.from("import_logs").insert({
      source: "nightly-backup",
      status: "success",
      total_fetched: totalRows,
      imported: totalRows,
      completed_at: new Date().toISOString(),
      results: [{
        folder: FOLDER_NAME,
        json_file_id: jsonId,
        csv_file_id: csvId,
        tables: meta,
        deleted_old_files: deleted,
        elapsed_ms: elapsedMs,
      }],
    });

    return json({
      success: true,
      folder_id: folderId,
      json_file_id: jsonId,
      csv_file_id: csvId,
      tables: meta,
      deleted_old_files: deleted,
      elapsed_ms: elapsedMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[nightly-backup] FEJL:", message);
    try {
      const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await sb.from("import_logs").insert({
        source: "nightly-backup",
        status: "failed",
        completed_at: new Date().toISOString(),
        errors: [{ message }],
      });
    } catch { /* ignore */ }
    return json({ error: message }, 500);
  }
});
