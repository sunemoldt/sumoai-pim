// Backfill: læs woo.rank_math_title / woo.rank_math_description (eller _yoast_wpseo_title / _yoast_wpseo_metadesc som fallback)
// fra Shopify metafields og skriv til master_products.meta_title / meta_description.
// Mode: 'report' (default) viser hvad der ville blive skrevet. 'apply' opdaterer PIM.
// Default: kun hvor PIM-feltet er tomt (overwriteEmptyOnly=true). Sæt overwriteEmptyOnly=false for at overskrive.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_VERSION = "2025-10";

async function gql(shop: string, token: string, query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`Shopify GQL ${res.status}: ${JSON.stringify(json.errors || json)}`);
  return json.data;
}

function decodeHtmlEntities(s: string): string {
  if (!s) return "";
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    ndash: "–", mdash: "—", hellip: "…", aelig: "æ", oslash: "ø", aring: "å",
    AElig: "Æ", Oslash: "Ø", Aring: "Å",
  };
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return _; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return _; } })
    .replace(/&([a-zA-Z]+);/g, (m, n) => named[n] ?? named[n.toLowerCase()] ?? m);
}
const norm = (s: string | null | undefined) => decodeHtmlEntities((s ?? "").trim()).trim();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!authHeader.includes(SUPABASE_SERVICE_ROLE_KEY)) {
      const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
      const { data: { user } } = await anon.auth.getUser();
      if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const mode: "report" | "apply" = body.mode === "apply" ? "apply" : "report";
    const eans: string[] | null = Array.isArray(body.eans) ? body.eans : null;
    const limit: number = Math.min(Number(body.limit) || 50, 250);
    const overwriteEmptyOnly: boolean = body.overwriteEmptyOnly !== false; // default true
    const useYoastFallback: boolean = body.useYoastFallback !== false; // default true

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: conn } = await supabase
      .from("shopify_connection")
      .select("shop_domain, access_token")
      .order("is_active", { ascending: false })
      .order("installed_at", { ascending: false })
      .limit(1).maybeSingle();
    if (!conn) throw new Error("Ingen Shopify-forbindelse");

    let q = supabase.from("master_products")
      .select("id, ean, sku, title, meta_title, meta_description, shopify_product_id")
      .not("shopify_product_id", "is", null);
    if (eans && eans.length) q = q.in("ean", eans);
    q = q.order("title").limit(limit);

    const { data: pimRows, error } = await q;
    if (error) throw error;
    if (!pimRows?.length) {
      return new Response(JSON.stringify({ success: true, mode, message: "Ingen produkter matchede", results: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Hent SEO-relaterede metafields fra Shopify (rank_math_* + _yoast_wpseo_*)
    const productGids = Array.from(new Set(pimRows.map(r => `gid://shopify/Product/${r.shopify_product_id}`)));
    const data = await gql(conn.shop_domain, conn.access_token, `
      query($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id title
            rmTitle: metafield(namespace: "woo", key: "rank_math_title") { value }
            rmDesc:  metafield(namespace: "woo", key: "rank_math_description") { value }
            yTitle:  metafield(namespace: "woo", key: "_yoast_wpseo_title") { value }
            yDesc:   metafield(namespace: "woo", key: "_yoast_wpseo_metadesc") { value }
          }
        }
      }`, { ids: productGids });

    const mfMap = new Map<string, any>();
    for (const n of data.nodes ?? []) if (n) mfMap.set(n.id.replace("gid://shopify/Product/", ""), n);

    const results: any[] = [];
    let updateCount = 0;

    for (const p of pimRows) {
      const sp = mfMap.get(p.shopify_product_id);
      if (!sp) {
        results.push({ ean: p.ean, title: p.title, error: "Shopify produkt ikke fundet" });
        continue;
      }

      const rmTitle = norm(sp.rmTitle?.value);
      const rmDesc = norm(sp.rmDesc?.value);
      const yTitle = useYoastFallback ? norm(sp.yTitle?.value) : "";
      const yDesc = useYoastFallback ? norm(sp.yDesc?.value) : "";
      const sourceTitle = rmTitle || yTitle;
      const sourceDesc = rmDesc || yDesc;
      const titleSrc = rmTitle ? "rank_math" : (yTitle ? "yoast" : "none");
      const descSrc = rmDesc ? "rank_math" : (yDesc ? "yoast" : "none");

      const pimTitle = norm(p.meta_title);
      const pimDesc = norm(p.meta_description);

      const willWriteTitle = sourceTitle && sourceTitle !== pimTitle && (!overwriteEmptyOnly || !pimTitle);
      const willWriteDesc = sourceDesc && sourceDesc !== pimDesc && (!overwriteEmptyOnly || !pimDesc);

      const entry: any = {
        ean: p.ean, title: p.title,
        current_pim_title: pimTitle || null,
        current_pim_desc: pimDesc || null,
        source_title: sourceTitle || null,
        source_desc: sourceDesc || null,
        title_source: titleSrc,
        desc_source: descSrc,
        will_write_title: willWriteTitle,
        will_write_desc: willWriteDesc,
      };

      if (mode === "apply" && (willWriteTitle || willWriteDesc)) {
        const update: Record<string, unknown> = {};
        if (willWriteTitle) update.meta_title = sourceTitle;
        if (willWriteDesc) update.meta_description = sourceDesc;
        const { error: upErr } = await supabase
          .from("master_products")
          .update(update)
          .eq("id", p.id);
        if (upErr) entry.error = upErr.message;
        else { entry.updated = Object.keys(update); updateCount++; }
      }

      results.push(entry);
    }

    const summary = {
      mode,
      total: results.length,
      with_rank_math_title: results.filter(r => r.title_source === "rank_math").length,
      with_yoast_title: results.filter(r => r.title_source === "yoast").length,
      will_update_title: results.filter(r => r.will_write_title).length,
      will_update_desc: results.filter(r => r.will_write_desc).length,
      applied: updateCount,
      overwrite_empty_only: overwriteEmptyOnly,
    };

    return new Response(JSON.stringify({ success: true, summary, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("shopify-seo-backfill error:", err);
    return new Response(JSON.stringify({ success: false, error: err?.message ?? String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
