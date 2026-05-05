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
  return backorders === "yes" || backorders === "notify" ? "CONTINUE" : "DENY";
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
    const { master_product_id, regular_price, sale_price, stock_quantity, stock_status, backorders } = body;
    if (!master_product_id) {
      return new Response(JSON.stringify({ error: "master_product_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: product, error: productError } = await supabase
      .from("master_products")
      .select("id, title, ean, webshop_price, sale_price, stock_quantity, stock_status, backorders_allowed, shopify_product_id, shopify_variant_id")
      .eq("id", master_product_id)
      .single();

    if (productError || !product) {
      return new Response(JSON.stringify({ error: "Product not found", details: productError?.message }), {
        status: 404,
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

    const updatedFields: string[] = [];
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
      variantInput.price = String(regular_price);
      dbUpdate.webshop_price = regular_price;
      logChange("webshop_price", product.webshop_price, regular_price, "price_update");
      updatedFields.push("price");
    }
    if (sale_price !== undefined) {
      variantInput.compareAtPrice = sale_price !== null ? String(sale_price) : null;
      dbUpdate.sale_price = sale_price;
      logChange("sale_price", product.sale_price, sale_price, "price_update");
      updatedFields.push("compareAtPrice");
    }
    const inventoryPolicy = toInventoryPolicy(backorders);
    if (inventoryPolicy) {
      variantInput.inventoryPolicy = inventoryPolicy;
      const allowed = inventoryPolicy === "CONTINUE";
      dbUpdate.backorders_allowed = allowed;
      logChange("backorders_allowed", product.backorders_allowed, allowed, "stock_update");
      updatedFields.push("inventoryPolicy");
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
      const inventoryQuery = `#graphql
        query VariantInventory($id: ID!) {
          productVariant(id: $id) { inventoryItem { id } inventoryQuantity }
          locations(first: 1) { nodes { id } }
        }`;
      const inventoryData = await shopifyGraphql(conn.shop_domain, conn.access_token, inventoryQuery, { id: variantGid });
      const inventoryItemId = inventoryData.productVariant?.inventoryItem?.id;
      const locationId = inventoryData.locations?.nodes?.[0]?.id;
      const currentQty = inventoryData.productVariant?.inventoryQuantity ?? 0;
      const delta = Number(stock_quantity) - Number(currentQty);

      if (inventoryItemId && locationId && delta !== 0) {
        const adjustMutation = `#graphql
          mutation AdjustInventory($input: InventoryAdjustQuantitiesInput!) {
            inventoryAdjustQuantities(input: $input) {
              userErrors { field message }
            }
          }`;
        const adjustData = await shopifyGraphql(conn.shop_domain, conn.access_token, adjustMutation, {
          input: {
            name: "available",
            reason: "correction",
            changes: [{ inventoryItemId, locationId, delta }],
          },
        });
        const errors = adjustData.inventoryAdjustQuantities.userErrors;
        if (errors?.length) throw new Error(errors.map((e: { message: string }) => e.message).join(", "));
      }
      dbUpdate.stock_quantity = stock_quantity;
      logChange("stock_quantity", product.stock_quantity, stock_quantity, "stock_update");
      updatedFields.push("stock_quantity");
    }

    if (stock_status) {
      dbUpdate.stock_status = stock_status;
      logChange("stock_status", product.stock_status, stock_status, "stock_update");
      updatedFields.push("stock_status");
    }

    if (Object.keys(dbUpdate).length > 0) {
      await supabase.from("master_products").update({ ...dbUpdate, updated_at: new Date().toISOString() }).eq("id", master_product_id);
    }
    if (changeLogs.length > 0) {
      await supabase.from("product_change_log").insert(changeLogs);
    }

    return new Response(JSON.stringify({ success: true, shopify_product_id: product.shopify_product_id, shopify_variant_id: product.shopify_variant_id, updated_fields: updatedFields }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ukendt fejl";
    console.error("Shopify update error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
