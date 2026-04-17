import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Minimal FTP client (passive mode) for preview. */
async function downloadViaFtpPreview(host: string, user: string, pass: string, path: string): Promise<string> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const conn = await Deno.connect({ hostname: host, port: 21 });

  async function readResponse(): Promise<string> {
    const buf = new Uint8Array(4096);
    let result = "";
    while (true) {
      const n = await conn.read(buf);
      if (n === null) break;
      result += decoder.decode(buf.subarray(0, n));
      if (/\r\n$/.test(result)) break;
      if (result.length > 100000) break;
    }
    return result;
  }
  async function send(cmd: string): Promise<string> {
    await conn.write(encoder.encode(cmd + "\r\n"));
    return await readResponse();
  }

  try {
    await readResponse();
    let resp = await send(`USER ${user}`);
    if (/^3\d\d/.test(resp)) resp = await send(`PASS ${pass}`);
    if (!/^2\d\d/.test(resp)) throw new Error(`FTP login failed: ${resp.trim()}`);
    await send("TYPE I");
    const pasvResp = await send("PASV");
    const m = pasvResp.match(/\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/);
    if (!m) throw new Error(`PASV parse failed: ${pasvResp.trim()}`);
    const dataHost = `${m[1]}.${m[2]}.${m[3]}.${m[4]}`;
    const dataPort = parseInt(m[5], 10) * 256 + parseInt(m[6], 10);

    let dataConn = await Deno.connect({ hostname: dataHost, port: dataPort });
    let retrResp = await send(`RETR ${path}`);
    // Fallback: try without leading slash (relative to home dir)
    if (!/^1\d\d/.test(retrResp) && path.startsWith("/")) {
      try { dataConn.close(); } catch { /* noop */ }
      const pasv2 = await send("PASV");
      const m2 = pasv2.match(/\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/);
      if (m2) {
        const dh = `${m2[1]}.${m2[2]}.${m2[3]}.${m2[4]}`;
        const dp = parseInt(m2[5], 10) * 256 + parseInt(m2[6], 10);
        dataConn = await Deno.connect({ hostname: dh, port: dp });
        retrResp = await send(`RETR ${path.replace(/^\/+/, "")}`);
      }
    }
    if (!/^1\d\d/.test(retrResp)) {
      try { dataConn.close(); } catch { /* noop */ }
      throw new Error(`RETR failed: ${retrResp.trim()}`);
    }
    const chunks: Uint8Array[] = [];
    const dbuf = new Uint8Array(65536);
    let total = 0;
    while (true) {
      const n = await dataConn.read(dbuf);
      if (n === null) break;
      chunks.push(dbuf.slice(0, n));
      total += n;
      if (total > 200_000) break; // preview only needs header
    }
    dataConn.close();
    try { await send("QUIT"); } catch { /* noop */ }
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { merged.set(c, off); off += c.length; }
    return decoder.decode(merged);
  } finally {
    try { conn.close(); } catch { /* noop */ }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const feed_url = typeof body.feed_url === "string" ? body.feed_url : "";
    const feed_type = typeof body.feed_type === "string" ? body.feed_type : "csv";
    const delimiter = typeof body.delimiter === "string" && body.delimiter ? body.delimiter : ";";
    const supplier_id = typeof body.supplier_id === "string" ? body.supplier_id : "";

    if (feed_type === "api") {
      if (!supplier_id) {
        return new Response(JSON.stringify({ error: "supplier_id is required for api feeds" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const adminClient = createClient(supabaseUrl, serviceRoleKey);
      const { data: supplier, error: supErr } = await adminClient
        .from("suppliers")
        .select("feed_url, column_mapping")
        .eq("id", supplier_id)
        .single();

      if (supErr || !supplier) {
        throw new Error("Supplier not found");
      }

      const mapping = (supplier.column_mapping ?? {}) as Record<string, string>;
      // Always use "item" database for preview – it contains EAN, price, stock, descriptions
      const params = new URLSearchParams({
        database: "item",
        customerid: mapping._api_customer_id || "",
        companyid: mapping._api_company_id || "",
        language: mapping._api_language || "da",
      });

      if (mapping._api_key) {
        params.set("apikey", mapping._api_key);
      }

      const apiBaseUrl = supplier.feed_url || feed_url || "https://api.aurdel.com/Prices/getPrice";
      const apiUrl = `${apiBaseUrl}?${params.toString()}`;

      // Aurdel "item" database can be slow – allow up to 55 seconds
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 55000);
      let res: Response;
      try {
        res = await fetch(apiUrl, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      const text = await res.text();

      if (!res.ok) {
        const errorSnippet = text.trim().slice(0, 200);
        throw new Error(
          errorSnippet
            ? `Failed to fetch API feed: ${res.status} ${errorSnippet}`
            : `Failed to fetch API feed: ${res.status}`,
        );
      }

      const itemMatch = text.match(/<item\s+id="[^"]*">([\s\S]*?)<\/item>/i);
      const columns: string[] = ["supplier_sku (item id)"];

      if (itemMatch) {
        const inner = itemMatch[1];
        if (/<ean>/i.test(inner)) columns.push("ean");
        if (/<net/i.test(inner)) columns.push("purchase_price (net)");
        if (/<stock\s+quantity/i.test(inner)) columns.push("stock_quantity");
        if (/<short>/i.test(inner)) columns.push("short_description");
        if (/<manufacturer/i.test(inner)) columns.push("manufacturer");
      }

      return new Response(JSON.stringify({ columns }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // FTP preview: load credentials from supplier and try HTTPS/HTTP, then real FTP
    if (feed_type === "ftp") {
      if (!supplier_id) {
        return new Response(JSON.stringify({ error: "supplier_id is required for ftp feeds" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const adminClient = createClient(supabaseUrl, serviceRoleKey);
      const { data: supplier, error: supErr } = await adminClient
        .from("suppliers").select("column_mapping").eq("id", supplier_id).single();
      if (supErr || !supplier) throw new Error("Supplier not found");

      const m = (supplier.column_mapping ?? {}) as Record<string, string>;
      const host = m._ftp_host?.trim();
      const userFtp = m._ftp_user?.trim() || "anonymous";
      const passFtp = m._ftp_pass?.trim() || "";
      const path = m._ftp_path?.trim();
      if (!host || !path) throw new Error("FTP host og filsti er påkrævet");
      const cleanPath = path.startsWith("/") ? path : `/${path}`;

      let text = "";
      let fetched = false;
      for (const scheme of ["https", "http"]) {
        try {
          const url = userFtp && passFtp
            ? `${scheme}://${encodeURIComponent(userFtp)}:${encodeURIComponent(passFtp)}@${host}${cleanPath}`
            : `${scheme}://${host}${cleanPath}`;
          const r = await fetch(url, { redirect: "follow" });
          if (r.ok) { text = await r.text(); fetched = true; break; }
        } catch { /* try next */ }
      }
      if (!fetched) {
        text = await downloadViaFtpPreview(host, userFtp, passFtp, cleanPath);
      }

      // Only need first ~64KB for header parsing
      const sample = text.slice(0, 65536);
      let columns: string[] = [];
      if (sample.trimStart().startsWith("<")) {
        const tagMatches = sample.match(/<([a-zA-Z_][a-zA-Z0-9_.-]*)[^/]*>/g);
        if (tagMatches) {
          const tags = new Set<string>();
          for (const mm of tagMatches) {
            const name = mm.replace(/<([a-zA-Z_][a-zA-Z0-9_.-]*)[^>]*>/, "$1");
            tags.add(name);
          }
          columns = [...tags].slice(0, 50);
        }
      } else {
        const firstLine = sample.split(/\r?\n/)[0];
        if (firstLine) {
          columns = firstLine.split(delimiter).map((c) => c.trim().replace(/^["']|["']$/g, ""));
        }
      }
      return new Response(JSON.stringify({ columns }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!feed_url) {
      return new Response(JSON.stringify({ error: "feed_url is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate URL scheme to prevent SSRF
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(feed_url);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid URL" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return new Response(JSON.stringify({ error: "Only http/https URLs are allowed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Block internal/private IP ranges
    const hostname = parsedUrl.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname.startsWith("10.") || hostname.startsWith("192.168.") || hostname.startsWith("172.") || hostname === "169.254.169.254" || hostname.endsWith(".internal") || hostname.endsWith(".local")) {
      return new Response(JSON.stringify({ error: "Internal URLs are not allowed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await fetch(feed_url);
    const text = await res.text();

    if (!res.ok) {
      const errorSnippet = text.trim().slice(0, 200);
      throw new Error(
        errorSnippet
          ? `Failed to fetch feed: ${res.status} ${errorSnippet}`
          : `Failed to fetch feed: ${res.status}`,
      );
    }

    let columns: string[] = [];

    if (feed_type === "xml") {
      const tagMatches = text.match(/<([a-zA-Z_][a-zA-Z0-9_.-]*)[^/]*>/g);
      if (tagMatches) {
        const tags = new Set<string>();
        for (const m of tagMatches) {
          const name = m.replace(/<([a-zA-Z_][a-zA-Z0-9_.-]*)[^>]*>/, "$1");
          tags.add(name);
        }
        columns = [...tags].slice(0, 50);
      }
    } else {
      const firstLine = text.split(/\r?\n/)[0];
      if (firstLine) {
        columns = firstLine.split(delimiter).map((c) => c.trim().replace(/^["']|["']$/g, ""));
      }
    }

    return new Response(JSON.stringify({ columns }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
