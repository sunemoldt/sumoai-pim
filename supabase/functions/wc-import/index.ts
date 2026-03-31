import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WC_STORE_URL = Deno.env.get("WC_STORE_URL");
const WC_CONSUMER_KEY = Deno.env.get("WC_CONSUMER_KEY");
const WC_CONSUMER_SECRET = Deno.env.get("WC_CONSUMER_SECRET");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!WC_STORE_URL || !WC_CONSUMER_KEY || !WC_CONSUMER_SECRET) {
    return new Response(
      JSON.stringify({ error: "WooCommerce credentials not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    let page = 1;
    let allProducts: any[] = [];
    const perPage = 100;
    const baseUrl = WC_STORE_URL.replace(/\/$/, "");

    while (true) {
      const url = `${baseUrl}/wp-json/wc/v3/products?per_page=${perPage}&page=${page}&consumer_key=${WC_CONSUMER_KEY}&consumer_secret=${WC_CONSUMER_SECRET}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`WooCommerce API error [${res.status}]: ${body}`);
      }
      const products = await res.json();
      if (!Array.isArray(products) || products.length === 0) break;
      allProducts = allProducts.concat(products);
      if (products.length < perPage) break;
      page++;
    }

    // Fetch variations for variable products
    const variableProducts = allProducts.filter((p: any) => p.type === "variable");
    const variations: any[] = [];
    for (const vp of variableProducts) {
      let vPage = 1;
      while (true) {
        const url = `${baseUrl}/wp-json/wc/v3/products/${vp.id}/variations?per_page=${perPage}&page=${vPage}&consumer_key=${WC_CONSUMER_KEY}&consumer_secret=${WC_CONSUMER_SECRET}`;
        const res = await fetch(url);
        if (!res.ok) break;
        const vars = await res.json();
        if (!Array.isArray(vars) || vars.length === 0) break;
        for (const v of vars) {
          variations.push({
            ...v,
            _parent_id: vp.id,
            _parent_name: vp.name,
            _parent_brand: vp.brands?.[0]?.name || vp.tags?.[0]?.name || null,
            _parent_categories: vp.categories,
            _parent_image: vp.images?.[0]?.src || null,
            _parent_short_description: vp.short_description || null,
            _parent_long_description: vp.description || null,
          });
        }
        if (vars.length < perPage) break;
        vPage++;
      }
    }

    // Helper to extract EAN from meta_data
    const eanMetaKeys = ["_avecdo_ean", "_gtin", "woo_feed_ean_var", "woo_feed_gtin_var", "_wc_gla_gtin"];
    function extractEan(metaData: any[], sku: string | null, fallbackId: string): string {
      if (metaData) {
        for (const key of eanMetaKeys) {
          const val = metaData.find((m: any) => m.key === key)?.value;
          if (val && String(val).trim()) return String(val).trim();
        }
      }
      // Only use SKU if it looks like a numeric barcode (8-14 digits)
      if (sku && /^\d{8,14}$/.test(sku.trim())) return sku.trim();
      return fallbackId;
    }

    // Map to master_products rows
    const rows: any[] = [];

    for (const p of allProducts) {
      if (p.type === "variable") continue;

      const ean = extractEan(p.meta_data, p.sku, `wc-${p.id}`);
      const attrs: Record<string, string> = {};
      if (p.attributes) {
        for (const a of p.attributes) {
          if (a.name && a.options) {
            attrs[a.name] = Array.isArray(a.options) ? a.options.join(", ") : String(a.options);
          } else if (a.name && a.option) {
            attrs[a.name] = a.option;
          }
        }
      }
      rows.push({
        ean,
        sku: p.sku || null,
        title: p.name,
        brand: p.brands?.[0]?.name || p.tags?.[0]?.name || null,
        category: p.categories?.[0]?.name || null,
        image_url: p.images?.[0]?.src || null,
        short_description: p.short_description || null,
        long_description: p.description || null,
        meta_title: p.meta_data?.find((m: any) => m.key === "_yoast_wpseo_title")?.value || p.meta_data?.find((m: any) => m.key === "rank_math_title")?.value || null,
        meta_description: p.meta_data?.find((m: any) => m.key === "_yoast_wpseo_metadesc")?.value || p.meta_data?.find((m: any) => m.key === "rank_math_description")?.value || null,
        attributes: Object.keys(attrs).length > 0 ? attrs : {},
        webshop_product_id: String(p.id),
        webshop_platform: "woocommerce",
        webshop_price: p.regular_price ? parseFloat(p.regular_price) : (p.price ? parseFloat(p.price) : null),
        sale_price: p.sale_price ? parseFloat(p.sale_price) : null,
        stock_quantity: p.stock_quantity ?? null,
        stock_status: p.stock_status || "instock",
        backorders_allowed: p.backorders === "yes" || p.backorders === "notify",
      });
    }

    for (const v of variations) {
      const ean = extractEan(v.meta_data, v.sku, `wc-${v._parent_id}-${v.id}`);
      const attrStr = v.attributes?.map((a: any) => a.option).join(" / ") || "";
      const varAttrs: Record<string, string> = {};
      if (v.attributes) {
        for (const a of v.attributes) {
          if (a.name && a.option) varAttrs[a.name] = a.option;
        }
      }
      rows.push({
        ean,
        sku: v.sku || null,
        title: attrStr ? `${v._parent_name} - ${attrStr}` : v._parent_name,
        brand: v._parent_brand,
        category: v._parent_categories?.[0]?.name || null,
        image_url: v.image?.src || v._parent_image || null,
        short_description: v.description || v._parent_short_description || null,
        long_description: v._parent_long_description || null,
        meta_title: null,
        meta_description: v.meta_data?.find((m: any) => m.key === "_yoast_wpseo_metadesc")?.value || null,
        attributes: Object.keys(varAttrs).length > 0 ? varAttrs : {},
        webshop_product_id: String(v.id),
        webshop_platform: "woocommerce",
        webshop_price: v.regular_price ? parseFloat(v.regular_price) : (v.price ? parseFloat(v.price) : null),
        sale_price: v.sale_price ? parseFloat(v.sale_price) : null,
        stock_quantity: v.stock_quantity ?? null,
        stock_status: v.stock_status || "instock",
        backorders_allowed: v.backorders === "yes" || v.backorders === "notify",
      });
    }

    const scoreRow = (row: any) => {
      const populatedValues = [
        row.title,
        row.brand,
        row.category,
        row.image_url,
        row.short_description,
        row.long_description,
        row.meta_title,
        row.meta_description,
        row.sku,
        row.webshop_price,
        row.sale_price,
      ];

      return populatedValues.filter((value) => value !== null && value !== undefined && value !== "").length +
        (row.attributes && Object.keys(row.attributes).length > 0 ? 1 : 0);
    };

    const rowsByEan = new Map<string, any>();
    const duplicateEans = new Set<string>();

    for (const row of rows) {
      const existing = rowsByEan.get(row.ean);
      if (!existing) {
        rowsByEan.set(row.ean, row);
        continue;
      }

      duplicateEans.add(row.ean);
      rowsByEan.set(row.ean, scoreRow(row) >= scoreRow(existing) ? row : existing);
    }

    const dedupedRows = Array.from(rowsByEan.values());

    // Create import log entry
    const { data: logEntry } = await supabase
      .from("import_logs")
      .insert({ source: "woocommerce", status: "running", total_fetched: allProducts.length + variations.length })
      .select("id")
      .single();
    const logId = logEntry?.id;

    // Upsert in batches
    let imported = 0;
    const errors: string[] = [];

    for (let i = 0; i < dedupedRows.length; i += 50) {
      const batch = dedupedRows.slice(i, i + 50);
      const { error } = await supabase
        .from("master_products")
        .upsert(batch, { onConflict: "ean" });

      if (error) {
        errors.push(`Batch ${i}-${i + batch.length}: ${error.message}`);
      } else {
        imported += batch.length;
      }
    }

    // Update import log
    if (logId) {
      await supabase.from("import_logs").update({
        status: errors.length > 0 ? "completed_with_errors" : "completed",
        imported,
        deduplicated: rows.length - dedupedRows.length,
        errors: errors.length > 0 ? errors : [],
        ean_snapshot: dedupedRows.map((r) => r.ean),
        completed_at: new Date().toISOString(),
      }).eq("id", logId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        total_fetched: allProducts.length + variations.length,
        imported,
        deduplicated: rows.length - dedupedRows.length,
        duplicate_eans: duplicateEans.size > 0 ? Array.from(duplicateEans).slice(0, 25) : undefined,
        errors: errors.length > 0 ? errors : undefined,
        log_id: logId,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("WC Import error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
