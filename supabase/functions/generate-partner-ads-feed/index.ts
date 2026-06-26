// Generates a Google Shopping-style XML feed for Partner-ads and caches it in
// Storage bucket "product-feeds" as partner-ads.xml. Logs each run to feed_runs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHOPIFY_API_VERSION = "2026-04";
const FEED_KEY = "partner-ads";
const BUCKET = "product-feeds";
const FILE_PATH = "partner-ads.xml";

function esc(s: unknown): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fmtPrice(v: number): string {
  return `${v.toFixed(2)} DKK`;
}

function availability(stockStatus: string | null, qty: number | null, backorderPolicy: string | null): string {
  const q = qty ?? 0;
  if (stockStatus === "instock" && q > 0) return "in stock";
  if (backorderPolicy === "yes") return "preorder";
  return "out of stock";
}

async function fetchShopifyHandles(supabase: ReturnType<typeof createClient>): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data: conn } = await supabase
    .from("shopify_connection")
    .select("shop_domain, access_token")
    .order("is_active", { ascending: false })
    .order("installed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!conn?.shop_domain || !conn?.access_token) return map;

  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    const query = `#graphql
      query($cursor: String) {
        products(first: 250, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes { id handle }
        }
      }`;
    const res = await fetch(`https://${conn.shop_domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": conn.access_token as string },
      body: JSON.stringify({ query, variables: { cursor } }),
    });
    if (!res.ok) break;
    const data = await res.json();
    const nodes = data?.data?.products?.nodes ?? [];
    for (const n of nodes) {
      const gid: string = n.id;
      const numeric = gid.replace(/^gid:\/\/shopify\/Product\//, "");
      map.set(numeric, n.handle);
    }
    if (!data?.data?.products?.pageInfo?.hasNextPage) break;
    cursor = data.data.products.pageInfo.endCursor;
  }
  return map;
}

async function generate(): Promise<{ url: string; product_count: number; size: number; run_id: string }> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: run, error: runErr } = await supabase
    .from("feed_runs")
    .insert({ feed_key: FEED_KEY, status: "running" })
    .select("id")
    .single();
  if (runErr) throw runErr;
  const runId = run.id as string;

  try {
    // Configurable storefront URL
    const { data: storeSetting } = await supabase
      .from("analytics_settings")
      .select("setting_value")
      .eq("setting_key", "feed_store_url")
      .maybeSingle();
    let storeUrl = (storeSetting?.setting_value as string | undefined)?.trim();
    if (!storeUrl) {
      const { data: conn } = await supabase
        .from("shopify_connection")
        .select("primary_domain_url, shop_domain")
        .order("is_active", { ascending: false })
        .limit(1)
        .maybeSingle();
      storeUrl = (conn?.primary_domain_url as string | undefined) ||
        (conn?.shop_domain ? `https://${conn.shop_domain}` : "");
    }
    storeUrl = (storeUrl || "").replace(/\/+$/, "");

    // Fetch products in pages
    const products: any[] = [];
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("master_products")
        .select(
          "id, ean, title, image_url, brand, category, sku, long_description, short_description, webshop_price, sale_price, stock_status, stock_quantity, backorder_policy, weight_kg, shopify_product_id, lifecycle_status, exclude_from_feeds"
        )
        .neq("lifecycle_status", "draft")
        .eq("exclude_from_feeds", false)
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      if (!data?.length) break;
      products.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
    }

    const handleMap = await fetchShopifyHandles(supabase);

    const items: string[] = [];
    for (const p of products) {
      if (!p.title || !p.webshop_price || p.webshop_price <= 0) continue;
      const handle = p.shopify_product_id ? handleMap.get(String(p.shopify_product_id)) : undefined;
      const link = handle && storeUrl ? `${storeUrl}/products/${handle}` : null;
      if (!link) continue; // Skip products without a resolvable storefront URL

      const idVal = p.ean || p.id;
      const desc = stripHtml(p.long_description || p.short_description || p.title).slice(0, 5000);
      const price = Number(p.webshop_price);
      const sale = p.sale_price ? Number(p.sale_price) : null;
      const avail = availability(p.stock_status, p.stock_quantity, p.backorder_policy);
      const weight = p.weight_kg && Number(p.weight_kg) > 0 ? Number(p.weight_kg) : 1;

      let item = `    <item>\n`;
      item += `      <g:id>${esc(idVal)}</g:id>\n`;
      item += `      <title>${esc(p.title)}</title>\n`;
      item += `      <description>${esc(desc)}</description>\n`;
      item += `      <link>${esc(link)}</link>\n`;
      if (p.image_url) item += `      <g:image_link>${esc(p.image_url)}</g:image_link>\n`;
      item += `      <g:availability>${avail}</g:availability>\n`;
      item += `      <g:price>${esc(fmtPrice(price))}</g:price>\n`;
      if (sale && sale > 0 && sale < price) {
        item += `      <g:sale_price>${esc(fmtPrice(sale))}</g:sale_price>\n`;
      }
      item += `      <g:condition>new</g:condition>\n`;
      if (p.brand) item += `      <g:brand>${esc(p.brand)}</g:brand>\n`;
      if (p.ean) item += `      <g:gtin>${esc(p.ean)}</g:gtin>\n`;
      if (p.sku) item += `      <g:mpn>${esc(p.sku)}</g:mpn>\n`;
      if (p.category) item += `      <g:product_type>${esc(p.category)}</g:product_type>\n`;
      item += `      <g:shipping_weight>${weight.toFixed(2)} kg</g:shipping_weight>\n`;
      item += `      <g:identifier_exists>${p.ean ? "yes" : "no"}</g:identifier_exists>\n`;
      item += `    </item>`;
      items.push(item);
    }

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n` +
      `  <channel>\n` +
      `    <title>Comtek produktfeed</title>\n` +
      `    <link>${esc(storeUrl)}</link>\n` +
      `    <description>Partner-ads produktfeed genereret af PIM</description>\n` +
      `    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n` +
      items.join("\n") + "\n" +
      `  </channel>\n` +
      `</rss>\n`;

    const bytes = new TextEncoder().encode(xml);
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(FILE_PATH, bytes, { contentType: "application/xml; charset=utf-8", upsert: true });
    if (upErr) throw upErr;

    await supabase
      .from("feed_runs")
      .update({
        status: "success",
        product_count: items.length,
        file_path: `${BUCKET}/${FILE_PATH}`,
        file_size_bytes: bytes.length,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);

    const url = `${SUPABASE_URL}/functions/v1/partner-ads-feed`;
    return { url, product_count: items.length, size: bytes.length, run_id: runId };
  } catch (e) {
    await supabase
      .from("feed_runs")
      .update({
        status: "error",
        error: e instanceof Error ? e.message : String(e),
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const result = await generate();
    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
