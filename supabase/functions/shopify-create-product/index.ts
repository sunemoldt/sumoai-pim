import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_VERSION = "2026-04";
const VAT_RATE = 0.25;

// HTML -> Shopify rich_text_field JSON (root/heading/paragraph/list/list-item/text/link).
function htmlToShopifyRichText(html: string): string {
  const clean = String(html ?? "").trim();
  if (!clean) return JSON.stringify({ type: "root", children: [] });
  type Node = { type: string; children?: Node[]; value?: string; level?: number; url?: string; listType?: string; bold?: boolean; italic?: boolean };
  const stripTags = (s: string) => s.replace(/<[^>]+>/g, "");
  const decodeEntities = (s: string) => s
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  function parseInline(inner: string): Node[] {
    const nodes: Node[] = [];
    const re = /<(\/?)(strong|b|em|i|a|br)(\s[^>]*)?>/gi;
    let last = 0;
    const stack: { bold: boolean; italic: boolean; url?: string }[] = [{ bold: false, italic: false }];
    const pushText = (raw: string) => {
      if (!raw) return;
      const top = stack[stack.length - 1];
      const text = decodeEntities(raw);
      if (!text) return;
      const node: Node = { type: "text", value: text };
      if (top.bold) node.bold = true;
      if (top.italic) node.italic = true;
      if (top.url) nodes.push({ type: "link", url: top.url, children: [node] });
      else nodes.push(node);
    };
    let m: RegExpExecArray | null;
    while ((m = re.exec(inner)) !== null) {
      pushText(inner.slice(last, m.index));
      const closing = m[1] === "/";
      const tag = m[2].toLowerCase();
      const attrs = m[3] ?? "";
      if (tag === "br") { /* ignore */ }
      else if (closing) { if (stack.length > 1) stack.pop(); }
      else {
        const top = { ...stack[stack.length - 1] };
        if (tag === "strong" || tag === "b") top.bold = true;
        if (tag === "em" || tag === "i") top.italic = true;
        if (tag === "a") {
          const h = /href=["']([^"']+)["']/i.exec(attrs);
          if (h) top.url = h[1];
        }
        stack.push(top);
      }
      last = m.index + m[0].length;
    }
    pushText(inner.slice(last));
    return nodes.length ? nodes : [{ type: "text", value: decodeEntities(stripTags(inner)) }];
  }
  const children: Node[] = [];
  const blockRe = /<(h[1-6]|p|ul|ol)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  let matched = false;
  while ((m = blockRe.exec(clean)) !== null) {
    matched = true;
    const tag = m[1].toLowerCase();
    const inner = m[3];
    if (tag.startsWith("h")) children.push({ type: "heading", level: parseInt(tag.slice(1), 10), children: parseInline(inner) });
    else if (tag === "p") children.push({ type: "paragraph", children: parseInline(inner) });
    else {
      const items: Node[] = [];
      const liRe = /<li(\s[^>]*)?>([\s\S]*?)<\/li>/gi;
      let li: RegExpExecArray | null;
      while ((li = liRe.exec(inner)) !== null) items.push({ type: "list-item", children: parseInline(li[2]) });
      children.push({ type: "list", listType: tag === "ol" ? "ordered" : "unordered", children: items });
    }
  }
  if (!matched) children.push({ type: "paragraph", children: parseInline(clean) });
  return JSON.stringify({ type: "root", children });
}

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

async function getCheapestPurchasePrice(admin: any, masterProductId: string): Promise<number | null> {
  const { data } = await admin
    .from("supplier_products")
    .select("purchase_price, in_stock, stock_quantity")
    .eq("master_product_id", masterProductId);

  const rows = (data ?? [])
    .map((sp: any) => ({
      purchase: sp.purchase_price == null ? null : Number(sp.purchase_price),
      inStock: sp.in_stock === true && (sp.stock_quantity == null || Number(sp.stock_quantity) > 0),
    }))
    .filter((sp: { purchase: number | null }) => sp.purchase != null && Number.isFinite(sp.purchase) && sp.purchase > 0);

  if (rows.length === 0) return null;
  const inStockRows = rows.filter((sp: { inStock: boolean }) => sp.inStock);
  const pool = inStockRows.length > 0 ? inStockRows : rows;
  return Math.min(...pool.map((sp: { purchase: number }) => sp.purchase));
}

function assertNotBelowPurchase(sellingPriceInclVat: number | null, purchasePriceExVat: number | null) {
  if (sellingPriceInclVat == null || purchasePriceExVat == null) return;
  const sellingExVat = sellingPriceInclVat / (1 + VAT_RATE);
  if (sellingExVat + 0.005 < purchasePriceExVat) {
    throw new Error(
      `Blokeret: Shopify-salgspris ${sellingPriceInclVat.toFixed(2)} kr inkl. moms er under indkøb ${purchasePriceExVat.toFixed(2)} kr ekskl. moms.`
    );
  }
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
    const regularPrice = p.webshop_price != null ? Number(p.webshop_price) : null;
    const salePrice = p.sale_price != null ? Number(p.sale_price) : null;
    const onSale = regularPrice != null && salePrice != null && salePrice > 0 && salePrice < regularPrice;
    const sellingPrice = onSale ? salePrice : regularPrice;
    const cheapestPurchase = await getCheapestPurchasePrice(supabase, master_product_id);
    assertNotBelowPurchase(sellingPrice, cheapestPurchase);

    const variantInput: Record<string, unknown> = {
      id: variantGid,
      price: sellingPrice != null ? String(sellingPrice) : undefined,
      compareAtPrice: onSale ? String(regularPrice) : undefined,
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
