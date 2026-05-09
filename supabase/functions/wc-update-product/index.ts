import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WC_STORE_URL = Deno.env.get("WC_STORE_URL");
const WC_CONSUMER_KEY = Deno.env.get("WC_CONSUMER_KEY");
const WC_CONSUMER_SECRET = Deno.env.get("WC_CONSUMER_SECRET");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Auth check
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!authHeader.includes(SUPABASE_SERVICE_ROLE_KEY)) {
    const anonClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  if (!WC_STORE_URL || !WC_CONSUMER_KEY || !WC_CONSUMER_SECRET) {
    return new Response(
      JSON.stringify({ error: "WooCommerce credentials not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json();
    const {
      master_product_id,
      regular_price,    // inkl. moms
      sale_price,       // inkl. moms or null
      stock_quantity,
      stock_status,     // "instock" | "outofstock" | "onbackorder"
      backorders,       // "yes" | "no" | "notify"
    } = body;

    if (!master_product_id) {
      return new Response(
        JSON.stringify({ error: "master_product_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the product from DB to find WooCommerce product ID and current values
    const { data: product, error: dbError } = await supabase
      .from("master_products")
      .select("webshop_product_id, webshop_parent_id, title, ean, webshop_price, sale_price, stock_quantity, stock_status, backorders_allowed")
      .eq("id", master_product_id)
      .single();

    if (dbError || !product) {
      return new Response(
        JSON.stringify({ error: "Product not found", details: dbError?.message }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!product.webshop_product_id) {
      return new Response(
        JSON.stringify({ error: "Product has no WooCommerce ID – cannot update shop" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isVariation = !!product.webshop_parent_id;

    // Build WooCommerce update payload
    const wcPayload: Record<string, any> = {};

    if (regular_price !== undefined && regular_price !== null) {
      wcPayload.regular_price = String(regular_price);
    }
    if (sale_price !== undefined) {
      wcPayload.sale_price = sale_price !== null ? String(sale_price) : "";
    }
    if (stock_quantity !== undefined && stock_quantity !== null) {
      wcPayload.stock_quantity = stock_quantity;
      wcPayload.manage_stock = true;
    }
    if (stock_status) {
      wcPayload.stock_status = stock_status;
    }
    if (backorders) {
      wcPayload.backorders = backorders;
    }

    // Use variation endpoint if this is a variation
    const wcUrl = isVariation
      ? `${WC_STORE_URL}/wp-json/wc/v3/products/${product.webshop_parent_id}/variations/${product.webshop_product_id}`
      : `${WC_STORE_URL}/wp-json/wc/v3/products/${product.webshop_product_id}`;
    const auth = btoa(`${WC_CONSUMER_KEY}:${WC_CONSUMER_SECRET}`);

    // comtek.dk's WooCommerce REST API can be slow/intermittent — give it 90s
    // and return a clear error instead of letting Supabase kill the worker (which
    // surfaces as the unhelpful "non-2xx status code" toast on the client).
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90_000);

    let wcRes: Response;
    try {
      wcRes = await fetch(wcUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${auth}`,
          "User-Agent": "ComtekPIM/1.0 (+https://pim.sumoai.dk)",
          Accept: "application/json",
        },
        body: JSON.stringify(wcPayload),
        signal: controller.signal,
      });
    } catch (e: any) {
      clearTimeout(timeoutId);
      const isAbort = e?.name === "AbortError";
      console.error("WC fetch failed:", e?.message || e);
      return new Response(
        JSON.stringify({
          error: isAbort
            ? "WooCommerce svarede ikke inden 90 sekunder. Prøv igen."
            : `Kunne ikke kontakte WooCommerce: ${e?.message || "ukendt fejl"}`,
        }),
        { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    clearTimeout(timeoutId);

    const wcText = await wcRes.text();
    let wcData: any;
    try { wcData = JSON.parse(wcText); } catch { wcData = wcText; }

    if (!wcRes.ok) {
      console.error(`WC API ${wcRes.status}:`, wcText.slice(0, 500));
      return new Response(
        JSON.stringify({
          error: `WooCommerce afviste opdateringen (HTTP ${wcRes.status})`,
          status: wcRes.status,
          details: wcData,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log changes and update local DB
    const changeLogs: { master_product_id: string; change_type: string; field_name: string; old_value: string | null; new_value: string | null; source: string }[] = [];
    const dbUpdate: Record<string, any> = {};

    const logChange = (field: string, oldVal: any, newVal: any, type = "shop_update") => {
      const o = oldVal != null ? String(oldVal) : null;
      const n = newVal != null ? String(newVal) : null;
      if (o !== n) {
        changeLogs.push({ master_product_id, change_type: type, field_name: field, old_value: o, new_value: n, source: "wc-update-product" });
      }
    };

    if (regular_price !== undefined && regular_price !== null) {
      logChange("webshop_price", product.webshop_price, regular_price, "price_update");
      dbUpdate.webshop_price = regular_price;
    }
    if (sale_price !== undefined) {
      logChange("sale_price", product.sale_price, sale_price, "price_update");
      dbUpdate.sale_price = sale_price;
    }
    if (stock_quantity !== undefined && stock_quantity !== null) {
      logChange("stock_quantity", product.stock_quantity, stock_quantity, "stock_update");
      dbUpdate.stock_quantity = stock_quantity;
    }
    if (stock_status) {
      logChange("stock_status", product.stock_status, stock_status, "stock_update");
      dbUpdate.stock_status = stock_status;
    }
    if (backorders) {
      const newVal = backorders === "yes" || backorders === "notify";
      logChange("backorders_allowed", product.backorders_allowed, newVal, "stock_update");
      dbUpdate.backorders_allowed = newVal;
    }

    if (Object.keys(dbUpdate).length > 0) {
      await supabase.from("master_products").update(dbUpdate).eq("id", master_product_id);
    }

    if (changeLogs.length > 0) {
      await supabase.from("product_change_log").insert(changeLogs);
    }

    return new Response(
      JSON.stringify({
        success: true,
        wc_product_id: product.webshop_product_id,
        updated_fields: Object.keys(wcPayload),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
