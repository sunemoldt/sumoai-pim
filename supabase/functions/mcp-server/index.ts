import { Hono } from "hono";
import { McpServer, StreamableHttpTransport } from "mcp-lite";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const app = new Hono();

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const mcpApiKey = Deno.env.get("MCP_API_KEY")!;
const supabase = createClient(supabaseUrl, serviceKey);

// Base URL for this edge function
const BASE_URL = `${supabaseUrl}/functions/v1/mcp-server`;

// ──────────────────────────────────────────────
// In-memory stores for OAuth (ephemeral, fine for edge function)
// ──────────────────────────────────────────────
const registeredClients = new Map<string, { client_id: string; client_secret: string; redirect_uris: string[] }>();
const authCodes = new Map<string, { client_id: string; redirect_uri: string; code_challenge?: string; expires: number }>();

function generateId(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return encodeBase64(bytes).replace(/[+/=]/g, "x");
}

// ──────────────────────────────────────────────
// OAuth 2.1 Endpoints (before auth middleware)
// ──────────────────────────────────────────────

// RFC 9728: Protected Resource Metadata
app.get("/.well-known/oauth-protected-resource", (c) => {
  return c.json({
    resource: BASE_URL,
    authorization_servers: [BASE_URL],
    bearer_methods_supported: ["header"],
  });
});

// RFC 8414: Authorization Server Metadata  
app.get("/.well-known/oauth-authorization-server", (c) => {
  return c.json({
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/authorize`,
    token_endpoint: `${BASE_URL}/token`,
    registration_endpoint: `${BASE_URL}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    code_challenge_methods_supported: ["S256", "plain"],
    scopes_supported: ["mcp:tools"],
  });
});

// RFC 7591: Dynamic Client Registration
app.post("/register", async (c) => {
  try {
    const body = await c.req.json();
    const client_id = `client_${generateId()}`;
    const client_secret = `secret_${generateId()}`;
    const redirect_uris = body.redirect_uris || [];

    registeredClients.set(client_id, { client_id, client_secret, redirect_uris });

    return c.json({
      client_id,
      client_secret,
      client_name: body.client_name || "Claude",
      redirect_uris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    }, 201);
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
});

// Authorization endpoint — auto-approves (single-tenant PIM)
app.get("/authorize", (c) => {
  const client_id = c.req.query("client_id") || "";
  const redirect_uri = c.req.query("redirect_uri") || "";
  const state = c.req.query("state") || "";
  const code_challenge = c.req.query("code_challenge");

  if (!redirect_uri) {
    return c.json({ error: "invalid_request", error_description: "redirect_uri required" }, 400);
  }

  // Generate authorization code
  const code = `code_${generateId()}`;
  authCodes.set(code, {
    client_id,
    redirect_uri,
    code_challenge,
    expires: Date.now() + 5 * 60 * 1000, // 5 minutes
  });

  // Auto-approve: redirect back with code
  const url = new URL(redirect_uri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);

  return c.redirect(url.toString(), 302);
});

// Token endpoint — exchange code for access token
app.post("/token", async (c) => {
  let body: Record<string, string>;
  const contentType = c.req.header("content-type") || "";
  
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await c.req.text();
    body = Object.fromEntries(new URLSearchParams(text));
  } else {
    body = await c.req.json();
  }

  const { grant_type, code, redirect_uri, code_verifier } = body;

  if (grant_type !== "authorization_code") {
    return c.json({ error: "unsupported_grant_type" }, 400);
  }

  if (!code) {
    return c.json({ error: "invalid_request", error_description: "code required" }, 400);
  }

  const stored = authCodes.get(code);
  if (!stored || stored.expires < Date.now()) {
    authCodes.delete(code);
    return c.json({ error: "invalid_grant", error_description: "code expired or invalid" }, 400);
  }

  // Verify PKCE if code_challenge was used
  if (stored.code_challenge && code_verifier) {
    const encoder = new TextEncoder();
    const hash = await crypto.subtle.digest("SHA-256", encoder.encode(code_verifier));
    const computed = encodeBase64(new Uint8Array(hash))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    if (computed !== stored.code_challenge) {
      return c.json({ error: "invalid_grant", error_description: "PKCE verification failed" }, 400);
    }
  }

  // Clean up used code
  authCodes.delete(code);

  // Issue access token = the MCP_API_KEY itself (so Bearer validation works)
  return c.json({
    access_token: mcpApiKey,
    token_type: "Bearer",
    expires_in: 86400 * 365, // effectively never expires
    scope: "mcp:tools",
  });
});

