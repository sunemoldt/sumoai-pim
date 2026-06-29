// List Shopify variants that are NOT linked to any PIM master_product (by shopify_variant_id).
// For each unmatched variant, flag EAN/SKU conflicts in PIM so UI can offer "Link" instead of "Create".

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_VERSION = "2026-04";

const normEan = (v: string | null | undefined) =>
  v ? String(v).trim().replace(/^0+/, "") || String(v).trim() : "";
const normSku = (v: string | null | undefined) => (v ? String(v).trim().toLowerCase() : "");

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!(await requireUser(req))) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: conn } = await supabase
      .from("shopify_connection")
      .select("shop_domain, access_token")
      .order("is_active", { ascending: false })
      .order("installed_at", { ascending: false })
      .limit(1).maybeSingle();
    if (!conn) {
      return new Response(JSON.stringify({ error: "Shopify er ikke forbundet" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all variants from Shopify
    type V = {
      productId: string; variantId: string; productTitle: string; variantTitle: string;
      sku: string; barcode: string; price: string | null; inventoryQuantity: number | null;
      image: string | null; productImage: string | null; status: string;
    };
    const variants: V[] = [];
    let cursor: string | null = null;
    let pages = 0;
    const MAX_PAGES = 80;
    while (pages < MAX_PAGES) {
      const query = `
        query($cursor: String) {
          productVariants(first: 250, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id sku barcode price title inventoryQuantity
              image { url }
              product { id title status featuredImage { url } }
            }
          }
        }`;
      const res = await fetch(`https://${conn.shop_domain}/admin/api/${API_VERSION}/graphql.json`, {
        method: "POST",
        headers: { "X-Shopify-Access-Token": conn.access_token, "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables: { cursor } }),
      });
      if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`);
      const json = await res.json();
      if (json.errors) throw new Error(`Shopify GraphQL: ${JSON.stringify(json.errors)}`);
      const nodes = json.data?.productVariants?.nodes ?? [];
      for (const n of nodes) {
        variants.push({
          productId: n.product.id.replace("gid://shopify/Product/", ""),
          variantId: n.id.replace("gid://shopify/ProductVariant/", ""),
          productTitle: n.product.title,
          variantTitle: n.title,
          sku: n.sku || "",
          barcode: n.barcode || "",
          price: n.price ?? null,
          inventoryQuantity: typeof n.inventoryQuantity === "number" ? n.inventoryQuantity : null,
          image: n.image?.url || null,
          productImage: n.product.featuredImage?.url || null,
          status: n.product.status,
        });
      }
      const pi = json.data?.productVariants?.pageInfo;
      if (!pi?.hasNextPage) break;
      cursor = pi.endCursor;
      pages++;
    }

    // Fetch PIM master products
    const { data: pim, error: pimErr } = await supabase
      .from("master_products")
      .select("id, title, ean, sku, shopify_product_id, shopify_variant_id");
    if (pimErr) throw pimErr;

    const linkedVariantIds = new Set<string>();
    const byEan = new Map<string, { id: string; title: string }>();
    const bySku = new Map<string, { id: string; title: string }>();
    for (const p of pim ?? []) {
      if (p.shopify_variant_id) linkedVariantIds.add(String(p.shopify_variant_id));
      const e = normEan(p.ean); if (e && !byEan.has(e)) byEan.set(e, { id: p.id, title: p.title });
      const s = normSku(p.sku); if (s && !bySku.has(s)) bySku.set(s, { id: p.id, title: p.title });
    }

    const unmatched = variants
      .filter((v) => !linkedVariantIds.has(v.variantId))
      .map((v) => {
        const eanKey = normEan(v.barcode);
        const skuKey = normSku(v.sku);
        const eanConflict = eanKey ? byEan.get(eanKey) ?? null : null;
        const skuConflict = skuKey ? bySku.get(skuKey) ?? null : null;
        return {
          shopify_product_id: v.productId,
          shopify_variant_id: v.variantId,
          product_title: v.productTitle,
          variant_title: v.variantTitle,
          sku: v.sku,
          barcode: v.barcode,
          price: v.price,
          inventory_quantity: v.inventoryQuantity,
          image_url: v.image || v.productImage,
          status: v.status,
          pim_ean_conflict: eanConflict,
          pim_sku_conflict: skuConflict,
        };
      });

    return new Response(JSON.stringify({
      success: true,
      shop_domain: conn.shop_domain,
      total_variants: variants.length,
      linked_in_pim: linkedVariantIds.size,
      unmatched_count: unmatched.length,
      unmatched,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("shopify-find-unmatched:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
