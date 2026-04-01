import { McpServer, StreamableHttpTransport } from "mcp-lite";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const mcpApiKey = Deno.env.get("MCP_API_KEY")!;
const supabase = createClient(supabaseUrl, serviceKey);

const BASE_URL = `${supabaseUrl}/functions/v1/mcp-server`;

// ── Helpers for self-contained signed OAuth codes ──
function generateId(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return encodeBase64(bytes).replace(/[+/=]/g, "x");
}

async function signCode(payload: Record<string, string>): Promise<string> {
  const data = JSON.stringify({ ...payload, exp: Date.now() + 5 * 60 * 1000 });
  const encoded = encodeBase64(new TextEncoder().encode(data));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(mcpApiKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = encodeBase64(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded))));
  return `${encoded}.${sig}`.replace(/[+/=]/g, "x");
}

async function verifyCode(code: string): Promise<Record<string, string> | null> {
  // Restore base64 chars
  const restored = code.replace(/x/g, "=");
  const dotIdx = restored.lastIndexOf(".");
  if (dotIdx === -1) return null;
  // Can't reliably split on dot after base64 restore, use original
  const parts = code.split(".");
  if (parts.length < 2) return null;
  const encodedPart = parts.slice(0, -1).join(".");
  const sigPart = parts[parts.length - 1];
  
  // Re-derive the encoded and sig with proper base64
  const encodedRestored = encodedPart.replace(/x/g, "=");
  const sigRestored = sigPart.replace(/x/g, "=");
  
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(mcpApiKey), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    // We need to verify against the original encoded string (before x replacement)
    // Actually let's simplify: just use a delimiter that won't conflict
  } catch { return null; }
  return null;
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

// ── OAuth Handlers ──

function handleProtectedResource() {
  return jsonResponse({
    resource: BASE_URL,
    authorization_servers: [BASE_URL],
    bearer_methods_supported: ["header"],
  });
}

function handleAuthServerMetadata() {
  return jsonResponse({
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
}

async function handleRegister(req: Request) {
  try {
    const body = await req.json();
    const client_id = `client_${generateId()}`;
    const client_secret = `secret_${generateId()}`;
    const redirect_uris = body.redirect_uris || [];
    registeredClients.set(client_id, { client_id, client_secret, redirect_uris });
    return jsonResponse({
      client_id,
      client_secret,
      client_name: body.client_name || "Claude",
      redirect_uris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    }, 201);
  } catch {
    return jsonResponse({ error: "invalid_request" }, 400);
  }
}

function handleAuthorize(url: URL) {
  const client_id = url.searchParams.get("client_id") || "";
  const redirect_uri = url.searchParams.get("redirect_uri") || "";
  const state = url.searchParams.get("state") || "";
  const code_challenge = url.searchParams.get("code_challenge") || undefined;

  if (!redirect_uri) {
    return jsonResponse({ error: "invalid_request", error_description: "redirect_uri required" }, 400);
  }

  const code = `code_${generateId()}`;
  authCodes.set(code, { client_id, redirect_uri, code_challenge, expires: Date.now() + 5 * 60 * 1000 });

  const redir = new URL(redirect_uri);
  redir.searchParams.set("code", code);
  if (state) redir.searchParams.set("state", state);

  return new Response(null, { status: 302, headers: { Location: redir.toString() } });
}

async function handleToken(req: Request) {
  let body: Record<string, string>;
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/x-www-form-urlencoded")) {
    body = Object.fromEntries(new URLSearchParams(await req.text()));
  } else {
    body = await req.json();
  }

  if (body.grant_type !== "authorization_code") {
    return jsonResponse({ error: "unsupported_grant_type" }, 400);
  }
  if (!body.code) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  const stored = authCodes.get(body.code);
  if (!stored || stored.expires < Date.now()) {
    authCodes.delete(body.code);
    return jsonResponse({ error: "invalid_grant" }, 400);
  }

  // PKCE verification
  if (stored.code_challenge && body.code_verifier) {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.code_verifier));
    const computed = encodeBase64(new Uint8Array(hash)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    if (computed !== stored.code_challenge) {
      return jsonResponse({ error: "invalid_grant", error_description: "PKCE failed" }, 400);
    }
  }

  authCodes.delete(body.code);
  return jsonResponse({
    access_token: mcpApiKey,
    token_type: "Bearer",
    expires_in: 86400 * 365,
    scope: "mcp:tools",
  });
}

// ── Auth check ──
function isAuthorized(req: Request): boolean {
  const auth = req.headers.get("Authorization") || "";
  if (mcpApiKey && auth === `Bearer ${mcpApiKey}`) return true;
  return false;
}

// ── MCP Server ──
const mcpServer = new McpServer({ name: "comtek-pim", version: "1.0.0" });
const ALL_PRODUCT_FIELDS = "id, ean, title, brand, category, sku, webshop_price, sale_price, stock_quantity, stock_status, image_url, short_description, long_description, meta_title, meta_description, webshop_product_id, webshop_platform, webshop_parent_id, backorders_allowed, custom_markup_percentage, attributes, created_at, updated_at";

