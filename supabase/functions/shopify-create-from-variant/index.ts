// Create a new PIM master_product from a Shopify variant, then pull full data.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_VERSION = "2026-04";

const normEan = (v: string | null | undefined) =>
  v ? String(v).trim().replace(/^0+/, "") || String(v).trim() : "";

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
    const { shopify_product_id, shopify_variant_id } = body as {
      shopify_product_id?: string; shopify_variant_id?: string;
    };
    if (!shopify_product_id || !shopify_variant_id) {
      return new Response(JSON.stringify({ error: "shopify_product_id og shopify_variant_id er påkrævet" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Already linked?
    const { data: linked } = await supabase
      .from("master_products")
      .select("id, title")
      .eq("shopify_variant_id", shopify_variant_id)
      .maybeSingle();
    if (linked) {
      return new Response(JSON.stringify({ error: `Variant er allerede linket til "${linked.title}"`, conflict_id: linked.id }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: conn } = await supabase
      .from("shopify_connection")
      .select("shop_domain, access_token")
      .order("is_active", { ascending: false })
      .order("installed_at", { ascending: false })
      .limit(1).maybeSingle();
    if (!conn) {
      return new Response(JSON.stringify({ error: "Shopify er ikke forbundet" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch variant from Shopify
    const query = `
      query($id: ID!) {
        productVariant(id: $id) {
          id sku barcode title
          product { id title status }
        }
      }`;
    const res = await fetch(`https://${conn.shop_domain}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": conn.access_token, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { id: `gid://shopify/ProductVariant/${shopify_variant_id}` } }),
    });
    const json = await res.json();
    if (!res.ok || json.errors) throw new Error(`Shopify ${res.status}: ${JSON.stringify(json.errors || json)}`);
    const variant = json.data?.productVariant;
    if (!variant) {
      return new Response(JSON.stringify({ error: "Variant ikke fundet i Shopify" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ean = normEan(variant.barcode);
    const sku = variant.sku || null;

    // EAN conflict check
    if (ean) {
      const { data: eanConflict } = await supabase
        .from("master_products")
        .select("id, title")
        .eq("ean", ean)
        .maybeSingle();
      if (eanConflict) {
        return new Response(JSON.stringify({
          error: `EAN ${ean} findes allerede i PIM på "${eanConflict.title}". Brug "Link til PIM" i stedet.`,
          conflict_id: eanConflict.id,
        }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const lifecycle = variant.product.status === "ACTIVE" ? "active"
      : variant.product.status === "ARCHIVED" ? "archived" : "draft";

    await supabase.rpc("set_change_source", { source: "shopify-create-from-variant" });
    const { data: inserted, error: insErr } = await supabase
      .from("master_products")
      .insert({
        title: variant.product.title,
        ean: ean || null,
        sku,
        shopify_product_id,
        shopify_variant_id,
        shopify_sync_enabled: true,
        lifecycle_status: lifecycle,
      })
      .select("id")
      .single();
    if (insErr) throw insErr;

    // Pull full data
    const pullRes = await fetch(`${SUPABASE_URL}/functions/v1/shopify-pull`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({ master_product_id: inserted.id }),
    });
    const pullJson = await pullRes.json().catch(() => ({}));

    return new Response(JSON.stringify({ success: true, master_product_id: inserted.id, pull: pullJson }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("shopify-create-from-variant:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
