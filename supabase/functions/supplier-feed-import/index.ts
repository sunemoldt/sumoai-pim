import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function assertSafeFeedUrl(raw: string): void {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error("Invalid feed URL"); }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Feed URL must use http or https");
  }
  const host = parsed.hostname.toLowerCase();
  const blocked = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.|::1$|0\.)/;
  if (host === "localhost" || host === "::1" || blocked.test(host) || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new Error("Feed URL targets a private/internal address");
  }
}

/** Stream a ReadableStream<Uint8Array> as CSV rows line-by-line so we never
 *  build the whole file as a single JS string. Callback is invoked per data row. */
async function streamCsvFromReadable(
  body: ReadableStream<Uint8Array>,
  delimiter: string,
  onRow: (row: Record<string, string>) => void | Promise<void>,
): Promise<{ rows: number; headers: string[] | null }> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  let headers: string[] | null = null;
  let bomStripped = false;
  let rowCount = 0;

  const emitLine = async (raw: string) => {
    if (!raw.trim()) return;
    if (headers === null) {
      headers = raw.split(delimiter).map((h) => h.trim().replace(/^["']|["']$/g, ""));
      return;
    }
    const vals = raw.split(delimiter);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (vals[idx] ?? "").trim().replace(/^["']|["']$/g, "");
    });
    await onRow(row);
    rowCount++;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += value;
    if (!bomStripped) {
      if (pending.charCodeAt(0) === 0xFEFF) pending = pending.slice(1);
      bomStripped = true;
    }
    let nl: number;
    while ((nl = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, nl).replace(/\r$/, "");
      pending = pending.slice(nl + 1);
      await emitLine(line);
    }
  }
  if (pending.length > 0) await emitLine(pending.replace(/\r$/, ""));
  return { rows: rowCount, headers };
}

/** Stream <item …>…</item> blocks from a ReadableStream, invoking callback per
 *  item so we don't buffer the entire XML file in memory. */
async function streamXmlItemsFromReadable(
  body: ReadableStream<Uint8Array>,
  onItem: (attrs: Record<string, string>, inner: string) => void | Promise<void>,
): Promise<number> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  let count = 0;

  const flush = async (final: boolean) => {
    const re = /<item\s+([^>]*)>([\s\S]*?)<\/item>/gi;
    let m;
    let lastEnd = 0;
    while ((m = re.exec(buf)) !== null) {
      const attrs: Record<string, string> = {};
      const attrRe = /(\w+)="([^"]*)"/g;
      let am;
      while ((am = attrRe.exec(m[1])) !== null) attrs[am[1]] = am[2];
      await onItem(attrs, m[2]);
      count++;
      lastEnd = m.index + m[0].length;
    }
    if (lastEnd > 0) buf = buf.slice(lastEnd);
    if (final) buf = "";
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    if (buf.length > 200_000) await flush(false);
  }
  await flush(true);
  return count;
}

async function streamGenericXmlRowsFromReadable(
  body: ReadableStream<Uint8Array>,
  onRow: (row: Record<string, string>) => void | Promise<void>,
): Promise<number> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  const productTags = ["product", "item", "row", "Product", "Item", "Row"];
  let buf = "";
  let tag = "";
  let count = 0;

  const parseInner = (inner: string) => {
    const row: Record<string, string> = {};
    const fieldRegex = /<([a-zA-Z_][a-zA-Z0-9_.-]*)[^>]*>([^<]*)<\/\1>/g;
    let fieldMatch;
    while ((fieldMatch = fieldRegex.exec(inner)) !== null) {
      row[fieldMatch[1]] = fieldMatch[2].trim();
    }
    return row;
  };

  const detectTag = () => {
    if (tag) return;
    for (const t of productTags) {
      if (buf.includes(`<${t}`) || buf.includes(`<${t}>`)) {
        tag = t;
        return;
      }
    }
  };

  const flush = async (final: boolean) => {
    detectTag();
    if (!tag) {
      if (!final && buf.length > 100_000) buf = buf.slice(-10_000);
      if (final) buf = "";
      return;
    }

    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, "gi");
    let match;
    let lastEnd = 0;
    while ((match = regex.exec(buf)) !== null) {
      const row = parseInner(match[1]);
      if (Object.keys(row).length > 0) {
        await onRow(row);
        count++;
      }
      lastEnd = match.index + match[0].length;
    }
    if (lastEnd > 0) buf = buf.slice(lastEnd);
    if (!final && buf.length > 300_000) buf = buf.slice(-100_000);
    if (final) buf = "";
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    if (buf.length > 200_000) await flush(false);
  }
  await flush(true);
  return count;
}

function normalizeEan(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed) return "";
  return trimmed.replace(/^0+/, "") || trimmed;
}

function parseMappedPrice(row: Record<string, string>, mapping: Record<string, string>): number | null {
  const priceCol = mapping.purchase_price;
  const priceStr = priceCol ? row[priceCol]?.trim().replace(",", ".") : "";
  const parsedPrice = priceStr ? parseFloat(priceStr) : NaN;
  if (isNaN(parsedPrice) || parsedPrice <= 0) return null;
  if ((mapping as Record<string, unknown>)._currency === "EUR") {
    const rawRate = String((mapping as Record<string, unknown>)._eur_rate ?? "7.46").replace(",", ".");
    const rate = parseFloat(rawRate) || 7.46;
    return Math.round(parsedPrice * rate * 100) / 100;
  }
  return parsedPrice;
}

