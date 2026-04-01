import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Google Auth: get access token from service account
async function getGoogleAccessToken(serviceAccount: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  }));

  const textEncoder = new TextEncoder();
  const inputStr = `${header}.${payload}`;

  // Import the private key
  const pemContent = serviceAccount.private_key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\n/g, "");
  const binaryKey = Uint8Array.from(atob(pemContent), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    textEncoder.encode(inputStr)
  );

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const jwt = `${header}.${payload}.${signatureB64}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Failed to get Google access token: ${err}`);
  }

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

// Fetch GA4 data
async function fetchGA4Data(accessToken: string, propertyId: string, startDate: string, endDate: string) {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "pagePath" }],
        metrics: [
          { name: "screenPageViews" },
          { name: "addToCarts" },
          { name: "ecommercePurchases" },
        ],
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GA4 API error: ${err}`);
  }

  return await res.json();
}

// Fetch GSC data
async function fetchGSCData(accessToken: string, siteUrl: string, startDate: string, endDate: string) {
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ["page"],
        rowLimit: 5000,
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GSC API error: ${err}`);
  }

  return await res.json();
}

// Extract slug from URL
function extractSlug(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, "");
    const parts = path.split("/").filter(Boolean);
    // Return last segment as slug
    return parts[parts.length - 1] || "";
  } catch {
    return url;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const serviceAccountJson = Deno.env.get("GCP_SERVICE_ACCOUNT_JSON");
    const ga4PropertyId = Deno.env.get("GA4_PROPERTY_ID");
    const gscSiteUrl = Deno.env.get("GSC_SITE_URL");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!serviceAccountJson) throw new Error("GCP_SERVICE_ACCOUNT_JSON not configured");
    if (!ga4PropertyId) throw new Error("GA4_PROPERTY_ID not configured");
    if (!gscSiteUrl) throw new Error("GSC_SITE_URL not configured");

    const serviceAccount = JSON.parse(serviceAccountJson);
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get analysis period from settings
    const { data: settings } = await supabase
      .from("analytics_settings")
      .select("setting_key, setting_value");

    const settingsMap: Record<string, string> = {};
    (settings || []).forEach((s: any) => { settingsMap[s.setting_key] = s.setting_value; });

    const periodDays = parseInt(settingsMap["analysis_period_days"] || "7");
    const minTraffic = parseInt(settingsMap["min_traffic_threshold"] || "50");
    const minCtr = parseFloat(settingsMap["min_ctr_threshold"] || "3");
    const lowStockThreshold = parseInt(settingsMap["low_stock_threshold"] || "5");

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - periodDays);
    const startStr = startDate.toISOString().split("T")[0];
    const endStr = endDate.toISOString().split("T")[0];

    console.log(`Fetching analytics for ${startStr} to ${endStr}`);

    // Get Google access token
    const accessToken = await getGoogleAccessToken(serviceAccount);

    // Fetch GA4 and GSC data in parallel
    const [ga4Data, gscData] = await Promise.all([
      fetchGA4Data(accessToken, ga4PropertyId, startStr, endStr),
      fetchGSCData(accessToken, gscSiteUrl, startStr, endStr),
    ]);

    // Get all products with their slugs (match by title slug)
    const { data: products } = await supabase
      .from("master_products")
      .select("id, title, sku, ean, stock_quantity, webshop_price, sale_price");

    if (!products || products.length === 0) {
      return new Response(JSON.stringify({ message: "No products found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build slug-to-product map (normalize titles to URL-friendly slugs)
    const slugToProduct = new Map<string, any>();
    for (const p of products) {
      // Create slug from title
      const slug = p.title
        .toLowerCase()
        .replace(/[æ]/g, "ae").replace(/[ø]/g, "oe").replace(/[å]/g, "aa")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      slugToProduct.set(slug, p);
      // Also map by SKU and EAN
      if (p.sku) slugToProduct.set(p.sku.toLowerCase(), p);
      if (p.ean) slugToProduct.set(p.ean, p);
    }

    // Process GA4 rows
    const ga4ByProduct = new Map<string, { pageViews: number; addToCarts: number; purchases: number }>();
    if (ga4Data.rows) {
      for (const row of ga4Data.rows) {
        const pagePath = row.dimensionValues[0].value;
        const slug = extractSlug(pagePath);
        
        // Try to match slug to product
        const product = slugToProduct.get(slug) || slugToProduct.get(slug.toLowerCase());
        if (product) {
          const existing = ga4ByProduct.get(product.id) || { pageViews: 0, addToCarts: 0, purchases: 0 };
          existing.pageViews += parseInt(row.metricValues[0].value || "0");
          existing.addToCarts += parseInt(row.metricValues[1].value || "0");
          existing.purchases += parseInt(row.metricValues[2].value || "0");
          ga4ByProduct.set(product.id, existing);
        }
      }
    }

    // Process GSC rows
    const gscByProduct = new Map<string, { impressions: number; clicks: number; position: number; ctr: number; url: string }>();
    if (gscData.rows) {
      for (const row of gscData.rows) {
        const pageUrl = row.keys[0];
        const slug = extractSlug(pageUrl);
        
        const product = slugToProduct.get(slug) || slugToProduct.get(slug.toLowerCase());
        if (product) {
          const existing = gscByProduct.get(product.id) || { impressions: 0, clicks: 0, position: 0, ctr: 0, url: pageUrl };
          existing.impressions += row.impressions || 0;
          existing.clicks += row.clicks || 0;
          existing.position = row.position || existing.position;
          existing.ctr = row.ctr ? row.ctr * 100 : existing.ctr;
          existing.url = pageUrl;
          gscByProduct.set(product.id, existing);
        }
      }
    }

    // Upsert analytics data
    const allProductIds = new Set([...ga4ByProduct.keys(), ...gscByProduct.keys()]);
    let upsertedCount = 0;
    const recommendations: any[] = [];

    for (const productId of allProductIds) {
      const ga4 = ga4ByProduct.get(productId) || { pageViews: 0, addToCarts: 0, purchases: 0 };
      const gsc = gscByProduct.get(productId) || { impressions: 0, clicks: 0, position: 0, ctr: 0, url: "" };
      const convRate = ga4.pageViews > 0 ? (ga4.purchases / ga4.pageViews) * 100 : 0;

      const { error } = await supabase
        .from("product_analytics")
        .upsert({
          master_product_id: productId,
          period_start: startStr,
          period_end: endStr,
          page_views: ga4.pageViews,
          add_to_carts: ga4.addToCarts,
          purchases: ga4.purchases,
          conversion_rate: Math.round(convRate * 100) / 100,
          impressions: gsc.impressions,
          clicks: gsc.clicks,
          avg_position: Math.round(gsc.position * 10) / 10,
          ctr: Math.round(gsc.ctr * 100) / 100,
          matched_url: gsc.url || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "master_product_id,period_start,period_end" });

      if (!error) upsertedCount++;

      // Find matching product for recommendations
      const product = products.find((p: any) => p.id === productId);
      if (!product) continue;

      // Trigger: High traffic, no sales
      if (ga4.pageViews >= minTraffic && ga4.purchases === 0) {
        recommendations.push({
          master_product_id: productId,
          recommendation_type: "high_traffic_no_sales",
          severity: "critical",
          title: "Høj trafik uden salg",
          description: `Produktet har haft ${ga4.pageViews} besøgende de sidste ${periodDays} dage uden et eneste salg. Overvej at justere prisen.`,
          action_suggestion: product.webshop_price
            ? `Sænk prisen med 5-10% fra ${product.webshop_price} DKK for at øge konverteringen.`
            : "Tilføj en konkurrencedygtig pris til produktet.",
          data: { page_views: ga4.pageViews, purchases: 0, current_price: product.webshop_price },
        });
      }

      // Trigger: High traffic, low stock
      if (ga4.pageViews >= minTraffic && ga4.purchases > 0 && (product.stock_quantity ?? 0) <= lowStockThreshold) {
        recommendations.push({
          master_product_id: productId,
          recommendation_type: "high_traffic_low_stock",
          severity: "warning",
          title: "Populært produkt med lavt lager",
          description: `Produktet konverterer godt (${ga4.purchases} salg), men lagerbeholdningen er kun ${product.stock_quantity ?? 0} stk.`,
          action_suggestion: "Bestil varen hjem hos den billigste leverandør hurtigst muligt.",
          data: { page_views: ga4.pageViews, purchases: ga4.purchases, stock: product.stock_quantity },
        });
      }

      // Trigger: Good position, bad CTR
      if (gsc.position > 0 && gsc.position <= 10 && gsc.ctr < minCtr && gsc.impressions >= 100) {
        recommendations.push({
          master_product_id: productId,
          recommendation_type: "good_position_bad_ctr",
          severity: "info",
          title: "God placering, lav CTR",
          description: `Produktet ligger i top ${Math.round(gsc.position)} på Google med ${gsc.impressions} visninger, men kun ${gsc.ctr.toFixed(1)}% CTR.`,
          action_suggestion: "Forbedr meta-titel og meta-beskrivelse for at øge klikraten fra søgeresultaterne.",
          data: { position: gsc.position, ctr: gsc.ctr, impressions: gsc.impressions },
        });
      }
    }

    // Clear old recommendations and insert new
    if (recommendations.length > 0) {
      // Only clear non-dismissed, unresolved recommendations
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
        const matchingRecs = recommendations.filter(r => eventTypes.includes(r.recommendation_type));
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
        ga4_rows: ga4Data.rows?.length || 0,
        gsc_rows: gscData.rows?.length || 0,
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
