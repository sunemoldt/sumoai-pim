// Matcher PIM-produkter (master_products) med Shopify-varianter via EAN (barcode).
// Opretter INTET nyt i PIM. Sætter kun shopify_product_id + shopify_variant_id på eksisterende produkter.
// Kan køres med ?ean=xxx for at teste et enkelt produkt.

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth
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

  // Parse body
  let body: any = {};
  try { body = await req.clone().json().catch(() => ({})); } catch (_) {}
  const url = new URL(req.url);
  const filterEan = body.ean || url.searchParams.get("ean") || null;
  const dryRun = body.dryRun === true || url.searchParams.get("dryRun") === "true";

  try {
    // 1. Hent Shopify connection
    const { data: conn, error: connErr } = await supabase
      .from("shopify_connection")
      .select("shop_domain, access_token")
      .order("installed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (connErr) throw connErr;
    if (!conn) throw new Error("Ingen Shopify-forbindelse fundet. Installer appen først.");

    const shopDomain = conn.shop_domain;
    const token = conn.access_token;

    // 2. Hent alle Shopify-varianter via GraphQL (paginated)
    const variants: Array<{ productId: string; variantId: string; barcode: string; sku: string; productTitle: string; variantTitle: string }> = [];
    let cursor: string | null = null;
    let pages = 0;
    const MAX_PAGES = 50;

    while (pages < MAX_PAGES) {
      const query = `
        query($cursor: String) {
          productVariants(first: 250, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              barcode
              sku
              title
              product { id title }
            }
          }
        }
      `;
      const res = await fetch(`https://${shopDomain}/admin/api/2025-01/graphql.json`, {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables: { cursor } }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Shopify GraphQL error [${res.status}]: ${errText}`);
      }
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
      const pageInfo = json.data?.productVariants?.pageInfo;
      if (!pageInfo?.hasNextPage) break;
      cursor = pageInfo.endCursor;
      pages++;
    }

    // 3. Byg EAN-map (normaliseret)
    const variantsByEan = new Map<string, typeof variants[number]>();
    let variantsWithBarcode = 0;
    for (const v of variants) {
      const ean = normEan(v.barcode);
      if (ean) {
        variantsWithBarcode++;
        if (!variantsByEan.has(ean)) variantsByEan.set(ean, v);
      }
    }

    // 4. Hent PIM produkter
    let pimQuery = supabase
      .from("master_products")
      .select("id, ean, title, shopify_product_id, shopify_variant_id");
    if (filterEan) pimQuery = pimQuery.eq("ean", filterEan);
    const { data: pimProducts, error: pimErr } = await pimQuery;
    if (pimErr) throw pimErr;

    // 5. Match og opdater
    const matched: Array<{ ean: string; pim_title: string; shopify_title: string; product_id: string; variant_id: string }> = [];
    const unmatched: Array<{ ean: string; pim_title: string }> = [];
    let updated = 0;
    let alreadyMatched = 0;

    for (const p of pimProducts ?? []) {
      const ean = normEan(p.ean);
      if (!ean) {
        unmatched.push({ ean: p.ean ?? "(tom)", pim_title: p.title });
        continue;
      }
      const v = variantsByEan.get(ean);
      if (!v) {
        unmatched.push({ ean: p.ean, pim_title: p.title });
        continue;
      }

      const isAlreadyMatched =
        p.shopify_product_id === v.productId && p.shopify_variant_id === v.variantId;

      if (isAlreadyMatched) {
        alreadyMatched++;
        matched.push({
          ean: p.ean,
          pim_title: p.title,
          shopify_title: `${v.productTitle} ${v.variantTitle !== "Default Title" ? "/ " + v.variantTitle : ""}`.trim(),
          product_id: v.productId,
          variant_id: v.variantId,
        });
        continue;
      }

      if (!dryRun) {
        const { error: upErr } = await supabase
          .from("master_products")
          .update({
            shopify_product_id: v.productId,
            shopify_variant_id: v.variantId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", p.id);
        if (upErr) {
          console.error("Update error", p.ean, upErr);
          continue;
        }
        updated++;
      }

      matched.push({
        ean: p.ean,
        pim_title: p.title,
        shopify_title: `${v.productTitle} ${v.variantTitle !== "Default Title" ? "/ " + v.variantTitle : ""}`.trim(),
        product_id: v.productId,
        variant_id: v.variantId,
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        dryRun,
        shopify: {
          shop_domain: shopDomain,
          total_variants: variants.length,
          variants_with_barcode: variantsWithBarcode,
          unique_eans: variantsByEan.size,
        },
        pim: {
          total_products: pimProducts?.length ?? 0,
          matched: matched.length,
          unmatched: unmatched.length,
          newly_updated: updated,
          already_matched: alreadyMatched,
        },
        matched_sample: matched.slice(0, 10),
        unmatched_sample: unmatched.slice(0, 10),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("shopify-match error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err?.message ?? String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
