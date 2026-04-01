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

// Tool: List products
mcpServer.tool({
  name: "list_products",
  description: "List all products in the PIM with title, EAN, brand, webshop price, stock, and SKU. Returns up to 100 products.",
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
      .select("id, title, ean, brand, category, sku, webshop_price, stock_quantity, stock_status, updated_at")
      .order("title")
      .range(offset, offset + Math.min(limit, 100) - 1);
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

// Tool: Search products
mcpServer.tool({
  name: "search_products",
  description: "Search products by title, EAN, SKU, or brand.",
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
      .select("id, title, ean, brand, category, sku, webshop_price, stock_quantity, stock_status")
      .or(`title.ilike.%${query}%,ean.ilike.%${query}%,brand.ilike.%${query}%,sku.ilike.%${query}%`)
      .limit(50);
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

// Tool: Get product with supplier details
mcpServer.tool({
  name: "get_product",
  description: "Get detailed product info including all supplier prices, stock, and descriptions. Use product ID.",
  inputSchema: {
    type: "object",
    properties: {
      product_id: { type: "string", description: "The product UUID" },
    },
    required: ["product_id"],
  },
  handler: async ({ product_id }: { product_id: string }) => {
    const { data, error } = await supabase
      .from("master_products")
      .select("*, supplier_products(*, suppliers(name))")
      .eq("id", product_id)
      .single();
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

// Tool: List suppliers
mcpServer.tool({
  name: "list_suppliers",
  description: "List all suppliers with their feed type, schedule, and sync status.",
  inputSchema: { type: "object", properties: {} },
  handler: async () => {
    const { data, error } = await supabase
      .from("suppliers")
      .select("id, name, feed_type, feed_url, feed_schedule, is_active, last_sync_at")
      .order("name");
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
      .select("id, title, ean, webshop_price, stock_quantity")
      .eq("id", product_id)
      .single();

    const { data: supplierProducts } = await supabase
      .from("supplier_products")
      .select("purchase_price, in_stock, stock_quantity, supplier_sku, last_updated, suppliers(name)")
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
        last_updated: sp.last_updated,
      })),
    };

    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
});

const transport = new StreamableHttpTransport();

app.all("/*", async (c) => {
  return await transport.handleRequest(c.req.raw, mcpServer);
});

Deno.serve(app.fetch);
