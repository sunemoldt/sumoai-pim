import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Auth check
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { feed_url, feed_type, delimiter = ";", supplier_id } = await req.json();

    // For API-type suppliers, fetch columns from the API using stored credentials
    if (feed_type === "api" && supplier_id) {
      const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: supplier, error: supErr } = await adminClient
        .from("suppliers")
        .select("column_mapping")
        .eq("id", supplier_id)
        .single();
      if (supErr || !supplier) throw new Error("Supplier not found");

      const mapping = (supplier.column_mapping ?? {}) as Record<string, string>;
      const apiDbStr = mapping._api_database || "item";
      const firstDb = apiDbStr.split(",")[0].trim();
      const params = new URLSearchParams({
        database: firstDb,
        customerid: mapping._api_customer_id || "",
        companyid: mapping._api_company_id || "",
        language: mapping._api_language || "da",
      });
      if (mapping._api_key) params.set("apikey", mapping._api_key);

      const apiUrl = `https://api.aurdel.com/Prices/getPrice?${params.toString()}`;
      const res = await fetch(apiUrl);
      if (!res.ok) throw new Error(`API returned status ${res.status}`);
      const text = await res.text();

      // Extract field names from first <item>
      const itemMatch = text.match(/<item\s+id="[^"]*">([\s\S]*?)<\/item>/i);
      const columns: string[] = ["supplier_sku (item id)"];
      if (itemMatch) {
        const inner = itemMatch[1];
        if (/<ean>/i.test(inner)) columns.push("ean");
        if (/<net/i.test(inner)) columns.push("purchase_price (net)");
        if (/<stock\s+quantity/i.test(inner)) columns.push("stock_quantity");
        if (/<short>/i.test(inner)) columns.push("short_description");
        if (/<manufacturer/i.test(inner)) columns.push("manufacturer");
      }

      return new Response(JSON.stringify({ columns }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!feed_url) {
      return new Response(JSON.stringify({ error: "feed_url is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await fetch(feed_url);
    if (!res.ok) throw new Error(`Failed to fetch feed: ${res.status}`);
    const text = await res.text();

    let columns: string[] = [];

    if (feed_type === "xml") {
      const tagMatches = text.match(/<([a-zA-Z_][a-zA-Z0-9_.-]*)[^/]*>/g);
      if (tagMatches) {
        const tags = new Set<string>();
        for (const m of tagMatches) {
          const name = m.replace(/<([a-zA-Z_][a-zA-Z0-9_.-]*)[^>]*>/, "$1");
          tags.add(name);
        }
        columns = [...tags].slice(0, 50);
      }
    } else {
      const firstLine = text.split(/\r?\n/)[0];
      if (firstLine) {
        columns = firstLine.split(delimiter).map((c) => c.trim().replace(/^["']|["']$/g, ""));
      }
    }

    return new Response(JSON.stringify({ columns }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
