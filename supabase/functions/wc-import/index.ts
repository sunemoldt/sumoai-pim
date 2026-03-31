import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.49.1/cors";

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
    // Fetch all products from WooCommerce (paginated)
    let page = 1;
    let allProducts: any[] = [];
    const perPage = 100;

    while (true) {
      const baseUrl = WC_STORE_URL.replace(/\/$/, "");
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

    // Also fetch variations for variable products
    const variableProducts = allProducts.filter((p: any) => p.type === "variable");
    const variations: any[] = [];
    for (const vp of variableProducts) {
      let vPage = 1;
      while (true) {
        const baseUrl = WC_STORE_URL.replace(/\/$/, "");
        const url = `${baseUrl}/wp-json/wc/v3/products/${vp.id}/variations?per_page=${perPage}&page=${vPage}&consumer_key=${WC_CONSUMER_KEY}&consumer_secret=${WC_CONSUMER_SECRET}`;
        const res = await fetch(url);
        if (!res.ok) break;
        const vars = await res.json();
        if (!Array.isArray(vars) || vars.length === 0) break;
        for (const v of vars) {
          variations.push({ ...v, _parent_id: vp.id, _parent_name: vp.name, _parent_categories: vp.categories });
        }
        if (vars.length < perPage) break;
        vPage++;
      }
    }

    // Map WC products to master_products rows
    const rows: any[] = [];

    for (const p of allProducts) {
      if (p.type === "variable") continue; // we handle variations instead

      const ean = p.sku || `wc-${p.id}`;
      rows.push({
        ean,
        title: p.name,
        brand: p.brands?.[0]?.name || p.tags?.[0]?.name || null,
        category: p.categories?.[0]?.name || null,
        image_url: p.images?.[0]?.src || null,
        webshop_product_id: String(p.id),
        webshop_platform: "woocommerce",
        webshop_price: p.price ? parseFloat(p.price) : null,
      });
    }

    for (const v of variations) {
      const ean = v.sku || `wc-${v._parent_id}-${v.id}`;
      const attrStr = v.attributes?.map((a: any) => a.option).join(" / ") || "";
      rows.push({
        ean,
        title: attrStr ? `${v._parent_name} - ${attrStr}` : v._parent_name,
        brand: null,
        category: v._parent_categories?.[0]?.name || null,
        image_url: v.image?.src || null,
        webshop_product_id: String(v.id),
        webshop_platform: "woocommerce",
        webshop_price: v.price ? parseFloat(v.price) : null,
      });
    }

    // Upsert into master_products (on ean conflict)
    let imported = 0;
    let errors: string[] = [];
    
    // Process in batches of 50
    for (let i = 0; i < rows.length; i += 50) {
      const batch = rows.slice(i, i + 50);
      const { error } = await supabase
        .from("master_products")
        .upsert(batch, { onConflict: "ean" });
      
      if (error) {
        errors.push(`Batch ${i}-${i + batch.length}: ${error.message}`);
      } else {
        imported += batch.length;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        total_fetched: allProducts.length + variations.length,
        imported,
        errors: errors.length > 0 ? errors : undefined,
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
