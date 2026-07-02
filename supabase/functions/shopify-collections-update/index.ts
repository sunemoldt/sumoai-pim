// Updates a Shopify collection's description and SEO fields, then writes back to DB.
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

    const body = await req.json();
    const { collection_id, description_html, meta_title, meta_description } = body;
    if (!collection_id) throw new Error("collection_id is required");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: col } = await supabase
      .from("shopify_collections")
      .select("id, shopify_collection_id, collection_type")
      .eq("id", collection_id)
      .single();
    if (!col) throw new Error("Collection ikke fundet");

    const { data: conn } = await supabase
      .from("shopify_connection")
      .select("shop_domain, access_token")
      .order("is_active", { ascending: false })
      .order("installed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!conn) throw new Error("Shopify er ikke forbundet");

    const input: Record<string, unknown> = { id: col.shopify_collection_id };
    if (description_html !== undefined) input.descriptionHtml = description_html ?? "";
    const seo: Record<string, unknown> = {};
    if (meta_title !== undefined) seo.title = meta_title ?? "";
    if (meta_description !== undefined) seo.description = meta_description ?? "";
    if (Object.keys(seo).length > 0) input.seo = seo;

    const mutation = `#graphql
      mutation UpdateCollection($input: CollectionInput!) {
        collectionUpdate(input: $input) {
          collection { id }
          userErrors { field message }
        }
      }`;
    const data: any = await gql(conn.shop_domain, conn.access_token, mutation, { input });
    const errs = data.collectionUpdate.userErrors;
    if (errs?.length) throw new Error(errs.map((e: any) => e.message).join(", "));

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), last_shopify_sync_at: new Date().toISOString() };
    if (description_html !== undefined) patch.description_html = description_html;
    if (meta_title !== undefined) patch.meta_title = meta_title;
    if (meta_description !== undefined) patch.meta_description = meta_description;
    await supabase.from("shopify_collections").update(patch).eq("id", collection_id);

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("shopify-collections-update:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
