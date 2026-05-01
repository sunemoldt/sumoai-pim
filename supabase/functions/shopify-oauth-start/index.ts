import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SHOPIFY_CLIENT_ID = Deno.env.get("SHOPIFY_CLIENT_ID");
const SHOPIFY_STORE_DOMAIN = Deno.env.get("SHOPIFY_STORE_DOMAIN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const SCOPES = "read_products,write_products,read_inventory,write_inventory,read_product_listings";
const STATE_TTL_HOURS = 2;

function normalizeShopDomain(value: string) {
  return value.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

async function createInstallUrl(shopDomainOverride?: string) {
  if (!SHOPIFY_CLIENT_ID || !SHOPIFY_STORE_DOMAIN) {
    throw new Error("Shopify credentials not configured");
  }

  const shopDomain = normalizeShopDomain(shopDomainOverride || SHOPIFY_STORE_DOMAIN);
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shopDomain)) {
    throw new Error("Invalid shop_domain — must be xxx.myshopify.com");
  }

  const state = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const expiresAt = new Date(Date.now() + STATE_TTL_HOURS * 60 * 60 * 1000).toISOString();
  await supabase.from("shopify_oauth_state").insert({ state, shop_domain: shopDomain, expires_at: expiresAt });
  await supabase.from("shopify_oauth_state").delete().lt("expires_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  const redirectUri = `${SUPABASE_URL}/functions/v1/shopify-oauth-callback`;
  const installUrl = `https://${shopDomain}/admin/oauth/authorize?` + new URLSearchParams({
    client_id: SHOPIFY_CLIENT_ID,
    scope: SCOPES,
    redirect_uri: redirectUri,
    state,
  }).toString();

  return { installUrl, shopDomain };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const shopDomainOverride = url.searchParams.get("shop_domain") || undefined;
      const { installUrl } = await createInstallUrl(shopDomainOverride);
      return Response.redirect(installUrl, 302);
    }

    // Auth check
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Allow caller to override domain (optional)
    let shopDomainOverride: string | undefined;
    try {
      const body = await req.json().catch(() => ({}));
      if (body?.shop_domain) {
        shopDomainOverride = String(body.shop_domain);
      }
    } catch { /* no body */ }

    const { installUrl, shopDomain } = await createInstallUrl(shopDomainOverride);

    return new Response(JSON.stringify({ install_url: installUrl, shop_domain: shopDomain }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
