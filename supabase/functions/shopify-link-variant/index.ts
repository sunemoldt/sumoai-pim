// Link an unmatched Shopify variant to an existing PIM master_product.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function requireUser(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return false;
  if (authHeader.includes(SUPABASE_SERVICE_ROLE_KEY)) return true;
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await anon.auth.getUser();
  return !error && Boolean(user);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!(await requireUser(req))) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = await req.json().catch(() => ({}));
    const { shopify_product_id, shopify_variant_id, master_product_id } = body as {
      shopify_product_id?: string; shopify_variant_id?: string; master_product_id?: string;
    };
    if (!shopify_product_id || !shopify_variant_id || !master_product_id) {
      return new Response(JSON.stringify({ error: "shopify_product_id, shopify_variant_id og master_product_id er påkrævet" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Conflict: another PIM row already links to this variant
    const { data: existing } = await supabase
      .from("master_products")
      .select("id, title")
      .eq("shopify_variant_id", shopify_variant_id)
      .neq("id", master_product_id)
      .maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ error: `Variant er allerede linket til PIM-produkt "${existing.title}"`, conflict_id: existing.id }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.rpc("set_change_source", { source: "shopify-link-variant" });
    const { error: upErr } = await supabase
      .from("master_products")
      .update({
        shopify_product_id,
        shopify_variant_id,
        shopify_sync_enabled: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", master_product_id);
    if (upErr) throw upErr;

    // Pull fresh data from Shopify
    const pullRes = await fetch(`${SUPABASE_URL}/functions/v1/shopify-pull`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({ master_product_id }),
    });
    const pullJson = await pullRes.json().catch(() => ({}));

    return new Response(JSON.stringify({ success: true, master_product_id, pull: pullJson }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("shopify-link-variant:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