function parseStockQuantity(row: Record<string, string>, mapping: Record<string, string>): number | null {
  const stockCol = mapping.stock_quantity;
  const stockStr = stockCol ? row[stockCol]?.trim() : "";
  const stockQty = stockStr ? parseInt(stockStr, 10) : NaN;
  return isNaN(stockQty) ? null : stockQty;
}

function parseMappedInStock(row: Record<string, string>, mapping: Record<string, string>, stockQty: number | null): boolean {
  if (mapping.in_stock) {
    const val = row[mapping.in_stock]?.trim().toLowerCase();
    const truthy = val === "1" || val === "yes" || val === "ja" || val === "true" || val === "in stock" || val === "på lager" || val === "a" || val === "y";
    const falsy = val === "0" || val === "no" || val === "nej" || val === "false" || val === "out of stock" || val === "udsolgt" || val === "n";
    return truthy ? true : falsy ? false : (stockQty !== null ? stockQty > 0 : false);
  }
  return stockQty !== null ? stockQty > 0 : true;
}

type SupplierFeedCacheRow = {
  supplier_id: string;
  ean: string;
  product_title: string | null;
  supplier_sku: string | null;
  brand: string | null;
  purchase_price: number;
  stock_quantity: number | null;
  in_stock: boolean;
  last_seen_at: string;
};

function buildSupplierFeedCacheRow(
  row: Record<string, string>,
  mapping: Record<string, string>,
  supplierId: string,
  lastSeenAt: string,
): SupplierFeedCacheRow | null {
  const ean = normalizeEan(mapping.ean ? row[mapping.ean] : "");
  if (!ean) return null;
  const price = parseMappedPrice(row, mapping);
  if (price === null) return null;
  const stockQty = parseStockQuantity(row, mapping);
  const titleCol = (mapping as Record<string, string>).title || (mapping as Record<string, string>).name || (mapping as Record<string, string>).short_description;
  const brandCol = (mapping as Record<string, string>).brand || (mapping as Record<string, string>).manufacturer;
  const skuCol = mapping.sku;
  const trim = (s: string | undefined | null, n: number) => s ? (s.length > n ? s.slice(0, n) : s) : null;
  return {
    supplier_id: supplierId,
    ean,
    product_title: trim(titleCol ? row[titleCol]?.trim() : null, 300),
    supplier_sku: trim(skuCol ? row[skuCol]?.trim() : null, 100),
    brand: trim(brandCol ? row[brandCol]?.trim() : null, 100),
    purchase_price: price,
    stock_quantity: stockQty,
    in_stock: parseMappedInStock(row, mapping, stockQty),
    last_seen_at: lastSeenAt,
  };
}

/** Extract Aurdel item fields from the <item …> inner XML block. */
function extractAurdelItemFields(inner: string, attrs: Record<string, string>): Record<string, string> {
  const row: Record<string, string> = { supplier_sku: attrs.id ?? "" };
  const eanMatch = inner.match(/<ean>([^<]*)<\/ean>/i);
  if (eanMatch) row.ean = eanMatch[1].trim().replace(/^0+/, "") || eanMatch[1].trim();
  const netMatch = inner.match(/<net[^>]*>([^<]*)<\/net>/i);
  if (netMatch) row.purchase_price = netMatch[1].trim().replace(",", ".");
  const stockMatch = inner.match(/<stock\s+quantity="([^"]*)"/i);
  if (stockMatch) row.stock_quantity = stockMatch[1].trim();
  const shortDesc = inner.match(/<short>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/short>/i);
  if (shortDesc) row.short_description = shortDesc[1].trim();
  const mfgMatch = inner.match(/<manufacturer[^>]*><description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);
  if (mfgMatch) row.manufacturer = mfgMatch[1].trim();
  return row;
}
function buildFtpPathCandidates(path: string, user: string): string[] {
  const trimmed = path.trim();
  const noLeadingSlash = trimmed.replace(/^\/+/, "");
  const fileName = noLeadingSlash.split("/").filter(Boolean).pop() ?? noLeadingSlash;
  const suffix = noLeadingSlash || fileName;
  const userFolder = user.replace(/^aln/i, "");

  return [...new Set([
    trimmed,
    noLeadingSlash,
    fileName,
    `/${fileName}`,
    userFolder ? `${userFolder}/${fileName}` : "",
    userFolder ? `/${userFolder}/${fileName}` : "",
    user ? `${user}/${fileName}` : "",
    user ? `/${user}/${fileName}` : "",
    userFolder && suffix ? `${userFolder}/${suffix}` : "",
    userFolder && suffix ? `/${userFolder}/${suffix}` : "",
  ].filter(Boolean))];
}

/** Minimal FTP client (passive mode, binary download) using Deno TCP.
 *  If onLine is provided, the data stream is parsed line-by-line and onLine is
 *  invoked for each complete line — no full-file string is built. Returns "".
 *  If onLine is omitted, the entire file is decoded and returned as a string.
 */
