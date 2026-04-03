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
    if (eanMatch) row.ean = eanMatch[1].trim();

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Auth check: require authenticated user or service role
  const authHeader = req.headers.get("authorization");
  if (authHeader && !authHeader.includes(SUPABASE_SERVICE_ROLE_KEY)) {
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
      const stockData = new Map<string, Record<string, string>>();

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
        const rows = parseXml(text);
        console.log(`Database ${db}: ${rows.length} rows`);

        if (db === "stock" && apiDbs.length > 1) {
          // Store stock data to merge with item data
          for (const row of rows) {
            const ean = Object.entries(row).find(([k]) => /ean|barcode|gtin/i.test(k))?.[1];
            if (ean) stockData.set(ean.trim(), row);
          }
        } else {
          feedRows.push(...rows);
        }
      }

      // Merge stock data into item rows if both databases were fetched
      if (stockData.size > 0 && feedRows.length > 0) {
        const sampleKeys = Object.keys(feedRows[0]);
        const eanKey = sampleKeys.find(k => /ean|barcode|gtin/i.test(k));
        if (eanKey) {
          for (const row of feedRows) {
            const ean = row[eanKey]?.trim();
            if (ean && stockData.has(ean)) {
              const stock = stockData.get(ean)!;
              // Merge stock fields into the item row (stock fields take priority for stock-related data)
              for (const [k, v] of Object.entries(stock)) {
                if (/stock|lager|qty|quantity|antal|available/i.test(k) && !row[k]) {
                  row[k] = v;
                }
              }
            }
          }
        }
        console.log(`Merged stock data for ${stockData.size} EANs`);
      }
    } else {
      if (!supplier.feed_url) throw new Error("No feed URL configured");
      if (!mapping.ean) throw new Error("EAN mapping not configured");
      if (!mapping.purchase_price) throw new Error("Purchase price mapping not configured");

      const delimiter = mapping._delimiter || ";";

      const res = await fetch(supplier.feed_url);
      if (!res.ok) throw new Error(`Failed to fetch feed: ${res.status}`);
      const text = await res.text();

      if (supplier.feed_type === "xml") {
        feedRows = parseXml(text);
      } else {
        feedRows = parseCsv(text, delimiter);
      }
    }

    // For API type, auto-detect EAN/price mapping from Aurdel XML if not set
    if (supplier.feed_type === "api" && (!mapping.ean || !mapping.purchase_price) && feedRows.length > 0) {
      const sampleKeys = Object.keys(feedRows[0]);
      console.log("API feed sample keys:", sampleKeys.join(", "));
      // Common Aurdel field names
      const eanField = sampleKeys.find(k => /ean|barcode|gtin/i.test(k));
      const priceField = sampleKeys.find(k => /price|pris/i.test(k));
      if (!eanField) throw new Error(`Could not auto-detect EAN field. Available fields: ${sampleKeys.join(", ")}`);
      if (!priceField) throw new Error(`Could not auto-detect price field. Available fields: ${sampleKeys.join(", ")}`);
      mapping.ean = eanField;
      mapping.purchase_price = priceField;
      // Also try stock
      const stockField = sampleKeys.find(k => /stock|lager|qty|quantity|antal/i.test(k));
      if (stockField) mapping.stock_quantity = stockField;
    } else if (supplier.feed_type !== "api") {
      if (!mapping.ean) throw new Error("EAN mapping not configured");
      if (!mapping.purchase_price) throw new Error("Purchase price mapping not configured");
    }

    if (feedRows.length === 0) throw new Error("No rows found in feed");

    // Get all existing EANs from master_products
    const { data: masterProducts, error: mpErr } = await supabase
      .from("master_products")
      .select("id, ean");
    if (mpErr) throw new Error(`Failed to fetch master products: ${mpErr.message}`);

    const eanToId = new Map<string, string>();
    for (const mp of masterProducts ?? []) {
      eanToId.set(mp.ean, mp.id);
    }

    // Process feed rows - only those matching existing EANs
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const row of feedRows) {
      const ean = row[mapping.ean]?.trim();
      if (!ean) { skipped++; continue; }

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
