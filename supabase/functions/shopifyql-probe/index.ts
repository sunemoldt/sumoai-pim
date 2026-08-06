import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const CANDIDATES = [
  "FROM foo SHOW bar SINCE -30d",
  "FROM sessions SHOW sum(sessions) GROUP BY product_id SINCE -30d LIMIT 5",
  "FROM products SHOW view_sessions GROUP BY product_id SINCE -30d LIMIT 5",
  "FROM sales SHOW sum(net_sales) GROUP BY product_id SINCE -30d LIMIT 5",
  "FROM products SHOW product_views, sessions GROUP BY product_id SINCE -30d LIMIT 5",
  "FROM online_store_sessions SHOW sum(sessions) GROUP BY product_id SINCE -30d LIMIT 5",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const internalSecret = req.headers.get("x-internal-secret");
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: ok } = internalSecret
    ? await admin.rpc("verify_internal_invoke_secret", { p_secret: internalSecret })
    : { data: false };
  if (ok !== true) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: conn } = await admin
    .from("shopify_connection")
    .select("shop_domain, access_token")
    .order("is_active", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!conn) return new Response(JSON.stringify({ error: "no connection" }), { status: 400, headers: corsHeaders });

  const results: Record<string, unknown>[] = [];
  for (const q of CANDIDATES) {
    try {
      const res = await fetch(`https://${conn.shop_domain}/admin/api/2026-04/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": conn.access_token },
        body: JSON.stringify({
          query: `query($q: String!) { shopifyqlQuery(query: $q) { parseErrors tableData { columns { name dataType } rows } } }`,
          variables: { q },
        }),
      });
      const json = await res.json();
      console.log("PROBE", q, JSON.stringify(json).slice(0, 1200));
      results.push({ q, json });
    } catch (e) {
      console.log("PROBE ERR", q, String(e));
    }
  }

  return new Response(JSON.stringify({ results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
