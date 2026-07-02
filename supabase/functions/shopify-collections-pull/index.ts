// Pulls all Shopify Collections into PIM, including product memberships.
// Shopify is master for collection metadata (description, SEO).
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
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  if (auth.includes(SUPABASE_SERVICE_ROLE_KEY)) return true;
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data: { user }, error } = await anon.auth.getUser();
  return !error && !!user;
}

async function gql(shop: string, token: string, query: string, variables: Record<string, unknown>) {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    const txt = await res.text();
    throw new Error(`Shopify non-JSON [${res.status}]: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!res.ok || data.errors) throw new Error(`Shopify ${res.status}: ${JSON.stringify(data.errors || data)}`);
  return data.data;
}

const COLLECTIONS_QUERY = `#graphql
  query PullCollections($cursor: String) {
    collections(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        handle
        title
        descriptionHtml
        sortOrder
        productsCount { count }
        image { url }
        seo { title description }
        ruleSet { rules { column relation condition } }
      }
    }
  }`;

const COLLECTION_PRODUCTS_QUERY = `#graphql
  query CollectionProducts($id: ID!, $cursor: String) {
    collection(id: $id) {
      products(first: 250, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { id }
      }
    }
  }`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!(await requireUser(req))) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: conn } = await supabase
      .from("shopify_connection")
      .select("shop_domain, access_token")
      .order("is_active", { ascending: false })
      .order("installed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!conn) throw new Error("Shopify er ikke forbundet");

    let cursor: string | null = null;
    let upserted = 0;
    const allCollections: { shopify_collection_id: string; type: "custom" | "smart" }[] = [];

    do {
      const data: any = await gql(conn.shop_domain, conn.access_token, COLLECTIONS_QUERY, { cursor });
      const nodes = data.collections.nodes ?? [];
      for (const c of nodes) {
        const type = c.ruleSet ? "smart" : "custom";
        const row = {
          shopify_collection_id: c.id,
          handle: c.handle,
          title: c.title,
          description_html: c.descriptionHtml ?? null,
          meta_title: c.seo?.title ?? null,
          meta_description: c.seo?.description ?? null,
          collection_type: type,
          products_count: c.productsCount?.count ?? 0,
          image_url: c.image?.url ?? null,
          sort_order: c.sortOrder ?? null,
          last_shopify_sync_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        const { error } = await supabase
          .from("shopify_collections")
          .upsert(row, { onConflict: "shopify_collection_id" });
        if (error) throw new Error(`Upsert failed: ${error.message}`);
        upserted++;
        allCollections.push({ shopify_collection_id: c.id, type });
      }
      cursor = data.collections.pageInfo.hasNextPage ? data.collections.pageInfo.endCursor : null;
      if (cursor) await new Promise((r) => setTimeout(r, 400));
    } while (cursor);

    // Sync memberships for each collection
    // Build a lookup from shopify product id to master_product_id
    const { data: productRows } = await supabase
      .from("master_products")
      .select("id, shopify_product_id")
      .not("shopify_product_id", "is", null);
    const productMap = new Map<string, string>();
    for (const p of productRows ?? []) {
      if (p.shopify_product_id) {
        const gid = String(p.shopify_product_id).startsWith("gid://")
          ? String(p.shopify_product_id)
          : `gid://shopify/Product/${p.shopify_product_id}`;
        productMap.set(gid, p.id);
      }
    }

    let membershipsSynced = 0;
    for (const c of allCollections) {
      // Get local collection uuid
      const { data: localCol } = await supabase
        .from("shopify_collections")
        .select("id")
        .eq("shopify_collection_id", c.shopify_collection_id)
        .maybeSingle();
      if (!localCol) continue;

      const productIds: string[] = [];
      let pCursor: string | null = null;
      do {
        const pd: any = await gql(conn.shop_domain, conn.access_token, COLLECTION_PRODUCTS_QUERY, { id: c.shopify_collection_id, cursor: pCursor });
        const pNodes = pd.collection?.products?.nodes ?? [];
        for (const p of pNodes) productIds.push(p.id);
        pCursor = pd.collection?.products?.pageInfo?.hasNextPage ? pd.collection.products.pageInfo.endCursor : null;
        if (pCursor) await new Promise((r) => setTimeout(r, 300));
      } while (pCursor);

      const masterIds = productIds
        .map((gid) => productMap.get(gid))
        .filter((x): x is string => !!x);

      // Replace memberships for this collection
      await supabase.from("master_product_collections").delete().eq("collection_id", localCol.id);
      if (masterIds.length > 0) {
        const rows = masterIds.map((mid) => ({ master_product_id: mid, collection_id: localCol.id }));
        // Chunk inserts to avoid payload limits
        for (let i = 0; i < rows.length; i += 500) {
          const chunk = rows.slice(i, i + 500);
          const { error } = await supabase.from("master_product_collections").insert(chunk);
          if (error) throw new Error(`Membership insert failed: ${error.message}`);
        }
        membershipsSynced += masterIds.length;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      collections_upserted: upserted,
      memberships_synced: membershipsSynced,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("shopify-collections-pull:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
