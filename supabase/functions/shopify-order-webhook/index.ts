// Shopify orders/create webhook — decrements PIM stock for future orders only.
// Protected by HMAC signature + cutoff timestamp + atomic claim idempotency.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-shopify-hmac-sha256, x-shopify-topic, x-shopify-shop-domain",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Shopify signs Admin-API-oprettede webhooks med app secret. Fallback hvis brugeren har sat egen secret.
const SHOPIFY_WEBHOOK_SECRET = Deno.env.get("SHOPIFY_WEBHOOK_SECRET") ?? Deno.env.get("SHOPIFY_CLIENT_SECRET") ?? "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function verifyHmac(rawBody: string, providedHmac: string): Promise<boolean> {
  if (!SHOPIFY_WEBHOOK_SECRET || !providedHmac) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SHOPIFY_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
  if (computed.length !== providedHmac.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.length; i++) mismatch |= computed.charCodeAt(i) ^ providedHmac.charCodeAt(i);
  return mismatch === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const rawBody = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256") ?? "";
  const topic = req.headers.get("x-shopify-topic") ?? "";

  const valid = await verifyHmac(rawBody, hmac);
  if (!valid) {
    console.warn("[shopify-order-webhook] Invalid HMAC", { topic });
    return json({ error: "Invalid signature" }, 401);
  }

  let order: Record<string, unknown>;
  try { order = JSON.parse(rawBody); } catch { return json({ error: "Bad JSON" }, 400); }

  const orderId = Number(order.id);
  const orderNumber = String(order.name ?? order.order_number ?? "");
  const createdAtRaw = String(order.created_at ?? "");
  const createdAt = createdAtRaw ? new Date(createdAtRaw) : new Date();
  const lineItems = Array.isArray(order.line_items) ? order.line_items as Array<Record<string, unknown>> : [];

  if (!orderId) return json({ error: "Missing order.id" }, 400);

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const logSkip = async (reason: string) => {
    await sb.from("shopify_skipped_orders").insert({
      order_id: orderId,
      shopify_order_number: orderNumber,
      skipped_reason: reason,
      raw: { created_at: createdAtRaw, line_count: lineItems.length },
    });
  };

  // 1) Cutoff check — aldrig rør historiske ordrer
  const { data: cfg } = await sb.from("shopify_webhook_config").select("orders_cutoff_at").eq("id", 1).maybeSingle();
  const cutoff = cfg?.orders_cutoff_at ? new Date(cfg.orders_cutoff_at) : null;
  if (!cutoff) {
    await logSkip("no_cutoff_configured");
    return json({ skipped: "no_cutoff_configured" });
  }
  if (createdAt < cutoff) {
    await logSkip("before_cutoff");
    return json({ skipped: "before_cutoff", order_id: orderId, created_at: createdAtRaw, cutoff: cutoff.toISOString() });
  }

  // 2) Atomar claim — insert virker som lås. Hvis order_id allerede findes → duplicate.
  const { data: claim, error: claimErr } = await sb
    .from("shopify_processed_orders")
    .insert({
      order_id: orderId,
      shopify_order_number: orderNumber,
      line_count: lineItems.length,
      total_decremented: 0,
    })
    .select("order_id")
    .maybeSingle();

  if (claimErr) {
    // Unique constraint violation = anden process har allerede claimet ordren
    const isDuplicate = /duplicate key|unique constraint/i.test(claimErr.message);
    if (isDuplicate) return json({ skipped: "duplicate", order_id: orderId });
    console.error("[shopify-order-webhook] Claim failed", claimErr);
    return json({ error: "Claim failed", details: claimErr.message }, 500);
  }
  if (!claim) return json({ skipped: "duplicate", order_id: orderId });

  // 3) Decrement stock per line item via atomar SQL-funktion
  let totalDecremented = 0;
  const lineResults: Array<Record<string, unknown>> = [];

  for (const item of lineItems) {
    const variantId = item.variant_id ? String(item.variant_id) : null;
    const qty = Number(item.quantity ?? 0);
    const title = String(item.title ?? item.name ?? "");
    const variantTitle = item.variant_title ? String(item.variant_title) : null;
    const sku = item.sku ? String(item.sku) : null;
    // price is per unit, incl or excl VAT depending on Shopify config; we snapshot both
    const unitPrice = Number(item.price ?? 0);
    const totalDiscount = Number(item.total_discount ?? 0);
    const lineTotal = unitPrice * qty - totalDiscount;

    const baseLine: Record<string, unknown> = {
      variant_id: variantId,
      title,
      variant_title: variantTitle,
      sku,
      quantity: qty,
      unit_price: unitPrice,
      total_discount: totalDiscount,
      line_total: lineTotal,
    };

    if (!variantId || !/^\d+$/.test(variantId)) {
      lineResults.push({ ...baseLine, skipped: "invalid_variant_id" });
      continue;
    }
    if (qty <= 0) {
      lineResults.push({ ...baseLine, skipped: "invalid_qty" });
      continue;
    }

    // Find produkt via shopify_variant_id (numeric eller GID)
    const { data: products } = await sb
      .from("master_products")
      .select("id, title, image_url, ean, stock_sync_supplier_ids")
      .or(`shopify_variant_id.eq.${variantId},shopify_variant_id.eq.gid://shopify/ProductVariant/${variantId}`)
      .limit(1);
    const product = products?.[0];

    // Snapshot cheapest purchase price at time of sale, from selected suppliers if any
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

    const enriched: Record<string, unknown> = {
      ...baseLine,
      product_id: product?.id ?? null,
      product_title: product?.title ?? null,
      product_image: product?.image_url ?? null,
      product_ean: product?.ean ?? null,
      purchase_price: purchasePrice,
    };

    if (!product) {
      lineResults.push({ ...enriched, skipped: "product_not_found" });
      continue;
    }

    const { data: rpcResult, error: rpcErr } = await sb.rpc("decrement_stock_from_shopify_order", {
      p_master_product_id: product.id,
      p_qty: qty,
    });

    if (rpcErr) {
      lineResults.push({ ...enriched, error: rpcErr.message });
      continue;
    }

    const result = (rpcResult ?? {}) as Record<string, unknown>;
    if (result.skipped) {
      lineResults.push({ ...enriched, skipped: result.skipped });
      continue;
    }

    const dec = Number(result.decremented ?? 0);
    totalDecremented += dec;
    lineResults.push({
      ...enriched,
      decremented: dec,
      old_qty: result.old,
      new_qty: result.new,
    });
  }

  const subtotalPrice = Number((order as any).subtotal_price ?? 0);
  const totalPrice = Number((order as any).total_price ?? 0);
  const totalTax = Number((order as any).total_tax ?? 0);
  const currency = String((order as any).currency ?? "DKK");
  const customer = (order as any).customer ?? null;
  const shippingLines = Array.isArray((order as any).shipping_lines) ? (order as any).shipping_lines : [];
  const shippingTotal = shippingLines.reduce((s: number, l: any) => s + Number(l.price ?? 0), 0);

  // 4) Opdater claim-rækken med slutresultat
  await sb.from("shopify_processed_orders")
    .update({
      total_decremented: totalDecremented,
      raw: { line_results: lineResults, created_at: createdAtRaw },
    })
    .eq("order_id", orderId);

  return json({ success: true, order_id: orderId, decremented: totalDecremented, lines: lineResults });
});
