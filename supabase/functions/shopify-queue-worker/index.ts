import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function callFn(name: string, payload: unknown) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  return { status: res.status, ok: res.ok, data: data as Record<string, unknown> | null, raw: text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // No auth guard — cron-triggered, verify_jwt=false, no user input.
  // Function only drains internal queue via service-role; abuse surface is nil.





  const url = new URL(req.url);
  const batchSize = Math.min(Number(url.searchParams.get("batch") ?? 10), 25);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Serialize worker runs: if another instance is already draining the queue,
  // exit early instead of racing it (which causes Shopify throttling bursts).
  const { data: lockData, error: lockErr } = await supabase.rpc("try_lock_shopify_queue_worker");
  if (lockErr) return json({ error: `lock: ${lockErr.message}` }, 500);
  if (lockData === false) {
    return json({ processed: 0, message: "Anden worker kører allerede — springer over" });
  }

  try {
    // Early-exit: cheap count first so empty cron ticks don't run select+update transaction
    const { count: pendingCount, error: countErr } = await supabase
      .from("shopify_update_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .lte("next_attempt_at", new Date().toISOString());
    if (countErr) return json({ error: countErr.message }, 500);
    if (!pendingCount || pendingCount === 0) {
      return json({ processed: 0, message: "Ingen opgaver i kø" });
    }


  // Pick up due pending items
    const { data: items, error } = await supabase
      .from("shopify_update_queue")
      .select("id, master_product_id, payload, attempts, max_attempts")
      .eq("status", "pending")
      .lte("next_attempt_at", new Date().toISOString())
      .order("next_attempt_at", { ascending: true })
      .limit(batchSize);

    if (error) return json({ error: error.message }, 500);
    if (!items || items.length === 0) return json({ processed: 0, message: "Ingen opgaver i kø" });

    // Mark as processing to prevent overlap
    const ids = items.map((i) => i.id);
    await supabase.from("shopify_update_queue")
      .update({ status: "processing" })
      .in("id", ids);

    const results: Array<{ id: string; status: string; message?: string }> = [];
    let processed = 0, succeeded = 0, requeued = 0, failed = 0;

    for (const item of items) {
      processed++;
      const attempts = (item.attempts ?? 0) + 1;
      try {
        const payload = {
          ...(item.payload as Record<string, unknown>),
          master_product_id: item.master_product_id,
          queued: true, // prevents re-enqueue loop
        };
        const resp = await callFn("shopify-update-product", payload);

        if (resp.ok && !(resp.data && (resp.data as { error?: string }).error)) {
          await supabase.from("shopify_update_queue").update({
            status: "done",
            attempts,
            last_error: null,
            completed_at: new Date().toISOString(),
          }).eq("id", item.id);
          succeeded++;
          results.push({ id: item.id, status: "done" });
        } else {
          const msg = String((resp.data as { error?: string } | null)?.error ?? resp.raw.slice(0, 300));
          const isThrottle = /rate.?limit|throttl|429|too many requests|exceeded for trace/i.test(msg);
          if (isThrottle && attempts < item.max_attempts) {
            // Exponential backoff: 60s, 120s, 240s … capped at 30 min
            const delaySec = Math.min(60 * Math.pow(2, attempts - 1), 1800);
            await supabase.from("shopify_update_queue").update({
              status: "pending",
              attempts,
              last_error: msg,
              next_attempt_at: new Date(Date.now() + delaySec * 1000).toISOString(),
            }).eq("id", item.id);
            requeued++;
            results.push({ id: item.id, status: "requeued", message: `retry in ${delaySec}s` });
            // Back off aggressively for the rest of this batch too.
            await sleep(3000);
          } else {
            await supabase.from("shopify_update_queue").update({
              status: attempts >= item.max_attempts ? "failed" : "pending",
              attempts,
              last_error: msg,
              next_attempt_at: new Date(Date.now() + 300_000).toISOString(),
            }).eq("id", item.id);
            if (attempts >= item.max_attempts) failed++; else requeued++;
            results.push({ id: item.id, status: attempts >= item.max_attempts ? "failed" : "requeued", message: msg });
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await supabase.from("shopify_update_queue").update({
          status: attempts >= item.max_attempts ? "failed" : "pending",
          attempts,
          last_error: msg,
          next_attempt_at: new Date(Date.now() + 300_000).toISOString(),
        }).eq("id", item.id);
        if (attempts >= item.max_attempts) failed++; else requeued++;
        results.push({ id: item.id, status: "error", message: msg });
      }

      // Throttle worker itself to stay friendly to Shopify
      await sleep(1200);
    }

    return json({ processed, succeeded, requeued, failed, results });
  } finally {
    await supabase.rpc("unlock_shopify_queue_worker").catch(() => {});
  }
});

