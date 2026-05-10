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

// Deterministic HTML cleanup for Elementor / WP / pagebuilder cruft.
// Stack-based: when we hit an opening tag matching builder patterns,
// skip the entire balanced subtree (handles nesting correctly).
function stripBuilderBlocks(html: string): string {
  const builderAttrRe = /\bdata-elementor[\w-]*=|class="[^"]*\b(elementor[\w-]*|et_pb_[\w-]*|vc_[\w-]*|wpb_[\w-]*|fusion-[\w-]*|wp-block-[\w-]*|e-con|e-flex|e-parent|e-child)/i;
  const out: string[] = [];
  let i = 0;
  const n = html.length;
  while (i < n) {
    const ch = html[i];
    if (ch !== "<") {
      const next = html.indexOf("<", i);
      if (next === -1) { out.push(html.slice(i)); break; }
      out.push(html.slice(i, next));
      i = next;
      continue;
    }
    const end = html.indexOf(">", i);
    if (end === -1) { out.push(html.slice(i)); break; }
    const tag = html.slice(i, end + 1);
    const open = tag.match(/^<([a-zA-Z][\w-]*)\b([^>]*)>$/);
    if (open && !tag.startsWith("</") && !tag.endsWith("/>") && builderAttrRe.test(open[2])) {
      const name = open[1].toLowerCase();
      // Walk forward, counting same-name opens/closes, skip everything inside
      let depth = 1;
      let j = end + 1;
      const openTagRe = new RegExp(`<${name}\\b[^>]*>`, "gi");
      const closeTagRe = new RegExp(`</${name}\\s*>`, "gi");
      while (j < n && depth > 0) {
        openTagRe.lastIndex = j;
        closeTagRe.lastIndex = j;
        const o = openTagRe.exec(html);
        const c = closeTagRe.exec(html);
        if (!c) { j = n; break; }
        if (o && o.index < c.index) {
          depth++;
          j = o.index + o[0].length;
        } else {
          depth--;
          j = c.index + c[0].length;
        }
      }
      i = j;
      continue;
    }
    out.push(tag);
    i = end + 1;
  }
  return out.join("");
}

function cleanHtml(input: string | null | undefined): string {
  if (!input) return "";
  let s = String(input);

  // 1. Strip script/style/iframe noise (keep youtube? -> drop, they re-add via Shopify)
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");

  // 2. Remove pagebuilder block wrappers (Elementor, Divi, VC, WPBakery, Fusion, Gutenberg)
  s = stripBuilderBlocks(s);

  // 3. Strip builder-specific attributes from any remaining tags
  s = s.replace(/\s+(data-(elementor|id|element_type|e-type|widget_type|settings|model-cid|preserve-html|content-id)|wpc-filter-[a-z0-9_-]+)="[^"]*"/gi, "");

  // 4. WP / Elementor shortcodes  [foo bar="baz"] ... [/foo]
  s = s.replace(/\[\/?[a-z][a-z0-9_-]*[^\]]*\]/gi, "");

  // 5. Collapse non-breaking spaces and stray entities
  s = s.replace(/&nbsp;/g, " ");

  // 6. Remove orphan invalid sequences like </p></div> and stray closing tags
  s = s.replace(/<\/p>\s*<\/div>/gi, "</div>");
  s = s.replace(/<p>\s*<\/p>/gi, "");

  // 7. Remove empty wrappers iteratively
  const emptyRe = /<(p|div|span|section)\b[^>]*>\s*(?:<br\s*\/?>\s*)*<\/\1>/gi;
  for (let i = 0; i < 10; i++) {
    const next = s.replace(emptyRe, "");
    if (next === s) break;
    s = next;
  }

  // 8. Remove orphan closing tags at end of doc (</div></div></p> trains)
  s = s.replace(/(?:\s*<\/(?:div|p|span|section)>)+\s*$/gi, "");

  // 9. Collapse 3+ blank lines
  s = s.replace(/\n{3,}/g, "\n\n").trim();

  return s;
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
      brand = "",
      sync_target = "shopify",
      dry_run = false,
      only_dirty = true,
      limit,
      mode = "ai",
      eans,
      force_push = false,
    } = body as {
      brand?: string;
      sync_target?: "shopify" | "woocommerce" | "none";
      dry_run?: boolean;
      only_dirty?: boolean;
      limit?: number;
      mode?: "ai" | "regex";
      eans?: string[];
      force_push?: boolean;
    };

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let query = supabase
      .from("master_products")
      .select("id, ean, title, brand, short_description, long_description, shopify_product_id, webshop_product_id, webshop_parent_id")
      .not("shopify_product_id", "is", null);
    // Skip variants only when scanning broadly; allow explicit EAN list to include variants.
    if (!eans || eans.length === 0) {
      query = query.is("webshop_parent_id", null);
    }
    if (brand && brand.length > 0) {
      query = query.or(`brand.ilike.${brand}%,title.ilike.${brand}%`);
    }
    if (eans && eans.length > 0) {
      query = query.in("ean", eans);
    }
    const { data: products, error: pErr } = await query.limit(2000);
    if (pErr) return json({ error: pErr.message }, 500);

    const dirtyRegex = /\[[a-z_]+[^\]]*\]|et_pb_|vc_row|wp-block|data-elementor|fusion_|<!--|elementor-element|wpc-filter-/i;
    const candidates = (products ?? []).filter((p) => {
      if (!only_dirty) return true;
      const blob = `${p.short_description ?? ""}\n${p.long_description ?? ""}`;
      return dirtyRegex.test(blob);
    });
    const slice = limit ? candidates.slice(0, limit) : candidates;

    console.log(`bulk-clean: ${slice.length} candidates (mode=${mode}, dry=${dry_run}, target=${sync_target})`);

    const { data: logRow } = await supabase
      .from("import_logs")
      .insert({ source: "bulk-clean-descriptions", status: "running", total_fetched: slice.length })
      .select("id")
      .single();
    const logId = logRow?.id as string | undefined;

    const CONCURRENCY = force_push ? 1 : (mode === "regex" ? 4 : 2);
    const DELAY_MS = force_push ? 600 : (mode === "regex" ? 100 : 400);
    let cursor = 0;
    const results: Result[] = [];

    const worker = async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= slice.length) return;
        const p = slice[idx];
        const r: Result = { id: p.id, ean: p.ean, title: p.title, status: "ok" };

        try {
          let newShort: string;
          let newLong: string;

          if (mode === "regex") {
            newShort = cleanHtml(p.short_description);
            newLong = cleanHtml(p.long_description);
            const unchanged =
              newShort === (p.short_description ?? "") &&
              newLong === (p.long_description ?? "");
            if (unchanged && !force_push) {
              r.status = "skipped";
              r.step = "no_changes";
              results.push(r);
              if (logId) {
                const errs = results.filter((x) => x.status === "error").map((x) => ({ ean: x.ean, msg: x.message }));
                const done = results.length === slice.length;
                await supabase.from("import_logs").update({
                  imported: results.filter((x) => x.status === "ok").length,
                  skipped: results.filter((x) => x.status === "skipped").length,
                  errors: errs,
                  status: done ? "completed" : "running",
                  completed_at: done ? new Date().toISOString() : null,
                }).eq("id", logId);
              }
              await sleep(DELAY_MS);
              continue;
            }
          } else {
            const ai = await callFn("ai-rewrite-description", { productId: p.id, mode: "clean" });
            newShort = ai.short_description ?? p.short_description ?? "";
            newLong = ai.long_description ?? p.long_description ?? "";
          }

          if (dry_run) {
            r.step = `dry_run_${mode}_done`;
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
                  force: force_push === true,
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
