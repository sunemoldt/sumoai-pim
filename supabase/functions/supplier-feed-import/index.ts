import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function parseCsv(text: string, delimiter: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(delimiter).map((h) => h.trim().replace(/^["']|["']$/g, ""));
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(delimiter).map((v) => v.trim().replace(/^["']|["']$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = vals[idx] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

function parseXml(text: string): Record<string, string>[] {
  // Simple XML parser for product feeds - finds repeating elements
  const rows: Record<string, string>[] = [];
  const productTags = ["product", "item", "row", "Product", "Item", "Row"];
  let tag = "";
  for (const t of productTags) {
    if (text.includes(`<${t}`) || text.includes(`<${t}>`)) {
      tag = t;
      break;
    }
  }
  if (!tag) return rows;

  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  let match;
  while ((match = regex.exec(text)) !== null) {
    const inner = match[1];
    const row: Record<string, string> = {};
    const fieldRegex = /<([a-zA-Z_][a-zA-Z0-9_.-]*)>([^<]*)<\/\1>/g;
    let fieldMatch;
    while ((fieldMatch = fieldRegex.exec(inner)) !== null) {
      row[fieldMatch[1]] = fieldMatch[2].trim();
    }
    if (Object.keys(row).length > 0) rows.push(row);
  }
  return rows;
}

/** Aurdel-specific XML parser for their item/stock database format */
function parseAurdelItemXml(text: string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  const itemRegex = /<item\s+id="([^"]*)">([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(text)) !== null) {
    const sku = match[1];
    const inner = match[2];
    const row: Record<string, string> = { supplier_sku: sku };

    // EAN
    const eanMatch = inner.match(/<ean>([^<]*)<\/ean>/i);
    if (eanMatch) row.ean = eanMatch[1].trim().replace(/^0+/, "") || eanMatch[1].trim();

    // Price (net)
    const netMatch = inner.match(/<net[^>]*>([^<]*)<\/net>/i);
    if (netMatch) row.purchase_price = netMatch[1].trim().replace(",", ".");

    // Stock quantity (attribute)
    const stockMatch = inner.match(/<stock\s+quantity="([^"]*)"/i);
    if (stockMatch) row.stock_quantity = stockMatch[1].trim();

    // Short description (may have CDATA)
    const shortDesc = inner.match(/<short>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/short>/i);
    if (shortDesc) row.short_description = shortDesc[1].trim();

    // Manufacturer
    const mfgMatch = inner.match(/<manufacturer[^>]*><description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);
    if (mfgMatch) row.manufacturer = mfgMatch[1].trim();

    if (row.ean || row.purchase_price) rows.push(row);
  }
  return rows;
}

/** Aurdel stock-only XML parser: <item id="SKU"><stock quantity="N"/></item> */
function parseAurdelStockXml(text: string): Map<string, string> {
  const stockMap = new Map<string, string>();
  const itemRegex = /<item\s+id="([^"]*)">\s*<stock\s+quantity="([^"]*)"/gi;
  let match;
  while ((match = itemRegex.exec(text)) !== null) {
    stockMap.set(match[1], match[2]);
  }
  return stockMap;
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

/** Minimal FTP client (passive mode, binary download) using Deno TCP. */
async function downloadViaFtp(host: string, user: string, pass: string, path: string): Promise<string> {
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

      const chunks: Uint8Array[] = [];
      const dbuf = new Uint8Array(65536);
      while (true) {
        const n = await dataConn.read(dbuf);
        if (n === null) break;
        chunks.push(dbuf.slice(0, n));
      }
      dataConn.close();
      await readResponse();
      try { await send("QUIT"); } catch { /* noop */ }

      const total = chunks.reduce((a, c) => a + c.length, 0);
      const merged = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { merged.set(c, off); off += c.length; }
      return decoder.decode(merged);
    }

    throw new Error(`RETR failed: ${lastError || "file not found"}`);
  } finally {
    try { conn.close(); } catch { /* noop */ }
  }
}

Deno.serve(async (req) => {
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

  try {
    const { supplier_id } = await req.json();
    if (!supplier_id) {
      return new Response(JSON.stringify({ error: "supplier_id is required" }), {
        status: 400,
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

    let feedRows: Record<string, string>[];

    if (supplier.feed_type === "api") {
      // Aurdel API: build URL from stored credentials
      const apiDbStr = mapping._api_database || "item";
      const apiDbs = apiDbStr.split(",").map((d: string) => d.trim()).filter(Boolean);
      const apiCust = mapping._api_customer_id;
      const apiComp = mapping._api_company_id;
      const apiKeyVal = mapping._api_key;
      const apiLang = mapping._api_language || "da";
      if (!apiCust || !apiComp) throw new Error("API credentials not configured (customerid, companyid)");

      feedRows = [];

      // First pass: fetch all databases
      let stockMap = new Map<string, string>(); // SKU -> quantity

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
        const res = await fetch(apiUrl);
        if (!res.ok) throw new Error(`API returned status ${res.status} for database=${db}`);
        const text = await res.text();

        if (db === "stock") {
          stockMap = parseAurdelStockXml(text);
          console.log(`Stock database: ${stockMap.size} SKUs with stock data`);
        } else {
          const rows = parseAurdelItemXml(text);
          console.log(`Item database: ${rows.length} items parsed`);
          feedRows.push(...rows);
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
        console.log(`Merged stock data for ${merged} items by SKU`);
      }

      // Set auto-mapping for Aurdel format
      mapping.ean = "ean";
      mapping.purchase_price = "purchase_price";
      mapping.stock_quantity = "stock_quantity";
      mapping.sku = "supplier_sku";
    } else {
      const mappingAny = mapping as Record<string, string>;
      const isFtp = supplier.feed_type === "ftp";

      if (!isFtp) {
        if (!supplier.feed_url) throw new Error("No feed URL configured");
      }
      if (!mapping.ean) throw new Error("EAN mapping not configured");
      if (!mapping.purchase_price) throw new Error("Purchase price mapping not configured");

      const delimiter = mapping._delimiter || ";";

      let text: string;

      if (isFtp) {
        const host = mappingAny._ftp_host?.trim();
        const user = mappingAny._ftp_user?.trim();
        const pass = mappingAny._ftp_pass?.trim();
        const path = mappingAny._ftp_path?.trim();
        if (!host || !path) throw new Error("FTP host og filsti er påkrævet");

        const cleanPath = path.startsWith("/") ? path : `/${path}`;

        // Try HTTP(S) first (many FTP servers also serve files via HTTP)
        let fetched = false;
        for (const scheme of ["https", "http"]) {
          try {
            const url = user && pass
              ? `${scheme}://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}${cleanPath}`
              : `${scheme}://${host}${cleanPath}`;
            console.log(`Trying ${scheme} download from ${host}${cleanPath}`);
            const res = await fetch(url, { redirect: "follow" });
            if (res.ok) {
              text = await res.text();
              fetched = true;
              break;
            }
            console.log(`${scheme} returned ${res.status}`);
          } catch (e) {
            console.log(`${scheme} failed:`, (e as Error).message);
          }
        }

        if (!fetched) {
          // Fallback: real FTP over TCP (passive mode)
          text = await downloadViaFtp(host, user || "anonymous", pass || "", cleanPath);
        }

        text = text!;
      } else {
        const res = await fetch(supplier.feed_url!);
        if (!res.ok) throw new Error(`Failed to fetch feed: ${res.status}`);
        text = await res.text();
      }

      if (supplier.feed_type === "xml") {
        feedRows = parseXml(text);
      } else {
        feedRows = parseCsv(text, delimiter);
      }
    }

    if (feedRows.length === 0) throw new Error("No rows found in feed");

    // Get all existing EANs from master_products
    const { data: masterProducts, error: mpErr } = await supabase
      .from("master_products")
      .select("id, ean");
    if (mpErr) throw new Error(`Failed to fetch master products: ${mpErr.message}`);

    const eanToId = new Map<string, string>();
    for (const mp of masterProducts ?? []) {
      // Normalize stored EAN too: strip leading zeros
      const normEan = mp.ean.replace(/^0+/, "") || mp.ean;
      eanToId.set(normEan, mp.id);
    }

    // Process feed rows - only those matching existing EANs
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

    for (const row of feedRows) {
      const rawEan = row[mapping.ean]?.trim();
      if (!rawEan) { skipped++; continue; }
      // Normalize: strip leading zeros
      const ean = rawEan.replace(/^0+/, "") || rawEan;

      const masterProductId = eanToId.get(ean);
      if (!masterProductId) { skipped++; continue; }

      const priceStr = row[mapping.purchase_price]?.trim().replace(",", ".");
      const price = parseFloat(priceStr);
      if (isNaN(price)) { skipped++; continue; }

      const stockStr = mapping.stock_quantity ? row[mapping.stock_quantity]?.trim() : null;
      const stockQty = stockStr ? parseInt(stockStr, 10) : null;

      let inStock = true;
      if (mapping.in_stock) {
        const val = row[mapping.in_stock]?.trim().toLowerCase();
        inStock = val === "1" || val === "yes" || val === "ja" || val === "true" || val === "in stock" || val === "på lager";
      } else if (stockQty !== null && !isNaN(stockQty)) {
        inStock = stockQty > 0;
      }

      const supplierSku = mapping.sku ? row[mapping.sku]?.trim() || null : null;

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
        // New supplier product link
        changeLogs.push({ master_product_id: masterProductId, change_type: "supplier_added", field_name: "supplier_product", old_value: null, new_value: `${supplier.name}: ${price} DKK`, source: `supplier:${supplier.name}` });
      }

      const spRow = {
        supplier_id: supplier.id,
        master_product_id: masterProductId,
        purchase_price: price,
        stock_quantity: stockQty !== null && !isNaN(stockQty) ? stockQty : null,
        in_stock: inStock,
        supplier_sku: supplierSku,
        last_updated: new Date().toISOString(),
      };

      // Upsert on (supplier_id, master_product_id)
      const { error: upsErr } = await supabase
        .from("supplier_products")
        .upsert(spRow, { onConflict: "supplier_id,master_product_id" });

      if (upsErr) {
        errors.push(`EAN ${ean}: ${upsErr.message}`);
      } else {
        imported++;
      }
    }

    // Insert change logs in batches
    if (changeLogs.length > 0) {
      for (let i = 0; i < changeLogs.length; i += 500) {
        await supabase.from("product_change_log").insert(changeLogs.slice(i, i + 500));
      }
      console.log(`Logged ${changeLogs.length} changes`);
    }

    // Update last_sync_at
    await supabase
      .from("suppliers")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("id", supplier.id);

    return new Response(
      JSON.stringify({
        success: true,
        total_rows: feedRows.length,
        imported,
        skipped,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Supplier feed import error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
