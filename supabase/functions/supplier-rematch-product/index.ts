// Rematch a single PIM product against all active supplier feeds.
// Used to auto-populate supplier_products for newly created/pulled products
// when supplier feeds were imported before the product appeared.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const normalizeEan = (value: string | null | undefined) => {
  const trimmed = (value ?? "").trim();
  return trimmed.replace(/^0+/, "") || trimmed;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // Allow service-role (internal callers) or authenticated users
  const isService = authHeader.includes(SUPABASE_SERVICE_ROLE_KEY);
  if (!isService) {
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await anon.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    const { master_product_id } = await req.json();
    if (!master_product_id) {
      return new Response(JSON.stringify({ error: "master_product_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: product } = await supabase
      .from("master_products")
      .select("id, ean")
      .eq("id", master_product_id)
      .single();
    if (!product?.ean) {
      return new Response(JSON.stringify({ error: "Product has no EAN" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const productEan = normalizeEan(product.ean);
    const eanCandidates = Array.from(new Set([product.ean, productEan].filter(Boolean)));

    // Fast path: use the maintained feed cache so newly-created products can be
    // linked to supplier offers immediately without downloading every feed.
    const { data: cacheRows, error: cacheErr } = await supabase
      .from("supplier_feed_cache")
      .select("supplier_id, purchase_price, in_stock, stock_quantity, supplier_sku, last_seen_at, suppliers(id, name)")
      .in("ean", eanCandidates);
    if (cacheErr) throw new Error(`Supplier cache lookup failed: ${cacheErr.message}`);

    const bestBySupplier = new Map<string, any>();
    for (const row of (cacheRows ?? []) as any[]) {
      const price = Number(row.purchase_price ?? 0);
      if (!row.supplier_id || !Number.isFinite(price) || price <= 0) continue;
      const existing = bestBySupplier.get(row.supplier_id);
      if (
        !existing ||
        (Boolean(row.in_stock) && !Boolean(existing.in_stock)) ||
        (Boolean(row.in_stock) === Boolean(existing.in_stock) && price < Number(existing.purchase_price ?? Infinity))
      ) {
        bestBySupplier.set(row.supplier_id, row);
      }
    }

    const cacheMatches = Array.from(bestBySupplier.values());
    let imported = 0;
    if (cacheMatches.length > 0) {
      const supplierIds = cacheMatches.map((row: any) => row.supplier_id);
      const { data: existingRows } = await supabase
        .from("supplier_products")
        .select("supplier_id, purchase_price, stock_quantity, in_stock, supplier_sku")
        .eq("master_product_id", product.id)
        .in("supplier_id", supplierIds);

      const existingBySupplier = new Map((existingRows ?? []).map((row: any) => [row.supplier_id, row]));
      const nowIso = new Date().toISOString();
      const upsertRows = cacheMatches.map((row: any) => ({
        supplier_id: row.supplier_id,
        master_product_id: product.id,
        purchase_price: Number(row.purchase_price),
        in_stock: Boolean(row.in_stock),
        stock_quantity: row.stock_quantity ?? null,
        supplier_sku: row.supplier_sku ?? null,
        last_updated: nowIso,
      }));

      const changeLogs: Array<{
        master_product_id: string;
        change_type: string;
        field_name: string;
        old_value: string | null;
        new_value: string | null;
        source: string;
      }> = [];

      for (const row of cacheMatches as any[]) {
        const existing = existingBySupplier.get(row.supplier_id) as any;
        const supplierName = row.suppliers?.name ?? "Ukendt leverandør";
        const price = Number(row.purchase_price);
        if (!existing) {
          changeLogs.push({ master_product_id: product.id, change_type: "supplier_added", field_name: "supplier_product", old_value: null, new_value: `${supplierName}: ${price} DKK`, source: "supplier-rematch-cache" });
        } else {
          if (Number(existing.purchase_price) !== price) {
            changeLogs.push({ master_product_id: product.id, change_type: "price_update", field_name: "purchase_price", old_value: String(existing.purchase_price), new_value: String(price), source: "supplier-rematch-cache" });
          }
          if (existing.stock_quantity !== (row.stock_quantity ?? null)) {
            changeLogs.push({ master_product_id: product.id, change_type: "stock_update", field_name: "supplier_stock_quantity", old_value: String(existing.stock_quantity ?? "null"), new_value: String(row.stock_quantity ?? "null"), source: "supplier-rematch-cache" });
          }
          if (existing.in_stock !== Boolean(row.in_stock)) {
            changeLogs.push({ master_product_id: product.id, change_type: "stock_update", field_name: "supplier_in_stock", old_value: String(existing.in_stock), new_value: String(Boolean(row.in_stock)), source: "supplier-rematch-cache" });
          }
        }
      }

      await supabase.rpc("set_bulk_supplier_import", { enabled: true });
      const { error: upsertErr } = await supabase
        .from("supplier_products")
        .upsert(upsertRows, { onConflict: "supplier_id,master_product_id" });
      await supabase.rpc("set_bulk_supplier_import", { enabled: false });
      if (upsertErr) throw new Error(`Supplier match upsert failed: ${upsertErr.message}`);

      imported = upsertRows.length;

      if (changeLogs.length > 0) {
        const { error: logErr } = await supabase.from("product_change_log").insert(changeLogs);
        if (logErr) console.error("supplier-rematch change log failed:", logErr.message);
      }

      const { error: stockErr } = await supabase.rpc("recompute_product_stock", { p_master_product_id: product.id });
      if (stockErr) console.error("supplier-rematch stock recompute failed:", stockErr.message);
    }

    const shouldRefreshFeeds = imported === 0;

    const { data: suppliers } = shouldRefreshFeeds ? await supabase
      .from("suppliers")
      .select("id, name, feed_type, feed_url")
      .eq("is_active", true) : { data: [] as any[] };

    // Only suppliers with auto-feeds (api/csv/xml/ftp) — manual ones can't be re-imported on demand
    const targets = (suppliers ?? []).filter((s) =>
      ["api", "csv", "xml", "ftp"].includes(s.feed_type ?? "")
    );

    const results: Array<{ supplier: string; ok: boolean; started?: boolean; error?: string }> = [];
    // Kick off each supplier import in async mode: the import function returns 202 immediately
    // and does the heavy work in EdgeRuntime.waitUntil, so a slow supplier can't cause a 504
    // for this rematch call. Callers should re-fetch supplier_products shortly after.
    await Promise.all(targets.map(async (s) => {
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/supplier-feed-import`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
          },
          body: JSON.stringify({ supplier_id: s.id, target_ean: product.ean, async: true }),
        });
        const j = await r.json().catch(() => ({}));
        results.push({ supplier: s.name, ok: r.ok && j.success !== false, started: j.started === true, error: j.error });
      } catch (e) {
        results.push({ supplier: s.name, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }));

    return new Response(JSON.stringify({
      success: true,
      ean: product.ean,
      total_imported: imported,
      cache_matches: imported,
      started: results.filter(r => r.started).length,
      results,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
