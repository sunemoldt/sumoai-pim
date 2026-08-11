import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Map cron expression → interval in hours. Anything not in this map is treated
// as "unknown" and gated conservatively (default 4h).
const SCHEDULE_TO_HOURS: Record<string, number> = {
  "0 * * * *": 1,
  "0 */2 * * *": 2,
  "0 */4 * * *": 4,
  "0 */6 * * *": 6,
  "0 */12 * * *": 12,
  "0 6 * * *": 24,
  "0 6 * * 1": 168,
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
    const now = new Date();

    // -----------------------------------------------------------------
    // 1. Supplier feeds — "last-run" gate + one supplier per tick.
    //
    // Strategy: don't try to be clever with cron minute slots. Instead,
    // pick the single most-overdue supplier whose interval has elapsed
    // and kick it off. pg_cron fires us every 5 minutes, so with N
    // scheduled feeds we get natural spacing of at least 5*N/tick_hits
    // minutes between two feeds — no two heavy feeds ever run together.
    // -----------------------------------------------------------------
    const { data: suppliers } = await supabase
      .from("suppliers")
      .select("id, name, feed_schedule, feed_url, feed_type, is_active, last_sync_at")
      .eq("is_active", true)
      .neq("feed_schedule", "manual")
      .not("feed_schedule", "is", null);

    const due: {
      id: string;
      name: string;
      last_sync_at: string | null;
      overdue_hours: number;
      skip_cache: boolean;
    }[] = [];

    for (const s of suppliers ?? []) {
      if (!s.feed_url || s.feed_type === "manual") continue;
      const intervalHours = SCHEDULE_TO_HOURS[s.feed_schedule!] ?? 4;
      const lastMs = s.last_sync_at ? new Date(s.last_sync_at).getTime() : 0;
      const ageHours = lastMs === 0 ? Number.POSITIVE_INFINITY : (now.getTime() - lastMs) / 3_600_000;
      // Fire when we're within 3 minutes of the interval to avoid a
      // one-tick miss pushing everything half an hour out.
      if (ageHours + 0.05 >= intervalHours) {
        due.push({
          id: s.id,
          name: s.name,
          last_sync_at: s.last_sync_at,
          overdue_hours: ageHours,
          // DCS ~150k rows OOMs the cache-building worker; keep the lightweight path.
          skip_cache: /dcs/i.test(s.name ?? ""),
        });
      }
    }

    // Most-overdue first (never-run wins because Infinity).
    due.sort((a, b) => b.overdue_hours - a.overdue_hours);

    // Back off suppliers whose last attempt failed recently (e.g. upstream API
    // outage returning 503). Without this we re-hit a dead API every tick.
    const FAILURE_BACKOFF_MIN = 30;
    if (due.length > 0) {
      const backoffSince = new Date(now.getTime() - FAILURE_BACKOFF_MIN * 60_000).toISOString();
      const { data: recentFails } = await supabase
        .from("import_logs")
        .select("source, status, started_at")
        .in("source", due.map((d) => `supplier-feed-import:${d.id}`))
        .eq("status", "failed")
        .gte("started_at", backoffSince);
      const cooling = new Set(
        (recentFails ?? []).map((r) => String(r.source).replace("supplier-feed-import:", "")),
      );
      if (cooling.size > 0) {
        for (const d of due) {
          if (cooling.has(d.id)) {
            results.push({ type: "supplier", name: d.name, skipped: "failure_backoff" });
          }
        }
        const filtered = due.filter((d) => !cooling.has(d.id));
        due.length = 0;
        due.push(...filtered);
      }
    }

    // Fire at most ONE supplier per tick. Guarantees no two heavy feeds
    // ever share a runtime slot.
    const pick = due[0] ?? null;
    if (pick) {
      // Extra safety: skip if the same supplier has an in-flight import_logs
      // row from the last 20 minutes (async worker still running).
      const twentyMinAgo = new Date(now.getTime() - 20 * 60_000).toISOString();
      const { data: inflight } = await supabase
        .from("import_logs")
        .select("id")
        .eq("source", `supplier-feed-import:${pick.id}`)
        .eq("status", "running")
        .gte("started_at", twentyMinAgo)
        .limit(1)
        .maybeSingle();

      if (inflight?.id) {
        results.push({ type: "supplier", name: pick.name, skipped: "already_running" });
      } else {
        try {
          const response = await fetch(
            `${supabaseUrl}/functions/v1/supplier-feed-import`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${serviceKey}`,
              },
              body: JSON.stringify({
                supplier_id: pick.id,
                async: true,
                skip_cache: pick.skip_cache,
              }),
            }
          );
          const data = await response.json().catch(() => ({}));
          results.push({
            type: "supplier",
            name: pick.name,
            overdue_hours: Number.isFinite(pick.overdue_hours) ? Math.round(pick.overdue_hours * 10) / 10 : "never",
            success: response.ok && !data.error,
            started: data.started ?? false,
            queued_remaining: Math.max(0, due.length - 1),
          });
        } catch (err) {
          results.push({
            type: "supplier",
            name: pick.name,
            success: false,
            error: String(err),
          });
        }
      }
    }

    // -----------------------------------------------------------------
    // 2. Auto stock sync — safety-net sweep. DB triggers keep stock live;
    // this only runs at minute 0 to avoid duplicate work every tick.
    // -----------------------------------------------------------------
    const nowMinute = now.getUTCMinutes();
    const nowHour = now.getUTCHours();
    const dow = now.getUTCDay();
    if (nowMinute < 5) {
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

    return new Response(JSON.stringify({ ok: true, results, due_count: due.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
