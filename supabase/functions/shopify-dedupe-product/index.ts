import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_VERSION = "2026-04";

type ShopifyProduct = {
  id: string;
  legacyResourceId: string;
  title: string;
  handle: string;
  status: string;
  vendor: string | null;
  createdAt: string;
  updatedAt: string;
  variants: { nodes: Array<{ id: string; legacyResourceId: string; sku: string | null; barcode: string | null; title: string | null }> };
};

function normEan(value: unknown) {
  return String(value ?? "").trim().replace(/^0+/, "");
}

function normTitle(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

async function requireUser(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return false;
  if (authHeader.includes(SUPABASE_SERVICE_ROLE_KEY)) return true;
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error } = await anon.auth.getUser();
  return !error && Boolean(user);
}

async function gql(shopDomain: string, token: string, query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(`https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`Shopify GraphQL ${res.status}: ${JSON.stringify(json.errors || json)}`);
  return json.data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!(await requireUser(req))) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const ean = String(body.ean ?? "0810084698426");
    const title = String(body.title ?? "Ubiquiti UniFi CloudKey+ SSD");
    const apply = body.apply === true;
    const deleteProductId = body.delete_product_id ? String(body.delete_product_id) : null;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: conn, error: connErr } = await supabase
      .from("shopify_connection")
      .select("shop_domain, requested_shop_domain, shop_name, access_token")
      .eq("is_active", true)
      .maybeSingle();
    if (connErr) throw connErr;
    if (!conn) throw new Error("Ingen aktiv Shopify-forbindelse");

    const { data: pimRows, error: pimErr } = await supabase
      .from("master_products")
      .select("id, ean, title, sku, shopify_product_id, shopify_variant_id")
      .or(`ean.eq.${ean},title.ilike.%${title}%`);
    if (pimErr) throw pimErr;

    const expectedPim = (pimRows ?? []).find((row) => normEan(row.ean) === normEan(ean)) ?? pimRows?.[0] ?? null;
    const linkedProductId = expectedPim?.shopify_product_id ? String(expectedPim.shopify_product_id) : null;

    const search = `title:${title.replace(/"/g, "")}`;
    const data = await gql(conn.shop_domain, conn.access_token, `
      query($query: String!) {
        products(first: 20, query: $query) {
          nodes {
            id legacyResourceId title handle status vendor createdAt updatedAt
            variants(first: 20) { nodes { id legacyResourceId sku barcode title } }
          }
        }
      }
    `, { query: search });

    const products: ShopifyProduct[] = data.products?.nodes ?? [];
    const titleMatches = products.filter((product) => normTitle(product.title) === normTitle(title));
    const eanMatches = titleMatches.filter((product) => product.variants.nodes.some((variant) => normEan(variant.barcode) === normEan(ean)));
    const candidates = titleMatches.length ? titleMatches : eanMatches;

    const annotated = candidates.map((product) => {
      const variants = product.variants.nodes.map((variant) => ({
        variant_id: variant.legacyResourceId,
        sku: variant.sku,
        barcode: variant.barcode,
        title: variant.title,
        ean_match: normEan(variant.barcode) === normEan(ean),
        linked_variant: expectedPim?.shopify_variant_id ? String(expectedPim.shopify_variant_id) === String(variant.legacyResourceId) : false,
      }));
      return {
        product_id: product.legacyResourceId,
        gid: product.id,
        title: product.title,
        handle: product.handle,
        status: product.status,
        vendor: product.vendor,
        created_at: product.createdAt,
        updated_at: product.updatedAt,
        linked_in_pim: linkedProductId === String(product.legacyResourceId),
        has_ean_match: variants.some((variant) => variant.ean_match),
        variants,
      };
    });

    const safeDeleteIds = annotated
      .filter((product) => !product.linked_in_pim && annotated.some((other) => other.linked_in_pim))
      .map((product) => product.product_id);

    if (apply) {
      if (!deleteProductId) throw new Error("delete_product_id er påkrævet ved apply=true");
      if (!safeDeleteIds.includes(deleteProductId)) {
        throw new Error(`Afviser sletning: ${deleteProductId} er ikke en entydig ikke-PIM-linket dublet`);
      }
      const deleted = annotated.find((product) => product.product_id === deleteProductId)!;
      const result = await gql(conn.shop_domain, conn.access_token, `
        mutation($input: ProductDeleteInput!) {
          productDelete(input: $input) { deletedProductId userErrors { field message } }
        }
      `, { input: { id: deleted.gid } });
      const errors = result.productDelete?.userErrors ?? [];
      if (errors.length) throw new Error(`Shopify afviste sletning: ${errors.map((e: any) => e.message).join(", ")}`);
      return new Response(JSON.stringify({ success: true, deleted_product_id: deleteProductId, deleted_title: deleted.title, kept_product_id: linkedProductId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      dry_run: true,
      shopify_connection: {
        api_domain: conn.shop_domain,
        display_domain: conn.requested_shop_domain,
        shop_name: conn.shop_name,
      },
      pim: expectedPim,
      searched: { ean, normalized_ean: normEan(ean), title },
      shopify_matches: annotated,
      safe_delete_product_ids: safeDeleteIds,
      recommendation: safeDeleteIds.length === 1
        ? `Kan slette dubletten ${safeDeleteIds[0]} og beholde PIM-linket ${linkedProductId}`
        : "Ingen entydig dublet fundet til automatisk sletning",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("shopify-dedupe-product error", err);
    return new Response(JSON.stringify({ success: false, error: err?.message ?? String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
