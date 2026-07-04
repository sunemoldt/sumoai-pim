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
  name: "get_product",
  title: "Get product details",
  description:
    "Fetch a single master product with linked supplier offers by product id or EAN.",
  inputSchema: {
    id: z.string().uuid().optional().describe("Master product UUID."),
    ean: z.string().optional().describe("EAN (leading zeros are stripped)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ id, ean }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    if (!id && !ean) {
      return { content: [{ type: "text", text: "Provide id or ean" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("master_products")
      .select("*, supplier_products(*)")
      .limit(1);
    if (id) q = q.eq("id", id);
    else if (ean) q = q.eq("ean", ean.replace(/^0+/, ""));
    const { data, error } = await q.maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) return { content: [{ type: "text", text: "Not found" }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { product: data },
    };
  },
});
