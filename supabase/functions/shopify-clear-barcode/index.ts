// One-shot util: clear a specific Shopify variant's barcode (e.g. remove bogus wc-* fallback).
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
    const variantId: string | undefined = body.variant_id;
    if (!variantId) throw new Error("variant_id required");
    const mode: "report" | "apply" = body.mode === "apply" ? "apply" : "report";

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: conn } = await supabase
      .from("shopify_connection")
      .select("shop_domain, access_token")
      .order("is_active", { ascending: false })
      .order("installed_at", { ascending: false })
      .limit(1).maybeSingle();
    if (!conn) throw new Error("Ingen Shopify-forbindelse");

    const variantGid = `gid://shopify/ProductVariant/${variantId}`;
    const lookup = await gql(conn.shop_domain, conn.access_token, `
      query($id: ID!) {
        node(id: $id) { ... on ProductVariant { id barcode sku product { id title } } }
      }`, { id: variantGid });
    const node = lookup.node;
    if (!node) throw new Error(`Variant ${variantId} not found`);

    const before = node.barcode;
    if (mode === "report") {
      return new Response(JSON.stringify({ mode, variant_id: variantId, current_barcode: before, product: node.product }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await gql(conn.shop_domain, conn.access_token, `
      mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id barcode }
          userErrors { field message }
        }
      }`, {
      productId: node.product.id,
      variants: [{ id: variantGid, barcode: "" }],
    });
    const errors = result.productVariantsBulkUpdate.userErrors;
    return new Response(JSON.stringify({
      mode, variant_id: variantId, before, after: result.productVariantsBulkUpdate.productVariants?.[0]?.barcode ?? null,
      userErrors: errors,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
