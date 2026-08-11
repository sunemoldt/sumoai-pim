// Repair tool: refresh master_products.image_url from Shopify.
// Shopify media can be replaced/deleted, leaving dead CDN URLs in PIM (404 -> broken image).
// This pulls the current variant/featured image for every linked product and updates
// image_url when it differs from what PIM has stored.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_VERSION = "2026-04";

async function requireUser(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return false;
  if (authHeader.includes(SUPABASE_SERVICE_ROLE_KEY)) return true;
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await anon.auth.getUser();
  return !error && Boolean(user);
}

async function gql(shop: string, token: string, query: string, variables: Record<string, unknown>) {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (!res.ok || data.errors) throw new Error(`Shopify ${res.status}: ${JSON.stringify(data.errors || data)}`);
  return data.data;
}

const NODES_QUERY = `#graphql
  query Products($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        featuredImage { url }
        variants(first: 100) { nodes { id image { url } } }
      }
    }
  }`;

const toProductGid = (id: string) => (id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`);
const toVariantGid = (id: string) => (id.startsWith("gid://") ? id : `gid://shopify/ProductVariant/${id}`);

async function isDead(url: string) {
  try {
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok) return true;
    const ct = res.headers.get("content-type") ?? "";
    return !ct.startsWith("image/");
  } catch {
    return true;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!(await requireUser(req))) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = await req.json().catch(() => ({}));
    // only_broken (default true): only replace URLs that no longer resolve to an image
    const onlyBroken = body.only_broken !== false;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: conn } = await supabase
      .from("shopify_connection")
      .select("shop_domain, access_token")
      .order("is_active", { ascending: false })
      .order("installed_at", { ascending: false })
      .limit(1).maybeSingle();
    if (!conn) {
      return new Response(JSON.stringify({ error: "Shopify er ikke forbundet" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: products, error } = await supabase
      .from("master_products")
      .select("id, title, image_url, shopify_product_id, shopify_variant_id")
      .not("shopify_product_id", "is", null);
    if (error) throw error;

    // Find candidates
    let candidates = products ?? [];
    if (onlyBroken) {
      const checked: typeof candidates = [];
      const withUrl = candidates.filter((p) => p.image_url);
      const noUrl = candidates.filter((p) => !p.image_url);
      const CHUNK = 25;
      for (let i = 0; i < withUrl.length; i += CHUNK) {
        const slice = withUrl.slice(i, i + CHUNK);
        const results = await Promise.all(slice.map((p) => isDead(p.image_url as string)));
        slice.forEach((p, idx) => { if (results[idx]) checked.push(p); });
      }
      candidates = [...noUrl, ...checked];
    }

    const updated: { id: string; title: string; image_url: string }[] = [];
    const unresolved: { id: string; title: string }[] = [];

    for (let i = 0; i < candidates.length; i += 50) {
      const batch = candidates.slice(i, i + 50);
      const ids = [...new Set(batch.map((p) => toProductGid(p.shopify_product_id as string)))];
      const data = await gql(conn.shop_domain, conn.access_token, NODES_QUERY, { ids });
      const byId = new Map<string, any>();
      for (const n of data.nodes ?? []) if (n?.id) byId.set(n.id, n);

      for (const p of batch) {
        const node = byId.get(toProductGid(p.shopify_product_id as string));
        if (!node) { unresolved.push({ id: p.id, title: p.title }); continue; }
        const variantGid = p.shopify_variant_id ? toVariantGid(p.shopify_variant_id) : null;
        const variant = variantGid
          ? (node.variants?.nodes ?? []).find((v: any) => v.id === variantGid)
          : null;
        const url: string | null = variant?.image?.url || node.featuredImage?.url || null;
        if (!url || url === p.image_url) {
          if (!url) unresolved.push({ id: p.id, title: p.title });
          continue;
        }
        const { error: upErr } = await supabase
          .from("master_products")
          .update({ image_url: url })
          .eq("id", p.id);
        if (upErr) { unresolved.push({ id: p.id, title: p.title }); continue; }
        updated.push({ id: p.id, title: p.title, image_url: url });
      }
    }

    return new Response(
      JSON.stringify({
        checked: products?.length ?? 0,
        candidates: candidates.length,
        updated: updated.length,
        unresolved: unresolved.length,
        updated_products: updated.slice(0, 50),
        unresolved_products: unresolved.slice(0, 50),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
