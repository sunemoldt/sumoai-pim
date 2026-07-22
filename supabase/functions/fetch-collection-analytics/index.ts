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
  return { status: res.status, data };
}

type CollectionStats = { views: number; sessions: number };

async function fetchCollectionVisits(shopDomain: string, token: string, since: string, until: string) {
  const result = new Map<string, CollectionStats>();
  const errors: string[] = [];

  // ShopifyqlQueryResponse { parseErrors, tableData { columns { name }, rows } }
  // `rows` is a JSON scalar (array of arrays).
  const gql = `#graphql
    query($q: String!) {
      shopifyqlQuery(query: $q) {
        parseErrors
        tableData { columns { name } rows }
      }
    }`;

  const attempts = [
    `FROM sessions SHOW sum(visits) AS views, sum(sessions) AS sessions_count GROUP BY landing_page_path SINCE ${since} UNTIL ${until} LIMIT 5000`,
    `FROM online_store_visitors SHOW sum(visits) AS views, sum(sessions) AS sessions_count GROUP BY landing_page_path SINCE ${since} UNTIL ${until} LIMIT 5000`,
  ];

  for (const q of attempts) {
    const { status, data } = await shopifyGraphql(shopDomain, token, gql, { q });
    if (data?.errors?.length) {
      const msg = data.errors.map((e: any) => e.message).join(" | ");
      errors.push(`[${status}] ${msg.slice(0, 300)}`);
      // ACCESS_DENIED means missing scope — no point retrying with another table.
      if (data.errors.some((e: any) => e.extensions?.code === "ACCESS_DENIED")) break;
      continue;
    }
    const r = data?.data?.shopifyqlQuery;
    if (r?.parseErrors?.length) {
      errors.push(`ParseError: ${r.parseErrors.join(", ")}`);
      continue;
    }
    const cols: { name: string }[] = r?.tableData?.columns ?? [];
    const rows: unknown[][] = Array.isArray(r?.tableData?.rows) ? r.tableData.rows : [];
    const idxPath = cols.findIndex((c) => c.name === "landing_page_path");
    const idxViews = cols.findIndex((c) => c.name === "views");
    const idxSessions = cols.findIndex((c) => c.name === "sessions_count");
    if (idxPath < 0) continue;
    for (const row of rows) {
      const path = String(row[idxPath] ?? "");
      const m = path.match(/^\/collections\/([^/?#]+)/);
      if (!m) continue;
      const handle = decodeURIComponent(m[1]);
      const cur = result.get(handle) ?? { views: 0, sessions: 0 };
      cur.views += Number(row[idxViews] ?? 0) || 0;
      cur.sessions += Number(row[idxSessions] ?? 0) || 0;
      result.set(handle, cur);
    }
    return { result, errors: [] as string[] };
  }
  return { result, errors };
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

    const { result: stats, errors } = await fetchCollectionVisits(
      conn.shop_domain,
      conn.access_token,
      since,
      until,
    );

    if (stats.size === 0 && errors.length > 0) {
      // Don't overwrite existing data with zeros when the API call failed.
      const scopeError = errors.some((e) => e.includes("ACCESS_DENIED") || e.includes("read_reports"));
      return new Response(JSON.stringify({
        success: false,
        error: scopeError
          ? "Shopify-appen mangler 'read_reports' scope (og Level 2 protected customer data). Genforbind Shopify med opdaterede scopes for at hente kategoritrafik."
          : errors.join(" | "),
        errors,
      }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

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
