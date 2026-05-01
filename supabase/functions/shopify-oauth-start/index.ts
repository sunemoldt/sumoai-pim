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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
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
    const { data: claimsData, error: claimsErr } = await anonClient.auth.getClaims(
      authHeader.replace("Bearer ", "")
    );
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!SHOPIFY_CLIENT_ID || !SHOPIFY_STORE_DOMAIN) {
      return new Response(JSON.stringify({ error: "Shopify credentials not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Allow caller to override domain (optional)
    let shopDomain = SHOPIFY_STORE_DOMAIN.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    try {
      const body = await req.json().catch(() => ({}));
      if (body?.shop_domain) {
        shopDomain = String(body.shop_domain).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      }
    } catch { /* no body */ }

    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shopDomain)) {
      return new Response(JSON.stringify({ error: "Invalid shop_domain — must be xxx.myshopify.com" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate cryptographic state for CSRF
    const state = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    await supabase.from("shopify_oauth_state").insert({ state, shop_domain: shopDomain });
    // Clean up expired states
    await supabase.from("shopify_oauth_state").delete().lt("expires_at", new Date().toISOString());

    const redirectUri = `${SUPABASE_URL}/functions/v1/shopify-oauth-callback`;
    const installUrl = `https://${shopDomain}/admin/oauth/authorize?` + new URLSearchParams({
      client_id: SHOPIFY_CLIENT_ID,
      scope: SCOPES,
      redirect_uri: redirectUri,
      state,
    }).toString();

    return new Response(JSON.stringify({ install_url: installUrl, shop_domain: shopDomain }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
