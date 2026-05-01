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

  if (!WC_STORE_URL || !WC_CONSUMER_KEY || !WC_CONSUMER_SECRET) {
    return new Response(
      JSON.stringify({ error: "WooCommerce credentials not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Allow caller to force a full re-import (e.g. after schema change)
  let forceFull = false;
  try {
    if (req.method === "POST") {
      const body = await req.clone().json().catch(() => ({}));
      forceFull = body?.full === true;
    }
  } catch (_) { /* ignore */ }

  try {
    // Determine incremental cutoff
    let modifiedAfter: string | null = null;
    if (!forceFull) {
      const { data: lastSetting } = await supabase
        .from("analytics_settings")
        .select("setting_value")
        .eq("setting_key", "wc_last_import_at")
        .maybeSingle();
      const v = lastSetting?.setting_value?.trim();
      if (v) modifiedAfter = v;
    }
    const importStartedAt = new Date().toISOString();

    let page = 1;
    let allProducts: any[] = [];
    const perPage = 100;
    const baseUrl = WC_STORE_URL.replace(/\/$/, "");
    const modifiedAfterParam = modifiedAfter
      ? `&modified_after=${encodeURIComponent(modifiedAfter)}&dates_are_gmt=true`
      : "";

    while (true) {
      const url = `${baseUrl}/wp-json/wc/v3/products?per_page=${perPage}&page=${page}${modifiedAfterParam}&consumer_key=${WC_CONSUMER_KEY}&consumer_secret=${WC_CONSUMER_SECRET}`;
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
        const url = `${baseUrl}/wp-json/wc/v3/products/${vp.id}/variations?per_page=${perPage}&page=${vPage}${modifiedAfterParam}&consumer_key=${WC_CONSUMER_KEY}&consumer_secret=${WC_CONSUMER_SECRET}`;
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

    // Normalize EAN: strip leading zeros for consistent matching (0810084693650 → 810084693650)
    function normalizeEan(ean: string): string {
      const stripped = ean.replace(/^0+/, "");
      // Keep at least 1 digit
      return stripped || ean;
    }

    // Helper to extract EAN from meta_data
    const eanMetaKeys = ["_avecdo_ean", "_gtin", "woo_feed_ean_var", "woo_feed_gtin_var", "_wc_gla_gtin"];
    function extractEan(metaData: any[], sku: string | null, fallbackId: string): string {
      if (metaData) {
        for (const key of eanMetaKeys) {
          const val = metaData.find((m: any) => m.key === key)?.value;
          if (val && String(val).trim()) return normalizeEan(String(val).trim());
        }
      }
      // Only use SKU if it looks like a numeric barcode (8-14 digits)
      if (sku && /^\d{8,14}$/.test(sku.trim())) return normalizeEan(sku.trim());
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
        categories: Array.isArray(p.categories) ? p.categories.map((c: any) => c?.name).filter(Boolean) : [],
        image_url: p.images?.[0]?.src || null,
        short_description: p.short_description || null,
        long_description: p.description || null,
        meta_title: p.meta_data?.find((m: any) => m.key === "rank_math_title")?.value || p.meta_data?.find((m: any) => m.key === "_rank_math_title")?.value || p.meta_data?.find((m: any) => m.key === "_yoast_wpseo_title")?.value || null,
        meta_description: p.meta_data?.find((m: any) => m.key === "rank_math_description")?.value || p.meta_data?.find((m: any) => m.key === "_rank_math_description")?.value || p.meta_data?.find((m: any) => m.key === "_yoast_wpseo_metadesc")?.value || null,
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
        categories: Array.isArray(v._parent_categories) ? v._parent_categories.map((c: any) => c?.name).filter(Boolean) : [],
        image_url: v.image?.src || v._parent_image || null,
        short_description: v.description || v._parent_short_description || null,
        long_description: v._parent_long_description || null,
        meta_title: v.meta_data?.find((m: any) => m.key === "rank_math_title")?.value || v.meta_data?.find((m: any) => m.key === "_rank_math_title")?.value || v.meta_data?.find((m: any) => m.key === "_yoast_wpseo_title")?.value || null,
        meta_description: v.meta_data?.find((m: any) => m.key === "rank_math_description")?.value || v.meta_data?.find((m: any) => m.key === "_rank_math_description")?.value || v.meta_data?.find((m: any) => m.key === "_yoast_wpseo_metadesc")?.value || null,
        attributes: Object.keys(varAttrs).length > 0 ? varAttrs : {},
        webshop_product_id: String(v.id),
        webshop_parent_id: String(v._parent_id),
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

    // Pre-fetch existing master products for diff detection + auto_stock_sync flag
    const { data: existingProducts } = await supabase
      .from("master_products")
      .select("ean, webshop_price, sale_price, stock_quantity, stock_status, backorders_allowed, title, brand, category, auto_stock_sync");
    const existingByEan = new Map<string, typeof existingProducts extends (infer T)[] | null ? T : never>();
    for (const ep of existingProducts ?? []) {
      existingByEan.set(ep.ean, ep);
    }

    // For products with auto_stock_sync = true, do NOT overwrite stock from WC.
    // Stock is owned by supplier sync (DB trigger recompute_product_stock).
    for (const row of dedupedRows) {
      const existing = existingByEan.get(row.ean);
      if (existing && (existing as any).auto_stock_sync) {
        delete row.stock_quantity;
        delete row.stock_status;
      }
    }

    const changeLogs: { master_product_id?: string; change_type: string; field_name: string; old_value: string | null; new_value: string | null; source: string; _ean?: string }[] = [];

    // Upsert in batches
    let imported = 0;
    const errors: string[] = [];

    for (let i = 0; i < dedupedRows.length; i += 50) {
      const batch = dedupedRows.slice(i, i + 50);

      // Detect changes before upsert
      for (const row of batch) {
        const existing = existingByEan.get(row.ean);
        if (existing) {
          const fields: [string, any, any, string][] = [
            ["webshop_price", existing.webshop_price, row.webshop_price, "price_update"],
            ["sale_price", existing.sale_price, row.sale_price, "price_update"],
            ["stock_quantity", existing.stock_quantity, row.stock_quantity, "stock_update"],
            ["stock_status", existing.stock_status, row.stock_status, "stock_update"],
            ["backorders_allowed", existing.backorders_allowed, row.backorders_allowed, "stock_update"],
          ];
          for (const [field, oldVal, newVal, changeType] of fields) {
            if (String(oldVal ?? "null") !== String(newVal ?? "null")) {
              changeLogs.push({ change_type: changeType, field_name: field, old_value: String(oldVal ?? "null"), new_value: String(newVal ?? "null"), source: "wc-import", _ean: row.ean });
            }
          }
        }
      }

      const { error } = await supabase
        .from("master_products")
        .upsert(batch, { onConflict: "ean" });

      if (error) {
        errors.push(`Batch ${i}-${i + batch.length}: ${error.message}`);
      } else {
        imported += batch.length;
      }
    }

    // Resolve EANs to IDs for change logs, then insert
    if (changeLogs.length > 0) {
      const { data: eanIds } = await supabase
        .from("master_products")
        .select("id, ean");
      const eanIdMap = new Map<string, string>();
      for (const e of eanIds ?? []) eanIdMap.set(e.ean, e.id);

      const resolvedLogs = changeLogs
        .map((l) => {
          const id = eanIdMap.get(l._ean!);
          if (!id) return null;
          return { master_product_id: id, change_type: l.change_type, field_name: l.field_name, old_value: l.old_value, new_value: l.new_value, source: l.source };
        })
        .filter(Boolean);

      for (let i = 0; i < resolvedLogs.length; i += 500) {
        await supabase.from("product_change_log").insert(resolvedLogs.slice(i, i + 500));
      }
      console.log(`Logged ${resolvedLogs.length} changes from WC import`);
    }

    // Update import log
    if (logId) {
      await supabase.from("import_logs").update({
        status: errors.length > 0 ? "completed_with_errors" : "completed",
        imported,
        deduplicated: rows.length - dedupedRows.length,
        errors: errors.length > 0 ? errors : [],
        ean_snapshot: dedupedRows.map((r) => r.ean),
        duplicate_eans: duplicateEans.size > 0 ? Array.from(duplicateEans) : [],
        completed_at: new Date().toISOString(),
      }).eq("id", logId);
    }

    // Persist last successful import timestamp for next incremental run
    if (errors.length === 0) {
      await supabase
        .from("analytics_settings")
        .update({ setting_value: importStartedAt, updated_at: new Date().toISOString() })
        .eq("setting_key", "wc_last_import_at");
    }

    return new Response(
      JSON.stringify({
        success: true,
        mode: modifiedAfter ? "incremental" : "full",
        modified_after: modifiedAfter,
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
