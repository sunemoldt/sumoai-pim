// Diagnostic + fix: tjek/ret barcode (EAN) på Shopify-varianter ud fra PIM ean.
// Mode 'report' viser hvor mange varianter har forkert/manglende barcode.
// Mode 'apply' opdaterer barcode = master_products.ean via productVariantsBulkUpdate.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!authHeader.includes(SUPABASE_SERVICE_ROLE_KEY)) {
      const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
      const { data: { user } } = await anon.auth.getUser();
      if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const mode: "report" | "apply" = body.mode === "apply" ? "apply" : "report";
    const eans: string[] | null = Array.isArray(body.eans) ? body.eans : null;
    const limit = Math.min(Number(body.limit) || 50, 250);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: conn } = await supabase
      .from("shopify_connection")
      .select("shop_domain, access_token")
      .order("is_active", { ascending: false })
      .order("installed_at", { ascending: false })
      .limit(1).maybeSingle();
    if (!conn) throw new Error("Ingen Shopify-forbindelse");

    let q = supabase.from("master_products")
      .select("id, ean, sku, title, shopify_product_id, shopify_variant_id")
      .not("shopify_variant_id", "is", null);
    if (eans?.length) q = q.in("ean", eans);
    q = q.order("title").limit(limit);
    const { data: rows, error } = await q;
    if (error) throw error;

    const variantGids = (rows ?? []).map(r => `gid://shopify/ProductVariant/${r.shopify_variant_id}`);
    const data = await gql(conn.shop_domain, conn.access_token, `
      query($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant { id barcode sku product { id } }
        }
      }`, { ids: variantGids });

    const map = new Map<string, any>();
    for (const n of data.nodes ?? []) if (n) map.set(n.id.replace("gid://shopify/ProductVariant/", ""), n);

    // Detect duplicates: flere PIM-rækker peger på samme shopify_variant_id
    const variantCounts = new Map<string, number>();
    for (const r of rows ?? []) variantCounts.set(r.shopify_variant_id, (variantCounts.get(r.shopify_variant_id) ?? 0) + 1);

    // Group by product for bulk update — undgå duplikate variant-id'er pr. produkt
    const updatesByProduct = new Map<string, Map<string, string>>(); // productGid -> variantGid -> barcode
    const results: any[] = [];
    let skippedDupes = 0;

    for (const r of rows ?? []) {
      const sv = map.get(r.shopify_variant_id);
      const shopBarcode = sv?.barcode ?? "";
      const correct = r.ean === shopBarcode;
      const isDupe = (variantCounts.get(r.shopify_variant_id) ?? 0) > 1;
      const entry: any = {
        ean: r.ean, sku: r.sku, title: r.title,
        shopify_variant_id: r.shopify_variant_id,
        shopify_barcode: shopBarcode,
        is_correct: correct,
        is_duplicate_mapping: isDupe,
        action: correct ? "ok" : (isDupe ? "skipped_duplicate" : (mode === "apply" ? "will_update" : "needs_update")),
      };
      if (!correct && !isDupe && mode === "apply" && r.ean) {
        const pid = `gid://shopify/Product/${r.shopify_product_id}`;
        const vmap = updatesByProduct.get(pid) ?? new Map<string, string>();
        vmap.set(`gid://shopify/ProductVariant/${r.shopify_variant_id}`, r.ean);
        updatesByProduct.set(pid, vmap);
      }
      if (isDupe) skippedDupes++;
      results.push(entry);
    }

    let applied = 0;
    const apply_errors: any[] = [];
    if (mode === "apply") {
      for (const [productId, variants] of updatesByProduct) {
        try {
          const r = await gql(conn.shop_domain, conn.access_token, `
            mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
              productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                userErrors { field message }
              }
            }`, { productId, variants });
          const errs = r.productVariantsBulkUpdate?.userErrors;
          if (errs?.length) apply_errors.push({ productId, errors: errs });
          else applied += variants.length;
        } catch (e: any) {
          apply_errors.push({ productId, error: e.message });
        }
      }
    }

    const summary = {
      mode,
      total: results.length,
      correct: results.filter(r => r.is_correct).length,
      incorrect: results.filter(r => !r.is_correct).length,
      applied,
      apply_errors,
    };

    return new Response(JSON.stringify({ success: true, summary, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err?.message ?? String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
