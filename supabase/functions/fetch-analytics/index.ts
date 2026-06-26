import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const API_VERSION = "2026-04";

async function shopifyGraphql(shopDomain: string, token: string, query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(`https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (!res.ok || data.errors) {
    throw new Error(`Shopify GraphQL [${res.status}]: ${JSON.stringify(data.errors || data).slice(0, 400)}`);
  }
  return data.data;
}

// Aggregate sales per product from orders in [startISO, endISO]
async function fetchShopifySales(shopDomain: string, token: string, startISO: string, endISO: string) {
  const stats = new Map<string, { items_sold: number; net_revenue: number; order_ids: Set<string> }>();
  let cursor: string | null = null;
  const queryFilter = `processed_at:>=${startISO} processed_at:<=${endISO}`;

  for (let page = 0; page < 50; page++) {
    const query = `#graphql
      query Orders($cursor: String, $q: String!) {
        orders(first: 100, after: $cursor, query: $q, sortKey: PROCESSED_AT) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            lineItems(first: 100) {
              nodes {
                quantity
                originalTotalSet { shopMoney { amount } }
                product { id }
              }
            }
          }
        }
      }`;
    const data = await shopifyGraphql(shopDomain, token, query, { cursor, q: queryFilter });
    const nodes = data.orders.nodes ?? [];
    for (const order of nodes) {
      for (const li of order.lineItems.nodes ?? []) {
        const gid = li.product?.id as string | undefined;
        if (!gid) continue;
        const pid = gid.split("/").pop()!;
        const cur = stats.get(pid) ?? { items_sold: 0, net_revenue: 0, order_ids: new Set<string>() };
        cur.items_sold += li.quantity ?? 0;
        cur.net_revenue += parseFloat(li.originalTotalSet?.shopMoney?.amount ?? "0");
        cur.order_ids.add(order.id);
        stats.set(pid, cur);
      }
    }
    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }
  return stats;
}

// ShopifyQL: product views & sessions per product over period
async function fetchShopifyViews(shopDomain: string, token: string, startISO: string, endISO: string) {
  const result = new Map<string, { views: number; sessions: number }>();
  // ShopifyQL via `shopifyqlQuery` returns tabular data
  const since = startISO.split("T")[0];
  const until = endISO.split("T")[0];
  const ql = `FROM products_analytics
    SHOW product_views, sessions
    GROUP BY product_id
    SINCE ${since} UNTIL ${until}
    LIMIT 1000`;
  try {
    const data = await shopifyGraphql(shopDomain, token, `#graphql
      query($q: String!) {
        shopifyqlQuery(query: $q) {
          __typename
          ... on TableResponse {
            tableData {
              columns { name dataType }
              rowData
            }
          }
          ... on ParseError { code message }
        }
      }`, { q: ql });
    const r = data.shopifyqlQuery;
    if (r?.__typename === "TableResponse") {
      const cols: { name: string }[] = r.tableData.columns;
      const idxProduct = cols.findIndex((c) => c.name === "product_id");
      const idxViews = cols.findIndex((c) => c.name === "product_views");
      const idxSessions = cols.findIndex((c) => c.name === "sessions");
      for (const row of r.tableData.rowData as string[][]) {
        const pid = String(row[idxProduct] ?? "").split("/").pop();
        if (!pid) continue;
        result.set(pid, {
          views: parseInt(row[idxViews] ?? "0") || 0,
          sessions: parseInt(row[idxSessions] ?? "0") || 0,
        });
      }
    } else if (r?.__typename === "ParseError") {
      console.warn(`ShopifyQL parse error: ${r.message}`);
    }
  } catch (e) {
    console.warn(`ShopifyQL views unavailable: ${(e as Error).message}`);
  }
  return result;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("authorization");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (!authHeader.includes(supabaseServiceKey)) {
    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error } = await anon.auth.getUser();
    if (error || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  }

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, supabaseServiceKey);

    // Active Shopify connection
    const { data: conn } = await supabase
      .from("shopify_connection")
      .select("shop_domain, access_token")
      .order("is_active", { ascending: false })
      .order("installed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!conn) throw new Error("Ingen aktiv Shopify-forbindelse");

    // Settings
    const { data: settings } = await supabase.from("analytics_settings").select("setting_key, setting_value");
    const settingsMap: Record<string, string> = {};
    (settings ?? []).forEach((s: { setting_key: string; setting_value: string }) => { settingsMap[s.setting_key] = s.setting_value; });
    const periodDays = parseInt(settingsMap["analysis_period_days"] || "30");
    const lowStockThreshold = parseInt(settingsMap["low_stock_threshold"] || "5");

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - periodDays);
    const startISO = startDate.toISOString();
    const endISO = endDate.toISOString();
    const startStr = startISO.split("T")[0];
    const endStr = endISO.split("T")[0];

    console.log(`Shopify analytics period: ${startStr} → ${endStr} (${periodDays}d) on ${conn.shop_domain}`);

    // Products with Shopify mapping
    const { data: products } = await supabase
      .from("master_products")
      .select("id, title, sku, ean, stock_quantity, webshop_price, sale_price, shopify_product_id")
      .not("shopify_product_id", "is", null);
    if (!products?.length) {
      return new Response(JSON.stringify({ message: "Ingen Shopify-produkter fundet" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const shopifyIdToProduct = new Map<string, typeof products[number]>();
    for (const p of products) {
      if (p.shopify_product_id) shopifyIdToProduct.set(String(p.shopify_product_id), p);
    }
    console.log(`Products in DB: ${products.length}, with Shopify IDs: ${shopifyIdToProduct.size}`);

    const [salesStats, viewStats] = await Promise.all([
      fetchShopifySales(conn.shop_domain, conn.access_token, startISO, endISO),
      fetchShopifyViews(conn.shop_domain, conn.access_token, startISO, endISO),
    ]);

    console.log(`Shopify sales: ${salesStats.size} products | views: ${viewStats.size} products`);

    const analyticsRows: Record<string, unknown>[] = [];
    const recommendations: Record<string, unknown>[] = [];
    let matchedSales = 0, matchedViews = 0;

    for (const product of products) {
      const sId = String(product.shopify_product_id);
      const sale = salesStats.get(sId);
      const view = viewStats.get(sId);
      if (sale) matchedSales++;
      if (view) matchedViews++;
      const purchases = sale?.items_sold ?? 0;
      const ordersCount = sale?.order_ids.size ?? 0;
      const netRevenue = sale?.net_revenue ?? 0;
      const pageViews = view?.views ?? 0;
      const sessions = view?.sessions ?? 0;
      const conversionRate = sessions > 0 ? Math.round((ordersCount / sessions) * 10000) / 100 : 0;

      analyticsRows.push({
        master_product_id: product.id,
        period_start: startStr,
        period_end: endStr,
        page_views: pageViews,
        add_to_carts: 0,
        purchases,
        conversion_rate: conversionRate,
        impressions: sessions,
        clicks: ordersCount,
        avg_position: 0,
        ctr: 0,
        matched_url: null,
        updated_at: new Date().toISOString(),
      });

      if (purchases > 0 && (product.stock_quantity ?? 0) <= lowStockThreshold) {
        recommendations.push({
          master_product_id: product.id,
          recommendation_type: "high_traffic_low_stock",
          severity: "warning",
          title: "Populært produkt med lavt lager",
          description: `Solgt ${purchases} stk. de sidste ${periodDays} dage på Shopify, lager er ${product.stock_quantity ?? 0} stk.`,
          action_suggestion: "Bestil varen hjem hos den billigste leverandør hurtigst muligt.",
          data: { purchases, stock: product.stock_quantity, page_views: pageViews, sessions, net_revenue: netRevenue, conversion_rate: conversionRate },
        });
      }
    }

    let upsertedCount = 0;
    for (let i = 0; i < analyticsRows.length; i += 50) {
      const batch = analyticsRows.slice(i, i + 50);
      const { error } = await supabase
        .from("product_analytics")
        .upsert(batch, { onConflict: "master_product_id,period_start,period_end" });
      if (error) console.error(`Upsert batch error: ${error.message}`);
      else upsertedCount += batch.length;
    }
    console.log(`Upserted ${upsertedCount} analytics rows`);

    if (recommendations.length > 0) {
      await supabase.from("product_recommendations").delete().is("resolved_at", null).eq("is_dismissed", false).eq("recommendation_type", "high_traffic_low_stock");
      await supabase.from("product_recommendations").insert(recommendations);

      const { data: webhooks } = await supabase.from("webhook_configs").select("*").eq("is_active", true);
      const isSafeWebhookUrl = (u: string): boolean => {
        try {
          const p = new URL(u);
          if (!["http:", "https:"].includes(p.protocol)) return false;
          const h = p.hostname.toLowerCase();
          if (h === "localhost" || h === "127.0.0.1" || h === "::1" ||
              h.startsWith("10.") || h.startsWith("192.168.") || h.startsWith("172.") ||
              h === "169.254.169.254" || h.endsWith(".internal") || h.endsWith(".local")) return false;
          return true;
        } catch { return false; }
      };
      for (const webhook of webhooks ?? []) {
        if (!isSafeWebhookUrl(webhook.url)) {
          console.warn(`Skipping unsafe webhook URL: ${webhook.url}`);
          continue;
        }
        const eventTypes = webhook.event_types ?? [];
        const matching = recommendations.filter((r) => eventTypes.includes((r as { recommendation_type: string }).recommendation_type));
        if (matching.length > 0) {
          try {
            await fetch(webhook.url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ event: "product_recommendations", recommendations: matching, timestamp: new Date().toISOString() }),
            });
          } catch (e) { console.error(`Webhook failed: ${e}`); }
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      source: "shopify",
      shop_domain: conn.shop_domain,
      analytics_updated: upsertedCount,
      products_with_sales: matchedSales,
      products_with_views: matchedViews,
      recommendations_created: recommendations.length,
      period: { start: startStr, end: endStr, days: periodDays },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ukendt fejl";
    console.error("fetch-analytics error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
