import { McpServer, StreamableHttpTransport } from "mcp-lite";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const mcpApiKey = Deno.env.get("MCP_API_KEY")!;
const supabase = createClient(supabaseUrl, serviceKey);
const BASE_URL = `${supabaseUrl}/functions/v1/mcp-server`;

// ── Helpers ──
function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  return bytes;
}

function truncate(value: string | null, max = 160): string | null {
  if (!value) return null;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function safeUrlHost(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return "invalid";
  }
}

function summarizeSecret(value: string | null): string | null {
  if (!value) return null;
  const [scheme, token] = value.split(/\s+/, 2);
  if (!token) return `present(len=${value.length})`;
  return `${scheme}(len=${token.length})`;
}

function logEvent(event: Record<string, unknown>) {
  console.log(JSON.stringify({ source: "mcp-server", ...event }));
}

function logRequest(req: Request, path: string) {
  const url = new URL(req.url);
  logEvent({
    event: "mcp_request",
    method: req.method,
    path,
    queryKeys: [...url.searchParams.keys()],
    headers: {
      accept: truncate(req.headers.get("accept")),
      contentType: truncate(req.headers.get("content-type")),
      userAgent: truncate(req.headers.get("user-agent")),
      origin: truncate(req.headers.get("origin")),
      referer: truncate(req.headers.get("referer")),
      authorization: summarizeSecret(req.headers.get("authorization")),
      apikey: summarizeSecret(req.headers.get("apikey")),
      mcpSessionId: truncate(req.headers.get("mcp-session-id")),
      xClientInfo: truncate(req.headers.get("x-client-info")),
    },
  });
}

async function logRpcRequest(req: Request, path: string) {
  if (req.method !== "POST" || (path !== "/" && path !== "")) return;
  try {
    const body = await req.clone().json();
    const params = body?.params && typeof body.params === "object" ? body.params : null;
    const args = params?.arguments && typeof params.arguments === "object" ? params.arguments : null;

    logEvent({
      event: "mcp_rpc_request",
      jsonrpcMethod: typeof body?.method === "string" ? body.method : null,
      toolName: body?.method === "tools/call" && typeof params?.name === "string" ? params.name : null,
      paramKeys: params ? Object.keys(params).slice(0, 10) : [],
      argumentKeys: args ? Object.keys(args).slice(0, 10) : [],
    });
  } catch {
    // Ignore non-JSON bodies
  }
}

function withLoggedResponse(req: Request, path: string, response: Response, extra: Record<string, unknown> = {}) {
  logEvent({
    event: "mcp_response",
    method: req.method,
    path,
    status: response.status,
    contentType: truncate(response.headers.get("content-type")),
    ...extra,
  });
  return response;
}

async function createSignedCode(payload: Record<string, string>): Promise<string> {
  const data = JSON.stringify({ ...payload, exp: String(Date.now() + 5 * 60 * 1000) });
  const dataHex = toHex(new TextEncoder().encode(data).buffer);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(mcpApiKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(dataHex)));
  return `${dataHex}:${sig}`;
}

async function verifySignedCode(code: string): Promise<Record<string, string> | null> {
  const colonIdx = code.lastIndexOf(":");
  if (colonIdx === -1) return null;
  const dataHex = code.substring(0, colonIdx);
  const sig = code.substring(colonIdx + 1);
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(mcpApiKey), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key, fromHex(sig), new TextEncoder().encode(dataHex));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromHex(dataHex)));
    if (Number(payload.exp) < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, accept, mcp-session-id, x-client-info, apikey",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "WWW-Authenticate",
};

function jsonResponse(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...headers },
  });
}

function unauthorizedResponse() {
  return jsonResponse(
    { error: "Unauthorized" },
    401,
    {
      "WWW-Authenticate": `Bearer realm="mcp", scope="mcp:tools", resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`,
    },
  );
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
    const redirectUris = Array.isArray(body.redirect_uris)
      ? body.redirect_uris.filter((value: unknown): value is string => typeof value === "string")
      : [];

    logEvent({
      event: "oauth_register",
      clientName: typeof body.client_name === "string" ? body.client_name : null,
      redirectUriHosts: redirectUris.map((uri) => safeUrlHost(uri)),
      requestedAuthMethod: typeof body.token_endpoint_auth_method === "string" ? body.token_endpoint_auth_method : null,
    });

    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const client_id = `client_${toHex(bytes.buffer)}`;
    crypto.getRandomValues(bytes);
    const client_secret = `secret_${toHex(bytes.buffer)}`;

    return jsonResponse({
      client_id,
      client_secret,
      client_name: typeof body.client_name === "string" ? body.client_name : "Claude",
      redirect_uris: redirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    }, 201);
  } catch {
    logEvent({ event: "oauth_register_error", reason: "invalid_request" });
    return jsonResponse({ error: "invalid_request" }, 400);
  }
}

