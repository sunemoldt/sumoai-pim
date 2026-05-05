// Matcher PIM-produkter (master_products) med Shopify-varianter.
// Match-prioritet: 1) EAN/barcode (normaliseret), 2) SKU (case-insensitive), 3) Titel exact (case-insensitive).
// Opretter INTET nyt i PIM. Sætter kun shopify_product_id + shopify_variant_id.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function normEan(v: string | null | undefined): string {
  if (!v) return "";
  return String(v).trim().replace(/^0+/, "");
}
function normSku(v: string | null | undefined): string {
  if (!v) return "";
  return String(v).trim().toLowerCase();
}
function normTitle(v: string | null | undefined): string {
  if (!v) return "";
  return String(v).trim().toLowerCase().replace(/\s+/g, " ");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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
    const { data: { user }, error } = await anonClient.auth.getUser();
    if (error || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let body: any = {};
  try { body = await req.clone().json().catch(() => ({})); } catch (_) {}
  const url = new URL(req.url);
  const filterEan = body.ean || url.searchParams.get("ean") || null;
  const dryRun = body.dryRun === true || url.searchParams.get("dryRun") === "true";

  try {
    const { data: conn, error: connErr } = await supabase
      .from("shopify_connection")
      .select("shop_domain, access_token")
      .order("is_active", { ascending: false })
      .order("installed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (connErr) throw connErr;
    if (!conn) throw new Error("Ingen Shopify-forbindelse fundet.");

    const shopDomain = conn.shop_domain;
    const token = conn.access_token;

    // Hent alle Shopify-varianter
    type V = { productId: string; variantId: string; barcode: string; sku: string; productTitle: string; variantTitle: string };
    const variants: V[] = [];
    let cursor: string | null = null;
    let pages = 0;
    const MAX_PAGES = 50;

    while (pages < MAX_PAGES) {
      const query = `
        query($cursor: String) {
          productVariants(first: 250, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id barcode sku title
              product { id title }
            }
          }
        }
      `;
      const res = await fetch(`https://${shopDomain}/admin/api/2026-04/graphql.json`, {
        method: "POST",
        headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables: { cursor } }),
      });
      if (!res.ok) throw new Error(`Shopify GraphQL [${res.status}]: ${await res.text()}`);
      const json = await res.json();
      if (json.errors) throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
      const nodes = json.data?.productVariants?.nodes ?? [];
      for (const n of nodes) {
        variants.push({
          productId: n.product.id.replace("gid://shopify/Product/", ""),
          variantId: n.id.replace("gid://shopify/ProductVariant/", ""),
          barcode: n.barcode || "",
          sku: n.sku || "",
          productTitle: n.product.title,
          variantTitle: n.title,
        });
      }
      const pi = json.data?.productVariants?.pageInfo;
      if (!pi?.hasNextPage) break;
      cursor = pi.endCursor;
      pages++;
    }

    // Byg lookup-maps
    const byEan = new Map<string, V>();
    const bySku = new Map<string, V>();
    const byTitle = new Map<string, V>();
    let withBarcode = 0, withSku = 0;
    for (const v of variants) {
      const ean = normEan(v.barcode);
      const sku = normSku(v.sku);
      const t = normTitle(v.productTitle);
      if (ean) { withBarcode++; if (!byEan.has(ean)) byEan.set(ean, v); }
      if (sku) { withSku++; if (!bySku.has(sku)) bySku.set(sku, v); }
      if (t && !byTitle.has(t)) byTitle.set(t, v);
    }

    // Hent PIM
    let q = supabase.from("master_products").select("id, ean, sku, title, shopify_product_id, shopify_variant_id");
    if (filterEan) q = q.eq("ean", filterEan);
    const { data: pimProducts, error: pimErr } = await q;
    if (pimErr) throw pimErr;

    const matched: any[] = [];
    const unmatched: any[] = [];
    let updated = 0, alreadyMatched = 0;
    const matchStats = { ean: 0, sku: 0, title: 0 };

    for (const p of pimProducts ?? []) {
      const ean = normEan(p.ean);
      const sku = normSku(p.sku);
      const title = normTitle(p.title);

      let v: V | undefined;
      let method = "";
      if (ean && byEan.has(ean)) { v = byEan.get(ean); method = "ean"; }
      else if (sku && bySku.has(sku)) { v = bySku.get(sku); method = "sku"; }
      else if (title && byTitle.has(title)) { v = byTitle.get(title); method = "title"; }

      if (!v) {
        unmatched.push({ ean: p.ean, sku: p.sku, title: p.title });
        continue;
      }

      matchStats[method as keyof typeof matchStats]++;

      const isAlready = p.shopify_product_id === v.productId && p.shopify_variant_id === v.variantId;
      if (isAlready) {
        alreadyMatched++;
      } else if (!dryRun) {
        const { error: upErr } = await supabase
          .from("master_products")
          .update({
            shopify_product_id: v.productId,
            shopify_variant_id: v.variantId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", p.id);
        if (upErr) { console.error("Update", p.ean, upErr); continue; }
        updated++;
      }

      matched.push({
        method,
        ean: p.ean, sku: p.sku, pim_title: p.title,
        shopify_title: v.productTitle,
        shopify_barcode: v.barcode, shopify_sku: v.sku,
        product_id: v.productId, variant_id: v.variantId,
      });
    }

    return new Response(JSON.stringify({
      success: true, dryRun,
      shopify: {
        shop_domain: shopDomain,
        total_variants: variants.length,
        with_barcode: withBarcode, with_sku: withSku,
        unique_eans: byEan.size, unique_skus: bySku.size,
      },
      pim: {
        total: pimProducts?.length ?? 0,
        matched: matched.length, unmatched: unmatched.length,
        newly_updated: updated, already_matched: alreadyMatched,
        match_methods: matchStats,
      },
      matched_sample: matched.slice(0, 10),
      unmatched_sample: unmatched.slice(0, 15),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("shopify-match error:", err);
    return new Response(JSON.stringify({ success: false, error: err?.message ?? String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
