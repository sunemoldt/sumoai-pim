// Registers the orders/create webhook in Shopify and sets cutoff timestamp.
// Idempotent: cutoff is only set first time.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_VERSION = "2026-04";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function requireUser(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return false;
  if (authHeader.includes(SUPABASE_SERVICE_ROLE_KEY)) return true;
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error } = await anon.auth.getUser();
  return !error && Boolean(user);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!(await requireUser(req))) return json({ error: "Unauthorized" }, 401);

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: conn } = await sb
    .from("shopify_connection")
    .select("shop_domain, access_token")
    .order("is_active", { ascending: false })
    .order("installed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!conn) return json({ error: "Shopify er ikke forbundet" }, 400);

  const webhookUrl = `${SUPABASE_URL}/functions/v1/shopify-order-webhook`;

  // List existing webhooks via Admin REST
  const listRes = await fetch(`https://${conn.shop_domain}/admin/api/${API_VERSION}/webhooks.json?topic=orders/create`, {
    headers: { "X-Shopify-Access-Token": conn.access_token },
  });
  const listJson = await listRes.json();
  if (!listRes.ok) return json({ error: "Kunne ikke hente webhooks", details: listJson }, 500);

  type Wh = { id: number; address: string; topic: string };
  const existing = (listJson.webhooks ?? []) as Wh[];
  let webhookId: number | null = existing.find((w) => w.address === webhookUrl)?.id ?? null;

  if (!webhookId) {
    const createRes = await fetch(`https://${conn.shop_domain}/admin/api/${API_VERSION}/webhooks.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": conn.access_token, "Content-Type": "application/json" },
      body: JSON.stringify({ webhook: { topic: "orders/create", address: webhookUrl, format: "json" } }),
    });
    const createJson = await createRes.json();
    if (!createRes.ok) return json({ error: "Kunne ikke oprette webhook", details: createJson }, 500);
    webhookId = createJson.webhook?.id ?? null;
  }

  // Upsert config — only set cutoff first time
  const { data: cfg } = await sb.from("shopify_webhook_config").select("orders_cutoff_at").eq("id", 1).maybeSingle();
  const nowIso = new Date().toISOString();
  if (cfg) {
    await sb.from("shopify_webhook_config").update({
      orders_webhook_id: webhookId ? String(webhookId) : null,
      registered_at: cfg.orders_cutoff_at ? undefined : nowIso,
      orders_cutoff_at: cfg.orders_cutoff_at ?? nowIso,
      updated_at: nowIso,
    }).eq("id", 1);
  } else {
    await sb.from("shopify_webhook_config").insert({
      id: 1,
      orders_webhook_id: webhookId ? String(webhookId) : null,
      orders_cutoff_at: nowIso,
      registered_at: nowIso,
    });
  }

  const { data: finalCfg } = await sb.from("shopify_webhook_config").select("*").eq("id", 1).maybeSingle();
  return json({ success: true, webhook_id: webhookId, config: finalCfg });
});