// ──────────────────────────────────────────────
// Auth middleware for MCP endpoints only
// ──────────────────────────────────────────────
const authMiddleware = async (c: any, next: any) => {
  const path = new URL(c.req.url).pathname;
  // Skip auth for OAuth endpoints
  const oauthPaths = ["/.well-known/", "/register", "/authorize", "/token"];
  if (oauthPaths.some(p => path.includes(p))) {
    return next();
  }

  const authHeader = c.req.header("Authorization") ?? "";

  // Option 1: API key via Bearer token (from OAuth flow or direct)
  if (mcpApiKey && authHeader === `Bearer ${mcpApiKey}`) {
    return next();
  }

  // Option 2: Valid Supabase JWT
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data, error } = await anonClient.auth.getUser(token);
    if (!error && data?.user) {
      return next();
    }
  }

  return c.json({ error: "Unauthorized" }, 401);
};

app.use("/*", authMiddleware);

// ──────────────────────────────────────────────
// MCP Server & Tools
// ──────────────────────────────────────────────

const mcpServer = new McpServer({
  name: "comtek-pim",
  version: "1.0.0",
});

const ALL_PRODUCT_FIELDS = "id, ean, title, brand, category, sku, webshop_price, sale_price, stock_quantity, stock_status, image_url, short_description, long_description, meta_title, meta_description, webshop_product_id, webshop_platform, webshop_parent_id, backorders_allowed, custom_markup_percentage, attributes, created_at, updated_at";

