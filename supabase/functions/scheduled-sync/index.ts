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
    const supabase = createClient(supabaseUrl, serviceKey);

    const results: any[] = [];

    // 1. Supplier feeds — stagger by minute-slot so we never fire multiple
    //    heavy feeds at the same UTC minute (avoids OOM + external API load).
    const { data: suppliers } = await supabase
      .from("suppliers")
      .select("id, name, feed_schedule, feed_url, feed_type, is_active")
      .eq("is_active", true)
      .neq("feed_schedule", "manual")
      .not("feed_schedule", "is", null)
      .order("id"); // stable order → stable stagger slots across runs

    const now = new Date();
    const nowMinute = now.getUTCMinutes();
    const nowHour = now.getUTCHours();

    if (suppliers && suppliers.length > 0) {
      // Group by feed_schedule so suppliers on the same cron get distinct slots.
      const groups = new Map<string, typeof suppliers>();
      for (const s of suppliers) {
        if (!s.feed_url || s.feed_type === "manual") continue;
        const arr = groups.get(s.feed_schedule!) ?? [];
        arr.push(s);
        groups.set(s.feed_schedule!, arr);
      }

      for (const [schedule, group] of groups) {
        const parts = schedule.trim().split(/\s+/);
        if (parts.length !== 5) continue;
        const [minExpr, hourExpr] = parts;

        // Cron's minute field is ignored for staggering: we compute our own slot.
        // But hour field must match now so a "0 6 * * *" job doesn't run at 14:xx.
        if (!matchField(hourExpr, nowHour)) continue;

        // Slot spacing: fit all suppliers in this group across the hour, capped
        // at 5-minute granularity (scheduled-sync runs every minute).
        const spacing = Math.max(5, Math.min(15, Math.floor(60 / Math.max(1, group.length))));

        for (let i = 0; i < group.length; i++) {
          const supplier = group[i];
          const slot = (i * spacing) % 60;
          if (slot !== nowMinute) continue;

          // Additional safety: if cron's minute expression is a fixed value
          // (e.g. "0" or "30"), only fire when the slot fits within that minute.
          // For "*/N" or "*" we skip this check.
          if (!minExpr.includes("*") && !minExpr.includes("/")) {
            // fixed-minute cron — respect it as an offset baseline
            const base = parseInt(minExpr, 10);
            if (Number.isFinite(base) && ((base + i * spacing) % 60) !== nowMinute) continue;
          }

          try {
            const response = await fetch(
              `${supabaseUrl}/functions/v1/supplier-feed-import`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${serviceKey}`,
                },
                body: JSON.stringify({ supplier_id: supplier.id, async: true }),
              }
            );
            const data = await response.json().catch(() => ({}));
            results.push({
              type: "supplier",
              name: supplier.name,
              slot_minute: slot,
              success: response.ok && !data.error,
              started: data.started ?? false,
            });
          } catch (err) {
            results.push({
              type: "supplier",
              name: supplier.name,
              slot_minute: slot,
              success: false,
              error: String(err),
            });
          }
        }
      }
    }

    // 2. Auto stock sync — safety-net sweep. DB triggers keep stock live;
    // this only runs at minute 0 to avoid 60x duplicate work per hour.
    const dow = now.getUTCDay();
    if (nowMinute === 0) {
      const eligibleIntervals: string[] = ["hourly"];
      if (nowHour === 6) eligibleIntervals.push("daily");
      if (nowHour === 6 && dow === 1) eligibleIntervals.push("weekly");

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

function matchField(expr: string, value: number): boolean {
  if (expr === "*") return true;
  if (expr.startsWith("*/")) {
    const step = parseInt(expr.slice(2), 10);
    return value % step === 0;
  }
  // comma-separated list
  if (expr.includes(",")) {
    return expr.split(",").some((p) => parseInt(p, 10) === value);
  }
  return parseInt(expr, 10) === value;
}
