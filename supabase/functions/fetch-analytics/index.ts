import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function wcFetch(storeUrl: string, endpoint: string, key: string, secret: string, params: Record<string, string> = {}) {
  const url = new URL(`${storeUrl}/wp-json/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const auth = btoa(`${key}:${secret}`);
  console.log(`WC fetch: ${url.toString()}`);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Basic ${auth}` },
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`WC error ${res.status}: ${body}`);
    throw new Error(`WC API error (${endpoint}): ${res.status}`);
  }
  return JSON.parse(body);
}

async function fetchIAWPAnalytics(
  storeUrl: string,
  apiKey: string,
  periodDays: number
): Promise<Map<string, { views: number; visitors: number; sessions: number }>> {
  const result = new Map<string, { views: number; visitors: number; sessions: number }>();
  try {
    const url = new URL(`${storeUrl}/wp-json/custom/v1/product-analytics`);
    url.searchParams.set("days", String(periodDays));
    url.searchParams.set("api_key", apiKey);
    console.log(`IAWP fetch: ${url.toString().replace(apiKey, "***")}`);
    const res = await fetch(url.toString());
    const body = await res.text();
    if (!res.ok) {
      console.error(`IAWP error ${res.status}: ${body}`);
      throw new Error(`IAWP API error: ${res.status}`);
    }
    const data = JSON.parse(body);
    console.log(`IAWP returned ${data.length} products with view data`);
    for (const item of data) {
      result.set(String(item.product_id), {
        views: item.views || 0,
        visitors: item.visitors || 0,
        sessions: item.sessions || 0,
      });
    }
  } catch (e) {
    console.error(`Could not fetch IAWP analytics: ${e.message}`);
  }
  return result;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const wcStoreUrl = Deno.env.get("WC_STORE_URL");
    const wcKey = Deno.env.get("WC_CONSUMER_KEY");
    const wcSecret = Deno.env.get("WC_CONSUMER_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!wcStoreUrl) throw new Error("WC_STORE_URL not configured");
    if (!wcKey) throw new Error("WC_CONSUMER_KEY not configured");
    if (!wcSecret) throw new Error("WC_CONSUMER_SECRET not configured");

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get settings
    const { data: settings } = await supabase
      .from("analytics_settings")
      .select("setting_key, setting_value");
    const settingsMap: Record<string, string> = {};
    (settings || []).forEach((s: any) => { settingsMap[s.setting_key] = s.setting_value; });

    const periodDays = parseInt(settingsMap["analysis_period_days"] || "30");
    const lowStockThreshold = parseInt(settingsMap["low_stock_threshold"] || "5");

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - periodDays);
    const startStr = startDate.toISOString().split("T")[0];
    const endStr = endDate.toISOString().split("T")[0];

    console.log(`Period: ${startStr} to ${endStr} (${periodDays} days)`);

    // Get products from our DB
    const { data: products } = await supabase
      .from("master_products")
      .select("id, title, sku, ean, stock_quantity, webshop_price, sale_price, webshop_product_id, webshop_parent_id");

    if (!products || products.length === 0) {
      return new Response(JSON.stringify({ message: "No products found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build WC product ID → master product map
    const wcIdToProduct = new Map<string, any>();
    for (const p of products) {
      if (p.webshop_product_id) wcIdToProduct.set(p.webshop_product_id, p);
      if (p.webshop_parent_id) wcIdToProduct.set(p.webshop_parent_id, p);
    }

    console.log(`Products in DB: ${products.length}, with WC IDs: ${wcIdToProduct.size}`);

    // Fetch WC sales stats and IAWP page views in parallel
    const [salesResult, iawpViews] = await Promise.all([
      fetchWCSalesStats(wcStoreUrl, wcKey, wcSecret, startStr, endStr),
      fetchIAWPAnalytics(wcStoreUrl, wcKey, wcSecret, periodDays),
    ]);

    const { productStats, usedEndpoint } = salesResult;

    // Map WC stats to our products
    const statsByProductId = new Map<string, { items_sold: number; net_revenue: number; orders_count: number }>();
    for (const stat of productStats) {
      const wcId = String(stat.product_id);
      const product = wcIdToProduct.get(wcId);
      if (product) {
        const existing = statsByProductId.get(product.id) || { items_sold: 0, net_revenue: 0, orders_count: 0 };
        existing.items_sold += stat.items_sold || 0;
        existing.net_revenue += parseFloat(stat.net_revenue || "0");
        existing.orders_count += stat.orders_count || 0;
        statsByProductId.set(product.id, existing);
      }
    }

    // Map IAWP views to our products
    const viewsByProductId = new Map<string, { views: number; visitors: number; sessions: number }>();
    for (const [wcId, viewData] of iawpViews) {
      const product = wcIdToProduct.get(wcId);
      if (product) {
        const existing = viewsByProductId.get(product.id) || { views: 0, visitors: 0, sessions: 0 };
        existing.views += viewData.views;
        existing.visitors += viewData.visitors;
        existing.sessions += viewData.sessions;
        viewsByProductId.set(product.id, existing);
      }
    }

    console.log(`Matched ${statsByProductId.size} products with sales data, ${viewsByProductId.size} with view data`);

    // Batch upsert analytics
    const analyticsRows = [];
    const recommendations: any[] = [];

    for (const product of products) {
      if (!product.webshop_product_id) continue;

      const stats = statsByProductId.get(product.id);
      const views = viewsByProductId.get(product.id);
      const purchases = stats?.items_sold || 0;
      const ordersCount = stats?.orders_count || 0;
      const pageViews = views?.views || 0;

      // Calculate conversion rate: purchases / page_views
      const conversionRate = pageViews > 0 ? Math.round((purchases / pageViews) * 10000) / 100 : 0;

      analyticsRows.push({
        master_product_id: product.id,
        period_start: startStr,
        period_end: endStr,
        page_views: pageViews,
        add_to_carts: 0,
        purchases,
        conversion_rate: conversionRate,
        impressions: views?.sessions || 0,
        clicks: ordersCount,
        avg_position: 0,
        ctr: 0,
        matched_url: null,
        updated_at: new Date().toISOString(),
      });

      // Recommendations
      if (purchases > 0 && (product.stock_quantity ?? 0) <= lowStockThreshold) {
        recommendations.push({
          master_product_id: product.id,
          recommendation_type: "high_traffic_low_stock",
          severity: "warning",
          title: "Populært produkt med lavt lager",
          description: `Produktet har solgt ${purchases} stk. de sidste ${periodDays} dage, men lagerbeholdningen er kun ${product.stock_quantity ?? 0} stk.`,
          action_suggestion: "Bestil varen hjem hos den billigste leverandør hurtigst muligt.",
          data: { purchases, stock: product.stock_quantity, page_views: pageViews, conversion_rate: conversionRate },
        });
      }
    }

    // Upsert in batches of 50
    let upsertedCount = 0;
    for (let i = 0; i < analyticsRows.length; i += 50) {
      const batch = analyticsRows.slice(i, i + 50);
      const { error } = await supabase
        .from("product_analytics")
        .upsert(batch, { onConflict: "master_product_id,period_start,period_end" });
      if (error) {
        console.error(`Upsert batch error: ${error.message}`);
      } else {
        upsertedCount += batch.length;
      }
    }

    console.log(`Upserted ${upsertedCount} analytics rows`);

    // Clear old recommendations and insert new
    if (recommendations.length > 0) {
      await supabase
        .from("product_recommendations")
        .delete()
        .is("resolved_at", null)
        .eq("is_dismissed", false);
      await supabase
        .from("product_recommendations")
        .insert(recommendations);
    }

    // Fire webhooks
    if (recommendations.length > 0) {
      const { data: webhooks } = await supabase
        .from("webhook_configs")
        .select("*")
        .eq("is_active", true);
      for (const webhook of webhooks || []) {
        const eventTypes = webhook.event_types || [];
        const matchingRecs = recommendations.filter((r: any) => eventTypes.includes(r.recommendation_type));
        if (matchingRecs.length > 0) {
          try {
            await fetch(webhook.url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ event: "product_recommendations", recommendations: matchingRecs, timestamp: new Date().toISOString() }),
            });
          } catch (e) {
            console.error(`Webhook failed: ${e}`);
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        endpoint_used: usedEndpoint,
        analytics_updated: upsertedCount,
        products_with_sales: statsByProductId.size,
        products_with_views: viewsByProductId.size,
        recommendations_created: recommendations.length,
        period: { start: startStr, end: endStr, days: periodDays },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in fetch-analytics:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Extracted: fetch WC sales statistics
async function fetchWCSalesStats(
  wcStoreUrl: string,
  wcKey: string,
  wcSecret: string,
  startStr: string,
  endStr: string
): Promise<{ productStats: any[]; usedEndpoint: string }> {
  try {
    const stats = await wcFetch(wcStoreUrl, "wc-analytics/reports/products", wcKey, wcSecret, {
      after: `${startStr}T00:00:00`,
      before: `${endStr}T23:59:59`,
      per_page: "100",
      orderby: "items_sold",
      order: "desc",
    });
    console.log(`WC Analytics returned ${stats.length} products`);
    return { productStats: stats, usedEndpoint: "wc-analytics/reports/products" };
  } catch (e) {
    console.log(`WC Analytics endpoint failed, trying classic: ${e.message}`);
    try {
      const topSellers = await wcFetch(wcStoreUrl, "wc/v3/reports/top_sellers", wcKey, wcSecret, {
        date_min: startStr,
        date_max: endStr,
        per_page: "100",
      });
      const productStats = topSellers.map((t: any) => ({
        product_id: t.product_id,
        items_sold: t.quantity,
        net_revenue: 0,
        orders_count: 0,
      }));
      console.log(`Classic top_sellers returned ${topSellers.length} items`);
      return { productStats, usedEndpoint: "wc/v3/reports/top_sellers" };
    } catch (e2) {
      console.error(`Both WC endpoints failed: ${e2.message}`);
      throw new Error(`Could not fetch WC stats: ${e2.message}`);
    }
  }
}
