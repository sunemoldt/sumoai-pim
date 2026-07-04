import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export default defineTool({
  name: "search_products",
  title: "Search products",
  description:
    "Search master products in the PIM by title, EAN, brand or SKU. Returns up to 20 matches.",
  inputSchema: {
    query: z.string().trim().min(1).describe("Search term (title, EAN, brand or SKU)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const normalizedEan = query.replace(/^0+/, "");
    const { data, error } = await supabase
      .from("master_products")
      .select(
        "id,title,ean,brand,sku,webshop_price,sale_price,stock_quantity,stock_status,lifecycle_status",
      )
      .or(
        `title.ilike.%${query}%,ean.eq.${normalizedEan},brand.ilike.%${query}%,sku.ilike.%${query}%`,
      )
      .limit(20);
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { products: data ?? [] },
    };
  },
});
