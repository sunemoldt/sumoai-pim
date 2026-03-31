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

        // Check if schedule matches current time
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

    // 2. Check WC import schedule
    const { data: wcSetting } = await supabase
      .from("price_settings")
      .select("scope_value")
      .eq("scope", "wc_schedule")
      .maybeSingle();

    if (wcSetting?.scope_value && wcSetting.scope_value !== "manual") {
      if (shouldRunNow(wcSetting.scope_value)) {
        try {
          const response = await fetch(
            `${supabaseUrl}/functions/v1/wc-import`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${serviceKey}`,
              },
              body: JSON.stringify({}),
            }
          );
          const data = await response.json();
          results.push({
            type: "wc-import",
            success: data.success ?? !data.error,
            imported: data.imported ?? 0,
          });
        } catch (err) {
          results.push({
            type: "wc-import",
            success: false,
            error: String(err),
          });
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
 * Supports: minute hour dom month dow (standard 5-field cron with * /N syntax)
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
