import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Result = {
  id: string;
  ean: string;
  title: string;
  status: "ok" | "skipped" | "error";
  step?: string;
  message?: string;
};

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
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) throw new Error(`${name} ${res.status}: ${data?.error ?? text.slice(0, 200)}`);
  if (data?.error) throw new Error(`${name}: ${data.error}`);
  return data;
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);
  if (!authHeader.includes(SUPABASE_SERVICE_ROLE_KEY)) {
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error } = await anon.auth.getUser();
    if (error || !user) return json({ error: "Unauthorized" }, 401);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const {
      brand = "ubiquiti",
      sync_target = "shopify",
      dry_run = false,
      only_dirty = true,
      limit,
    } = body as {
      brand?: string;
      sync_target?: "shopify" | "woocommerce" | "none";
      dry_run?: boolean;
      only_dirty?: boolean;
      limit?: number;
    };

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: products, error: pErr } = await supabase
      .from("master_products")
      .select("id, ean, title, brand, short_description, long_description, shopify_product_id, webshop_product_id, webshop_parent_id")
      .or(`brand.ilike.${brand}%,title.ilike.${brand}%`)
      .not("webshop_product_id", "is", null)
      .is("webshop_parent_id", null);
    if (pErr) return json({ error: pErr.message }, 500);

    const dirtyRegex = /\[[a-z_]+[^\]]*\]|et_pb_|vc_row|wp-block|data-elementor|fusion_|<!--|style="|class="/i;
    const candidates = (products ?? []).filter((p) => {
      if (!only_dirty) return true;
      const blob = `${p.short_description ?? ""}\n${p.long_description ?? ""}`;
      return dirtyRegex.test(blob);
    });
    const slice = limit ? candidates.slice(0, limit) : candidates;

    console.log(`bulk-clean: ${slice.length} candidates (dry=${dry_run}, target=${sync_target})`);

    const { data: logRow } = await supabase
      .from("import_logs")
      .insert({ source: "bulk-clean-descriptions", status: "running", total_fetched: slice.length })
      .select("id")
      .single();
    const logId = logRow?.id as string | undefined;

    const CONCURRENCY = 2;
    const DELAY_MS = 400;
    let cursor = 0;
    const results: Result[] = [];

    const worker = async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= slice.length) return;
        const p = slice[idx];
        const r: Result = { id: p.id, ean: p.ean, title: p.title, status: "ok" };

        try {
          const ai = await callFn("ai-rewrite-description", { productId: p.id, mode: "clean" });
          const newShort = ai.short_description ?? p.short_description ?? "";
          const newLong = ai.long_description ?? p.long_description ?? "";

          if (dry_run) {
            r.step = "dry_run_ai_done";
          } else {
            const { error: uErr } = await supabase
              .from("master_products")
              .update({ short_description: newShort, long_description: newLong })
              .eq("id", p.id);
            if (uErr) throw new Error(`pim: ${uErr.message}`);

            if (sync_target === "shopify") {
              if (!p.shopify_product_id) {
                r.status = "skipped";
                r.step = "no_shopify_id";
              } else {
                await callFn("shopify-update-product", {
                  master_product_id: p.id,
                  description: newLong,
                  short_description: newShort,
                });
                r.step = "synced_shopify";
              }
            } else if (sync_target === "woocommerce") {
              await callFn("wc-update-product", {
                master_product_id: p.id,
                description: newLong,
                short_description: newShort,
              });
              r.step = "synced_woocommerce";
            } else {
              r.step = "pim_only";
            }
          }
        } catch (e) {
          r.status = "error";
          r.message = e instanceof Error ? e.message : String(e);
          console.error(`bulk-clean ${p.ean}:`, r.message);
        }

        results.push(r);

        if (logId) {
          const errorList = results
            .filter((x) => x.status === "error")
            .map((x) => ({ ean: x.ean, msg: x.message }));
          const done = results.length === slice.length;
          await supabase.from("import_logs").update({
            imported: results.filter((x) => x.status === "ok").length,
            skipped: results.filter((x) => x.status === "skipped").length,
            errors: errorList,
            status: done ? "completed" : "running",
            completed_at: done ? new Date().toISOString() : null,
          }).eq("id", logId);
        }

        await sleep(DELAY_MS);
      }
    };

    const runAll = async () => {
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      console.log(`bulk-clean done: ${results.length}/${slice.length}`);
    };

    // @ts-ignore EdgeRuntime is available at runtime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(runAll());
      return json({
        accepted: true,
        log_id: logId,
        total: slice.length,
        message: "Job kører i baggrunden – poll import_logs",
      }, 202);
    }

    await runAll();
    return json({
      summary: {
        total: slice.length,
        ok: results.filter((r) => r.status === "ok").length,
        skipped: results.filter((r) => r.status === "skipped").length,
        errors: results.filter((r) => r.status === "error").length,
      },
      results,
      log_id: logId,
    }, 200);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("bulk-clean fatal:", msg);
    return json({ error: msg }, 500);
  }
});
