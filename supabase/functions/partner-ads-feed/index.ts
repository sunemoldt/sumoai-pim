// Public endpoint that streams the cached Partner-ads XML feed from Storage.
// If the cache is missing, it triggers generation inline.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "product-feeds";
const FILE_PATH = "partner-ads.xml";

const baseHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=900",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let { data, error } = await supabase.storage.from(BUCKET).download(FILE_PATH);

  if (error || !data) {
    // Cache miss → trigger generation, then re-download
    await fetch(`${SUPABASE_URL}/functions/v1/generate-partner-ads-feed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    ({ data, error } = await supabase.storage.from(BUCKET).download(FILE_PATH));
    if (error || !data) {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><error>Feed not available</error>`,
        { status: 503, headers: baseHeaders },
      );
    }
  }

  const buf = await data.arrayBuffer();
  return new Response(buf, { headers: baseHeaders });
});
