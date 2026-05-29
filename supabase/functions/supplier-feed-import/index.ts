import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function assertSafeFeedUrl(raw: string): void {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error("Invalid feed URL"); }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Feed URL must use http or https");
  }
  const host = parsed.hostname.toLowerCase();
  const blocked = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.|::1$|0\.)/;
  if (host === "localhost" || host === "::1" || blocked.test(host) || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new Error("Feed URL targets a private/internal address");
  }
}

function parseCsv(text: string, delimiter: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(delimiter).map((h) => h.trim().replace(/^["']|["']$/g, ""));
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(delimiter).map((v) => v.trim().replace(/^["']|["']$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = vals[idx] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

function parseXml(text: string): Record<string, string>[] {
  // Simple XML parser for product feeds - finds repeating elements
  const rows: Record<string, string>[] = [];
  const productTags = ["product", "item", "row", "Product", "Item", "Row"];
  let tag = "";
  for (const t of productTags) {
    if (text.includes(`<${t}`) || text.includes(`<${t}>`)) {
      tag = t;
      break;
    }
  }
  if (!tag) return rows;

  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  let match;
  while ((match = regex.exec(text)) !== null) {
    const inner = match[1];
    const row: Record<string, string> = {};
    const fieldRegex = /<([a-zA-Z_][a-zA-Z0-9_.-]*)>([^<]*)<\/\1>/g;
    let fieldMatch;
    while ((fieldMatch = fieldRegex.exec(inner)) !== null) {
      row[fieldMatch[1]] = fieldMatch[2].trim();
    }
    if (Object.keys(row).length > 0) rows.push(row);
  }
  return rows;
}

/** Aurdel-specific XML parser for their item/stock database format */
function parseAurdelItemXml(text: string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  const itemRegex = /<item\s+id="([^"]*)">([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(text)) !== null) {
    const sku = match[1];
    const inner = match[2];
    const row: Record<string, string> = { supplier_sku: sku };

    // EAN
    const eanMatch = inner.match(/<ean>([^<]*)<\/ean>/i);
    if (eanMatch) row.ean = eanMatch[1].trim().replace(/^0+/, "") || eanMatch[1].trim();

    // Price (net)
    const netMatch = inner.match(/<net[^>]*>([^<]*)<\/net>/i);
    if (netMatch) row.purchase_price = netMatch[1].trim().replace(",", ".");

    // Stock quantity (attribute)
    const stockMatch = inner.match(/<stock\s+quantity="([^"]*)"/i);
    if (stockMatch) row.stock_quantity = stockMatch[1].trim();

    // Short description (may have CDATA)
    const shortDesc = inner.match(/<short>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/short>/i);
    if (shortDesc) row.short_description = shortDesc[1].trim();

    // Manufacturer
    const mfgMatch = inner.match(/<manufacturer[^>]*><description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);
    if (mfgMatch) row.manufacturer = mfgMatch[1].trim();

    if (row.ean || row.purchase_price) rows.push(row);
  }
  return rows;
}

/** Aurdel stock-only XML parser: <item id="SKU"><stock quantity="N"/></item> */
function parseAurdelStockXml(text: string): Map<string, string> {
  const stockMap = new Map<string, string>();
  const itemRegex = /<item\s+id="([^"]*)">\s*<stock\s+quantity="([^"]*)"/gi;
  let match;
  while ((match = itemRegex.exec(text)) !== null) {
    stockMap.set(match[1], match[2]);
  }
  return stockMap;
}

function buildFtpPathCandidates(path: string, user: string): string[] {
  const trimmed = path.trim();
  const noLeadingSlash = trimmed.replace(/^\/+/, "");
  const fileName = noLeadingSlash.split("/").filter(Boolean).pop() ?? noLeadingSlash;
  const suffix = noLeadingSlash || fileName;
  const userFolder = user.replace(/^aln/i, "");

  return [...new Set([
    trimmed,
    noLeadingSlash,
    fileName,
    `/${fileName}`,
    userFolder ? `${userFolder}/${fileName}` : "",
    userFolder ? `/${userFolder}/${fileName}` : "",
    user ? `${user}/${fileName}` : "",
    user ? `/${user}/${fileName}` : "",
    userFolder && suffix ? `${userFolder}/${suffix}` : "",
    userFolder && suffix ? `/${userFolder}/${suffix}` : "",
  ].filter(Boolean))];
}

/** Minimal FTP client (passive mode, binary download) using Deno TCP.
 *  If onLine is provided, the data stream is parsed line-by-line and onLine is
 *  invoked for each complete line — no full-file string is built. Returns "".
 *  If onLine is omitted, the entire file is decoded and returned as a string.
 */
async function downloadViaFtp(
  host: string,
  user: string,
  pass: string,
  path: string,
  onLine?: (line: string) => void,
): Promise<string> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const conn = await Deno.connect({ hostname: host, port: 21 });

  async function readResponse(): Promise<string> {
    const buf = new Uint8Array(4096);
    let result = "";
    while (true) {
      const n = await conn.read(buf);
      if (n === null) break;
      result += decoder.decode(buf.subarray(0, n));
      if (/\r\n$/.test(result)) break;
      if (result.length > 100000) break;
    }
    return result;
  }

  async function send(cmd: string): Promise<string> {
    await conn.write(encoder.encode(cmd + "\r\n"));
    return await readResponse();
  }

  async function openPassiveDataConnection() {
    const pasvResp = await send("PASV");
    const m = pasvResp.match(/\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/);
    if (!m) throw new Error(`PASV parse failed: ${pasvResp.trim()}`);
    const dataHost = `${m[1]}.${m[2]}.${m[3]}.${m[4]}`;
    const dataPort = parseInt(m[5], 10) * 256 + parseInt(m[6], 10);
    return Deno.connect({ hostname: dataHost, port: dataPort });
  }

  try {
    await readResponse();
    let resp = await send(`USER ${user}`);
    if (/^3\d\d/.test(resp)) resp = await send(`PASS ${pass}`);
    if (!/^2\d\d/.test(resp)) throw new Error(`FTP login failed: ${resp.trim()}`);
    await send("TYPE I");

    const candidates = buildFtpPathCandidates(path, user);
    let lastError = "";

    for (const candidate of candidates) {
      const dataConn = await openPassiveDataConnection();
      const retrResp = await send(`RETR ${candidate}`);
      if (!/^1\d\d/.test(retrResp)) {
        lastError = retrResp.trim();
        try { dataConn.close(); } catch { /* noop */ }
        continue;
      }

      const streamDecoder = new TextDecoder("utf-8", { fatal: false });
      const dbuf = new Uint8Array(65536);
      let bytes = 0;

      if (onLine) {
        let pending = "";
        let lineCount = 0;
        while (true) {
          const n = await dataConn.read(dbuf);
          if (n === null) break;
          bytes += n;
          pending += streamDecoder.decode(dbuf.subarray(0, n), { stream: true });
          let nl: number;
          while ((nl = pending.indexOf("\n")) !== -1) {
            const line = pending.slice(0, nl).replace(/\r$/, "");
            pending = pending.slice(nl + 1);
            onLine(line);
            lineCount++;
          }
        }
        pending += streamDecoder.decode();
        if (pending.length > 0) { onLine(pending.replace(/\r$/, "")); lineCount++; }
        dataConn.close();
        await readResponse();
        try { await send("QUIT"); } catch { /* noop */ }
        console.log(`FTP RETR ${candidate} streamed: ${bytes} bytes, ${lineCount} lines`);
        return "";
      }

      let text = "";
      while (true) {
        const n = await dataConn.read(dbuf);
        if (n === null) break;
        bytes += n;
        text += streamDecoder.decode(dbuf.subarray(0, n), { stream: true });
      }
      text += streamDecoder.decode();
      dataConn.close();
      await readResponse();
      try { await send("QUIT"); } catch { /* noop */ }
      console.log(`FTP RETR ${candidate} ok: ${bytes} bytes, ${text.length} chars`);
      return text;
    }

    throw new Error(`RETR failed: ${lastError || "file not found"}`);
  } finally {
    try { conn.close(); } catch { /* noop */ }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Auth check: require authenticated user or service role
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!authHeader.includes(SUPABASE_SERVICE_ROLE_KEY)) {
    const anonClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { supplier_id, target_ean: rawTargetEan } = await req.json();
    if (!supplier_id) {
      return new Response(JSON.stringify({ error: "supplier_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Optional: only process rows matching this normalized EAN (used by supplier-rematch-product)
    const targetEan: string | null = rawTargetEan
      ? (String(rawTargetEan).trim().replace(/^0+/, "") || String(rawTargetEan).trim())
      : null;

    // Get supplier
    const { data: supplier, error: supErr } = await supabase
      .from("suppliers")
      .select("*")
      .eq("id", supplier_id)
      .single();
    if (supErr || !supplier) throw new Error("Supplier not found");

    const mapping = (supplier.column_mapping ?? {}) as Record<string, string>;

    let feedRows: Record<string, string>[];
    let eanToIdEarlyOuter: Map<string, string> | null = null;

    if (supplier.feed_type === "api") {
      // Aurdel API: build URL from stored credentials
      const apiDbStr = mapping._api_database || "item";
      const apiDbs = apiDbStr.split(",").map((d: string) => d.trim()).filter(Boolean);
      const apiCust = mapping._api_customer_id;
      const apiComp = mapping._api_company_id;
      const apiKeyVal = mapping._api_key;
      const apiLang = mapping._api_language || "da";
      if (!apiCust || !apiComp) throw new Error("API credentials not configured (customerid, companyid)");

      feedRows = [];

      // First pass: fetch all databases
      let stockMap = new Map<string, string>(); // SKU -> quantity

      for (const db of apiDbs) {
        const params = new URLSearchParams({
          database: db,
          customerid: apiCust,
          companyid: apiComp,
          language: apiLang,
        });
        if (apiKeyVal) params.set("apikey", apiKeyVal);

        const apiUrl = `https://api.aurdel.com/Prices/getPrice?${params.toString()}`;
        console.log(`Fetching Aurdel API database=${db}...`);
        const res = await fetch(apiUrl);
        if (!res.ok) throw new Error(`API returned status ${res.status} for database=${db}`);
        const text = await res.text();

        if (db === "stock") {
          stockMap = parseAurdelStockXml(text);
          console.log(`Stock database: ${stockMap.size} SKUs with stock data`);
        } else {
          const rows = parseAurdelItemXml(text);
          console.log(`Item database: ${rows.length} items parsed`);
          feedRows.push(...rows);
        }
      }

      // Merge stock data into item rows by SKU
      if (stockMap.size > 0 && feedRows.length > 0) {
        let merged = 0;
        for (const row of feedRows) {
          const sku = row.supplier_sku;
          if (sku && stockMap.has(sku)) {
            row.stock_quantity = stockMap.get(sku)!;
            merged++;
          }
        }
        console.log(`Merged stock data for ${merged} items by SKU`);
      }

      // Set auto-mapping for Aurdel format
      mapping.ean = "ean";
      mapping.purchase_price = "purchase_price";
      mapping.stock_quantity = "stock_quantity";
      mapping.sku = "supplier_sku";
    } else {
      const mappingAny = mapping as Record<string, string>;
      const isFtp = supplier.feed_type === "ftp";

      if (!isFtp) {
        if (!supplier.feed_url) throw new Error("No feed URL configured");
      }
      if (!mapping.ean) throw new Error("EAN mapping not configured");
      if (!mapping.purchase_price) throw new Error("Purchase price mapping not configured");

      const delimiter = mapping._delimiter || ";";

      let text: string | null = null;

      if (isFtp) {
        const host = mappingAny._ftp_host?.trim();
        const user = mappingAny._ftp_user?.trim();
        const pass = mappingAny._ftp_pass?.trim();
        const path = mappingAny._ftp_path?.trim();
        if (!host || !path) throw new Error("FTP host og filsti er påkrævet");

        const cleanPath = path.startsWith("/") ? path : `/${path}`;
        console.log(`FTP download from ${host}${cleanPath} as ${user || "anonymous"}`);

        // Pre-fetch EANs so we can filter on-the-fly and avoid loading the whole CSV in memory
        const { data: mpsEarly, error: mpEarlyErr } = await supabase
          .from("master_products").select("id, ean");
        if (mpEarlyErr) throw new Error(`Failed to fetch master products: ${mpEarlyErr.message}`);
        eanToIdEarlyOuter = new Map<string, string>();
        for (const mp of mpsEarly ?? []) {
          const normEan = (mp.ean ?? "").replace(/^0+/, "") || (mp.ean ?? "");
          if (normEan) eanToIdEarlyOuter.set(normEan, mp.id);
        }

        feedRows = [];
        let headers: string[] | null = null;
        let eanIdx = -1;
        const eanCol = mapping.ean;
        await downloadViaFtp(host, user || "anonymous", pass || "", cleanPath, (line: string) => {
          if (!line) return;
          if (headers === null) {
            headers = line.split(delimiter).map((h) => h.trim().replace(/^["']|["']$/g, ""));
            eanIdx = headers.indexOf(eanCol);
            return;
          }
          if (eanIdx === -1) return;
          const vals = line.split(delimiter);
          const rawEan = (vals[eanIdx] ?? "").trim().replace(/^["']|["']$/g, "");
          if (!rawEan) return;
          const ean = rawEan.replace(/^0+/, "") || rawEan;
          if (!eanToIdEarlyOuter!.has(ean)) return;
          const row: Record<string, string> = {};
          headers.forEach((h, idx) => {
            row[h] = (vals[idx] ?? "").trim().replace(/^["']|["']$/g, "");
          });
          feedRows.push(row);
        });
        console.log(`Streamed CSV: kept ${feedRows.length} matching rows`);
      } else {
        assertSafeFeedUrl(supplier.feed_url!);
        const res = await fetch(supplier.feed_url!);
        if (!res.ok) throw new Error(`Failed to fetch feed: ${res.status}`);
        text = await res.text();
        if (supplier.feed_type === "xml") {
          feedRows = parseXml(text);
        } else {
          feedRows = parseCsv(text, delimiter);
        }
      }
    }

    if (feedRows.length === 0) throw new Error("No rows found in feed");

    // Get all existing EANs from master_products (skip if already loaded during streaming FTP path)
    let eanToId: Map<string, string>;
    if (typeof eanToIdEarlyOuter !== "undefined" && eanToIdEarlyOuter) {
      eanToId = eanToIdEarlyOuter;
    } else {
      const { data: masterProducts, error: mpErr } = await supabase
        .from("master_products")
        .select("id, ean");
      if (mpErr) throw new Error(`Failed to fetch master products: ${mpErr.message}`);
      eanToId = new Map<string, string>();
      for (const mp of masterProducts ?? []) {
        const normEan = mp.ean.replace(/^0+/, "") || mp.ean;
        eanToId.set(normEan, mp.id);
      }
    }

    // Process feed rows - only those matching existing EANs
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];
    const changeLogs: { master_product_id: string; change_type: string; field_name: string; old_value: string | null; new_value: string | null; source: string }[] = [];

    // Pre-fetch existing supplier_products for diff detection
    const { data: existingSps } = await supabase
      .from("supplier_products")
      .select("master_product_id, purchase_price, stock_quantity, in_stock, supplier_sku")
      .eq("supplier_id", supplier.id);
    const existingMap = new Map<string, typeof existingSps extends (infer T)[] | null ? T : never>();
    for (const sp of existingSps ?? []) {
      existingMap.set(sp.master_product_id, sp);
    }

    // Build all upsert rows in memory first (no per-row DB calls)
    const spRows: Array<{
      supplier_id: string;
      master_product_id: string;
      purchase_price: number;
      stock_quantity: number | null;
      in_stock: boolean;
      supplier_sku: string | null;
      last_updated: string;
    }> = [];
    const nowIso = new Date().toISOString();

    for (const row of feedRows) {
      const rawEan = row[mapping.ean]?.trim();
      if (!rawEan) { skipped++; continue; }
      const ean = rawEan.replace(/^0+/, "") || rawEan;

      const masterProductId = eanToId.get(ean);
      if (!masterProductId) { skipped++; continue; }

      const priceStr = row[mapping.purchase_price]?.trim().replace(",", ".");
      let price = parseFloat(priceStr);
      if (isNaN(price)) { skipped++; continue; }
      if ((mapping as any)._currency === "EUR") {
        const rate = parseFloat(((mapping as any)._eur_rate ?? "7.46").toString().replace(",", ".")) || 7.46;
        price = Math.round(price * rate * 100) / 100;
      }

      const stockStr = mapping.stock_quantity ? row[mapping.stock_quantity]?.trim() : null;
      const stockQty = stockStr ? parseInt(stockStr, 10) : null;

      let inStock = true;
      if (mapping.in_stock) {
        const val = row[mapping.in_stock]?.trim().toLowerCase();
        inStock = val === "1" || val === "yes" || val === "ja" || val === "true" || val === "in stock" || val === "på lager";
      } else if (stockQty !== null && !isNaN(stockQty)) {
        inStock = stockQty > 0;
      }

      const supplierSku = mapping.sku ? row[mapping.sku]?.trim() || null : null;

      // Detect changes for changelog
      const existing = existingMap.get(masterProductId);
      if (existing) {
        if (Number(existing.purchase_price) !== price) {
          changeLogs.push({ master_product_id: masterProductId, change_type: "price_update", field_name: "purchase_price", old_value: String(existing.purchase_price), new_value: String(price), source: `supplier:${supplier.name}` });
        }
        if (existing.stock_quantity !== (stockQty !== null && !isNaN(stockQty) ? stockQty : null)) {
          changeLogs.push({ master_product_id: masterProductId, change_type: "stock_update", field_name: "supplier_stock_quantity", old_value: String(existing.stock_quantity ?? "null"), new_value: String(stockQty ?? "null"), source: `supplier:${supplier.name}` });
        }
        if (existing.in_stock !== inStock) {
          changeLogs.push({ master_product_id: masterProductId, change_type: "stock_update", field_name: "supplier_in_stock", old_value: String(existing.in_stock), new_value: String(inStock), source: `supplier:${supplier.name}` });
        }
      } else {
        changeLogs.push({ master_product_id: masterProductId, change_type: "supplier_added", field_name: "supplier_product", old_value: null, new_value: `${supplier.name}: ${price} DKK`, source: `supplier:${supplier.name}` });
      }

      spRows.push({
        supplier_id: supplier.id,
        master_product_id: masterProductId,
        purchase_price: price,
        stock_quantity: stockQty !== null && !isNaN(stockQty) ? stockQty : null,
        in_stock: inStock,
        supplier_sku: supplierSku,
        last_updated: nowIso,
      });
    }

    // Deduplicate by (supplier_id, master_product_id) — last row wins.
    // Some feeds (e.g. DCS) list the same EAN multiple times; without this,
    // upsert fails with "ON CONFLICT DO UPDATE command cannot affect row a second time".
    const dedupMap = new Map<string, typeof spRows[number]>();
    for (const r of spRows) {
      dedupMap.set(`${r.supplier_id}::${r.master_product_id}`, r);
    }
    const dedupedRows = Array.from(dedupMap.values());
    if (dedupedRows.length !== spRows.length) {
      console.log(`Deduplicated ${spRows.length - dedupedRows.length} duplicate rows by EAN`);
    }

    // Bulk upsert in batches of 500. Triggers are bypassed via app.bulk_supplier_import flag.
    for (let i = 0; i < dedupedRows.length; i += 500) {
      const batch = dedupedRows.slice(i, i + 500);
      // Set bulk flag (session-scoped) right before each batch
      await supabase.rpc("set_bulk_supplier_import", { enabled: true });
      const { error: upsErr } = await supabase
        .from("supplier_products")
        .upsert(batch, { onConflict: "supplier_id,master_product_id" });
      if (upsErr) {
        errors.push(`Batch ${i}: ${upsErr.message}`);
      } else {
        imported += batch.length;
      }
    }
    // Always reset flag
    await supabase.rpc("set_bulk_supplier_import", { enabled: false });

    // Insert change logs in batches
    if (changeLogs.length > 0) {
      for (let i = 0; i < changeLogs.length; i += 500) {
        await supabase.from("product_change_log").insert(changeLogs.slice(i, i + 500));
      }
      console.log(`Logged ${changeLogs.length} changes`);
    }

    // Recompute master stock for all products linked to this supplier (single batch call)
    const { error: recomputeErr } = await supabase.rpc("recompute_stock_for_supplier", {
      p_supplier_id: supplier.id,
    });
    if (recomputeErr) {
      console.error("Stock recompute error:", recomputeErr.message);
    }

    // Update last_sync_at
    await supabase
      .from("suppliers")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("id", supplier.id);

    return new Response(
      JSON.stringify({
        success: true,
        total_rows: feedRows.length,
        imported,
        skipped,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Supplier feed import error:", msg);
    return new Response(JSON.stringify({
      error: msg,
      success: false,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