// Tool: List products
mcpServer.tool("list_products", {
  description: "List all products in the PIM with all fields. Returns up to 100 products.",
  inputSchema: {
    type: "object" as const,
    properties: {
      limit: { type: "number" as const, description: "Max results (default 50)" },
      offset: { type: "number" as const, description: "Offset for pagination (default 0)" },
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
mcpServer.tool("search_products", {
  description: "Search products by title, EAN, SKU, brand, or category.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: { type: "string" as const, description: "Search term" },
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
mcpServer.tool("get_product", {
  description: "Get detailed product info including all fields and all supplier prices, stock, and descriptions. Use product ID or EAN.",
  inputSchema: {
    type: "object" as const,
    properties: {
      product_id: { type: "string" as const, description: "The product UUID or EAN" },
    },
    required: ["product_id"],
  },
  handler: async ({ product_id }: { product_id: string }) => {
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
mcpServer.tool("update_product", {
  description: "Update one or more fields on a product. Provide product_id and the fields to update. Updatable fields: title, brand, category, sku, webshop_price, sale_price, stock_quantity, stock_status, image_url, short_description, long_description, meta_title, meta_description, backorders_allowed, custom_markup_percentage, attributes.",
  inputSchema: {
    type: "object" as const,
    properties: {
      product_id: { type: "string" as const, description: "The product UUID" },
      updates: {
        type: "object" as const,
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
mcpServer.tool("list_suppliers", {
  description: "List all suppliers with their feed type, feed URL, schedule, sync status, and column mappings.",
  inputSchema: { type: "object" as const, properties: {} },
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
mcpServer.tool("get_supplier", {
  description: "Get detailed supplier info including all its products with prices and stock.",
  inputSchema: {
    type: "object" as const,
    properties: {
      supplier_id: { type: "string" as const, description: "The supplier UUID" },
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
mcpServer.tool("get_price_info", {
  description: "Get price comparison across suppliers for a product, including purchase prices, recommended prices, margins, and stock levels.",
  inputSchema: {
    type: "object" as const,
    properties: {
      product_id: { type: "string" as const, description: "The product UUID" },
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
mcpServer.tool("get_price_history", {
  description: "Get price history for a supplier product over time.",
  inputSchema: {
    type: "object" as const,
    properties: {
      supplier_product_id: { type: "string" as const, description: "The supplier_product UUID" },
      limit: { type: "number" as const, description: "Max records (default 50)" },
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
mcpServer.tool("get_change_log", {
  description: "Get change log for a product showing all field changes over time.",
  inputSchema: {
    type: "object" as const,
    properties: {
      product_id: { type: "string" as const, description: "The master product UUID" },
      limit: { type: "number" as const, description: "Max records (default 50)" },
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
mcpServer.tool("get_price_settings", {
  description: "Get all markup/margin settings (global, brand-level, product-level).",
  inputSchema: { type: "object" as const, properties: {} },
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
mcpServer.tool("get_import_logs", {
  description: "Get import/sync logs showing history of data imports and their results.",
  inputSchema: {
    type: "object" as const,
    properties: {
      limit: { type: "number" as const, description: "Max records (default 20)" },
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
mcpServer.tool("get_webhooks", {
  description: "Get all configured webhooks for automation (n8n, Make.com, etc.).",
  inputSchema: { type: "object" as const, properties: {} },
  handler: async () => {
    const { data, error } = await supabase
      .from("webhook_configs")
      .select("*")
      .order("name");
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

// Tool: Get product analytics
mcpServer.tool("get_product_analytics", {
  description: "Get performance analytics (GA4 + GSC) for a product or all products. Includes page views, conversions, Google position, CTR.",
  inputSchema: {
    type: "object" as const,
    properties: {
      product_id: { type: "string" as const, description: "Optional: specific product ID. Omit for all." },
      limit: { type: "number" as const, description: "Max results (default 50)" },
    },
  },
  handler: async ({ product_id, limit = 50 }: { product_id?: string; limit?: number }) => {
    let query = supabase.from("product_analytics").select("*").order("period_start", { ascending: false }).limit(limit);
    if (product_id) query = query.eq("master_product_id", product_id);
    const { data, error } = await query;
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

// Tool: Get product recommendations
mcpServer.tool("get_recommendations", {
  description: "Get active action recommendations (e.g. high traffic no sales, low stock alerts, SEO tips).",
  inputSchema: {
    type: "object" as const,
    properties: {
      product_id: { type: "string" as const, description: "Optional: filter by product ID" },
      severity: { type: "string" as const, description: "Optional: filter by severity (critical, warning, info)" },
    },
  },
  handler: async ({ product_id, severity }: { product_id?: string; severity?: string }) => {
    let query = supabase.from("product_recommendations").select("*").eq("is_dismissed", false).is("resolved_at", null).order("created_at", { ascending: false });
    if (product_id) query = query.eq("master_product_id", product_id);
    if (severity) query = query.eq("severity", severity);
    const { data, error } = await query;
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

// Tool: Trigger analytics sync
mcpServer.tool("sync_analytics", {
  description: "Trigger a manual sync of Google Analytics 4 and Search Console data.",
  inputSchema: { type: "object" as const, properties: {} },
  handler: async () => {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/fetch-analytics`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
      });
      const data = await res.json();
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
    }
  },
});

// ──────────────────────────────────────────────
// Transport & Serve
// ──────────────────────────────────────────────
const transport = new StreamableHttpTransport();
const httpHandler = transport.bind(mcpServer);

app.all("/*", async (c) => {
  return await httpHandler(c.req.raw);
});

Deno.serve(app.fetch);
