// Scans every variant in Shopify and flips inventoryItem.tracked=true where it's
// off. Without tracking, Shopify ignores stock qty and can oversell.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_VERSION = "2026-04";

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

const LIST_QUERY = `#graphql
  query Variants($cursor: String) {
    productVariants(first: 200, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        sku
        product { id title status }
        inventoryItem { id tracked }
      }
    }
  }`;

const UPDATE_MUTATION = `#graphql
  mutation Fix($id: ID!) {
    inventoryItemUpdate(id: $id, input: { tracked: true }) {
      inventoryItem { id tracked }
      userErrors { field message }
    }
  }`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  let mode: "audit" | "fix" = "audit";
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body?.mode === "fix") mode = "fix";
    }
  } catch { /* noop */ }

  try {
    const { data: conn } = await svc
      .from("shopify_connection")
      .select("shop_domain,access_token")
      .eq("is_active", true)
      .maybeSingle();
    if (!conn) throw new Error("No active Shopify connection");

    const untracked: Array<{
      variant_id: string; inventory_item_id: string; sku: string | null;
      product_id: string; product_title: string; status: string;
    }> = [];

    let cursor: string | null = null;
    let pages = 0;
    let totalVariants = 0;
    do {
      const data = await gql(conn.shop_domain, conn.access_token, LIST_QUERY, { cursor });
      const pv = data.productVariants;
      for (const n of pv.nodes) {
        totalVariants++;
        if (n?.inventoryItem?.tracked === false) {
          untracked.push({
            variant_id: n.id.split("/").pop(),
            inventory_item_id: n.inventoryItem.id,
            sku: n.sku,
            product_id: n.product?.id?.split("/").pop() ?? "",
            product_title: n.product?.title ?? "",
            status: n.product?.status ?? "",
          });
        }
      }
      cursor = pv.pageInfo.hasNextPage ? pv.pageInfo.endCursor : null;
      pages++;
      if (pages > 300) break;
    } while (cursor);

    let fixed = 0;
    const errors: Array<{ variant_id: string; message: string }> = [];
    if (mode === "fix" && untracked.length) {
      for (const u of untracked) {
        try {
          const res = await gql(conn.shop_domain, conn.access_token, UPDATE_MUTATION, { id: u.inventory_item_id });
          const ue = res.inventoryItemUpdate?.userErrors ?? [];
          if (ue.length) {
            errors.push({ variant_id: u.variant_id, message: ue.map((e: any) => e.message).join("; ") });
          } else {
            fixed++;
          }
        } catch (e) {
          errors.push({ variant_id: u.variant_id, message: (e as Error).message });
        }
        // Gentle throttle — Shopify GraphQL bucket restore is fast, but avoid bursts.
        await new Promise((r) => setTimeout(r, 60));
      }

      // Re-queue affected products so PIM stock is pushed to Shopify now that tracking is on.
      const masterIds = new Set<string>();
      for (const u of untracked) {
        const { data: mp } = await svc
          .from("master_products")
          .select("id")
          .eq("shopify_variant_id", u.variant_id)
          .maybeSingle();
        if (mp?.id) masterIds.add(mp.id);
      }
      for (const id of masterIds) {
        await svc.from("shopify_update_queue").insert({
          master_product_id: id,
          payload: { reason: "tracking-audit-fix" },
          source: "tracking-audit",
          status: "pending",
          next_attempt_at: new Date().toISOString(),
        });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        mode,
        total_variants: totalVariants,
        untracked_count: untracked.length,
        fixed,
        errors,
        untracked: untracked.slice(0, 500),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("shopify-tracking-audit error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
