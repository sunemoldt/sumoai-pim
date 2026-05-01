// Sammenligner PIM (master_products) med Shopify for udvalgte produkter.
// Tjekker: titel, beskrivelser, pris, sale_price, lager, stock_status.
// Mode: 'report' (default) = kun rapport. 'apply' = opdater Shopify ud fra PIM.
// Filter: { brand?: string, eans?: string[], limit?: number }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_VERSION = "2025-10";

async function gql(shop: string, token: string, query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`Shopify GQL ${res.status}: ${JSON.stringify(json.errors || json)}`);
  return json.data;
}

function stripHtml(s: string | null | undefined): string {
  if (!s) return "";
  return String(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
function normNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!authHeader.includes(SUPABASE_SERVICE_ROLE_KEY)) {
      const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
      const { data: { user }, error } = await anon.auth.getUser();
      if (error || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const mode: "report" | "apply" = body.mode === "apply" ? "apply" : "report";
    const brand: string | null = body.brand ?? null;
    const eans: string[] | null = Array.isArray(body.eans) ? body.eans : null;
    const limit: number = Math.min(Number(body.limit) || 20, 100);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: conn } = await supabase
      .from("shopify_connection")
      .select("shop_domain, access_token")
      .order("installed_at", { ascending: false })
      .limit(1).maybeSingle();
    if (!conn) throw new Error("Ingen Shopify-forbindelse");

    let q = supabase.from("master_products")
      .select("id, ean, sku, title, short_description, long_description, webshop_price, sale_price, stock_quantity, stock_status, backorders_allowed, shopify_product_id, shopify_variant_id")
      .not("shopify_variant_id", "is", null);
    if (eans && eans.length) q = q.in("ean", eans);
    else if (brand) q = q.or(`brand.ilike.%${brand}%,title.ilike.%${brand}%`);
    q = q.order("title").limit(limit);

    const { data: pimRows, error } = await q;
    if (error) throw error;
    if (!pimRows || pimRows.length === 0) {
      return new Response(JSON.stringify({ success: true, mode, message: "Ingen PIM-produkter matchede filteret", results: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Hent unikke produkter (for description/title) og varianter (for pris/lager)
    const productGids = Array.from(new Set(pimRows.map(r => `gid://shopify/Product/${r.shopify_product_id}`)));
    const variantGids = pimRows.map(r => `gid://shopify/ProductVariant/${r.shopify_variant_id}`);

    const productData = await gql(conn.shop_domain, conn.access_token, `
      query($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product { id title descriptionHtml }
        }
      }`, { ids: productGids });

    const variantData = await gql(conn.shop_domain, conn.access_token, `
      query($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id title sku barcode price compareAtPrice inventoryPolicy inventoryQuantity
            inventoryItem { id }
            product { id title }
          }
        }
      }`, { ids: variantGids });

    const productMap = new Map<string, any>();
    for (const n of productData.nodes ?? []) if (n) productMap.set(n.id.replace("gid://shopify/Product/", ""), n);
    const variantMap = new Map<string, any>();
    for (const n of variantData.nodes ?? []) if (n) variantMap.set(n.id.replace("gid://shopify/ProductVariant/", ""), n);

    // Hent én lokation til inventory adjust
    let locationId: string | null = null;
    if (mode === "apply") {
      const loc = await gql(conn.shop_domain, conn.access_token, `query { locations(first: 1) { nodes { id } } }`);
      locationId = loc.locations?.nodes?.[0]?.id ?? null;
    }

    const results: any[] = [];
    let appliedCount = 0;

    for (const p of pimRows) {
      const sp = productMap.get(p.shopify_product_id);
      const sv = variantMap.get(p.shopify_variant_id);
      if (!sp || !sv) {
        results.push({ ean: p.ean, title: p.title, error: "Shopify produkt/variant ikke fundet" });
        continue;
      }

      const diffs: any[] = [];
      const pimDesc = stripHtml(p.long_description);
      const shopDesc = stripHtml(sp.descriptionHtml);

      if ((p.title || "") !== (sp.title || "")) diffs.push({ field: "title", pim: p.title, shopify: sp.title });
      if (pimDesc !== shopDesc) diffs.push({ field: "description", pim_len: pimDesc.length, shopify_len: shopDesc.length, pim_preview: pimDesc.slice(0, 80), shopify_preview: shopDesc.slice(0, 80) });

      const pimPrice = normNum(p.webshop_price);
      const shopPrice = normNum(sv.price);
      if (pimPrice !== shopPrice) diffs.push({ field: "price", pim: pimPrice, shopify: shopPrice });

      const pimSale = normNum(p.sale_price);
      const shopSale = normNum(sv.compareAtPrice);
      if (pimSale !== shopSale) diffs.push({ field: "sale_price/compareAtPrice", pim: pimSale, shopify: shopSale });

      const pimQty = normNum(p.stock_quantity) ?? 0;
      const shopQty = normNum(sv.inventoryQuantity) ?? 0;
      if (pimQty !== shopQty) diffs.push({ field: "stock_quantity", pim: pimQty, shopify: shopQty });

      const pimPolicy = p.backorders_allowed ? "CONTINUE" : "DENY";
      if (pimPolicy !== sv.inventoryPolicy) diffs.push({ field: "inventoryPolicy", pim: pimPolicy, shopify: sv.inventoryPolicy });

      const entry: any = {
        ean: p.ean, sku: p.sku, title: p.title,
        shopify_product_id: p.shopify_product_id,
        shopify_variant_id: p.shopify_variant_id,
        in_sync: diffs.length === 0,
        diffs,
      };

      if (mode === "apply" && diffs.length > 0) {
        const applied: string[] = [];
        try {
          // Update product (title + description)
          const productUpdates: Record<string, unknown> = { id: `gid://shopify/Product/${p.shopify_product_id}` };
          if (p.title && p.title !== sp.title) { productUpdates.title = p.title; applied.push("title"); }
          if (p.long_description && stripHtml(p.long_description) !== shopDesc) { productUpdates.descriptionHtml = p.long_description; applied.push("description"); }
          if (Object.keys(productUpdates).length > 1) {
            const r = await gql(conn.shop_domain, conn.access_token, `
              mutation($input: ProductInput!) {
                productUpdate(input: $input) { product { id } userErrors { field message } }
              }`, { input: productUpdates });
            const errs = r.productUpdate?.userErrors;
            if (errs?.length) throw new Error(`productUpdate: ${errs.map((e: any) => e.message).join(", ")}`);
          }

          // Update variant (price, compareAtPrice, inventoryPolicy)
          const variantInput: Record<string, unknown> = { id: `gid://shopify/ProductVariant/${p.shopify_variant_id}` };
          if (pimPrice !== null && pimPrice !== shopPrice) { variantInput.price = String(pimPrice); applied.push("price"); }
          if (pimSale !== shopSale) { variantInput.compareAtPrice = pimSale !== null ? String(pimSale) : null; applied.push("compareAtPrice"); }
          if (pimPolicy !== sv.inventoryPolicy) { variantInput.inventoryPolicy = pimPolicy; applied.push("inventoryPolicy"); }
          if (Object.keys(variantInput).length > 1) {
            const r = await gql(conn.shop_domain, conn.access_token, `
              mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
                productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                  userErrors { field message }
                }
              }`, { productId: `gid://shopify/Product/${p.shopify_product_id}`, variants: [variantInput] });
            const errs = r.productVariantsBulkUpdate?.userErrors;
            if (errs?.length) throw new Error(`variantsBulkUpdate: ${errs.map((e: any) => e.message).join(", ")}`);
          }

          // Inventory adjust
          if (pimQty !== shopQty && locationId && sv.inventoryItem?.id) {
            const delta = pimQty - shopQty;
            const r = await gql(conn.shop_domain, conn.access_token, `
              mutation($input: InventoryAdjustQuantitiesInput!) {
                inventoryAdjustQuantities(input: $input) { userErrors { field message } }
              }`, {
                input: { name: "available", reason: "correction",
                  changes: [{ inventoryItemId: sv.inventoryItem.id, locationId, delta }] }
              });
            const errs = r.inventoryAdjustQuantities?.userErrors;
            if (errs?.length) throw new Error(`inventoryAdjust: ${errs.map((e: any) => e.message).join(", ")}`);
            applied.push("stock_quantity");
          }

          entry.applied = applied;
          appliedCount++;
        } catch (e: any) {
          entry.apply_error = e.message;
        }
      }

      results.push(entry);
    }

    const summary = {
      mode,
      total: results.length,
      in_sync: results.filter(r => r.in_sync).length,
      out_of_sync: results.filter(r => !r.in_sync && !r.error).length,
      errors: results.filter(r => r.error).length,
      applied: appliedCount,
    };

    return new Response(JSON.stringify({ success: true, summary, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("shopify-compare error:", err);
    return new Response(JSON.stringify({ success: false, error: err?.message ?? String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
