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

function toInventoryPolicy(backorders?: string) {
  if (!backorders) return undefined;
  // Only 'yes' allows backorders. 'notify' and 'no' both DENY purchases when out of stock.
  return backorders === "yes" ? "CONTINUE" : "DENY";
}

function toGid(type: "Product" | "ProductVariant" | "InventoryItem" | "Location", id: string | number | null | undefined): string | null {
  if (id == null || id === "") return null;
  const s = String(id);
  if (s.startsWith("gid://")) return s;
  return `gid://shopify/${type}/${s}`;
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

    const body = await req.json();
    const { master_product_id, regular_price, sale_price, stock_quantity, stock_status, backorders, backorder_policy, weight_kg, description, short_description, meta_title, meta_description, force, enqueue_on_throttle, queued, source, status, ean: eanInput } = body;
    // Normalize backorder input: accept legacy 'backorders' ('yes'/'no'/'notify') or new 'backorder_policy'
    const backordersNorm: string | undefined = backorder_policy ?? backorders;
    if (!master_product_id) {
      return new Response(JSON.stringify({ error: "master_product_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: product, error: productError } = await supabase
      .from("master_products")
      .select("id, title, ean, webshop_price, sale_price, stock_quantity, stock_status, backorders_allowed, backorder_policy, weight_kg, shopify_product_id, shopify_variant_id, short_description, long_description, meta_title, meta_description, lifecycle_status")
      .eq("id", master_product_id)
      .single();

    if (productError || !product) {
      return new Response(JSON.stringify({ error: "Product not found", details: productError?.message }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (product.lifecycle_status === "draft") {
      return new Response(JSON.stringify({ skipped: true, reason: "lifecycle=draft", message: "Produktet er en kladde og er ikke sendt til Shopify endnu." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!product.shopify_product_id || !product.shopify_variant_id) {
      return new Response(JSON.stringify({ error: "Produktet har ikke Shopify produkt-/variant-ID. Kør Shopify-import først." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: conn } = await supabase
      .from("shopify_connection")
      .select("shop_domain, access_token")
      .order("is_active", { ascending: false })
      .order("installed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!conn) {
      return new Response(JSON.stringify({ error: "Shopify er ikke forbundet endnu" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load field sync policy and skip fields where PIM is not master/push
    const { data: policyRows } = await supabase
      .from("field_sync_policy")
      .select("field_name, master, direction");
    const policy = new Map<string, { master: string; direction: string }>(
      (policyRows ?? []).map((r) => [r.field_name, { master: r.master, direction: r.direction }])
    );
    const canPush = (field: string) => {
      if (force === true) return true;
      const p = policy.get(field);
      if (!p) return true; // unknown field => allow
      if (p.master !== "pim") return false;
      return p.direction === "push" || p.direction === "two_way";
    };

    const updatedFields: string[] = [];
    const skippedFields: string[] = [];
    const dbUpdate: Record<string, unknown> = {};
    const changeLogs: { master_product_id: string; change_type: string; field_name: string; old_value: string | null; new_value: string | null; source: string }[] = [];
    const logChange = (field: string, oldVal: unknown, newVal: unknown, type: string) => {
      const oldText = oldVal == null ? null : String(oldVal);
      const newText = newVal == null ? null : String(newVal);
      if (oldText !== newText) changeLogs.push({ master_product_id, change_type: type, field_name: field, old_value: oldText, new_value: newText, source: "shopify-update-product" });
    };

    const variantGid = toGid("ProductVariant", product.shopify_variant_id);
    const productGid = toGid("Product", product.shopify_product_id);

    const variantInput: Record<string, unknown> = { id: variantGid };
    if (regular_price !== undefined && regular_price !== null) {
      if (canPush("webshop_price")) {
        variantInput.price = String(regular_price);
        dbUpdate.webshop_price = regular_price;
        logChange("webshop_price", product.webshop_price, regular_price, "price_update");
        updatedFields.push("price");
      } else { skippedFields.push("webshop_price"); }
    }
    if (sale_price !== undefined) {
      if (canPush("sale_price")) {
        variantInput.compareAtPrice = sale_price !== null ? String(sale_price) : null;
        dbUpdate.sale_price = sale_price;
        logChange("sale_price", product.sale_price, sale_price, "price_update");
        updatedFields.push("compareAtPrice");
      } else { skippedFields.push("sale_price"); }
    }
    const inventoryPolicy = toInventoryPolicy(backordersNorm);
    if (inventoryPolicy) {
      if (canPush("backorders_allowed") || canPush("backorder_policy")) {
        variantInput.inventoryPolicy = inventoryPolicy;
        const allowed = inventoryPolicy === "CONTINUE";
        const policyValue = backordersNorm === "yes" || backordersNorm === "no" || backordersNorm === "notify" ? backordersNorm : (allowed ? "yes" : "no");
        dbUpdate.backorders_allowed = allowed;
        dbUpdate.backorder_policy = policyValue;
        logChange("backorders_allowed", product.backorders_allowed, allowed, "stock_update");
        logChange("backorder_policy", product.backorder_policy, policyValue, "stock_update");
        updatedFields.push("inventoryPolicy");
      } else { skippedFields.push("backorders_allowed"); }
    }

    // Weight (kg) — send to Shopify via inventoryItem measurement. Defaults to 1 kg if no value set in PIM.
    {
      const effectiveWeight = weight_kg !== undefined && weight_kg !== null
        ? Number(weight_kg)
        : (product.weight_kg != null ? Number(product.weight_kg) : 1);
      if (Number.isFinite(effectiveWeight) && effectiveWeight >= 0) {
        if (canPush("weight_kg")) {
          variantInput.inventoryItem = {
            ...(variantInput.inventoryItem as Record<string, unknown> ?? {}),
            measurement: { weight: { value: effectiveWeight, unit: "KILOGRAMS" } },
          };
          if (weight_kg !== undefined && weight_kg !== null) {
            dbUpdate.weight_kg = weight_kg;
            logChange("weight_kg", product.weight_kg, weight_kg, "weight_update");
          }
          updatedFields.push("weight");
        } else { skippedFields.push("weight_kg"); }
      }
    }
    // Barcode (EAN). Default to PIM's current ean unless caller overrode. Skip fallback 'wc-' EANs.
    {
      const eanCandidate = eanInput !== undefined ? eanInput : product.ean;
      if (eanCandidate && typeof eanCandidate === "string" && !eanCandidate.startsWith("wc-")) {
        if (canPush("ean")) {
          // Only push if it actually differs from what we last knew, OR caller forced
          if (force === true || eanInput !== undefined) {
            variantInput.barcode = String(eanCandidate);
            logChange("ean", product.ean, eanCandidate, "ean_update");
            updatedFields.push("barcode");
          }
        } else { skippedFields.push("ean"); }
      }
    }

    // Product-level update (description / excerpt)
    const productInput: Record<string, unknown> = { id: productGid };
    if (description !== undefined && description !== null) {
      if (canPush("long_description")) {
        productInput.descriptionHtml = String(description);
        dbUpdate.long_description = description;
        logChange("long_description", product.long_description, description, "description_update");
        updatedFields.push("descriptionHtml");
      } else { skippedFields.push("long_description"); }
    }
    if (short_description !== undefined && short_description !== null) {
      if (canPush("short_description")) {
        productInput.metafields = [{
          namespace: "custom",
          key: "short_description",
          type: "multi_line_text_field",
          value: String(short_description),
        }];
        dbUpdate.short_description = short_description;
        logChange("short_description", product.short_description, short_description, "description_update");
        updatedFields.push("short_description");
      } else { skippedFields.push("short_description"); }
    }
    if (status !== undefined && status !== null) {
      const s = String(status).toUpperCase();
      if (s === "ACTIVE" || s === "ARCHIVED" || s === "DRAFT") {
        productInput.status = s;
        logChange("shopify_status", null, s, "status_update");
        updatedFields.push("status");
      }
    }
    if (Object.keys(productInput).length > 1) {
      const productMutation = `#graphql
        mutation UpdateProduct($input: ProductInput!) {
          productUpdate(input: $input) {
            product { id }
            userErrors { field message }
          }
        }`;
      const pData = await shopifyGraphql(conn.shop_domain, conn.access_token, productMutation, { input: productInput });
      const pErrors = pData.productUpdate.userErrors;
      if (pErrors?.length) throw new Error(pErrors.map((e: { message: string }) => e.message).join(", "));
    }

    if (Object.keys(variantInput).length > 1) {
      const mutation = `#graphql
        mutation UpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            productVariants { id }
            userErrors { field message }
          }
        }`;
      const data = await shopifyGraphql(conn.shop_domain, conn.access_token, mutation, {
        productId: productGid,
        variants: [variantInput],
      });
      const errors = data.productVariantsBulkUpdate.userErrors;
      if (errors?.length) throw new Error(errors.map((e: { message: string }) => e.message).join(", "));
    }

    if (stock_quantity !== undefined && stock_quantity !== null) {
      if (!canPush("stock_quantity")) {
        skippedFields.push("stock_quantity");
      } else {
        const inventoryQuery = `#graphql
          query VariantInventory($id: ID!) {
            productVariant(id: $id) {
              inventoryItem {
                id
                inventoryLevels(first: 10) {
                  nodes {
                    location { id }
                    quantities(names: ["available"]) { name quantity }
                  }
                }
              }
            }
            locations(first: 5, includeInactive: false) { nodes { id } }
          }`;
        const inventoryData = await shopifyGraphql(conn.shop_domain, conn.access_token, inventoryQuery, { id: variantGid });
        const inventoryItemId = inventoryData.productVariant?.inventoryItem?.id;
        const levels = inventoryData.productVariant?.inventoryItem?.inventoryLevels?.nodes ?? [];
        const firstLevel = levels[0];
        const locationId = firstLevel?.location?.id ?? inventoryData.locations?.nodes?.[0]?.id;
        const currentQty = firstLevel?.quantities?.find((q: { name: string }) => q.name === "available")?.quantity ?? 0;

        if (inventoryItemId && locationId) {
          const setMutation = `#graphql
            mutation SetInventory($input: InventorySetQuantitiesInput!) {
              inventorySetQuantities(input: $input) @idempotent(key: "${crypto.randomUUID()}") {
                userErrors { field message }
              }
            }`;
          const setData = await shopifyGraphql(conn.shop_domain, conn.access_token, setMutation, {
            input: {
              name: "available",
              reason: "correction",
              quantities: [{ inventoryItemId, locationId, quantity: Number(stock_quantity), changeFromQuantity: Number(currentQty) }],
            },
          });
          const errors = setData.inventorySetQuantities.userErrors;
          if (errors?.length) throw new Error(errors.map((e: { message: string }) => e.message).join(", "));
        }
        dbUpdate.stock_quantity = stock_quantity;
        logChange("stock_quantity", product.stock_quantity, stock_quantity, "stock_update");
        updatedFields.push("stock_quantity");
      }
    }

    if (stock_status) {
      if (canPush("stock_status")) {
        dbUpdate.stock_status = stock_status;
        logChange("stock_status", product.stock_status, stock_status, "stock_update");
        updatedFields.push("stock_status");
      } else { skippedFields.push("stock_status"); }
    }

    // Always stamp sync timestamp on success (even if no fields actually pushed — call succeeded)
    dbUpdate.last_shopify_sync_at = new Date().toISOString();
    dbUpdate.last_shopify_sync_status = "ok";

    await supabase.from("master_products").update({ ...dbUpdate, updated_at: new Date().toISOString() }).eq("id", master_product_id);
    if (changeLogs.length > 0) {
      await supabase.from("product_change_log").insert(changeLogs);
    }

    return new Response(JSON.stringify({ success: true, shopify_product_id: product.shopify_product_id, shopify_variant_id: product.shopify_variant_id, updated_fields: updatedFields, skipped_fields: skippedFields, last_shopify_sync_at: dbUpdate.last_shopify_sync_at }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ukendt fejl";
    console.error("Shopify update error:", message);

    // Detect transient/throttle errors and enqueue for retry
    const isThrottle = /rate.?limit|throttl|429|too many requests|exceeded for trace/i.test(message);
    const shouldEnqueue = isThrottle && enqueue_on_throttle !== false && queued !== true;

    // Stamp failure on product (best-effort, ignore errors)
    try {
      const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await sb.from("master_products").update({ last_shopify_sync_status: shouldEnqueue ? "queued" : "failed" }).eq("id", master_product_id);
    } catch { /* ignore */ }


    if (shouldEnqueue) {
      try {
        const supabaseSvc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        // Avoid duplicate pending entries for the same product
        const { data: existing } = await supabaseSvc
          .from("shopify_update_queue")
          .select("id, attempts")
          .eq("master_product_id", master_product_id)
          .in("status", ["pending", "processing"])
          .maybeSingle();

        const retryDelaySec = 60; // initial backoff window
        const payload = await req.clone().json().catch(() => ({}));
        // Strip control fields so worker re-runs cleanly
        delete payload.queued;
        delete payload.enqueue_on_throttle;

        if (existing) {
          await supabaseSvc.from("shopify_update_queue")
            .update({
              payload,
              status: "pending",
              last_error: message,
              next_attempt_at: new Date(Date.now() + retryDelaySec * 1000).toISOString(),
            })
            .eq("id", existing.id);
        } else {
          await supabaseSvc.from("shopify_update_queue").insert({
            master_product_id,
            payload,
            status: "pending",
            attempts: 0,
            last_error: message,
            next_attempt_at: new Date(Date.now() + retryDelaySec * 1000).toISOString(),
            source: source ?? "shopify-update-product",
          });
        }

        return new Response(JSON.stringify({
          queued: true,
          retry_after_seconds: retryDelaySec,
          message: "Shopify rate limit ramt — opgaven er sat i kø og prøves automatisk igen.",
        }), {
          status: 202,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (qErr) {
        console.error("Failed to enqueue:", qErr);
      }
    }

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
