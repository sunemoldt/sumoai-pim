// Daily scanner: pull current Shopify prices, compare against cheapest supplier
// purchase_price, and insert alerts when Shopify is selling below cost or at
// margin below the low-margin guard threshold.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_VERSION = "2026-04";
const VAT = 1.25;

async function gql(shop: string, token: string, query: string, variables: Record<string, unknown>) {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (!res.ok || data.errors) throw new Error(`Shopify ${res.status}: ${JSON.stringify(data.errors || data)}`);
  return data.data;
}

const VARIANTS_QUERY = `#graphql
  query Variants($cursor: String) {
    productVariants(first: 200, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        price
        compareAtPrice
        product { id status }
      }
    }
  }`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Thresholds: low_margin (guard) + min_sync_margin (used by stock recompute).
    const { data: settings } = await svc
      .from("analytics_settings")
      .select("setting_key,setting_value")
      .in("setting_key", ["low_margin_guard_threshold", "min_sync_margin_default"]);
    const threshold = Number(
      settings?.find((s) => s.setting_key === "low_margin_guard_threshold")?.setting_value ?? 10,
    );
    const minSyncMarginDefault = Number(
      settings?.find((s) => s.setting_key === "min_sync_margin_default")?.setting_value ?? 15,
    );


    const { data: conn } = await svc
      .from("shopify_connection")
      .select("shop_domain,access_token")
      .eq("is_active", true)
      .maybeSingle();
    if (!conn) throw new Error("No active Shopify connection");

    // Pull every variant's live price from Shopify.
    const variantPrices = new Map<string, { price: number; compareAt: number | null; status: string }>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const data = await gql(conn.shop_domain, conn.access_token, VARIANTS_QUERY, { cursor });
      const conn2 = data.productVariants;
      for (const v of conn2.nodes) {
        const vid = v.id?.split("/").pop();
        if (!vid) continue;
        variantPrices.set(vid, {
          price: Number(v.price),
          compareAt: v.compareAtPrice != null ? Number(v.compareAtPrice) : null,
          status: v.product?.status ?? "ACTIVE",
        });
      }
      cursor = conn2.pageInfo.hasNextPage ? conn2.pageInfo.endCursor : null;
      pages++;
      if (pages > 200) break; // safety
    } while (cursor);

    // Load PIM products that are synced with Shopify + their cheapest supplier.
    const { data: products } = await svc
      .from("master_products")
      .select("id,title,sku,shopify_variant_id,shopify_product_id,lifecycle_status,webshop_price,sale_price,stock_quantity,auto_stock_sync,stock_sync_supplier_ids,min_sync_margin")
      .not("shopify_variant_id", "is", null)
      .neq("lifecycle_status", "archived");

    if (!products?.length) {
      return new Response(JSON.stringify({ ok: true, scanned: 0, alerts: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const productIds = products.map((p) => p.id);
    const { data: suppliers } = await svc
      .from("supplier_products")
      .select("master_product_id,supplier_id,purchase_price,in_stock,stock_quantity")
      .in("master_product_id", productIds)
      .not("purchase_price", "is", null);

    // Cheapest per product (prefer in-stock; else any) — used for below_cost / low_margin.
    const cheapest = new Map<string, number>();
    const cheapestInStock = new Map<string, number>();
    // Per-product supplier rows for margin_blocked detection (restricted to selected suppliers).
    const byProduct = new Map<string, Array<{ supplier_id: string; pp: number; qty: number | null; in_stock: boolean }>>();
    for (const sp of suppliers ?? []) {
      const pp = Number(sp.purchase_price);
      if (!(pp > 0)) continue;
      const cur = cheapest.get(sp.master_product_id);
      if (cur == null || pp < cur) cheapest.set(sp.master_product_id, pp);
      if (sp.in_stock && (sp.stock_quantity == null || sp.stock_quantity > 0)) {
        const c2 = cheapestInStock.get(sp.master_product_id);
        if (c2 == null || pp < c2) cheapestInStock.set(sp.master_product_id, pp);
      }
      const arr = byProduct.get(sp.master_product_id) ?? [];
      arr.push({ supplier_id: sp.supplier_id, pp, qty: sp.stock_quantity, in_stock: !!sp.in_stock });
      byProduct.set(sp.master_product_id, arr);
    }


    // Existing unresolved alerts — keyed by (product_id, severity) so we can
    // auto-resolve those that no longer trigger this scan.
    const { data: openAlerts } = await svc
      .from("price_alerts")
      .select("id,master_product_id,severity")
      .is("resolved_at", null);
    const openByKey = new Map<string, string>(); // key -> alert id
    const openByProduct = new Map<string, string[]>(); // product -> severities
    for (const a of openAlerts ?? []) {
      openByKey.set(`${a.master_product_id}::${a.severity}`, a.id);
      const arr = openByProduct.get(a.master_product_id) ?? [];
      arr.push(a.severity);
      openByProduct.set(a.master_product_id, arr);
    }
    const stillTriggered = new Set<string>(); // keys still valid this scan
    // Track which products we actually evaluated per severity family — we only
    // auto-resolve alerts we successfully re-checked, so a missing Shopify
    // variant or missing supplier data never silently clears an alarm.
    const evaluatedPrice = new Set<string>();        // below_cost + low_margin
    const evaluatedMarginBlocked = new Set<string>(); // margin_blocked

    const inserts: any[] = [];
    let scanned = 0;

    for (const p of products) {
      const v = variantPrices.get(String(p.shopify_variant_id));
      if (!v) continue;
      if (v.status === "ARCHIVED") continue;
      scanned++;

      const purchase = cheapestInStock.get(p.id) ?? cheapest.get(p.id);
      if (purchase == null) continue;

      // Active selling price on Shopify: use `price` (that's what customers pay).
      const activeInc = v.price;
      if (!(activeInc > 0)) continue;
      const activeEx = activeInc / VAT;
      const marginPct = ((activeEx - purchase) / activeEx) * 100;

      // We successfully evaluated this product for below_cost/low_margin.
      evaluatedPrice.add(p.id);

      let severity: "below_cost" | "low_margin" | null = null;
      if (activeEx + 0.005 < purchase) severity = "below_cost";
      else if (marginPct < threshold) severity = "low_margin";
      if (!severity) continue;

      const key = `${p.id}::${severity}`;
      stillTriggered.add(key);
      if (openByKey.has(key)) continue; // already flagged

      inserts.push({
...
        },
      });
    }

    // === Second pass: margin_blocked ===
    for (const p of products as any[]) {
      if (!p.auto_stock_sync) continue;
      const selected: string[] = p.stock_sync_supplier_ids ?? [];
      if (!selected.length) continue;

      // We evaluated this product's margin_blocked status (result may be "not blocked").
      evaluatedMarginBlocked.add(p.id);

      if ((p.stock_quantity ?? 0) > 0) continue; // not blocked

      const rows = (byProduct.get(p.id) ?? []).filter(
        (r) => selected.includes(r.supplier_id) && r.in_stock && (r.qty == null || r.qty > 0),
      );
      if (!rows.length) continue; // genuinely out of stock, not blocked

      const activeInc = Number(p.sale_price ?? p.webshop_price ?? 0);
      if (!(activeInc > 0)) continue;
      const activeEx = activeInc / VAT;
      const minMargin = Number(p.min_sync_margin ?? minSyncMarginDefault);

      const anyPasses = rows.some((r) => ((activeEx - r.pp) / activeEx) * 100 >= minMargin);
      if (anyPasses) continue;

      const cheapestSel = rows.reduce((min, r) => (r.pp < min ? r.pp : min), rows[0].pp);
      const marginPct = ((activeEx - cheapestSel) / activeEx) * 100;

      const key = `${p.id}::margin_blocked`;
      stillTriggered.add(key);
      if (openByKey.has(key)) continue;

      inserts.push({
        master_product_id: p.id,
        shopify_price: activeInc,
        shopify_compare_at_price: null,
        cheapest_purchase_price: cheapestSel,
        margin_pct: Number(marginPct.toFixed(2)),
        severity: "margin_blocked",
        source: "shopify-scanner",
        details: {
          title: p.title,
          sku: p.sku,
          shopify_variant_id: p.shopify_variant_id,
          min_sync_margin_pct: minMargin,
          reason: "Salg stoppet automatisk fordi margin er under min_sync_margin",
        },
      });
    }

    if (inserts.length) {
      const { error } = await svc.from("price_alerts").insert(inserts);
      if (error) throw error;
    }

    // Auto-resolve only alerts we actually re-evaluated this scan. Alerts whose
    // product we couldn't check (missing variant, missing supplier data, etc.)
    // stay open so nothing gets silently cleared.
    const toResolve: string[] = [];
    for (const [key, id] of openByKey.entries()) {
      if (stillTriggered.has(key)) continue;
      const [pid, sev] = key.split("::");
      const wasEvaluated =
        sev === "margin_blocked" ? evaluatedMarginBlocked.has(pid) : evaluatedPrice.has(pid);
      if (wasEvaluated) toResolve.push(id);
    }
    if (toResolve.length) {
      await svc
        .from("price_alerts")
        .update({ resolved_at: new Date().toISOString() })
        .in("id", toResolve);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        scanned,
        alerts: inserts.length,
        auto_resolved: toResolve.length,
        variants_pulled: variantPrices.size,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (e) {
    console.error("shopify-below-cost-scanner error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
