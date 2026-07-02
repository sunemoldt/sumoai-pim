// Removes a product from a Shopify custom collection and mirrors the change in PIM.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_VERSION = "2026-04";

async function requireUser(req: Request) {
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  if (auth.includes(SUPABASE_SERVICE_ROLE_KEY)) return true;
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data: { user }, error } = await anon.auth.getUser();
  return !error && !!user;
}

async function gql(shop: string, token: string, query: string, variables: Record<string, unknown>) {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    const txt = await res.text();
    throw new Error(`Shopify non-JSON [${res.status}]: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!res.ok || data.errors) throw new Error(`Shopify ${res.status}: ${JSON.stringify(data.errors || data)}`);
  return data.data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!(await requireUser(req))) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { collection_id, master_product_id } = await req.json();
    if (!collection_id || !master_product_id) throw new Error("collection_id og master_product_id kræves");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: col } = await supabase
      .from("shopify_collections")
      .select("id, shopify_collection_id, collection_type")
      .eq("id", collection_id)
      .single();
    if (!col) throw new Error("Collection ikke fundet");
    if (col.collection_type === "smart") throw new Error("Smart collections styres af Shopify's regler");

    const { data: prod } = await supabase
      .from("master_products")
      .select("shopify_product_id")
      .eq("id", master_product_id)
      .single();
    if (!prod?.shopify_product_id) throw new Error("Produktet er ikke linket til Shopify");

    const productGid = String(prod.shopify_product_id).startsWith("gid://")
      ? String(prod.shopify_product_id)
      : `gid://shopify/Product/${prod.shopify_product_id}`;

    const { data: conn } = await supabase
      .from("shopify_connection")
      .select("shop_domain, access_token")
      .order("is_active", { ascending: false })
      .order("installed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!conn) throw new Error("Shopify er ikke forbundet");

    const mutation = `#graphql
      mutation RemoveProducts($id: ID!, $productIds: [ID!]!) {
        collectionRemoveProducts(id: $id, productIds: $productIds) {
          job { id }
          userErrors { field message }
        }
      }`;
    const data: any = await gql(conn.shop_domain, conn.access_token, mutation, {
      id: col.shopify_collection_id,
      productIds: [productGid],
    });
    const errs = data.collectionRemoveProducts.userErrors;
    if (errs?.length) throw new Error(errs.map((e: any) => e.message).join(", "));

    await supabase
      .from("master_product_collections")
      .delete()
      .eq("collection_id", collection_id)
      .eq("master_product_id", master_product_id);

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("shopify-collection-remove-product:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
