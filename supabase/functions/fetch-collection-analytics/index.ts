import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const API_VERSION = "2026-04";

async function shopifyGraphql(shopDomain: string, token: string, query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(`https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (!res.ok || data.errors) {
    throw new Error(`Shopify GraphQL [${res.status}]: ${JSON.stringify(data.errors || data).slice(0, 400)}`);
  }
  return data.data;
}

// Query ShopifyQL for visits + sessions grouped by landing_page_path
async function fetchCollectionVisits(shopDomain: string, token: string, since: string, until: string) {
  const result = new Map<string, { views: number; sessions: number }>();

  // Try `sessions` schema first (most common for online store visits)
  const queries = [
    `FROM sessions SHOW sum(visits) AS views, sum(sessions) AS sessions_count GROUP BY landing_page_path SINCE ${since} UNTIL ${until} LIMIT 5000`,
    `FROM online_store_visitors SHOW sum(visits) AS views, sum(sessions) AS sessions_count GROUP BY landing_page_path SINCE ${since} UNTIL ${until} LIMIT 5000`,
  ];

  for (const ql of queries) {
    try {
      const data = await shopifyGraphql(shopDomain, token, `#graphql
        query($q: String!) {
          shopifyqlQuery(query: $q) {
            __typename
            ... on TableResponse { tableData { columns { name } rowData } }
            ... on ParseError { code message }
          }
        }`, { q: ql });
      const r = data.shopifyqlQuery;
      if (r?.__typename === "TableResponse") {
        const cols: { name: string }[] = r.tableData.columns;
        const idxPath = cols.findIndex((c) => c.name === "landing_page_path");
        const idxViews = cols.findIndex((c) => c.name === "views");
        const idxSessions = cols.findIndex((c) => c.name === "sessions_count");
        for (const row of r.tableData.rowData as string[][]) {
          const path = String(row[idxPath] ?? "");
          const m = path.match(/^\/collections\/([^/?#]+)/);
          if (!m) continue;
          const handle = decodeURIComponent(m[1]);
          const cur = result.get(handle) ?? { views: 0, sessions: 0 };
          cur.views += parseInt(row[idxViews] ?? "0") || 0;
          cur.sessions += parseInt(row[idxSessions] ?? "0") || 0;
          result.set(handle, cur);
        }
        return result;
      } else if (r?.__typename === "ParseError") {
        console.warn(`ShopifyQL parse error on "${ql.slice(0, 40)}…": ${r.message}`);
      }
    } catch (e) {
      console.warn(`ShopifyQL attempt failed: ${(e as Error).message}`);
    }
  }
  return result;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("authorization");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (!authHeader.includes(serviceKey)) {
    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error } = await anon.auth.getUser();
    if (error || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  }

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
    const { data: conn } = await supabase
      .from("shopify_connection")
      .select("shop_domain, access_token")
      .order("is_active", { ascending: false })
      .order("installed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!conn) throw new Error("Ingen aktiv Shopify-forbindelse");

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 30);
    const since = startDate.toISOString().split("T")[0];
    const until = endDate.toISOString().split("T")[0];

    console.log(`Collection analytics: ${since} → ${until}`);

    const stats = await fetchCollectionVisits(conn.shop_domain, conn.access_token, since, until);

    const { data: collections } = await supabase
      .from("shopify_collections")
      .select("id, handle");

    let updated = 0;
    const now = new Date().toISOString();
    for (const c of collections ?? []) {
      const s = c.handle ? stats.get(c.handle) : null;
      const { error } = await supabase
        .from("shopify_collections")
        .update({
          views_30d: s?.views ?? 0,
          sessions_30d: s?.sessions ?? 0,
          analytics_updated_at: now,
        })
        .eq("id", c.id);
      if (!error) updated++;
    }

    return new Response(JSON.stringify({
      success: true,
      period_days: 30,
      collections_updated: updated,
      collections_with_data: stats.size,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
