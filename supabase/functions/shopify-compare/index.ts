// Sammenligner PIM (master_products) med Shopify for udvalgte produkter.
// Tjekker: titel, long_description, short_description (metafield), meta_title (seo.title),
// meta_description (seo.description), pris, sale_price, lager, stock_status.
// Mode: 'report' (default) = kun rapport. 'apply' = opdater Shopify ud fra PIM.
// Filter: { brand?: string, eans?: string[], limit?: number, ignoreVariantTitle?: boolean,
//          shortDescMetafield?: { namespace: string, key: string } }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_VERSION = "2025-10";

async function gql(shop: string, token: string, query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`Shopify GQL ${res.status}: ${JSON.stringify(json.errors || json)}`);
  return json.data;
}

// Afkod HTML-entities (numeriske + navngivne) til rigtige unicode-tegn
function decodeHtmlEntities(s: string): string {
  if (!s) return "";
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»",
    lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", copy: "©", reg: "®",
    trade: "™", deg: "°", euro: "€", pound: "£", yen: "¥", cent: "¢",
    middot: "·", bull: "•", times: "×", divide: "÷", plusmn: "±",
    aelig: "æ", oslash: "ø", aring: "å", AElig: "Æ", Oslash: "Ø", Aring: "Å",
  };
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return _; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return _; } })
    .replace(/&([a-zA-Z]+);/g, (m, n) => named[n] ?? named[n.toLowerCase()] ?? m);
}

function stripHtml(s: string | null | undefined): string {
  if (!s) return "";
  const decoded = decodeHtmlEntities(String(s));
  return decoded.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// Udtræk plain text fra Shopify rich_text_field JSON-AST
function extractRichText(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractRichText).join(" ");
  if (typeof node === "object") {
    if (typeof node.value === "string") return node.value;
    if (Array.isArray(node.children)) return node.children.map(extractRichText).join(" ");
  }
  return "";
}

// Normalisér en metafield-værdi til plain text uanset type (rich_text_field JSON eller HTML)
function normalizeMetafieldText(value: string | null | undefined, type?: string | null): string {
  if (!value) return "";
  const v = String(value).trim();
  if (type === "rich_text_field" || (v.startsWith("{") && v.includes('"type"'))) {
    try { return decodeHtmlEntities(extractRichText(JSON.parse(v))).replace(/\s+/g, " ").trim(); }
    catch { /* fall through */ }
  }
  return stripHtml(v);
}

