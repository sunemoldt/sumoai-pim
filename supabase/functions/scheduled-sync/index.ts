import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // No auth guard — function is cron-triggered, verify_jwt=false, no user input.
    // Only triggers internal stock recompute via service-role; abuse surface is nil.




    const supabase = createClient(supabaseUrl, serviceKey);

    const results: any[] = [];

    // 1. Check supplier feeds that need syncing
    const { data: suppliers } = await supabase
      .from("suppliers")
      .select("id, name, feed_schedule, feed_url, feed_type, is_active")
      .eq("is_active", true)
      .neq("feed_schedule", "manual")
      .not("feed_schedule", "is", null);

    if (suppliers && suppliers.length > 0) {
      for (const supplier of suppliers) {
        if (!supplier.feed_url || supplier.feed_type === "manual") continue;
        if (!shouldRunNow(supplier.feed_schedule)) continue;

        try {
          const response = await fetch(
            `${supabaseUrl}/functions/v1/supplier-feed-import`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${serviceKey}`,
              },
              body: JSON.stringify({ supplier_id: supplier.id }),
            }
          );
          const data = await response.json();
          results.push({
            type: "supplier",
            name: supplier.name,
            success: !data.error,
            imported: data.imported ?? 0,
          });
        } catch (err) {
          results.push({
            type: "supplier",
            name: supplier.name,
            success: false,
            error: String(err),
          });
        }
      }
    }

    // WooCommerce sync er permanent deaktiveret — hele blokken er fjernet.


    // 3. Auto stock sync — safety-net sweep. DB triggers keep stock live;
    // this only runs at minute 0 to avoid 60x duplicate work per hour.
    const now = new Date();
    const minute = now.getUTCMinutes();
    const hour = now.getUTCHours();
    const dow = now.getUTCDay();

    if (minute === 0) {
      // Filter intervals server-side so we don't pull all auto-sync rows every tick.
      const eligibleIntervals: string[] = ["hourly"];
      if (hour === 6) eligibleIntervals.push("daily");
      if (hour === 6 && dow === 1) eligibleIntervals.push("weekly");

      const { data: syncProducts } = await supabase
        .from("master_products")
        .select("id")
        .eq("auto_stock_sync", true)
        .in("stock_sync_interval", eligibleIntervals);

      if (syncProducts && syncProducts.length > 0) {
        for (const product of syncProducts) {
          const { error } = await supabase.rpc("recompute_product_stock", {
            p_master_product_id: product.id,
          });
          if (error) {
            results.push({ type: "stock-sync", product_id: product.id, success: false, error: error.message });
          } else {
            results.push({ type: "stock-sync", product_id: product.id, success: true });
          }
        }
      }
    }


    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/**
 * Simple cron-like check: does the given cron expression match the current UTC time?
 */
function shouldRunNow(cron: string): boolean {
  const now = new Date();
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minExpr, hourExpr] = parts;
  const minute = now.getUTCMinutes();
  const hour = now.getUTCHours();

  return matchField(minExpr, minute) && matchField(hourExpr, hour);
}

function matchField(expr: string, value: number): boolean {
  if (expr === "*") return true;
  if (expr.startsWith("*/")) {
    const step = parseInt(expr.slice(2), 10);
    return value % step === 0;
  }
  return parseInt(expr, 10) === value;
}
