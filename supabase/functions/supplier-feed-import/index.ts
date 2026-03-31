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
  // Try to find product-like elements
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
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

    if (!supplier.feed_url) throw new Error("No feed URL configured");

    const mapping = (supplier.column_mapping ?? {}) as Record<string, string>;
    if (!mapping.ean) throw new Error("EAN mapping not configured");
    if (!mapping.purchase_price) throw new Error("Purchase price mapping not configured");

    const delimiter = mapping._delimiter || ";";

    // Fetch feed
    const res = await fetch(supplier.feed_url);
    if (!res.ok) throw new Error(`Failed to fetch feed: ${res.status}`);
    const text = await res.text();

    // Parse
    let feedRows: Record<string, string>[];
    if (supplier.feed_type === "xml") {
      feedRows = parseXml(text);
    } else {
      feedRows = parseCsv(text, delimiter);
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
