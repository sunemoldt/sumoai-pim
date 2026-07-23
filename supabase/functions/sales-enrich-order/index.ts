// Enrich shopify_processed_orders with full order details from Shopify Admin API
// and match each line item to a PIM master_product to snapshot purchase price.
// Modes:
//  - { order_id: number }              → enrich one order (re-enrich even if enriched)
//  - { order_ids: number[] }           → enrich given orders
//  - { missing_only: true, limit?: n } → enrich orders whose raw is missing line_results/purchase_price
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_VERSION = "2026-04";

async function requireUser(req: Request): Promise<boolean> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return false;
  if (authHeader.includes(SUPABASE_SERVICE_ROLE_KEY)) return true;
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await anon.auth.getUser();
  return !error && Boolean(user);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fetchOrder(shop: string, token: string, orderId: number) {
  const url = `https://${shop}/admin/api/${API_VERSION}/orders/${orderId}.json?status=any`;
  const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
  if (!res.ok) throw new Error(`Shopify order ${orderId} → ${res.status} ${await res.text().catch(() => "")}`);
  const data = await res.json();
  return data.order as Record<string, any> | null;
}

async function enrichOne(sb: any, shop: string, token: string, orderId: number) {
  const order = await fetchOrder(shop, token, orderId);
  if (!order) return { order_id: orderId, error: "not_found_in_shopify" };

  const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
  const lineResults: Array<Record<string, unknown>> = [];

  for (const item of lineItems) {
    const variantId = item.variant_id ? String(item.variant_id) : null;
    const productIdShopify = item.product_id ? String(item.product_id) : null;
    const qty = Number(item.quantity ?? 0);
    const unitPrice = Number(item.price ?? 0);
    const totalDiscount = Number(item.total_discount ?? 0);
    const lineTotal = unitPrice * qty - totalDiscount;

    const base: Record<string, unknown> = {
      variant_id: variantId,
      product_id_shopify: productIdShopify,
      title: String(item.title ?? item.name ?? ""),
      variant_title: item.variant_title ? String(item.variant_title) : null,
      sku: item.sku ? String(item.sku) : null,
      quantity: qty,
      unit_price: unitPrice,
      total_discount: totalDiscount,
      line_total: lineTotal,
    };

    // Match to PIM by variant_id first, then by product_id, then by SKU/EAN
    let product: any = null;
    if (variantId) {
      const { data } = await sb
        .from("master_products")
        .select("id, title, image_url, ean, sku, stock_sync_supplier_ids")
        .or(`shopify_variant_id.eq.${variantId},shopify_variant_id.eq.gid://shopify/ProductVariant/${variantId}`)
        .limit(1);
      product = data?.[0] ?? null;
    }
    if (!product && productIdShopify) {
      const { data } = await sb
        .from("master_products")
        .select("id, title, image_url, ean, sku, stock_sync_supplier_ids")
        .or(`shopify_product_id.eq.${productIdShopify},shopify_product_id.eq.gid://shopify/Product/${productIdShopify}`)
        .limit(1);
      product = data?.[0] ?? null;
    }
    if (!product && item.sku) {
      const { data } = await sb
        .from("master_products")
        .select("id, title, image_url, ean, sku, stock_sync_supplier_ids")
        .eq("sku", String(item.sku))
        .limit(1);
      product = data?.[0] ?? null;
    }

    let purchasePrice: number | null = null;
    if (product) {
      const supplierIds = Array.isArray(product.stock_sync_supplier_ids) ? product.stock_sync_supplier_ids : [];
      let q = sb.from("supplier_products").select("purchase_price").eq("master_product_id", product.id);
      if (supplierIds.length > 0) q = q.in("supplier_id", supplierIds);
      const { data: sps } = await q;
      const prices = (sps ?? [])
        .map((r: any) => Number(r.purchase_price))
        .filter((n: number) => Number.isFinite(n) && n > 0);
      if (prices.length > 0) purchasePrice = Math.min(...prices);
    }

    lineResults.push({
      ...base,
      product_id: product?.id ?? null,
      product_title: product?.title ?? null,
      product_image: product?.image_url ?? null,
      product_ean: product?.ean ?? null,
      purchase_price: purchasePrice,
    });
  }

  const shippingLines = Array.isArray(order.shipping_lines) ? order.shipping_lines : [];
  const shippingTotal = shippingLines.reduce((s: number, l: any) => s + Number(l.price ?? 0), 0);

  const raw = {
    line_results: lineResults,
    created_at: order.created_at ?? null,
    subtotal_price: Number(order.subtotal_price ?? 0),
    total_price: Number(order.total_price ?? 0),
    total_tax: Number(order.total_tax ?? 0),
    shipping_total: shippingTotal,
    currency: String(order.currency ?? "DKK"),
    financial_status: order.financial_status ?? null,
    fulfillment_status: order.fulfillment_status ?? null,
    customer: order.customer ? {
      id: order.customer.id ?? null,
      first_name: order.customer.first_name ?? null,
      last_name: order.customer.last_name ?? null,
      email: order.customer.email ?? null,
    } : null,
    order_status_url: order.order_status_url ?? null,
    enriched_at: new Date().toISOString(),
  };

  await sb.from("shopify_processed_orders")
    .upsert({
      order_id: orderId,
      shopify_order_number: String(order.name ?? order.order_number ?? ""),
      line_count: lineItems.length,
      raw,
    }, { onConflict: "order_id" });

  return {
    order_id: orderId,
    lines: lineResults.length,
    matched: lineResults.filter((l: any) => l.product_id).length,
    with_cost: lineResults.filter((l: any) => Number(l.purchase_price) > 0).length,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!(await requireUser(req))) return json({ error: "Unauthorized" }, 401);


  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

  const { data: conn, error: connErr } = await svc
    .from("shopify_connection")
    .select("shop_domain, access_token")
    .eq("is_active", true)
    .maybeSingle();
  if (connErr || !conn) return json({ error: "No active Shopify connection" }, 400);

  let ids: number[] = [];
  if (body.order_id) ids = [Number(body.order_id)];
  else if (Array.isArray(body.order_ids)) ids = body.order_ids.map((n: any) => Number(n)).filter(Boolean);
  else if (body.missing_only) {
    const limit = Math.min(Number(body.limit ?? 50), 200);
    const { data } = await svc
      .from("shopify_processed_orders")
      .select("order_id, raw")
      .order("processed_at", { ascending: false })
      .limit(500);
    ids = (data ?? [])
      .filter((r: any) => {
        const lines = r.raw?.line_results;
        if (!Array.isArray(lines) || lines.length === 0) return true;
        return lines.some((l: any) => !(Number(l.purchase_price) > 0) || !l.quantity);
      })
      .slice(0, limit)
      .map((r: any) => Number(r.order_id));
  }

  if (ids.length === 0) return json({ enriched: 0, results: [] });

  const results: any[] = [];
  for (const id of ids) {
    try {
      results.push(await enrichOne(svc, conn.shop_domain, conn.access_token, id));
    } catch (e: any) {
      results.push({ order_id: id, error: e?.message ?? String(e) });
    }
  }

  return json({
    enriched: results.filter((r) => !r.error).length,
    failed: results.filter((r) => r.error).length,
    results,
  });
});
