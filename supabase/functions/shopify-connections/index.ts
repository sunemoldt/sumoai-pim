// List/switch/delete Shopify-forbindelser. Bruges af UI til at skifte mellem tenants.
// GET (uden body): returner alle forbindelser (uden access_token)
// POST { action: "activate", id }: marker som aktiv (deaktiverer andre)
// POST { action: "delete", id }: slet en forbindelse
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("authorization");
  if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authErr } = await anon.auth.getUser();
  if (authErr || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("shopify_connection")
        .select("id, shop_domain, scope, is_active, installed_at, updated_at")
        .order("installed_at", { ascending: false });
      if (error) throw error;
      return new Response(JSON.stringify({ connections: data ?? [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const { action, id } = body ?? {};
      if (!action || !id) {
        return new Response(JSON.stringify({ error: "action and id are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "activate") {
        // Deaktiver alle, derefter aktiver valgt
        await supabase.from("shopify_connection").update({ is_active: false }).eq("is_active", true);
        const { error } = await supabase.from("shopify_connection").update({ is_active: true, updated_at: new Date().toISOString() }).eq("id", id);
        if (error) throw error;
        return new Response(JSON.stringify({ success: true, activated: id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "delete") {
        const { error } = await supabase.from("shopify_connection").delete().eq("id", id);
        if (error) throw error;
        return new Response(JSON.stringify({ success: true, deleted: id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("shopify-connections error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
