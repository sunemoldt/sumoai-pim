import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const feed_url = typeof body.feed_url === "string" ? body.feed_url : "";
    const feed_type = typeof body.feed_type === "string" ? body.feed_type : "csv";
    const delimiter = typeof body.delimiter === "string" && body.delimiter ? body.delimiter : ";";
    const supplier_id = typeof body.supplier_id === "string" ? body.supplier_id : "";

    if (feed_type === "api") {
      if (!supplier_id) {
        return new Response(JSON.stringify({ error: "supplier_id is required for api feeds" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const adminClient = createClient(supabaseUrl, serviceRoleKey);
      const { data: supplier, error: supErr } = await adminClient
        .from("suppliers")
        .select("feed_url, column_mapping")
        .eq("id", supplier_id)
        .single();

      if (supErr || !supplier) {
        throw new Error("Supplier not found");
      }

      const apiDbStr = mapping._api_database || "item,stock";
      const params = new URLSearchParams({
        database: apiDbStr,
        customerid: mapping._api_customer_id || "",
        companyid: mapping._api_company_id || "",
        language: mapping._api_language || "da",
      });

      if (mapping._api_key) {
        params.set("apikey", mapping._api_key);
      }

      const apiBaseUrl = supplier.feed_url || feed_url || "https://api.aurdel.com/Prices/getPrice";
      const apiUrl = `${apiBaseUrl}?${params.toString()}`;
      const res = await fetch(apiUrl);
      const text = await res.text();

      if (!res.ok) {
        const errorSnippet = text.trim().slice(0, 200);
        throw new Error(
          errorSnippet
            ? `Failed to fetch API feed: ${res.status} ${errorSnippet}`
            : `Failed to fetch API feed: ${res.status}`,
        );
      }

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
    const text = await res.text();

    if (!res.ok) {
      const errorSnippet = text.trim().slice(0, 200);
      throw new Error(
        errorSnippet
          ? `Failed to fetch feed: ${res.status} ${errorSnippet}`
          : `Failed to fetch feed: ${res.status}`,
      );
    }

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
