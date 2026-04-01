import { Hono } from "hono";
import { McpServer, StreamableHttpTransport } from "mcp-lite";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const app = new Hono();

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, serviceKey);

const mcpServer = new McpServer({
  name: "comtek-pim",
  version: "1.0.0",
});

const ALL_PRODUCT_FIELDS = "id, ean, title, brand, category, sku, webshop_price, sale_price, stock_quantity, stock_status, image_url, short_description, long_description, meta_title, meta_description, webshop_product_id, webshop_platform, webshop_parent_id, backorders_allowed, custom_markup_percentage, attributes, created_at, updated_at";

// Tool: List products
mcpServer.tool({
  name: "list_products",
  description: "List all products in the PIM with all fields. Returns up to 100 products.",
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max results (default 50)" },
      offset: { type: "number", description: "Offset for pagination (default 0)" },
    },
  },
  handler: async ({ limit = 50, offset = 0 }: { limit?: number; offset?: number }) => {
    const { data, error } = await supabase
      .from("master_products")
      .select(ALL_PRODUCT_FIELDS)
      .order("title")
      .range(offset, offset + Math.min(limit, 100) - 1);
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

// Tool: Search products
mcpServer.tool({
  name: "search_products",
  description: "Search products by title, EAN, SKU, brand, or category.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search term" },
    },
    required: ["query"],
  },
  handler: async ({ query }: { query: string }) => {
    const { data, error } = await supabase
      .from("master_products")
      .select(ALL_PRODUCT_FIELDS)
      .or(`title.ilike.%${query}%,ean.ilike.%${query}%,brand.ilike.%${query}%,sku.ilike.%${query}%,category.ilike.%${query}%`)
      .limit(50);
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

// Tool: Get product with supplier details
mcpServer.tool({
  name: "get_product",
  description: "Get detailed product info including all fields and all supplier prices, stock, and descriptions. Use product ID or EAN.",
  inputSchema: {
    type: "object",
    properties: {
      product_id: { type: "string", description: "The product UUID or EAN" },
    },
    required: ["product_id"],
  },
  handler: async ({ product_id }: { product_id: string }) => {
    // Try UUID first, then EAN
    let query = supabase
      .from("master_products")
      .select("*, supplier_products(*, suppliers(name))");

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(product_id);
    if (isUuid) {
      query = query.eq("id", product_id);
    } else {
      query = query.eq("ean", product_id);
    }

    const { data, error } = await query.single();
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

// Tool: Update product
mcpServer.tool({
  name: "update_product",
  description: "Update one or more fields on a product. Provide product_id and the fields to update. Updatable fields: title, brand, category, sku, webshop_price, sale_price, stock_quantity, stock_status, image_url, short_description, long_description, meta_title, meta_description, backorders_allowed, custom_markup_percentage, attributes.",
  inputSchema: {
    type: "object",
    properties: {
      product_id: { type: "string", description: "The product UUID" },
      updates: {
        type: "object",
        description: "Object with field names and new values",
      },
    },
    required: ["product_id", "updates"],
  },
  handler: async ({ product_id, updates }: { product_id: string; updates: Record<string, any> }) => {
    const allowedFields = new Set([
      "title", "brand", "category", "sku", "webshop_price", "sale_price",
      "stock_quantity", "stock_status", "image_url", "short_description",
      "long_description", "meta_title", "meta_description", "backorders_allowed",
      "custom_markup_percentage", "attributes",
    ]);

    const filtered: Record<string, any> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (allowedFields.has(k)) filtered[k] = v;
    }

    if (Object.keys(filtered).length === 0) {
      return { content: [{ type: "text" as const, text: "Error: No valid fields to update" }] };
    }

    const { data, error } = await supabase
      .from("master_products")
      .update(filtered)
      .eq("id", product_id)
      .select(ALL_PRODUCT_FIELDS)
      .single();
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

// Tool: List suppliers
mcpServer.tool({
  name: "list_suppliers",
  description: "List all suppliers with their feed type, feed URL, schedule, sync status, and column mappings.",
  inputSchema: { type: "object", properties: {} },
  handler: async () => {
    const { data, error } = await supabase
      .from("suppliers")
      .select("*")
      .order("name");
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

// Tool: Get supplier details with products
mcpServer.tool({
  name: "get_supplier",
  description: "Get detailed supplier info including all its products with prices and stock.",
  inputSchema: {
    type: "object",
    properties: {
      supplier_id: { type: "string", description: "The supplier UUID" },
    },
    required: ["supplier_id"],
  },
  handler: async ({ supplier_id }: { supplier_id: string }) => {
    const { data, error } = await supabase
      .from("suppliers")
      .select("*, supplier_products(*, master_products(title, ean, sku))")
      .eq("id", supplier_id)
      .single();
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

// Tool: Get price info for a product
mcpServer.tool({
  name: "get_price_info",
  description: "Get price comparison across suppliers for a product, including purchase prices, recommended prices, margins, and stock levels.",
  inputSchema: {
    type: "object",
    properties: {
      product_id: { type: "string", description: "The product UUID" },
    },
    required: ["product_id"],
  },
  handler: async ({ product_id }: { product_id: string }) => {
    const { data: product } = await supabase
      .from("master_products")
      .select(ALL_PRODUCT_FIELDS)
      .eq("id", product_id)
      .single();

    const { data: supplierProducts } = await supabase
      .from("supplier_products")
      .select("*, suppliers(name)")
      .eq("master_product_id", product_id);

    const { data: settings } = await supabase
      .from("price_settings")
      .select("*")
      .eq("scope", "global")
      .maybeSingle();

    const markup = settings?.markup_percentage ?? 30;

    const result = {
      product,
      markup_percentage: markup,
      suppliers: (supplierProducts ?? []).map((sp: any) => ({
        supplier: sp.suppliers?.name,
        purchase_price_ex_vat: sp.purchase_price,
        recommended_price_incl_vat: Math.round(sp.purchase_price * (1 + markup / 100) * 1.25 * 100) / 100,
        in_stock: sp.in_stock,
        stock_quantity: sp.stock_quantity,
        supplier_sku: sp.supplier_sku,
        last_updated: sp.last_updated,
      })),
    };

    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
});

// Tool: Get price history
mcpServer.tool({
  name: "get_price_history",
  description: "Get price history for a supplier product over time.",
  inputSchema: {
    type: "object",
    properties: {
      supplier_product_id: { type: "string", description: "The supplier_product UUID" },
      limit: { type: "number", description: "Max records (default 50)" },
    },
    required: ["supplier_product_id"],
  },
  handler: async ({ supplier_product_id, limit = 50 }: { supplier_product_id: string; limit?: number }) => {
    const { data, error } = await supabase
      .from("price_history")
      .select("*")
      .eq("supplier_product_id", supplier_product_id)
      .order("recorded_at", { ascending: false })
      .limit(limit);
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

// Tool: Get change log
mcpServer.tool({
  name: "get_change_log",
  description: "Get change log for a product showing all field changes over time.",
  inputSchema: {
    type: "object",
    properties: {
      product_id: { type: "string", description: "The master product UUID" },
      limit: { type: "number", description: "Max records (default 50)" },
    },
    required: ["product_id"],
  },
  handler: async ({ product_id, limit = 50 }: { product_id: string; limit?: number }) => {
    const { data, error } = await supabase
      .from("product_change_log")
      .select("*")
      .eq("master_product_id", product_id)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

// Tool: Get price settings
mcpServer.tool({
  name: "get_price_settings",
  description: "Get all markup/margin settings (global, brand-level, product-level).",
  inputSchema: { type: "object", properties: {} },
  handler: async () => {
    const { data, error } = await supabase
      .from("price_settings")
      .select("*")
      .order("scope");
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

// Tool: Get import logs
mcpServer.tool({
  name: "get_import_logs",
  description: "Get import/sync logs showing history of data imports and their results.",
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max records (default 20)" },
    },
  },
  handler: async ({ limit = 20 }: { limit?: number }) => {
    const { data, error } = await supabase
      .from("import_logs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

// Tool: Get webhook configs
mcpServer.tool({
  name: "get_webhooks",
  description: "Get all configured webhooks for automation (n8n, Make.com, etc.).",
  inputSchema: { type: "object", properties: {} },
  handler: async () => {
    const { data, error } = await supabase
      .from("webhook_configs")
      .select("*")
      .order("name");
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

const transport = new StreamableHttpTransport();

app.all("/*", async (c) => {
  return await transport.handleRequest(c.req.raw, mcpServer);
});

Deno.serve(app.fetch);