mcpServer.tool("list_products", {
  description: "List all products in the PIM with all fields. Returns up to 100 products.",
  inputSchema: { type: "object" as const, properties: { limit: { type: "number" as const, description: "Max results (default 50)" }, offset: { type: "number" as const, description: "Offset for pagination (default 0)" } } },
  handler: async ({ limit = 50, offset = 0 }: { limit?: number; offset?: number }) => {
    const { data, error } = await supabase.from("master_products").select(ALL_PRODUCT_FIELDS).order("title").range(offset, offset + Math.min(limit, 100) - 1);
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("search_products", {
  description: "Search products by title, EAN, SKU, brand, or category.",
  inputSchema: { type: "object" as const, properties: { query: { type: "string" as const, description: "Search term" } }, required: ["query"] },
  handler: async ({ query }: { query: string }) => {
    const { data, error } = await supabase.from("master_products").select(ALL_PRODUCT_FIELDS).or(`title.ilike.%${query}%,ean.ilike.%${query}%,brand.ilike.%${query}%,sku.ilike.%${query}%,category.ilike.%${query}%`).limit(50);
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("get_product", {
  description: "Get detailed product info including all fields and all supplier prices, stock, and descriptions. Use product ID or EAN.",
  inputSchema: { type: "object" as const, properties: { product_id: { type: "string" as const, description: "The product UUID or EAN" } }, required: ["product_id"] },
  handler: async ({ product_id }: { product_id: string }) => {
    let query = supabase.from("master_products").select("*, supplier_products(*, suppliers(name))");
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(product_id);
    query = isUuid ? query.eq("id", product_id) : query.eq("ean", product_id);
    const { data, error } = await query.single();
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("update_product", {
  description: "Update one or more fields on a product. Updatable: title, brand, category, sku, webshop_price, sale_price, stock_quantity, stock_status, image_url, short_description, long_description, meta_title, meta_description, backorders_allowed, custom_markup_percentage, attributes.",
  inputSchema: { type: "object" as const, properties: { product_id: { type: "string" as const, description: "The product UUID" }, updates: { type: "object" as const, description: "Object with field names and new values" } }, required: ["product_id", "updates"] },
  handler: async ({ product_id, updates }: { product_id: string; updates: Record<string, any> }) => {
    const allowed = new Set(["title", "brand", "category", "sku", "webshop_price", "sale_price", "stock_quantity", "stock_status", "image_url", "short_description", "long_description", "meta_title", "meta_description", "backorders_allowed", "custom_markup_percentage", "attributes"]);
    const filtered: Record<string, any> = {};
    for (const [k, v] of Object.entries(updates)) { if (allowed.has(k)) filtered[k] = v; }
    if (!Object.keys(filtered).length) return { content: [{ type: "text" as const, text: "Error: No valid fields to update" }] };
    const { data, error } = await supabase.from("master_products").update(filtered).eq("id", product_id).select(ALL_PRODUCT_FIELDS).single();
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("list_suppliers", {
  description: "List all suppliers with their feed type, feed URL, schedule, sync status, and column mappings.",
  inputSchema: { type: "object" as const, properties: {} },
  handler: async () => {
    const { data, error } = await supabase.from("suppliers").select("*").order("name");
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("get_supplier", {
  description: "Get detailed supplier info including all its products with prices and stock.",
  inputSchema: { type: "object" as const, properties: { supplier_id: { type: "string" as const, description: "The supplier UUID" } }, required: ["supplier_id"] },
  handler: async ({ supplier_id }: { supplier_id: string }) => {
    const { data, error } = await supabase.from("suppliers").select("*, supplier_products(*, master_products(title, ean, sku))").eq("id", supplier_id).single();
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("get_price_info", {
  description: "Get price comparison across suppliers for a product.",
  inputSchema: { type: "object" as const, properties: { product_id: { type: "string" as const, description: "The product UUID" } }, required: ["product_id"] },
  handler: async ({ product_id }: { product_id: string }) => {
    const { data: product } = await supabase.from("master_products").select(ALL_PRODUCT_FIELDS).eq("id", product_id).single();
    const { data: sp } = await supabase.from("supplier_products").select("*, suppliers(name)").eq("master_product_id", product_id);
    const { data: settings } = await supabase.from("price_settings").select("*").eq("scope", "global").maybeSingle();
    const markup = settings?.markup_percentage ?? 30;
    const result = { product, markup_percentage: markup, suppliers: (sp ?? []).map((s: any) => ({ supplier: s.suppliers?.name, purchase_price_ex_vat: s.purchase_price, recommended_price_incl_vat: Math.round(s.purchase_price * (1 + markup / 100) * 1.25 * 100) / 100, in_stock: s.in_stock, stock_quantity: s.stock_quantity, supplier_sku: s.supplier_sku, last_updated: s.last_updated })) };
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
});

mcpServer.tool("get_price_history", {
  description: "Get price history for a supplier product over time.",
  inputSchema: { type: "object" as const, properties: { supplier_product_id: { type: "string" as const, description: "The supplier_product UUID" }, limit: { type: "number" as const, description: "Max records (default 50)" } }, required: ["supplier_product_id"] },
  handler: async ({ supplier_product_id, limit = 50 }: { supplier_product_id: string; limit?: number }) => {
    const { data, error } = await supabase.from("price_history").select("*").eq("supplier_product_id", supplier_product_id).order("recorded_at", { ascending: false }).limit(limit);
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("get_change_log", {
  description: "Get change log for a product showing all field changes over time.",
  inputSchema: { type: "object" as const, properties: { product_id: { type: "string" as const, description: "The master product UUID" }, limit: { type: "number" as const, description: "Max records (default 50)" } }, required: ["product_id"] },
  handler: async ({ product_id, limit = 50 }: { product_id: string; limit?: number }) => {
    const { data, error } = await supabase.from("product_change_log").select("*").eq("master_product_id", product_id).order("created_at", { ascending: false }).limit(limit);
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("get_price_settings", {
  description: "Get all markup/margin settings (global, brand-level, product-level).",
  inputSchema: { type: "object" as const, properties: {} },
  handler: async () => {
    const { data, error } = await supabase.from("price_settings").select("*").order("scope");
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("get_import_logs", {
  description: "Get import/sync logs showing history of data imports and their results.",
  inputSchema: { type: "object" as const, properties: { limit: { type: "number" as const, description: "Max records (default 20)" } } },
  handler: async ({ limit = 20 }: { limit?: number }) => {
    const { data, error } = await supabase.from("import_logs").select("*").order("started_at", { ascending: false }).limit(limit);
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("get_webhooks", {
  description: "Get all configured webhooks for automation (n8n, Make.com, etc.).",
  inputSchema: { type: "object" as const, properties: {} },
  handler: async () => {
    const { data, error } = await supabase.from("webhook_configs").select("*").order("name");
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("get_product_analytics", {
  description: "Get performance analytics (GA4 + GSC) for a product or all products.",
  inputSchema: { type: "object" as const, properties: { product_id: { type: "string" as const, description: "Optional: specific product ID" }, limit: { type: "number" as const, description: "Max results (default 50)" } } },
  handler: async ({ product_id, limit = 50 }: { product_id?: string; limit?: number }) => {
    let query = supabase.from("product_analytics").select("*").order("period_start", { ascending: false }).limit(limit);
    if (product_id) query = query.eq("master_product_id", product_id);
    const { data, error } = await query;
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("get_recommendations", {
  description: "Get active action recommendations (e.g. high traffic no sales, low stock alerts, SEO tips).",
  inputSchema: { type: "object" as const, properties: { product_id: { type: "string" as const, description: "Optional: filter by product ID" }, severity: { type: "string" as const, description: "Optional: filter by severity (critical, warning, info)" } } },
  handler: async ({ product_id, severity }: { product_id?: string; severity?: string }) => {
    let query = supabase.from("product_recommendations").select("*").eq("is_dismissed", false).is("resolved_at", null).order("created_at", { ascending: false });
    if (product_id) query = query.eq("master_product_id", product_id);
    if (severity) query = query.eq("severity", severity);
    const { data, error } = await query;
    if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("sync_analytics", {
  description: "Trigger a manual sync of Google Analytics 4 and Search Console data.",
  inputSchema: { type: "object" as const, properties: {} },
  handler: async () => {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/fetch-analytics`, { method: "POST", headers: { "Authorization": `Bearer ${serviceKey}`, "Content-Type": "application/json" } });
      const data = await res.json();
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
    }
  },
});

// ── Transport ──
const transport = new StreamableHttpTransport();
const mcpHandler = transport.bind(mcpServer);

// ── Main Request Handler (manual routing) ──
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  // Strip the function prefix — Supabase passes full path like /mcp-server/.well-known/...
  const path = url.pathname.replace(/^\/mcp-server/, "");

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey, accept, mcp-session-id",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      },
    });
  }

  // OAuth routes (no auth required)
  if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/") {
    return handleProtectedResource();
  }
  if (path === "/.well-known/oauth-authorization-server" || path === "/.well-known/oauth-authorization-server/") {
    return handleAuthServerMetadata();
  }
  if (path === "/register" || path === "/register/") {
    if (req.method === "POST") return handleRegister(req);
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }
  if (path === "/authorize" || path === "/authorize/") {
    return handleAuthorize(url);
  }
  if (path === "/token" || path === "/token/") {
    if (req.method === "POST") return handleToken(req);
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  // All other routes = MCP protocol — require auth
  if (!isAuthorized(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  return mcpHandler(req);
});
