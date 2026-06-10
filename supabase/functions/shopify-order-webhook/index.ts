// Shopify orders/create webhook — decrements PIM stock for future orders only.
// Protected by HMAC signature + cutoff timestamp + idempotency table.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-shopify-hmac-sha256, x-shopify-topic, x-shopify-shop-domain",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHOPIFY_WEBHOOK_SECRET = Deno.env.get("SHOPIFY_WEBHOOK_SECRET") ?? "";

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
  // Constant-time compare
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

  // 1) Cutoff check — never touch historical orders
  const { data: cfg } = await sb.from("shopify_webhook_config").select("orders_cutoff_at").eq("id", 1).maybeSingle();
  const cutoff = cfg?.orders_cutoff_at ? new Date(cfg.orders_cutoff_at) : null;
  if (!cutoff) {
    await sb.from("shopify_processed_orders").upsert({
      order_id: orderId, shopify_order_number: orderNumber, line_count: lineItems.length,
      total_decremented: 0, skipped_reason: "no_cutoff_configured",
    });
    return json({ skipped: "no_cutoff_configured" });
  }
  if (createdAt < cutoff) {
    await sb.from("shopify_processed_orders").upsert({
      order_id: orderId, shopify_order_number: orderNumber, line_count: lineItems.length,
      total_decremented: 0, skipped_reason: "before_cutoff",
    });
    return json({ skipped: "before_cutoff", order_id: orderId, created_at: createdAtRaw, cutoff: cutoff.toISOString() });
  }

  // 2) Idempotency check
  const { data: existing } = await sb.from("shopify_processed_orders").select("order_id").eq("order_id", orderId).maybeSingle();
  if (existing) return json({ skipped: "duplicate", order_id: orderId });

  // 3) Decrement stock per line item
  let totalDecremented = 0;
  const lineResults: Array<Record<string, unknown>> = [];

  for (const item of lineItems) {
    const variantId = item.variant_id ? String(item.variant_id) : null;
    const qty = Number(item.quantity ?? 0);
    if (!variantId || qty <= 0) {
      lineResults.push({ variant_id: variantId, skipped: "no_variant_or_qty" });
      continue;
    }

    // Find product by shopify_variant_id (stored as string or numeric)
    const { data: products } = await sb
      .from("master_products")
      .select("id, title, stock_quantity, auto_stock_sync, lifecycle_status")
      .or(`shopify_variant_id.eq.${variantId},shopify_variant_id.eq.gid://shopify/ProductVariant/${variantId}`)
      .limit(1);
    const product = products?.[0];

    if (!product) {
      lineResults.push({ variant_id: variantId, skipped: "product_not_found" });
      continue;
    }
    if (product.auto_stock_sync) {
      lineResults.push({ variant_id: variantId, product_id: product.id, skipped: "auto_stock_sync_managed" });
      continue;
    }
    if (product.lifecycle_status === "draft") {
      lineResults.push({ variant_id: variantId, product_id: product.id, skipped: "draft" });
      continue;
    }

    const newQty = Math.max((product.stock_quantity ?? 0) - qty, 0);
    // Mark change source so auto_enqueue_shopify_update skip-list catches it (no push-back to Shopify)
    await sb.rpc("set_change_source", { source: "shopify-order" });
    const { error: updErr } = await sb
      .from("master_products")
      .update({
        stock_quantity: newQty,
        stock_status: newQty > 0 ? "instock" : "outofstock",
        updated_at: new Date().toISOString(),
      })
      .eq("id", product.id);

    if (updErr) {
      lineResults.push({ variant_id: variantId, product_id: product.id, error: updErr.message });
      continue;
    }
    totalDecremented += qty;
    lineResults.push({ variant_id: variantId, product_id: product.id, decremented: qty, new_qty: newQty });
  }

  await sb.from("shopify_processed_orders").insert({
    order_id: orderId,
    shopify_order_number: orderNumber,
    line_count: lineItems.length,
    total_decremented: totalDecremented,
    raw: { line_results: lineResults, created_at: createdAtRaw },
  });

  return json({ success: true, order_id: orderId, decremented: totalDecremented, lines: lineResults });
});
