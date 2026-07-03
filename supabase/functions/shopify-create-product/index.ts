import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_VERSION = "2026-04";

async function requireUser(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return false;
  if (authHeader.includes(SUPABASE_SERVICE_ROLE_KEY)) return true;
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await anon.auth.getUser();
  return !error && Boolean(user);
}

async function shopifyGraphql(shopDomain: string, accessToken: string, query: string, variables: Record<string, unknown>) {
  const res = await fetch(`https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (!res.ok || data.errors) throw new Error(`Shopify ${res.status}: ${JSON.stringify(data.errors || data)}`);
  return data.data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!(await requireUser(req))) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { master_product_id } = await req.json();
    if (!master_product_id) {
      return new Response(JSON.stringify({ error: "master_product_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: p, error: pErr } = await supabase
      .from("master_products")
      .select("id, title, ean, sku, brand, category, webshop_price, sale_price, stock_quantity, short_description, long_description, meta_title, meta_description, lifecycle_status, shopify_product_id, weight_kg, backorder_policy")
      .eq("id", master_product_id)
      .single();
    if (pErr || !p) {
      return new Response(JSON.stringify({ error: "Product not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (p.shopify_product_id) {
      return new Response(JSON.stringify({ error: "Produktet er allerede i Shopify (id=" + p.shopify_product_id + ")" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: conn } = await supabase
      .from("shopify_connection")
      .select("shop_domain, access_token")
      .order("is_active", { ascending: false })
      .order("installed_at", { ascending: false })
      .limit(1).maybeSingle();
    if (!conn) {
      return new Response(JSON.stringify({ error: "Shopify er ikke forbundet" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 1. Create product as DRAFT
    const productMutation = `#graphql
      mutation CreateProduct($input: ProductInput!) {
        productCreate(input: $input) {
          product { id variants(first: 1) { nodes { id inventoryItem { id } } } }
          userErrors { field message }
        }
      }`;
    const productInput: Record<string, unknown> = {
      title: p.title,
      status: "DRAFT",
      descriptionHtml: p.long_description ?? "",
      vendor: p.brand ?? undefined,
      productType: p.category ?? undefined,
    };
    if (p.short_description) {
      productInput.metafields = [{
        namespace: "custom",
        key: "shortdescription",
        type: "rich_text_field",
        value: htmlToShopifyRichText(String(p.short_description)),
      }];
    }
    const seoObj: Record<string, unknown> = {};
    if (p.meta_title) seoObj.title = String(p.meta_title);
    if (p.meta_description) seoObj.description = String(p.meta_description);
    if (Object.keys(seoObj).length > 0) productInput.seo = seoObj;
    const created = await shopifyGraphql(conn.shop_domain, conn.access_token, productMutation, { input: productInput });
    const errs = created.productCreate.userErrors;
    if (errs?.length) throw new Error(errs.map((e: { message: string }) => e.message).join(", "));
    const productGid = created.productCreate.product.id as string;
    const variantGid = created.productCreate.product.variants.nodes[0].id as string;

    // 2. Update default variant with price/sku/barcode
    const variantMutation = `#graphql
      mutation UpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id }
          userErrors { field message }
        }
      }`;
    const effectiveWeight = p.weight_kg != null ? Number(p.weight_kg) : 1;
    const inventoryPolicy = p.backorder_policy === "yes" ? "CONTINUE" : "DENY";
    const variantInput: Record<string, unknown> = {
      id: variantGid,
      price: p.webshop_price != null ? String(p.webshop_price) : undefined,
      compareAtPrice: p.sale_price != null ? String(p.sale_price) : undefined,
      barcode: p.ean ?? undefined,
      inventoryPolicy,
      inventoryItem: {
        sku: p.sku ?? p.ean ?? undefined,
        tracked: true,
        measurement: { weight: { value: effectiveWeight, unit: "KILOGRAMS" } },
      },
    };
    const vData = await shopifyGraphql(conn.shop_domain, conn.access_token, variantMutation, {
      productId: productGid, variants: [variantInput],
    });
    const vErrs = vData.productVariantsBulkUpdate.userErrors;
    if (vErrs?.length) throw new Error(vErrs.map((e: { message: string }) => e.message).join(", "));

    const numericProductId = productGid.split("/").pop();
    const numericVariantId = variantGid.split("/").pop();

    await supabase.from("master_products").update({
      shopify_product_id: numericProductId,
      shopify_variant_id: numericVariantId,
      shopify_sync_enabled: true,
      lifecycle_status: "pending_activation",
      updated_at: new Date().toISOString(),
    }).eq("id", master_product_id);

    await supabase.from("product_change_log").insert({
      master_product_id, change_type: "lifecycle", field_name: "lifecycle_status",
      old_value: p.lifecycle_status, new_value: "pending_activation", source: "shopify-create-product",
    });

    return new Response(JSON.stringify({
      success: true,
      shopify_product_id: numericProductId,
      shopify_variant_id: numericVariantId,
      shopify_admin_url: `https://${conn.shop_domain}/admin/products/${numericProductId}`,
      message: "Produkt oprettet i Shopify som KLADDE. Aktivér i Shopify-admin når det er klar.",
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("shopify-create-product:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
