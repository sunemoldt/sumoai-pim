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

  // Global kill-switch + scope: skip all WC calls if disabled in settings
  let wcScope: "full" | "prices_stock_only" = "prices_stock_only";
  {
    const { data: settings } = await supabase
      .from("analytics_settings")
      .select("setting_key, setting_value")
      .in("setting_key", ["woocommerce_enabled", "woocommerce_scope"]);
    const map = new Map((settings ?? []).map((s) => [s.setting_key, s.setting_value]));
    if (map.get("woocommerce_enabled") !== "true") {
      return new Response(
        JSON.stringify({ success: false, skipped: true, fallback: true, error: "WooCommerce-sync er deaktiveret i indstillinger." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (map.get("woocommerce_scope") === "full") wcScope = "full";
  }

  try {
    const body = await req.json();
    const {
      master_product_id,
      regular_price,    // inkl. moms
      sale_price,       // inkl. moms or null
      stock_quantity,
      stock_status,     // "instock" | "outofstock" | "onbackorder"
      backorders,       // "yes" | "no" | "notify"
      description,        // lang beskrivelse (HTML)
      short_description,  // kort beskrivelse (HTML)
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
      .select("webshop_product_id, webshop_parent_id, title, ean, webshop_price, sale_price, stock_quantity, stock_status, backorders_allowed, short_description, long_description")
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
    if (description !== undefined && !isVariation && wcScope === "full") {
      wcPayload.description = description ?? "";
    }
    if (short_description !== undefined && !isVariation && wcScope === "full") {
      wcPayload.short_description = short_description ?? "";
    }

    // Use variation endpoint if this is a variation
    const wcUrl = isVariation
      ? `${WC_STORE_URL}/wp-json/wc/v3/products/${product.webshop_parent_id}/variations/${product.webshop_product_id}`
      : `${WC_STORE_URL}/wp-json/wc/v3/products/${product.webshop_product_id}`;
    const auth = btoa(`${WC_CONSUMER_KEY}:${WC_CONSUMER_SECRET}`);

    // comtek.dk's WooCommerce REST API can be slow/intermittent — give it 90s
    // and return a clear error instead of letting Supabase kill the worker (which
    // surfaces as the unhelpful "non-2xx status code" toast on the client).
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let wcRes: Response | null = null;
    let lastErr: any = null;
    const maxRetries = 4;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90_000);
      try {
        const res = await fetch(wcUrl, {
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
        clearTimeout(timeoutId);

        if ((res.status === 429 || res.status === 503) && attempt < maxRetries) {
          const retryAfter = res.headers.get("retry-after");
          let delayMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 0;
          if (!delayMs || isNaN(delayMs)) delayMs = Math.min(30_000, 1000 * Math.pow(2, attempt));
          await res.body?.cancel().catch(() => {});
          console.warn(`WC ${res.status} – backing off ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`);
          await sleep(delayMs);
          continue;
        }
        wcRes = res;
        break;
      } catch (e: any) {
        clearTimeout(timeoutId);
        lastErr = e;
        const isAbort = e?.name === "AbortError";
        if (isAbort || attempt === maxRetries) {
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
        await sleep(Math.min(10_000, 1000 * Math.pow(2, attempt)));
      }
    }

    if (!wcRes) {
      return new Response(
        JSON.stringify({ error: `Kunne ikke kontakte WooCommerce: ${lastErr?.message || "ukendt fejl"}` }),
        { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const wcText = await wcRes.text();
    let wcData: any;
    try { wcData = JSON.parse(wcText); } catch { wcData = wcText; }

    if (!wcRes.ok) {
      console.error(`WC API ${wcRes.status}:`, wcText.slice(0, 500));
      const isCloudflareChallenge =
        wcRes.status === 403 &&
        typeof wcData === "string" &&
        wcData.includes("challenges.cloudflare.com");
      const friendly = isCloudflareChallenge
        ? "WooCommerce blokerede requestet via Cloudflare (legacy-sync er pauset)."
        : `WooCommerce afviste opdateringen (HTTP ${wcRes.status})`;
      // Return 200 + fallback so callers don't crash on 5xx — WC sync is paused/legacy.
      return new Response(
        JSON.stringify({
          success: false,
          fallback: true,
          skipped: true,
          error: friendly,
          status: wcRes.status,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
    if (description !== undefined && !isVariation) {
      logChange("long_description", product.long_description, description, "shop_update");
    }
    if (short_description !== undefined && !isVariation) {
      logChange("short_description", product.short_description, short_description, "shop_update");
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