async function handleAuthorize(url: URL) {
  const redirect_uri = url.searchParams.get("redirect_uri") || "";
  const state = url.searchParams.get("state") || "";
  const client_id = url.searchParams.get("client_id") || "";
  const code_challenge = url.searchParams.get("code_challenge") || "";
  const code_challenge_method = url.searchParams.get("code_challenge_method") || "S256";
  const response_type = url.searchParams.get("response_type") || "";

  logEvent({
    event: "oauth_authorize",
    clientIdPresent: Boolean(client_id),
    redirectUriHost: safeUrlHost(redirect_uri),
    responseType: response_type || null,
    hasState: Boolean(state),
    hasCodeChallenge: Boolean(code_challenge),
    codeChallengeMethod: code_challenge_method,
  });

  if (!redirect_uri) {
    return jsonResponse({ error: "invalid_request", error_description: "redirect_uri required" }, 400);
  }

  const code = await createSignedCode({ client_id, redirect_uri, code_challenge, code_challenge_method });

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

  logEvent({
    event: "oauth_token",
    contentType: truncate(ct),
    grantType: body.grant_type || null,
    hasCode: Boolean(body.code),
    hasCodeVerifier: Boolean(body.code_verifier),
    hasClientId: Boolean(body.client_id),
    hasClientSecret: Boolean(body.client_secret),
    redirectUriHost: safeUrlHost(body.redirect_uri),
  });

  if (body.grant_type !== "authorization_code") {
    logEvent({ event: "oauth_token_error", reason: "unsupported_grant_type" });
    return jsonResponse({ error: "unsupported_grant_type" }, 400);
  }
  if (!body.code) {
    logEvent({ event: "oauth_token_error", reason: "missing_code" });
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  const payload = await verifySignedCode(body.code);
  if (!payload) {
    logEvent({ event: "oauth_token_error", reason: "invalid_or_expired_code" });
    return jsonResponse({ error: "invalid_grant", error_description: "Invalid or expired code" }, 400);
  }

  // PKCE verification
  if (payload.code_challenge && body.code_verifier) {
    let computed: string;
    if (payload.code_challenge_method === "plain") {
      computed = body.code_verifier;
    } else {
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.code_verifier));
      computed = btoa(String.fromCharCode(...new Uint8Array(hash)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    }
    if (computed !== payload.code_challenge) {
      logEvent({
        event: "oauth_token_error",
        reason: "pkce_failed",
        codeChallengeMethod: payload.code_challenge_method || "S256",
      });
      return jsonResponse({ error: "invalid_grant", error_description: "PKCE failed" }, 400);
    }
  }

  logEvent({ event: "oauth_token_success", codeChallengeMethod: payload.code_challenge_method || null });

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
  return mcpApiKey ? auth === `Bearer ${mcpApiKey}` : false;
}

// ── MCP Server & Tools ──
const mcpServer = new McpServer({ name: "comtek-pim", version: "1.0.0" });
const ALL = "id, ean, title, brand, category, sku, webshop_price, sale_price, stock_quantity, stock_status, image_url, short_description, long_description, meta_title, meta_description, webshop_product_id, webshop_platform, webshop_parent_id, backorders_allowed, custom_markup_percentage, attributes, created_at, updated_at";

mcpServer.tool("list_products", {
  description: "List all products in the PIM. Returns up to 100 products.",
  inputSchema: { type: "object" as const, properties: { limit: { type: "number" as const }, offset: { type: "number" as const } } },
  handler: async ({ limit = 50, offset = 0 }: any) => {
    const { data, error } = await supabase.from("master_products").select(ALL).order("title").range(offset, offset + Math.min(limit, 100) - 1);
    return { content: [{ type: "text" as const, text: error ? `Error: ${error.message}` : JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("search_products", {
  description: "Search products by title, EAN, SKU, brand, or category.",
  inputSchema: { type: "object" as const, properties: { query: { type: "string" as const } }, required: ["query"] },
  handler: async ({ query }: any) => {
    const { data, error } = await supabase.from("master_products").select(ALL).or(`title.ilike.%${query}%,ean.ilike.%${query}%,brand.ilike.%${query}%,sku.ilike.%${query}%,category.ilike.%${query}%`).limit(50);
    return { content: [{ type: "text" as const, text: error ? `Error: ${error.message}` : JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("get_product", {
  description: "Get detailed product info with supplier prices and stock. Use product ID or EAN.",
  inputSchema: { type: "object" as const, properties: { product_id: { type: "string" as const } }, required: ["product_id"] },
  handler: async ({ product_id }: any) => {
    let q = supabase.from("master_products").select("*, supplier_products(*, suppliers(name))");
    q = /^[0-9a-f]{8}-/.test(product_id) ? q.eq("id", product_id) : q.eq("ean", product_id);
    const { data, error } = await q.single();
    return { content: [{ type: "text" as const, text: error ? `Error: ${error.message}` : JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("update_product", {
  description: "Update fields on a product. Updatable: title, brand, category, sku, webshop_price, sale_price, stock_quantity, stock_status, image_url, short_description, long_description, meta_title, meta_description, backorders_allowed, custom_markup_percentage, attributes.",
  inputSchema: { type: "object" as const, properties: { product_id: { type: "string" as const }, updates: { type: "object" as const } }, required: ["product_id", "updates"] },
  handler: async ({ product_id, updates }: any) => {
    const allowed = new Set(["title", "brand", "category", "sku", "webshop_price", "sale_price", "stock_quantity", "stock_status", "image_url", "short_description", "long_description", "meta_title", "meta_description", "backorders_allowed", "custom_markup_percentage", "attributes"]);
    const f: any = {};
    for (const [k, v] of Object.entries(updates)) {
      if (allowed.has(k)) f[k] = v;
    }
    if (!Object.keys(f).length) return { content: [{ type: "text" as const, text: "No valid fields" }] };
    const { data, error } = await supabase.from("master_products").update(f).eq("id", product_id).select(ALL).single();
    return { content: [{ type: "text" as const, text: error ? `Error: ${error.message}` : JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("list_suppliers", {
  description: "List all suppliers.",
  inputSchema: { type: "object" as const, properties: {} },
  handler: async () => {
    const { data, error } = await supabase.from("suppliers").select("*").order("name");
    return { content: [{ type: "text" as const, text: error ? `Error: ${error.message}` : JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("get_supplier", {
  description: "Get supplier details with products.",
  inputSchema: { type: "object" as const, properties: { supplier_id: { type: "string" as const } }, required: ["supplier_id"] },
  handler: async ({ supplier_id }: any) => {
    const { data, error } = await supabase.from("suppliers").select("*, supplier_products(*, master_products(title, ean, sku))").eq("id", supplier_id).single();
    return { content: [{ type: "text" as const, text: error ? `Error: ${error.message}` : JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("get_price_info", {
  description: "Get price comparison across suppliers for a product.",
  inputSchema: { type: "object" as const, properties: { product_id: { type: "string" as const } }, required: ["product_id"] },
  handler: async ({ product_id }: any) => {
    const { data: product } = await supabase.from("master_products").select(ALL).eq("id", product_id).single();
    const { data: sp } = await supabase.from("supplier_products").select("*, suppliers(name)").eq("master_product_id", product_id);
    const { data: s } = await supabase.from("price_settings").select("*").eq("scope", "global").maybeSingle();
    const m = s?.markup_percentage ?? 30;
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          product,
          markup_percentage: m,
          suppliers: (sp ?? []).map((x: any) => ({
            supplier: x.suppliers?.name,
            purchase_price: x.purchase_price,
            recommended_price: Math.round(x.purchase_price * (1 + m / 100) * 1.25 * 100) / 100,
            in_stock: x.in_stock,
            stock_quantity: x.stock_quantity,
          })),
        }, null, 2),
      }],
    };
  },
});

mcpServer.tool("get_price_history", {
  description: "Get price history for a supplier product.",
  inputSchema: { type: "object" as const, properties: { supplier_product_id: { type: "string" as const }, limit: { type: "number" as const } }, required: ["supplier_product_id"] },
  handler: async ({ supplier_product_id, limit = 50 }: any) => {
    const { data, error } = await supabase.from("price_history").select("*").eq("supplier_product_id", supplier_product_id).order("recorded_at", { ascending: false }).limit(limit);
    return { content: [{ type: "text" as const, text: error ? `Error: ${error.message}` : JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("get_change_log", {
  description: "Get change log for a product.",
  inputSchema: { type: "object" as const, properties: { product_id: { type: "string" as const }, limit: { type: "number" as const } }, required: ["product_id"] },
  handler: async ({ product_id, limit = 50 }: any) => {
    const { data, error } = await supabase.from("product_change_log").select("*").eq("master_product_id", product_id).order("created_at", { ascending: false }).limit(limit);
    return { content: [{ type: "text" as const, text: error ? `Error: ${error.message}` : JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("get_price_settings", {
  description: "Get all markup/margin settings.",
  inputSchema: { type: "object" as const, properties: {} },
  handler: async () => {
    const { data, error } = await supabase.from("price_settings").select("*").order("scope");
    return { content: [{ type: "text" as const, text: error ? `Error: ${error.message}` : JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("get_import_logs", {
  description: "Get import/sync logs.",
  inputSchema: { type: "object" as const, properties: { limit: { type: "number" as const } } },
  handler: async ({ limit = 20 }: any) => {
    const { data, error } = await supabase.from("import_logs").select("*").order("started_at", { ascending: false }).limit(limit);
    return { content: [{ type: "text" as const, text: error ? `Error: ${error.message}` : JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("get_webhooks", {
  description: "Get all configured webhooks.",
  inputSchema: { type: "object" as const, properties: {} },
  handler: async () => {
    const { data, error } = await supabase.from("webhook_configs").select("*").order("name");
    return { content: [{ type: "text" as const, text: error ? `Error: ${error.message}` : JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("get_product_analytics", {
  description: "Get performance analytics (GA4 + GSC) for products.",
  inputSchema: { type: "object" as const, properties: { product_id: { type: "string" as const }, limit: { type: "number" as const } } },
  handler: async ({ product_id, limit = 50 }: any) => {
    let q = supabase.from("product_analytics").select("*").order("period_start", { ascending: false }).limit(limit);
    if (product_id) q = q.eq("master_product_id", product_id);
    const { data, error } = await q;
    return { content: [{ type: "text" as const, text: error ? `Error: ${error.message}` : JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("get_recommendations", {
  description: "Get active action recommendations.",
  inputSchema: { type: "object" as const, properties: { product_id: { type: "string" as const }, severity: { type: "string" as const } } },
  handler: async ({ product_id, severity }: any) => {
    let q = supabase.from("product_recommendations").select("*").eq("is_dismissed", false).is("resolved_at", null).order("created_at", { ascending: false });
    if (product_id) q = q.eq("master_product_id", product_id);
    if (severity) q = q.eq("severity", severity);
    const { data, error } = await q;
    return { content: [{ type: "text" as const, text: error ? `Error: ${error.message}` : JSON.stringify(data, null, 2) }] };
  },
});

mcpServer.tool("sync_analytics", {
  description: "Trigger analytics sync.",
  inputSchema: { type: "object" as const, properties: {} },
  handler: async () => {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/fetch-analytics`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      });
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

// ── Main Handler ──
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const rawPath = url.pathname.replace(/^\/mcp-server/, "");
  const path = rawPath === "" ? "/" : rawPath;

  logRequest(req, path);
  await logRpcRequest(req, path);

  if (req.method === "OPTIONS") {
    return withLoggedResponse(req, path, new Response(null, { headers: corsHeaders }), { route: "preflight" });
  }

  // OAuth routes (no auth)
  if (path === "/.well-known/oauth-protected-resource") {
    return withLoggedResponse(req, path, handleProtectedResource(), { route: "oauth-protected-resource" });
  }
  if (path === "/.well-known/oauth-authorization-server" || path === "/.well-known/openid-configuration") {
    return withLoggedResponse(req, path, handleAuthServerMetadata(), { route: "oauth-authorization-server" });
  }
  if (path === "/register" && req.method === "POST") {
    return withLoggedResponse(req, path, await handleRegister(req), { route: "register" });
  }
  if (path === "/authorize") {
    return withLoggedResponse(req, path, await handleAuthorize(url), { route: "authorize" });
  }
  if (path === "/token" && req.method === "POST") {
    return withLoggedResponse(req, path, await handleToken(req), { route: "token" });
  }

  // MCP routes (auth required)
  if (!isAuthorized(req)) {
    return withLoggedResponse(req, path, unauthorizedResponse(), { route: "mcp", authorized: false });
  }

  const response = await mcpHandler(req);
  return withLoggedResponse(req, path, response, { route: "mcp", authorized: true });
});