// Konvertér PIM HTML/plain-text til Shopify rich_text_field JSON-AST
function htmlToRichText(html: string | null | undefined): string {
  const text = stripHtml(html);
  if (!text) return JSON.stringify({ type: "root", children: [] });
  // Split på dobbelt newline / punktum-grænser? Hold det enkelt: ét paragraph pr. blok
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const blocks = (paragraphs.length ? paragraphs : [text]).map(p => ({
    type: "paragraph",
    children: [{ type: "text", value: p }],
  }));
  return JSON.stringify({ type: "root", children: blocks });
}
function normNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function normText(s: string | null | undefined): string {
  return (s ?? "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!authHeader.includes(SUPABASE_SERVICE_ROLE_KEY)) {
      const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
      const { data: { user }, error } = await anon.auth.getUser();
      if (error || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const mode: "report" | "apply" = body.mode === "apply" ? "apply" : "report";
    const brand: string | null = body.brand ?? null;
    const eans: string[] | null = Array.isArray(body.eans) ? body.eans : null;
    const limit: number = Math.min(Number(body.limit) || 20, 100);
    const ignoreVariantTitle: boolean = body.ignoreVariantTitle !== false; // default true
    const shortDescMf = body.shortDescMetafield ?? { namespace: "custom", key: "short_description" };
    const probe: boolean = body.probe === true; // returnerer rå Shopify metafields til debugging

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: conn } = await supabase
      .from("shopify_connection")
      .select("shop_domain, access_token")
      .order("is_active", { ascending: false })
      .order("installed_at", { ascending: false })
      .limit(1).maybeSingle();
    if (!conn) throw new Error("Ingen Shopify-forbindelse");

    let q = supabase.from("master_products")
      .select("id, ean, sku, title, short_description, long_description, meta_title, meta_description, webshop_price, sale_price, stock_quantity, stock_status, backorders_allowed, shopify_product_id, shopify_variant_id")
      .not("shopify_variant_id", "is", null);
    if (eans && eans.length) q = q.in("ean", eans);
    else if (brand) q = q.or(`brand.ilike.%${brand}%,title.ilike.%${brand}%`);
    q = q.order("title").limit(limit);

    const { data: pimRows, error } = await q;
    if (error) throw error;
    if (!pimRows || pimRows.length === 0) {
      return new Response(JSON.stringify({ success: true, mode, message: "Ingen PIM-produkter matchede filteret", results: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const productGids = Array.from(new Set(pimRows.map(r => `gid://shopify/Product/${r.shopify_product_id}`)));
    const variantGids = pimRows.map(r => `gid://shopify/ProductVariant/${r.shopify_variant_id}`);

    // Hent produkt-data inkl. SEO + alle metafields (op til 250)
    const productData = await gql(conn.shop_domain, conn.access_token, `
      query($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id title descriptionHtml
            seo { title description }
            metafields(first: 250) {
              nodes { namespace key value type }
            }
          }
        }
      }`, { ids: productGids });

    const variantData = await gql(conn.shop_domain, conn.access_token, `
      query($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id title sku barcode price compareAtPrice inventoryPolicy inventoryQuantity
            inventoryItem { id }
            product { id title }
          }
        }
      }`, { ids: variantGids });

    const productMap = new Map<string, any>();
    for (const n of productData.nodes ?? []) if (n) productMap.set(n.id.replace("gid://shopify/Product/", ""), n);
    const variantMap = new Map<string, any>();
    for (const n of variantData.nodes ?? []) if (n) variantMap.set(n.id.replace("gid://shopify/ProductVariant/", ""), n);

    if (probe) {
      // returnér rå metafields så vi kan se hvilke namespace/keys der findes
      const probeOut = Array.from(productMap.entries()).map(([pid, p]) => ({
        product_id: pid, title: p.title,
        seo: p.seo,
        metafields: (p.metafields?.nodes ?? []).map((m: any) => ({ ns: m.namespace, key: m.key, type: m.type, preview: String(m.value ?? "").slice(0, 80) })),
      }));
      return new Response(JSON.stringify({ success: true, probe: true, products: probeOut }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let locationId: string | null = null;
    if (mode === "apply") {
      const loc = await gql(conn.shop_domain, conn.access_token, `query { locations(first: 1) { nodes { id } } }`);
      locationId = loc.locations?.nodes?.[0]?.id ?? null;
    }

    const results: any[] = [];
    let appliedCount = 0;

    for (const p of pimRows) {
      const sp = productMap.get(p.shopify_product_id);
      const sv = variantMap.get(p.shopify_variant_id);
      if (!sp || !sv) {
        results.push({ ean: p.ean, title: p.title, error: "Shopify produkt/variant ikke fundet" });
        continue;
      }

      const diffs: any[] = [];

      // === TITEL ===
      if (!ignoreVariantTitle) {
        if (normText(p.title) !== normText(sp.title)) {
          diffs.push({ field: "title", pim: p.title, shopify: sp.title });
        }
      }

      // === LONG DESCRIPTION ===
      const pimLong = stripHtml(p.long_description);
      const shopLong = stripHtml(sp.descriptionHtml);
      if (pimLong !== shopLong) {
        diffs.push({ field: "long_description", pim_len: pimLong.length, shopify_len: shopLong.length, pim_preview: pimLong.slice(0, 100), shopify_preview: shopLong.slice(0, 100) });
      }

      // === SHORT DESCRIPTION (metafield) ===
      const mfNodes = sp.metafields?.nodes ?? [];
      const shortMf = mfNodes.find((m: any) => m.namespace === shortDescMf.namespace && m.key === shortDescMf.key);
      const pimShort = stripHtml(p.short_description);
      const shopShort = normalizeMetafieldText(shortMf?.value, shortMf?.type);
      if (pimShort !== shopShort) {
        diffs.push({
          field: "short_description",
          metafield: `${shortDescMf.namespace}.${shortDescMf.key}`,
          shopify_metafield_type: shortMf?.type ?? null,
          pim_len: pimShort.length,
          shopify_len: shopShort.length,
          pim_preview: pimShort.slice(0, 100),
          shopify_preview: shopShort.slice(0, 100),
          shopify_has_metafield: Boolean(shortMf),
        });
      }

      // === META TITLE (SEO) ===
      const pimMetaTitle = normText(p.meta_title);
      const shopMetaTitle = normText(sp.seo?.title);
      if (pimMetaTitle !== shopMetaTitle) {
        diffs.push({ field: "meta_title", pim: pimMetaTitle, shopify: shopMetaTitle });
      }

      // === META DESCRIPTION (SEO) ===
      const pimMetaDesc = normText(p.meta_description);
      const shopMetaDesc = normText(sp.seo?.description);
      if (pimMetaDesc !== shopMetaDesc) {
        diffs.push({ field: "meta_description", pim_len: pimMetaDesc.length, shopify_len: shopMetaDesc.length, pim_preview: pimMetaDesc.slice(0, 100), shopify_preview: shopMetaDesc.slice(0, 100) });
      }

      // === PRIS ===
      const pimPrice = normNum(p.webshop_price);
      const shopPrice = normNum(sv.price);
      if (pimPrice !== shopPrice) diffs.push({ field: "price", pim: pimPrice, shopify: shopPrice });

      const pimSale = normNum(p.sale_price);
      const shopSale = normNum(sv.compareAtPrice);
      if (pimSale !== shopSale) diffs.push({ field: "sale_price", pim: pimSale, shopify: shopSale });

      // === LAGER ===
      const pimQty = normNum(p.stock_quantity) ?? 0;
      const shopQty = normNum(sv.inventoryQuantity) ?? 0;
      if (pimQty !== shopQty) diffs.push({ field: "stock_quantity", pim: pimQty, shopify: shopQty });

      const pimPolicy = p.backorders_allowed ? "CONTINUE" : "DENY";
      if (pimPolicy !== sv.inventoryPolicy) diffs.push({ field: "inventoryPolicy", pim: pimPolicy, shopify: sv.inventoryPolicy });

      const entry: any = {
        ean: p.ean, sku: p.sku, title: p.title,
        shopify_product_id: p.shopify_product_id,
        shopify_variant_id: p.shopify_variant_id,
        in_sync: diffs.length === 0,
        diffs,
      };

      if (mode === "apply" && diffs.length > 0) {
        const applied: string[] = [];
        try {
          // Product update: title (kun hvis ikke ignoreret), descriptionHtml, seo
          const productInput: Record<string, unknown> = { id: `gid://shopify/Product/${p.shopify_product_id}` };
          let productNeedsUpdate = false;
          if (!ignoreVariantTitle && p.title && p.title !== sp.title) {
            productInput.title = p.title; applied.push("title"); productNeedsUpdate = true;
          }
          if (p.long_description && pimLong !== shopLong) {
            productInput.descriptionHtml = p.long_description; applied.push("long_description"); productNeedsUpdate = true;
          }
          const seoUpdate: Record<string, unknown> = {};
          if (pimMetaTitle !== shopMetaTitle) { seoUpdate.title = pimMetaTitle; applied.push("meta_title"); }
          if (pimMetaDesc !== shopMetaDesc) { seoUpdate.description = pimMetaDesc; applied.push("meta_description"); }
          if (Object.keys(seoUpdate).length) { productInput.seo = seoUpdate; productNeedsUpdate = true; }

          if (productNeedsUpdate) {
            const r = await gql(conn.shop_domain, conn.access_token, `
              mutation($input: ProductInput!) {
                productUpdate(input: $input) { product { id } userErrors { field message } }
              }`, { input: productInput });
            const errs = r.productUpdate?.userErrors;
            if (errs?.length) throw new Error(`productUpdate: ${errs.map((e: any) => e.message).join(", ")}`);
          }

          // Short description som metafield via metafieldsSet
          if (pimShort !== shopShort && p.short_description) {
            const mfType = shortMf?.type ?? "rich_text_field";
            const mfValue = mfType === "rich_text_field"
              ? htmlToRichText(p.short_description)
              : p.short_description;
            const r = await gql(conn.shop_domain, conn.access_token, `
              mutation($metafields: [MetafieldsSetInput!]!) {
                metafieldsSet(metafields: $metafields) {
                  metafields { id }
                  userErrors { field message }
                }
              }`, {
                metafields: [{
                  ownerId: `gid://shopify/Product/${p.shopify_product_id}`,
                  namespace: shortDescMf.namespace,
                  key: shortDescMf.key,
                  type: mfType,
                  value: mfValue,
                }],
              });
            const errs = r.metafieldsSet?.userErrors;
            if (errs?.length) throw new Error(`metafieldsSet: ${errs.map((e: any) => e.message).join(", ")}`);
            applied.push("short_description");
          }

          // Variant update: pris, sale_price, inventoryPolicy
          const variantInput: Record<string, unknown> = { id: `gid://shopify/ProductVariant/${p.shopify_variant_id}` };
          let variantNeeds = false;
          if (pimPrice !== null && pimPrice !== shopPrice) { variantInput.price = String(pimPrice); applied.push("price"); variantNeeds = true; }
          if (pimSale !== shopSale) { variantInput.compareAtPrice = pimSale !== null ? String(pimSale) : null; applied.push("sale_price"); variantNeeds = true; }
          if (pimPolicy !== sv.inventoryPolicy) { variantInput.inventoryPolicy = pimPolicy; applied.push("inventoryPolicy"); variantNeeds = true; }
          if (variantNeeds) {
            const r = await gql(conn.shop_domain, conn.access_token, `
              mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
                productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                  userErrors { field message }
                }
              }`, { productId: `gid://shopify/Product/${p.shopify_product_id}`, variants: [variantInput] });
            const errs = r.productVariantsBulkUpdate?.userErrors;
            if (errs?.length) throw new Error(`variantsBulkUpdate: ${errs.map((e: any) => e.message).join(", ")}`);
          }

          if (pimQty !== shopQty && locationId && sv.inventoryItem?.id) {
            const delta = pimQty - shopQty;
            const r = await gql(conn.shop_domain, conn.access_token, `
              mutation($input: InventoryAdjustQuantitiesInput!) {
                inventoryAdjustQuantities(input: $input) { userErrors { field message } }
              }`, {
                input: { name: "available", reason: "correction",
                  changes: [{ inventoryItemId: sv.inventoryItem.id, locationId, delta }] }
              });
            const errs = r.inventoryAdjustQuantities?.userErrors;
            if (errs?.length) throw new Error(`inventoryAdjust: ${errs.map((e: any) => e.message).join(", ")}`);
            applied.push("stock_quantity");
          }

          entry.applied = applied;
          appliedCount++;
        } catch (e: any) {
          entry.apply_error = e.message;
        }
      }

      results.push(entry);
    }

    const summary = {
      mode,
      total: results.length,
      in_sync: results.filter(r => r.in_sync).length,
      out_of_sync: results.filter(r => !r.in_sync && !r.error).length,
      errors: results.filter(r => r.error).length,
      applied: appliedCount,
      ignored_variant_title: ignoreVariantTitle,
      short_desc_metafield: `${shortDescMf.namespace}.${shortDescMf.key}`,
    };

    return new Response(JSON.stringify({ success: true, summary, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("shopify-compare error:", err);
    return new Response(JSON.stringify({ success: false, error: err?.message ?? String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
