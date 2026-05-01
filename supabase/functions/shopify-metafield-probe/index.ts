// Diagnostic probe: hent metafield-definitioner + targeted custom namespace lookup
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
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

  const authHeader = req.headers.get("authorization");
  if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (!authHeader.includes(SUPABASE_SERVICE_ROLE_KEY)) {
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await anon.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: conn } = await supabase
    .from("shopify_connection")
    .select("shop_domain, access_token, scope")
    .order("installed_at", { ascending: false })
    .limit(1).maybeSingle();
  if (!conn) return new Response(JSON.stringify({ error: "no shopify connection" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const body = await req.json().catch(() => ({}));
  const productId = body.product_id || "10464785465683"; // TurretCam 5 MP

  try {
    // 1) Token scopes
    const accessScopes = await gql(conn.shop_domain, conn.access_token, `query { currentAppInstallation { accessScopes { handle } } }`);

    // 2) Alle metafield-definitioner for produkter
    const defs = await gql(conn.shop_domain, conn.access_token, `
      query { metafieldDefinitions(first: 100, ownerType: PRODUCT) {
        nodes { namespace key name type { name } access { admin storefront } }
      } }
    `);

    // 3) Targeted lookup: custom.shortdescription direkte
    const direct = await gql(conn.shop_domain, conn.access_token, `
      query($id: ID!) {
        product(id: $id) {
          id title
          mfShort: metafield(namespace: "custom", key: "shortdescription") { id namespace key type value }
          mfShort2: metafield(namespace: "custom", key: "short_description") { id namespace key type value }
          allMf: metafields(first: 250) {
            nodes { namespace key type value }
          }
        }
      }
    `, { id: `gid://shopify/Product/${productId}` });

    const allMf = direct.product?.allMf?.nodes ?? [];
    const namespaces = Array.from(new Set(allMf.map((m: any) => m.namespace))).sort();

    return new Response(JSON.stringify({
      success: true,
      shop_domain: conn.shop_domain,
      scope: conn.scope,
      access_scopes: accessScopes.currentAppInstallation?.accessScopes?.map((s: any) => s.handle),
      product_id: productId,
      product_title: direct.product?.title,
      direct_lookup_custom_shortdescription: direct.product?.mfShort,
      direct_lookup_custom_short_description: direct.product?.mfShort2,
      total_metafields_returned: allMf.length,
      unique_namespaces: namespaces,
      metafield_definitions: defs.metafieldDefinitions?.nodes,
      all_metafields: allMf.map((m: any) => ({ ns: m.namespace, key: m.key, type: m.type, len: String(m.value ?? "").length })),
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
