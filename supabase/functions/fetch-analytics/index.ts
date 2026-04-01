import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// WooCommerce API helper with Basic Auth
async function wcFetch(storeUrl: string, endpoint: string, key: string, secret: string, params: Record<string, string> = {}) {
  const url = new URL(`${storeUrl}/wp-json/wc/v3/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const auth = btoa(`${key}:${secret}`);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Basic ${auth}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WooCommerce API error (${endpoint}): ${res.status} ${err}`);
  }
  return await res.json();
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

    // Get analysis period from settings
    const { data: settings } = await supabase
      .from("analytics_settings")
      .select("setting_key, setting_value");

    const settingsMap: Record<string, string> = {};
    (settings || []).forEach((s: any) => { settingsMap[s.setting_key] = s.setting_value; });

    const periodDays = parseInt(settingsMap["analysis_period_days"] || "30");
    const minTraffic = parseInt(settingsMap["min_traffic_threshold"] || "50");
    const lowStockThreshold = parseInt(settingsMap["low_stock_threshold"] || "5");

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - periodDays);
    const startStr = startDate.toISOString().split("T")[0];
    const endStr = endDate.toISOString().split("T")[0];

    console.log(`Fetching WooCommerce stats for ${startStr} to ${endStr}`);

    // Fetch top sellers from WooCommerce reports
    const topSellers = await wcFetch(wcStoreUrl, "reports/top_sellers", wcKey, wcSecret, {
      date_min: startStr,
      date_max: endStr,
      per_page: "100",
    });

    // Fetch sales report for the period
    const salesReport = await wcFetch(wcStoreUrl, "reports/sales", wcKey, wcSecret, {
      date_min: startStr,
      date_max: endStr,
    });

    // Get all products from our DB with their webshop IDs
    const { data: products } = await supabase
      .from("master_products")
      .select("id, title, sku, ean, stock_quantity, webshop_price, sale_price, webshop_product_id, webshop_parent_id");

    if (!products || products.length === 0) {
      return new Response(JSON.stringify({ message: "No products found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build webshop_product_id → master product map
    const wcIdToProduct = new Map<string, any>();
    for (const p of products) {
      if (p.webshop_product_id) {
        wcIdToProduct.set(p.webshop_product_id, p);
      }
      // Also map parent IDs for variations
      if (p.webshop_parent_id) {
        wcIdToProduct.set(p.webshop_parent_id, p);
      }
    }

    // Process top sellers data
    const statsByProduct = new Map<string, { purchases: number; revenue: number }>();
    for (const item of topSellers || []) {
      const wcId = String(item.product_id);
      const product = wcIdToProduct.get(wcId);
      if (product) {
        const existing = statsByProduct.get(product.id) || { purchases: 0, revenue: 0 };
        existing.purchases += item.quantity || 0;
        // top_sellers doesn't always have revenue, calculate from what we have
        statsByProduct.set(product.id, existing);
      }
    }

    // Upsert analytics data
    let upsertedCount = 0;
    const recommendations: any[] = [];

    for (const product of products) {
      const stats = statsByProduct.get(product.id);
      const purchases = stats?.purchases || 0;

      const { error } = await supabase
        .from("product_analytics")
        .upsert({
          master_product_id: product.id,
          period_start: startStr,
          period_end: endStr,
          page_views: 0,
          add_to_carts: 0,
          purchases,
          conversion_rate: 0,
          impressions: 0,
          clicks: 0,
          avg_position: 0,
          ctr: 0,
          matched_url: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "master_product_id,period_start,period_end" });

      if (!error) upsertedCount++;

      // Recommendation: Popular product with low stock
      if (purchases > 0 && (product.stock_quantity ?? 0) <= lowStockThreshold) {
        recommendations.push({
          master_product_id: product.id,
          recommendation_type: "high_traffic_low_stock",
          severity: "warning",
          title: "Populært produkt med lavt lager",
          description: `Produktet har solgt ${purchases} stk. de sidste ${periodDays} dage, men lagerbeholdningen er kun ${product.stock_quantity ?? 0} stk.`,
          action_suggestion: "Bestil varen hjem hos den billigste leverandør hurtigst muligt.",
          data: { purchases, stock: product.stock_quantity },
        });
      }

      // Recommendation: No sales but has price (might need attention)
      if (purchases === 0 && product.webshop_price && product.webshop_product_id) {
        // Only flag products that are actually live in the shop
        recommendations.push({
          master_product_id: product.id,
          recommendation_type: "high_traffic_no_sales",
          severity: "info",
          title: "Ingen salg i perioden",
          description: `Produktet har ikke haft salg de sidste ${periodDays} dage. Overvej at justere prisen eller synligheden.`,
          action_suggestion: product.webshop_price
            ? `Overvej at sænke prisen fra ${product.webshop_price} DKK.`
            : "Tilføj en konkurrencedygtig pris til produktet.",
          data: { purchases: 0, current_price: product.webshop_price },
        });
      }
    }

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

    // Fire webhooks for new recommendations
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
              body: JSON.stringify({
                event: "product_recommendations",
                recommendations: matchingRecs,
                timestamp: new Date().toISOString(),
              }),
            });
          } catch (e) {
            console.error(`Webhook ${webhook.name} failed:`, e);
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        analytics_updated: upsertedCount,
        recommendations_created: recommendations.length,
        period: { start: startStr, end: endStr },
        top_sellers_count: topSellers?.length || 0,
        total_products: products.length,
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
