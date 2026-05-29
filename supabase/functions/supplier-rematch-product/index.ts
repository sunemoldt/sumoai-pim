// Rematch a single PIM product against all active supplier feeds.
// Used to auto-populate supplier_products for newly created/pulled products
// when supplier feeds were imported before the product appeared.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // Allow service-role (internal callers) or authenticated users
  const isService = authHeader.includes(SUPABASE_SERVICE_ROLE_KEY);
  if (!isService) {
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await anon.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    const { master_product_id } = await req.json();
    if (!master_product_id) {
      return new Response(JSON.stringify({ error: "master_product_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: product } = await supabase
      .from("master_products")
      .select("id, ean")
      .eq("id", master_product_id)
      .single();
    if (!product?.ean) {
      return new Response(JSON.stringify({ error: "Product has no EAN" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: suppliers } = await supabase
      .from("suppliers")
      .select("id, name, feed_type, feed_url")
      .eq("is_active", true);

    // Only suppliers with auto-feeds (api/csv/xml/ftp) — manual ones can't be re-imported on demand
    const targets = (suppliers ?? []).filter((s) =>
      ["api", "csv", "xml", "ftp"].includes(s.feed_type ?? "")
    );

    const results: Array<{ supplier: string; ok: boolean; imported?: number; error?: string }> = [];
    // Fire in parallel; each call has target_ean so it's cheap
    await Promise.all(targets.map(async (s) => {
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/supplier-feed-import`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
          },
          body: JSON.stringify({ supplier_id: s.id, target_ean: product.ean }),
        });
        const j = await r.json().catch(() => ({}));
        results.push({ supplier: s.name, ok: r.ok && j.success !== false, imported: j.imported, error: j.error });
      } catch (e) {
        results.push({ supplier: s.name, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }));

    const totalImported = results.reduce((a, r) => a + (r.imported ?? 0), 0);
    return new Response(JSON.stringify({ success: true, ean: product.ean, total_imported: totalImported, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
