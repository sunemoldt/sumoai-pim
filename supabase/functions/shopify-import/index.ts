import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_VERSION = "2025-10";

type ShopifyVariant = {
  id: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  price: string | null;
  compareAtPrice: string | null;
  inventoryQuantity: number | null;
  inventoryPolicy: "CONTINUE" | "DENY" | string;
  selectedOptions: { name: string; value: string }[];
};

type ShopifyProduct = {
  id: string;
  title: string;
  vendor: string | null;
  productType: string | null;
  descriptionHtml: string | null;
  handle: string | null;
  status: string | null;
  featuredImage?: { url: string | null } | null;
  collections?: { nodes: { title: string }[] };
  variants: { nodes: ShopifyVariant[] };
};

function normalizeEan(value: string): string {
  const stripped = value.trim().replace(/^0+/, "");
  return stripped || value.trim();
}

function gidTail(gid: string): string {
  return gid.split("/").pop() || gid;
}

function parsePrice(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stockStatus(quantity: number | null, policy: string) {
  if ((quantity ?? 0) > 0) return "instock";
  return policy === "CONTINUE" ? "onbackorder" : "outofstock";
}

async function requireUser(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return false;
  if (authHeader.includes(SUPABASE_SERVICE_ROLE_KEY)) return true;

  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await anonClient.auth.getUser();
  return !error && Boolean(user);
}

async function shopifyGraphql(shopDomain: string, accessToken: string, query: string, variables: Record<string, unknown>) {
  const response = await fetch(`https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  const data = await response.json();
  if (!response.ok || data.errors) {
    throw new Error(`Shopify API error [${response.status}]: ${JSON.stringify(data.errors || data)}`);
  }
  return data.data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authed = await requireUser(req);
    if (!authed) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: conn } = await supabase
      .from("shopify_connection")
      .select("shop_domain, access_token")
      .order("installed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!conn) {
      return new Response(JSON.stringify({ error: "Shopify er ikke forbundet endnu" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const query = `#graphql
      query Products($cursor: String) {
        products(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            title
            vendor
            productType
            descriptionHtml
            handle
            status
            featuredImage { url }
            collections(first: 10) { nodes { title } }
            variants(first: 100) {
              nodes {
                id
                title
                sku
                barcode
                price
                compareAtPrice
                inventoryQuantity
                inventoryPolicy
                selectedOptions { name value }
              }
            }
          }
        }
      }`;

    const rows: Record<string, unknown>[] = [];
    let cursor: string | null = null;
    let fetchedProducts = 0;

    do {
      const data = await shopifyGraphql(conn.shop_domain, conn.access_token, query, { cursor });
      const products = data.products.nodes as ShopifyProduct[];
      fetchedProducts += products.length;

      for (const product of products) {
        const categories = product.collections?.nodes?.map((c) => c.title).filter(Boolean) ?? [];
        for (const variant of product.variants.nodes) {
          const fallbackEan = `shopify-${gidTail(variant.id)}`;
          const ean = variant.barcode?.trim() ? normalizeEan(variant.barcode) : fallbackEan;
          const optionLabel = variant.title && variant.title !== "Default Title" ? variant.title : "";
          const attrs = Object.fromEntries((variant.selectedOptions ?? []).map((o) => [o.name, o.value]));

          rows.push({
            ean,
            sku: variant.sku || null,
            title: optionLabel ? `${product.title} - ${optionLabel}` : product.title,
            brand: product.vendor || null,
            category: product.productType || categories[0] || null,
            categories,
            image_url: product.featuredImage?.url || null,
            short_description: null,
            long_description: product.descriptionHtml || null,
            attributes: attrs,
            webshop_platform: "shopify",
            webshop_product_id: product.id,
            webshop_parent_id: null,
            shopify_product_id: product.id,
            shopify_variant_id: variant.id,
            webshop_price: parsePrice(variant.price),
            sale_price: null,
            stock_quantity: variant.inventoryQuantity ?? null,
            stock_status: stockStatus(variant.inventoryQuantity, variant.inventoryPolicy),
            backorders_allowed: variant.inventoryPolicy === "CONTINUE",
          });
        }
      }

      cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
    } while (cursor);

    const deduped = new Map<string, Record<string, unknown>>();
    const duplicateEans = new Set<string>();
    for (const row of rows) {
      if (deduped.has(row.ean as string)) duplicateEans.add(row.ean as string);
      deduped.set(row.ean as string, row);
    }
    const finalRows = Array.from(deduped.values());

    const { data: logEntry } = await supabase
      .from("import_logs")
      .insert({ source: "shopify", status: "running", total_fetched: rows.length })
      .select("id")
      .single();

    let imported = 0;
    const errors: string[] = [];
    for (let i = 0; i < finalRows.length; i += 50) {
      const batch = finalRows.slice(i, i + 50);
      const { error } = await supabase.from("master_products").upsert(batch, { onConflict: "ean" });
      if (error) errors.push(`Batch ${i}-${i + batch.length}: ${error.message}`);
      else imported += batch.length;
    }

    if (logEntry?.id) {
      await supabase.from("import_logs").update({
        status: errors.length ? "completed_with_errors" : "completed",
        imported,
        deduplicated: rows.length - finalRows.length,
        errors,
        ean_snapshot: finalRows.map((r) => r.ean),
        duplicate_eans: Array.from(duplicateEans),
        completed_at: new Date().toISOString(),
      }).eq("id", logEntry.id);
    }

    return new Response(JSON.stringify({
      success: errors.length === 0,
      source: "shopify",
      shop_domain: conn.shop_domain,
      total_products: fetchedProducts,
      total_fetched: rows.length,
      imported,
      deduplicated: rows.length - finalRows.length,
      duplicate_eans: Array.from(duplicateEans).slice(0, 25),
      errors: errors.length ? errors : undefined,
      log_id: logEntry?.id,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ukendt fejl";
    console.error("Shopify import error:", message);
    return new Response(JSON.stringify({ error: message, success: false }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