async function downloadViaFtp(
  host: string,
  user: string,
  pass: string,
  path: string,
  onLine?: (line: string) => void | Promise<void>,
): Promise<string> {
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

  async function openPassiveDataConnection() {
    const pasvResp = await send("PASV");
    const m = pasvResp.match(/\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/);
    if (!m) throw new Error(`PASV parse failed: ${pasvResp.trim()}`);
    const dataHost = `${m[1]}.${m[2]}.${m[3]}.${m[4]}`;
    const dataPort = parseInt(m[5], 10) * 256 + parseInt(m[6], 10);
    return Deno.connect({ hostname: dataHost, port: dataPort });
  }

  try {
    await readResponse();
    let resp = await send(`USER ${user}`);
    if (/^3\d\d/.test(resp)) resp = await send(`PASS ${pass}`);
    if (!/^2\d\d/.test(resp)) throw new Error(`FTP login failed: ${resp.trim()}`);
    await send("TYPE I");

    const candidates = buildFtpPathCandidates(path, user);
    let lastError = "";

    for (const candidate of candidates) {
      const dataConn = await openPassiveDataConnection();
      const retrResp = await send(`RETR ${candidate}`);
      if (!/^1\d\d/.test(retrResp)) {
        lastError = retrResp.trim();
        try { dataConn.close(); } catch { /* noop */ }
        continue;
      }

      const streamDecoder = new TextDecoder("utf-8", { fatal: false });
      const dbuf = new Uint8Array(65536);
      let bytes = 0;

      if (onLine) {
        let pending = "";
        let lineCount = 0;
        while (true) {
          const n = await dataConn.read(dbuf);
          if (n === null) break;
          bytes += n;
          pending += streamDecoder.decode(dbuf.subarray(0, n), { stream: true });
          let nl: number;
          while ((nl = pending.indexOf("\n")) !== -1) {
            const line = pending.slice(0, nl).replace(/\r$/, "");
            pending = pending.slice(nl + 1);
            await onLine(line);
            lineCount++;
          }
        }
        pending += streamDecoder.decode();
        if (pending.length > 0) { await onLine(pending.replace(/\r$/, "")); lineCount++; }
        dataConn.close();
        await readResponse();
        try { await send("QUIT"); } catch { /* noop */ }
        console.log(`FTP RETR ${candidate} streamed: ${bytes} bytes, ${lineCount} lines`);
        return "";
      }

      let text = "";
      while (true) {
        const n = await dataConn.read(dbuf);
        if (n === null) break;
        bytes += n;
        text += streamDecoder.decode(dbuf.subarray(0, n), { stream: true });
      }
      text += streamDecoder.decode();
      dataConn.close();
      await readResponse();
      try { await send("QUIT"); } catch { /* noop */ }
      console.log(`FTP RETR ${candidate} ok: ${bytes} bytes, ${text.length} chars`);
      return text;
    }

    throw new Error(`RETR failed: ${lastError || "file not found"}`);
  } finally {
    try { conn.close(); } catch { /* noop */ }
  }
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Auth check: require authenticated user or service role
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!authHeader.includes(SUPABASE_SERVICE_ROLE_KEY)) {
    const anonClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let asyncMode = false;
  let importLogId: string | null = null;
  try {
    const body = await req.json();
    const { supplier_id, target_ean: rawTargetEan, mode: rawMode, async: rawAsync, _import_log_id: rawLogId, skip_cache: rawSkipCache } = body;
    if (!supplier_id) {
      return new Response(JSON.stringify({ error: "supplier_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const mode: "import" | "unmatched" = rawMode === "unmatched" ? "unmatched" : "import";
    asyncMode = rawAsync === true && mode === "import";
    importLogId = typeof rawLogId === "string" ? rawLogId : null;
    const skipCache = rawSkipCache === true;
    // Optional: only process rows matching this normalized EAN (used by supplier-rematch-product)
    const targetEan: string | null = rawTargetEan
      ? (String(rawTargetEan).trim().replace(/^0+/, "") || String(rawTargetEan).trim())
      : null;

    // Async mode: kick off the work in the background and respond immediately so the
    // caller (and the API gateway) doesn't hit the 60s wall-clock timeout on large feeds.
    // We also register an import_logs row so the actual outcome (success or resource-limit
    // failure) is visible to the UI — previously all async errors were silently swallowed.
    if (asyncMode) {
      // Overlap guard: if the same supplier already has a running import
      // from within the last 20 minutes, skip instead of starting a
      // second concurrent run (which caused "No rows found in feed"
      // ghosts when a manual "Kør nu" collided with a scheduled tick).
      const twentyMinAgo = new Date(Date.now() - 20 * 60_000).toISOString();
      const { data: inflight } = await supabase
        .from("import_logs")
        .select("id, started_at")
        .eq("source", `supplier-feed-import:${supplier_id}`)
        .eq("status", "running")
        .gte("started_at", twentyMinAgo)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (inflight?.id) {
        return new Response(
          JSON.stringify({ success: true, async: true, started: false, skipped: "already_running", import_log_id: inflight.id }),
          { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Scoped stale-log cleanup: close only this supplier's abandoned
      // rows (> 20 min old) so we never treat them as in-flight above.
      await supabase
        .from("import_logs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          errors: { message: "Stale running log closed by overlap guard" },
        })
        .eq("source", `supplier-feed-import:${supplier_id}`)
        .eq("status", "running")
        .lt("started_at", twentyMinAgo);

      const { data: logRow } = await supabase
        .from("import_logs")
        .insert({
          source: `supplier-feed-import:${supplier_id}`,
          status: "running",
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      const logId = logRow?.id ?? null;

      // Run the sync body IN-PROCESS via waitUntil so we get the ~400s
      // background budget instead of hitting the 150s HTTP idle timeout that
      // used to kill long imports like Aurdel (item+stock).
      const childReq = new Request(req.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "apikey": SUPABASE_SERVICE_ROLE_KEY,
        },
        body: JSON.stringify({ supplier_id, target_ean: rawTargetEan, mode: rawMode, skip_cache: skipCache, _import_log_id: logId }),
      });
      const work = (async () => {
        try {
          const resp = await handler(childReq);
          const bodyText = await resp.text().catch(() => "");
          let parsed: any = {};
          try { parsed = bodyText ? JSON.parse(bodyText) : {}; } catch { parsed = { raw: bodyText.slice(0, 500) }; }
          console.log(`[async import ${supplier_id}]`, resp.status, JSON.stringify(parsed).slice(0, 200));
          if (!resp.ok && logId) {
            await supabase.from("import_logs").update({
              status: "failed",
              completed_at: new Date().toISOString(),
              errors: { http_status: resp.status, response: parsed },
            }).eq("id", logId);
          }
        } catch (e) {
          console.error(`[async import ${supplier_id}] failed`, e);
          if (logId) {
            await supabase.from("import_logs").update({
              status: "failed",
              completed_at: new Date().toISOString(),
              errors: { message: (e as Error).message ?? String(e) },
            }).eq("id", logId);
          }
        }
      })();
      // @ts-ignore EdgeRuntime is provided by Supabase Edge Runtime
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
      return new Response(JSON.stringify({ success: true, async: true, started: true, import_log_id: logId }), {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }



    // Get supplier
    const { data: supplier, error: supErr } = await supabase
      .from("suppliers")
      .select("*")
      .eq("id", supplier_id)
      .single();
    if (supErr || !supplier) throw new Error("Supplier not found");

    const mapping = (supplier.column_mapping ?? {}) as Record<string, string>;

    let feedRows: Record<string, string>[] = [];
    let eanToIdEarlyOuter: Map<string, string> | null = null;
    let feedRowCount = 0;
    const shouldBuildCache = !skipCache && !targetEan && mode === "import";
    let cacheAlreadyBuilt = false;
    let cacheUpserted = 0;
    const runStartedAt = new Date().toISOString();
    const seenCache = new Set<string>(); // per-batch dedup only; cleared on flush
    const cacheBatch: SupplierFeedCacheRow[] = [];
    const FLUSH_AT = 200; // smaller batches → lower peak memory on huge feeds (DCS ~150k rows)

    const flushCacheRows = async () => {
      if (cacheBatch.length === 0) return;
      const rows = cacheBatch.splice(0, cacheBatch.length);
      seenCache.clear();
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const { error: cacheErr } = await supabase
          .from("supplier_feed_cache")
          .upsert(batch, { onConflict: "supplier_id,ean" });
        if (cacheErr) console.error(`supplier_feed_cache upsert failed at ${cacheUpserted + i}: ${cacheErr.message}`);
      }
      cacheUpserted += rows.length;
    };

    const shouldKeepFeedRow = (ean: string) => {
      if (mode === "unmatched" || targetEan) return true;
      return Boolean(ean && eanToIdEarlyOuter?.has(ean));
    };

    const acceptFeedRow = async (
      row: Record<string, string>,
      ean: string,
      allowAsyncFlush: boolean,
      onCacheRow?: (cacheRow: SupplierFeedCacheRow) => void,
    ) => {
      feedRowCount++;
      if (shouldBuildCache) {
        const cacheRow = buildSupplierFeedCacheRow(row, mapping, supplier.id, runStartedAt);
        if (cacheRow && !seenCache.has(cacheRow.ean)) {
          seenCache.add(cacheRow.ean);
          cacheBatch.push(cacheRow);
          onCacheRow?.(cacheRow);
          if (allowAsyncFlush && cacheBatch.length >= FLUSH_AT) await flushCacheRows();
        }
      }
      if (shouldKeepFeedRow(ean)) feedRows.push(row);
    };

    // Pre-fetch master EANs once so we can filter on-the-fly for every code path
    // that streams — this keeps peak memory bounded even for very large feeds.
    {
      const { data: mpsEarly, error: mpEarlyErr } = await supabase
        .from("master_products").select("id, ean");
      if (mpEarlyErr) throw new Error(`Failed to fetch master products: ${mpEarlyErr.message}`);
      eanToIdEarlyOuter = new Map<string, string>();
      for (const mp of mpsEarly ?? []) {
        const raw = mp.ean;
        if (!raw) continue;
        const normEan = raw.replace(/^0+/, "") || raw;
        eanToIdEarlyOuter.set(normEan, mp.id);
      }
    }

    if (supplier.feed_type === "api") {
      // Aurdel API: build URL from stored credentials
      const apiDbStr = mapping._api_database || "item";
      const apiDbs = apiDbStr.split(",").map((d: string) => d.trim()).filter(Boolean);
      const apiCust = mapping._api_customer_id;
      const apiComp = mapping._api_company_id;
      const apiKeyVal = mapping._api_key;
      const apiLang = mapping._api_language || "da";
      if (!apiCust || !apiComp) throw new Error("API credentials not configured (customerid, companyid)");

      // Set auto-mapping before streaming so cache rows can be built incrementally.
      mapping.ean = "ean";
      mapping.purchase_price = "purchase_price";
      mapping.stock_quantity = "stock_quantity";
      mapping.sku = "supplier_sku";

      const stockMap = new Map<string, string>(); // SKU -> quantity
      const aurdelHasStock = apiDbs.includes("stock");
      const skuToCacheRow: Map<string, SupplierFeedCacheRow> | null = aurdelHasStock ? new Map() : null;

      for (const db of apiDbs) {
        const params = new URLSearchParams({
          database: db,
          customerid: apiCust,
          companyid: apiComp,
          language: apiLang,
        });
        if (apiKeyVal) params.set("apikey", apiKeyVal);

        const apiUrl = `https://api.aurdel.com/Prices/getPrice?${params.toString()}`;
        console.log(`Fetching Aurdel API database=${db}...`);
        // Aurdel returns transient 5xx fairly often; retry with backoff before
        // failing the whole import.
        let res: Response | null = null;
        let lastStatus = 0;
        const delays = [2000, 5000, 10_000, 20_000];
        for (let attempt = 0; attempt <= delays.length; attempt++) {
          try {
            const r = await fetch(apiUrl);
            if (r.ok && r.body) { res = r; break; }
            lastStatus = r.status;
            try { await r.body?.cancel(); } catch { /* ignore */ }
            // Only retry transient server-side/rate-limit failures.
            if (r.status < 500 && r.status !== 429) break;
          } catch (e) {
            lastStatus = 0;
            console.log(`Aurdel fetch error (db=${db}, attempt ${attempt + 1}): ${e}`);
          }
          if (attempt < delays.length) {
            console.log(`Aurdel ${lastStatus || "network error"} for database=${db} — retrying in ${delays[attempt]}ms`);
            await new Promise((r) => setTimeout(r, delays[attempt]));
          }
        }
        if (!res) throw new Error(`API returned status ${lastStatus} for database=${db} after ${delays.length + 1} attempts`);


        if (db === "stock") {
          const count = await streamXmlItemsFromReadable(res.body, (attrs, inner) => {
            const sku = attrs.id;
            const m = inner.match(/<stock\s+quantity="([^"]*)"/i)
                   ?? inner.match(/quantity="([^"]*)"/i);
            if (sku && m) stockMap.set(sku, m[1]);
          });
          console.log(`Stock database: streamed ${count} items, ${stockMap.size} SKUs with stock data`);
        } else {
          let items = 0;
          await streamXmlItemsFromReadable(res.body, async (attrs, inner) => {
            items++;
            const row = extractAurdelItemFields(inner, attrs);
            if (!row.ean && !row.purchase_price) return;
            const ean = row.ean ?? "";
            if (targetEan && ean !== targetEan) return;
            // When a "stock" DB is also configured, defer flushing so we can
            // patch cache rows with merged quantities before upsert.
            await acceptFeedRow(row, ean, !aurdelHasStock, skuToCacheRow
              ? (cr) => {
                  const sku = row.supplier_sku;
                  if (sku) skuToCacheRow.set(sku, cr);
                }
              : undefined);
          });
          console.log(`Item database: streamed ${items} items, kept ${feedRows.length}`);
        }
      }

      // Merge stock data into item rows by SKU
      if (stockMap.size > 0 && feedRows.length > 0) {
        let merged = 0;
        for (const row of feedRows) {
          const sku = row.supplier_sku;
          if (sku && stockMap.has(sku)) {
            row.stock_quantity = stockMap.get(sku)!;
            merged++;
          }
        }
        console.log(`Merged stock data for ${merged} feedRows by SKU`);
      }

      // Patch already-built cache rows with merged stock so supplier_feed_cache
      // reflects the true availability (item DB only exposes stock via <stock>
      // inside <item>, which is often stale compared to the "stock" DB).
      if (skuToCacheRow && stockMap.size > 0) {
        let patched = 0;
        for (const [sku, cacheRow] of skuToCacheRow) {
          const qtyStr = stockMap.get(sku);
          if (qtyStr == null) continue;
          const qty = Number(qtyStr);
          if (!Number.isFinite(qty)) continue;
          cacheRow.stock_quantity = qty;
          cacheRow.in_stock = qty > 0;
          patched++;
        }
        console.log(`Patched stock on ${patched} cache rows from stock DB`);
      }

      if (shouldBuildCache) {
        await flushCacheRows();
        cacheAlreadyBuilt = true;
      }
    } else {
      const mappingAny = mapping as Record<string, string>;
      const isFtp = supplier.feed_type === "ftp";

      if (!isFtp) {
        if (!supplier.feed_url) throw new Error("No feed URL configured");
      }
      if (!mapping.ean) throw new Error("EAN mapping not configured");
      if (!mapping.purchase_price) throw new Error("Purchase price mapping not configured");

      const delimiter = mapping._delimiter || ";";
      const eanCol = mapping.ean;

      if (isFtp) {
        const host = mappingAny._ftp_host?.trim();
        const user = mappingAny._ftp_user?.trim();
        const pass = mappingAny._ftp_pass?.trim();
        const path = mappingAny._ftp_path?.trim();
        if (!host || !path) throw new Error("FTP host og filsti er påkrævet");

        const cleanPath = path.startsWith("/") ? path : `/${path}`;
        console.log(`FTP download from ${host}${cleanPath} as ${user || "anonymous"}`);

        let headers: string[] | null = null;
        let eanIdx = -1;
        await downloadViaFtp(host, user || "anonymous", pass || "", cleanPath, async (line: string) => {
          if (!line) return;
          if (headers === null) {
            const hdrLine = line.charCodeAt(0) === 0xFEFF ? line.slice(1) : line;
            headers = hdrLine.split(delimiter).map((h) => h.trim().replace(/^["']|["']$/g, ""));
            eanIdx = headers.indexOf(eanCol);
            return;
          }
          if (eanIdx === -1) return;
          const vals = line.split(delimiter);
          const rawEan = (vals[eanIdx] ?? "").trim().replace(/^["']|["']$/g, "");
          if (!rawEan) return;
          const ean = normalizeEan(rawEan);
          if (targetEan && ean !== targetEan) return;
          const row: Record<string, string> = {};
          headers.forEach((h, idx) => {
            row[h] = (vals[idx] ?? "").trim().replace(/^["']|["']$/g, "");
          });
          await acceptFeedRow(row, ean, true);
        });
        if (shouldBuildCache) {
          await flushCacheRows();
          cacheAlreadyBuilt = true;
        }
        console.log(`Streamed CSV (ftp): kept ${feedRows.length} rows`);
      } else {
        // Non-FTP feeds — HTTP URL or storage bucket. Stream both cases so we never
        // materialise the full response body as one JS string (OOM on large feeds).
        const storagePrefix = `${SUPABASE_URL}/storage/v1/object/public/supplier-feeds/`;
        const signedPrefix = `${SUPABASE_URL}/storage/v1/object/sign/supplier-feeds/`;
        const url = supplier.feed_url!;

        let bodyStream: ReadableStream<Uint8Array>;
        if (url.startsWith(storagePrefix) || url.startsWith(signedPrefix)) {
          const rawPath = url.startsWith(storagePrefix)
            ? url.slice(storagePrefix.length)
            : url.slice(signedPrefix.length).split("?")[0];
          const objectPath = decodeURIComponent(rawPath);
          const { data: blob, error: dlErr } = await supabase.storage
            .from("supplier-feeds").download(objectPath);
          if (dlErr || !blob) throw new Error(`Failed to download feed file: ${dlErr?.message ?? "unknown"}`);
          bodyStream = blob.stream();
        } else {
          assertSafeFeedUrl(url);
          const res = await fetch(url);
          if (!res.ok || !res.body) throw new Error(`Failed to fetch feed: ${res.status}`);
          bodyStream = res.body;
        }

        if (supplier.feed_type === "xml") {
          const rows = await streamGenericXmlRowsFromReadable(bodyStream, async (row) => {
            const ean = normalizeEan(eanCol ? row[eanCol] : "");
            if (!ean) return;
            if (targetEan && ean !== targetEan) return;
            await acceptFeedRow(row, ean, true);
          });
          console.log(`Streamed XML: read ${rows} rows, kept ${feedRows.length}`);
        } else {
          // csv, txt and everything else are streamed line-by-line.
          const { rows } = await streamCsvFromReadable(bodyStream, delimiter, async (row) => {
            const rawEan = row[eanCol]?.trim() ?? "";
            if (!rawEan) return;
            const ean = normalizeEan(rawEan);
            if (targetEan && ean !== targetEan) return;
            await acceptFeedRow(row, ean, true);
          });
          console.log(`Streamed CSV (http): read ${rows} rows, kept ${feedRows.length}`);
        }
        if (shouldBuildCache) {
          await flushCacheRows();
          cacheAlreadyBuilt = true;
        }
      }
    }

    if (!targetEan && cacheAlreadyBuilt) {
      const { error: pruneErr, count: pruned } = await supabase
        .from("supplier_feed_cache")
        .delete({ count: "estimated" })
        .eq("supplier_id", supplier.id)
        .lt("last_seen_at", runStartedAt);
      if (pruneErr) console.error(`supplier_feed_cache prune failed: ${pruneErr.message}`);
      console.log(`supplier_feed_cache: upserted ${cacheUpserted}, pruned ${pruned ?? "?"} stale rows for ${supplier.name}`);
    }


    if (feedRowCount === 0) throw new Error("No rows found in feed");

    // Get all existing EANs from master_products (skip if already loaded during streaming FTP path)
    let eanToId: Map<string, string>;
    if (typeof eanToIdEarlyOuter !== "undefined" && eanToIdEarlyOuter) {
      eanToId = eanToIdEarlyOuter;
    } else {
      const { data: masterProducts, error: mpErr } = await supabase
        .from("master_products")
        .select("id, ean");
      if (mpErr) throw new Error(`Failed to fetch master products: ${mpErr.message}`);
      eanToId = new Map<string, string>();
      for (const mp of masterProducts ?? []) {
        const normEan = normalizeEan(mp.ean);
        if (!normEan) continue;
        eanToId.set(normEan, mp.id);
      }
    }

    // Unmatched mode: return supplier feed rows whose EAN does NOT map to a master product
    if (mode === "unmatched") {
      const eanCol = mapping.ean;
      const priceCol = mapping.purchase_price;
      const stockCol = mapping.stock_quantity;
      const skuCol = mapping.sku;
      const titleCol = (mapping as any).title || (mapping as any).name || (mapping as any).short_description;
      const brandCol = (mapping as any).brand || (mapping as any).manufacturer;
      const seen = new Set<string>();
      const unmatched: Array<{
        ean: string;
        title: string | null;
        supplier_sku: string | null;
        brand: string | null;
        purchase_price: number | null;
        stock_quantity: number | null;
        in_stock: boolean;
      }> = [];
      for (const row of feedRows) {
        const rawEan = eanCol ? row[eanCol]?.trim() : "";
        if (!rawEan) continue;
        const ean = rawEan.replace(/^0+/, "") || rawEan;
        if (eanToId.has(ean)) continue;
        if (seen.has(ean)) continue;
        seen.add(ean);
        const priceStr = priceCol ? row[priceCol]?.trim().replace(",", ".") : "";
        let price = priceStr ? parseFloat(priceStr) : NaN;
        if (!isNaN(price) && (mapping as any)._currency === "EUR") {
          const rate = parseFloat(((mapping as any)._eur_rate ?? "7.46").toString().replace(",", ".")) || 7.46;
          price = Math.round(price * rate * 100) / 100;
        }
        const stockStr = stockCol ? row[stockCol]?.trim() : "";
        const stockQty = stockStr ? parseInt(stockStr, 10) : NaN;
        let inStock = true;
        if (mapping.in_stock) {
          const v = row[mapping.in_stock]?.trim().toLowerCase();
          const truthy = v === "1" || v === "yes" || v === "ja" || v === "true" || v === "in stock" || v === "på lager" || v === "a" || v === "y";
          const falsy = v === "0" || v === "no" || v === "nej" || v === "false" || v === "out of stock" || v === "udsolgt" || v === "n";
          inStock = truthy ? true : falsy ? false : (!isNaN(stockQty) ? stockQty > 0 : false);
        } else if (!isNaN(stockQty)) {
          inStock = stockQty > 0;
        }

        unmatched.push({
          ean,
          title: titleCol ? (row[titleCol]?.trim() || null) : null,
          supplier_sku: skuCol ? (row[skuCol]?.trim() || null) : null,
          brand: brandCol ? (row[brandCol]?.trim() || null) : null,
          purchase_price: isNaN(price) ? null : price,
          stock_quantity: isNaN(stockQty) ? null : stockQty,
          in_stock: inStock,
        });
      }
      return new Response(
        JSON.stringify({
          success: true,
          supplier_id: supplier.id,
          supplier_name: supplier.name,
          total_rows: feedRowCount,
          unmatched_count: unmatched.length,
          unmatched,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];
    const changeLogs: { master_product_id: string; change_type: string; field_name: string; old_value: string | null; new_value: string | null; source: string }[] = [];

    // Pre-fetch existing supplier_products for diff detection
    const { data: existingSps } = await supabase
      .from("supplier_products")
      .select("master_product_id, purchase_price, stock_quantity, in_stock, supplier_sku")
      .eq("supplier_id", supplier.id);
    const existingMap = new Map<string, typeof existingSps extends (infer T)[] | null ? T : never>();
    for (const sp of existingSps ?? []) {
      existingMap.set(sp.master_product_id, sp);
    }

    // Build all upsert rows in memory first (no per-row DB calls)
    const spRows: Array<{
      supplier_id: string;
      master_product_id: string;
      purchase_price: number;
      stock_quantity: number | null;
      in_stock: boolean;
      supplier_sku: string | null;
      weight_kg: number | null;
      last_updated: string;
    }> = [];
    const nowIso = new Date().toISOString();
    // Track best (cheapest) weight per master to backfill master_products.weight_kg later
    const bestWeightByMaster = new Map<string, { weight: number; price: number }>();

    for (const row of feedRows) {
      const rawEan = row[mapping.ean]?.trim();
      if (!rawEan) { skipped++; continue; }
      const ean = rawEan.replace(/^0+/, "") || rawEan;
      if (targetEan && ean !== targetEan) { skipped++; continue; }

      const masterProductId = eanToId.get(ean);
      if (!masterProductId) { skipped++; continue; }

      const priceStr = row[mapping.purchase_price]?.trim().replace(",", ".");
      let price = parseFloat(priceStr);
      if (isNaN(price)) { skipped++; continue; }
      if ((mapping as any)._currency === "EUR") {
        const rate = parseFloat(((mapping as any)._eur_rate ?? "7.46").toString().replace(",", ".")) || 7.46;
        price = Math.round(price * rate * 100) / 100;
      }

      const stockStr = mapping.stock_quantity ? row[mapping.stock_quantity]?.trim() : null;
      const stockQty = stockStr ? parseInt(stockStr, 10) : null;

      let inStock = true;
      if (mapping.in_stock) {
        const val = row[mapping.in_stock]?.trim().toLowerCase();
        const truthy = val === "1" || val === "yes" || val === "ja" || val === "true" || val === "in stock" || val === "på lager" || val === "a" || val === "y";
        const falsy = val === "0" || val === "no" || val === "nej" || val === "false" || val === "out of stock" || val === "udsolgt" || val === "n";
        inStock = truthy ? true : falsy ? false : (stockQty !== null && !isNaN(stockQty) ? stockQty > 0 : false);
      } else if (stockQty !== null && !isNaN(stockQty)) {
        inStock = stockQty > 0;
      }


      const supplierSku = mapping.sku ? row[mapping.sku]?.trim() || null : null;

      // Weight in kg (optional). Accept comma-decimals; if column missing/invalid, leave null.
      let weightKg: number | null = null;
      const weightColKey = (mapping as any).weight_kg as string | undefined;
      if (weightColKey) {
        const wStr = row[weightColKey]?.trim().replace(",", ".");
        const wNum = wStr ? parseFloat(wStr) : NaN;
        if (!isNaN(wNum) && wNum >= 0) weightKg = wNum;
      }

      // Detect changes for changelog
      const existing = existingMap.get(masterProductId);
      if (existing) {
        if (Number(existing.purchase_price) !== price) {
          changeLogs.push({ master_product_id: masterProductId, change_type: "price_update", field_name: "purchase_price", old_value: String(existing.purchase_price), new_value: String(price), source: `supplier:${supplier.name}` });
        }
        if (existing.stock_quantity !== (stockQty !== null && !isNaN(stockQty) ? stockQty : null)) {
          changeLogs.push({ master_product_id: masterProductId, change_type: "stock_update", field_name: "supplier_stock_quantity", old_value: String(existing.stock_quantity ?? "null"), new_value: String(stockQty ?? "null"), source: `supplier:${supplier.name}` });
        }
        if (existing.in_stock !== inStock) {
          changeLogs.push({ master_product_id: masterProductId, change_type: "stock_update", field_name: "supplier_in_stock", old_value: String(existing.in_stock), new_value: String(inStock), source: `supplier:${supplier.name}` });
        }
      } else {
        changeLogs.push({ master_product_id: masterProductId, change_type: "supplier_added", field_name: "supplier_product", old_value: null, new_value: `${supplier.name}: ${price} DKK`, source: `supplier:${supplier.name}` });
      }

      if (weightKg !== null) {
        const prev = bestWeightByMaster.get(masterProductId);
        if (!prev || price < prev.price) bestWeightByMaster.set(masterProductId, { weight: weightKg, price });
      }

      spRows.push({
        supplier_id: supplier.id,
        master_product_id: masterProductId,
        purchase_price: price,
        stock_quantity: stockQty !== null && !isNaN(stockQty) ? stockQty : null,
        in_stock: inStock,
        supplier_sku: supplierSku,
        weight_kg: weightKg,
        last_updated: nowIso,
      });
    }

    // Deduplicate by (supplier_id, master_product_id) — last row wins.
    // Some feeds (e.g. DCS) list the same EAN multiple times; without this,
    // upsert fails with "ON CONFLICT DO UPDATE command cannot affect row a second time".
    const dedupMap = new Map<string, typeof spRows[number]>();
    for (const r of spRows) {
      dedupMap.set(`${r.supplier_id}::${r.master_product_id}`, r);
    }
    const dedupedRows = Array.from(dedupMap.values());
    if (dedupedRows.length !== spRows.length) {
      console.log(`Deduplicated ${spRows.length - dedupedRows.length} duplicate rows by EAN`);
    }

    // Bulk upsert in batches of 500. Triggers are bypassed via app.bulk_supplier_import flag.
    for (let i = 0; i < dedupedRows.length; i += 500) {
      const batch = dedupedRows.slice(i, i + 500);
      // Set bulk flag (session-scoped) right before each batch
      await supabase.rpc("set_bulk_supplier_import", { enabled: true });
      const { error: upsErr } = await supabase
        .from("supplier_products")
        .upsert(batch, { onConflict: "supplier_id,master_product_id" });
      if (upsErr) {
        errors.push(`Batch ${i}: ${upsErr.message}`);
      } else {
        imported += batch.length;
      }
    }
    // Always reset flag
    await supabase.rpc("set_bulk_supplier_import", { enabled: false });

    // Insert change logs in batches
    if (changeLogs.length > 0) {
      for (let i = 0; i < changeLogs.length; i += 500) {
        await supabase.from("product_change_log").insert(changeLogs.slice(i, i + 500));
      }
      console.log(`Logged ${changeLogs.length} changes`);
    }

    // Backfill master_products.weight_kg ONLY when master is currently null, using cheapest supplier's weight
    if (bestWeightByMaster.size > 0) {
      const ids = Array.from(bestWeightByMaster.keys());
      const { data: existingWeights } = await supabase
        .from("master_products")
        .select("id, weight_kg")
        .in("id", ids);
      const needBackfill = (existingWeights ?? []).filter((m) => m.weight_kg == null);
      for (const m of needBackfill) {
        const w = bestWeightByMaster.get(m.id)?.weight;
        if (w != null) {
          await supabase.rpc("set_change_source", { source: `supplier:${supplier.name}` });
          await supabase.from("master_products").update({ weight_kg: w }).eq("id", m.id);
        }
      }
    }

    // Recompute master stock for all products linked to this supplier (skip in targeted mode — trigger handles it)
    if (!targetEan) {
      const { error: recomputeErr } = await supabase.rpc("recompute_stock_for_supplier", {
        p_supplier_id: supplier.id,
      });
      if (recomputeErr) {
        console.error("Stock recompute error:", recomputeErr.message);
      }
    }

    // Update last_sync_at (skip in targeted mode — this is a single-product rematch, not a full sync)
    if (!targetEan) {
      await supabase
        .from("suppliers")
        .update({ last_sync_at: new Date().toISOString() })
        .eq("id", supplier.id);
    }

    // Mark the async parent's import_logs row as done (if any).
    if (importLogId) {
      await supabase.from("import_logs").update({
        status: "done",
        completed_at: new Date().toISOString(),
        total_fetched: feedRowCount,
        imported,
        skipped,
        errors: errors.length > 0 ? { batch_errors: errors } : null,
      }).eq("id", importLogId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        total_rows: feedRowCount,
        imported,
        skipped,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Supplier feed import error:", msg);
    if (importLogId) {
      const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await svc.from("import_logs").update({
        status: "failed",
        completed_at: new Date().toISOString(),
        errors: { message: msg },
      }).eq("id", importLogId);
    }
    return new Response(JSON.stringify({
      error: msg,
      success: false,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },

    });
  }
};

Deno.serve(handler);

