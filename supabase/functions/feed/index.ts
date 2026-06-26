// Friendly short-URL proxy for cached affiliate feeds.
// GET /feed             -> partner-ads XML
// GET /feed/partnerads  -> partner-ads XML (alias)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "product-feeds";

const FEED_MAP: Record<string, { path: string; generator: string }> = {
  "": { path: "partner-ads.xml", generator: "generate-partner-ads-feed" },
  "partnerads": { path: "partner-ads.xml", generator: "generate-partner-ads-feed" },
  "partner-ads": { path: "partner-ads.xml", generator: "generate-partner-ads-feed" },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  // Path is /feed or /feed/<slug>
  const parts = url.pathname.split("/").filter(Boolean);
  const slug = (parts[1] ?? "").toLowerCase();
  const target = FEED_MAP[slug];

  if (!target) {
    return new Response(JSON.stringify({ error: "Ukendt feed", available: Object.keys(FEED_MAP).filter(Boolean) }), {
      status: 404,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  let { data, error } = await supabase.storage.from(BUCKET).download(target.path);

  if (error || !data) {
    // Cache miss → generate on-the-fly
    await supabase.functions.invoke(target.generator, { body: {} });
    const retry = await supabase.storage.from(BUCKET).download(target.path);
    data = retry.data;
    if (!data) {
      return new Response(JSON.stringify({ error: "Feed ikke tilgængeligt" }), {
        status: 503,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
  }

  return new Response(data, {
    headers: {
      ...cors,
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=900",
    },
  });
});
