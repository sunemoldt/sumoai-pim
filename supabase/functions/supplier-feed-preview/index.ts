const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { feed_url, feed_type, delimiter = ";" } = await req.json();

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
      // Extract unique tag names from first product element
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
      // CSV: read first line
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
