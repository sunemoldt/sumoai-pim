import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Auth check
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!authHeader.includes(SUPABASE_SERVICE_ROLE_KEY)) {
    const anonClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Cooldown: kør max 1 gang per time for at spare AI-credits
    // (medmindre forced=true sendes i body)
    let forced = false;
    try {
      const body = await req.clone().json().catch(() => ({}));
      forced = !!(body as any)?.forced;
    } catch { /* no body */ }

    if (!forced) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: recent } = await supabase
        .from("product_recommendations")
        .select("created_at")
        .in("recommendation_type", ["pricing", "stock", "conversion", "margin"])
        .gte("created_at", oneHourAgo)
        .limit(1);
      if (recent && recent.length > 0) {
        return new Response(JSON.stringify({
          success: true,
          skipped: true,
          reason: "AI-analyse blev kørt for under 1 time siden – springer over for at spare credits. Send {forced:true} for at tvinge.",
          recommendations_count: 0,
          products_affected: 0,
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // 1. Fetch recent change logs (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [changeLogsRes, productsRes, analyticsRes, supplierProductsRes, suppliersRes] = await Promise.all([
      supabase.from("product_change_log")
        .select("master_product_id, change_type, field_name, old_value, new_value, created_at")
        .gte("created_at", thirtyDaysAgo)
        .order("created_at", { ascending: false })
        .limit(500),
      // Shopify er master: kun produkter der er synket til Shopify medtages i analysen
      supabase.from("master_products")
        .select("id, ean, title, brand, category, webshop_price, sale_price, stock_quantity, stock_status, shopify_product_id, shopify_variant_id, shopify_sync_enabled")
        .not("shopify_product_id", "is", null),
      supabase.from("product_analytics")
        .select("master_product_id, page_views, purchases, conversion_rate, clicks, impressions"),
      supabase.from("supplier_products")
        .select("master_product_id, supplier_id, purchase_price, in_stock, stock_quantity"),
      supabase.from("suppliers")
        .select("id, name"),
    ]);

    const changeLogs = changeLogsRes.data ?? [];
    const products = productsRes.data ?? [];
    const analytics = analyticsRes.data ?? [];
    const supplierProducts = supplierProductsRes.data ?? [];
    const suppliers = suppliersRes.data ?? [];

    const supplierMap = new Map(suppliers.map(s => [s.id, s.name]));

    // Build product summaries for AI — kun top 40 for at spare tokens
    const productSummaries = products.slice(0, 40).map(p => {
      const pAnalytics = analytics.filter(a => a.master_product_id === p.id);
      const pSuppliers = supplierProducts.filter(sp => sp.master_product_id === p.id);
      const pChanges = changeLogs.filter(cl => cl.master_product_id === p.id);

      const totalVisits = pAnalytics.reduce((sum, a) => sum + (a.page_views ?? 0), 0);
      const totalPurchases = pAnalytics.reduce((sum, a) => sum + (a.purchases ?? 0), 0);
      const avgConversion = pAnalytics.length > 0
        ? pAnalytics.reduce((sum, a) => sum + (Number(a.conversion_rate) ?? 0), 0) / pAnalytics.length
        : 0;

      const cheapestSupplier = pSuppliers.length > 0
        ? pSuppliers.reduce((min, sp) => sp.purchase_price < min.purchase_price ? sp : min, pSuppliers[0])
        : null;

      const margin = cheapestSupplier && p.webshop_price
        ? ((Number(p.webshop_price) / 1.25 - cheapestSupplier.purchase_price) / (Number(p.webshop_price) / 1.25)) * 100
        : null;

      return {
        id: p.id,
        title: p.title,
        brand: p.brand,
        category: p.category,
        webshop_price: p.webshop_price,
        sale_price: p.sale_price,
        stock_status: p.stock_status,
        stock_qty: p.stock_quantity,
        visits_30d: totalVisits,
        purchases_30d: totalPurchases,
        conversion_pct: avgConversion,
        cheapest_purchase_price: cheapestSupplier?.purchase_price ?? null,
        cheapest_supplier: cheapestSupplier ? supplierMap.get(cheapestSupplier.supplier_id) ?? "Ukendt" : null,
        supplier_in_stock: pSuppliers.some(sp => sp.in_stock),
        margin_pct: margin ? Math.round(margin * 10) / 10 : null,
        recent_changes: pChanges.slice(0, 5).map(c => ({
          field: c.field_name,
          from: c.old_value,
          to: c.new_value,
          type: c.change_type,
          date: c.created_at,
        })),
      };
    });

    // Aggregate patterns
    const priceChanges = changeLogs.filter(c => c.change_type === "price_update");
    const stockChanges = changeLogs.filter(c => c.change_type === "stock_update");

    // Load rounding + backorder settings
    const { data: settingsRows } = await supabase
      .from("price_settings")
      .select("scope, scope_value")
      .in("scope", ["price_rounding", "default_backorder"]);
    
    const settingsMap = new Map((settingsRows ?? []).map(r => [r.scope, r.scope_value]));
    const roundingMode = settingsMap.get("price_rounding") ?? "nearest_5";
    const backorderMode = settingsMap.get("default_backorder") ?? "notify";

    const backorderLabel = backorderMode === "notify" ? "Ja med besked (notify)" : backorderMode === "yes" ? "Ja (yes)" : "Nej (no)";

    const systemPrompt = `Du er en intelligent PIM-analytiker for en dansk webshop drevet på Shopify.
Shopify er master for produktdata – analyser kun produkter der er aktivt synket til Shopify (shopify_product_id != null).
Du analyserer produktdata, prisændringer, lagerdata og besøgsstatistik for at generere KONKRETE, HANDLINGSORIENTEREDE anbefalinger til Shopify-kataloget.

Regler:
- Skriv altid på dansk
- Giv max 8 anbefalinger, prioriteret efter potentiel forretningsværdi
- Hver anbefaling SKAL have: title, description, severity (info/warning/critical), recommendation_type (pricing/stock/conversion/margin), action_suggestion, product_ids
- For PRIS-anbefalinger (pricing/margin): inkluder altid suggested_price (et konkret tal inkl. moms i DKK) – prisen pushes til Shopify
- For LAGER-anbefalinger (stock): inkluder suggested_stock_status og/eller suggested_stock_quantity – synkes til Shopify inventory
- Når du anbefaler restordre (onbackorder), brug ALTID backorder_mode: "${backorderMode}" – dette betyder: ${backorderLabel} (mappes til Shopify inventoryPolicy CONTINUE/DENY)
- Fokusér på mønstre i Shopify-kataloget: produkter med høj trafik men lav konvertering, lav margin, prisændringer der skaber trends, udsolgte populære produkter osv.
- Priser i DKK inkl. moms (x1.25 fra ex. moms)
- Afrundingsregel: ${roundingMode} - anvend denne ved prisforslag
- Overvej sæsonmønstre og prisudvikling over tid`;

    const userPrompt = `Analysér disse Shopify-synkede produkter og giv anbefalinger:

OPSUMMERING:
- ${products.length} Shopify-produkter total (kun produkter med shopify_product_id)
- ${priceChanges.length} prisændringer (30 dage)
- ${stockChanges.length} lagerændringer (30 dage)

PRODUKTDATA (top 40 Shopify-produkter):
${JSON.stringify(productSummaries, null, 0)}

Returnér anbefalinger som JSON array med tool calling.`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3.1-flash-lite-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "save_recommendations",
            description: "Save AI-generated product recommendations",
            parameters: {
              type: "object",
              properties: {
                recommendations: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      description: { type: "string" },
                      severity: { type: "string", enum: ["info", "warning", "critical"] },
                      recommendation_type: { type: "string", enum: ["pricing", "stock", "conversion", "margin"] },
                      action_suggestion: { type: "string" },
                      product_ids: { type: "array", items: { type: "string" } },
                      suggested_price: { type: "number", description: "Suggested price incl. VAT in DKK (only for pricing/margin recs)" },
                      suggested_stock_status: { type: "string", enum: ["instock", "outofstock", "onbackorder"], description: "Suggested stock status (only for stock recs)" },
                      suggested_backorder_mode: { type: "string", enum: ["yes", "notify", "no"], description: "Backorder mode when status is onbackorder" },
                      suggested_stock_quantity: { type: "number", description: "Suggested stock quantity (only for stock recs)" },
                    },
                    required: ["title", "description", "severity", "recommendation_type", "action_suggestion", "product_ids"],
                  },
                },
              },
              required: ["recommendations"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "save_recommendations" } },
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit - prøv igen om lidt" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI-kreditter opbrugt" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      throw new Error("No tool call response from AI");
    }

    const { recommendations } = JSON.parse(toolCall.function.arguments);

    // Clear old AI recommendations (keep dismissed ones)
    await supabase.from("product_recommendations")
      .delete()
      .eq("is_dismissed", false)
      .in("recommendation_type", ["pricing", "stock", "conversion", "margin"]);

    // Insert new recommendations
    const inserts = [];
    for (const rec of recommendations) {
      for (const productId of rec.product_ids) {
        inserts.push({
          master_product_id: productId,
          recommendation_type: rec.recommendation_type,
          severity: rec.severity,
          title: rec.title,
          description: rec.description,
          action_suggestion: rec.action_suggestion,
          data: {
            ai_generated: true,
            generated_at: new Date().toISOString(),
            product_ids: rec.product_ids,
            ...(rec.suggested_price !== undefined && { suggested_price: rec.suggested_price }),
            ...(rec.suggested_stock_status && { suggested_stock_status: rec.suggested_stock_status }),
            ...(rec.suggested_stock_quantity !== undefined && { suggested_stock_quantity: rec.suggested_stock_quantity }),
            ...(rec.suggested_backorder_mode && { suggested_backorder_mode: rec.suggested_backorder_mode }),
          },
        });
      }
    }

    if (inserts.length > 0) {
      const { error: insertError } = await supabase.from("product_recommendations").insert(inserts);
      if (insertError) console.error("Insert error:", insertError.message);
    }

    return new Response(JSON.stringify({
      success: true,
      recommendations_count: recommendations.length,
      products_affected: inserts.length,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("AI Analyze error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
