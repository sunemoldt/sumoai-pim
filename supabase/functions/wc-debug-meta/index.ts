const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WC_STORE_URL = Deno.env.get("WC_STORE_URL");
const WC_CONSUMER_KEY = Deno.env.get("WC_CONSUMER_KEY");
const WC_CONSUMER_SECRET = Deno.env.get("WC_CONSUMER_SECRET");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const baseUrl = WC_STORE_URL!.replace(/\/$/, "");

  // Fetch first variable product
  const url = `${baseUrl}/wp-json/wc/v3/products?per_page=5&type=variable&consumer_key=${WC_CONSUMER_KEY}&consumer_secret=${WC_CONSUMER_SECRET}`;
  const res = await fetch(url);
  const products = await res.json();

  const results: any[] = [];

  for (const p of products.slice(0, 2)) {
    // Get variations
    const vUrl = `${baseUrl}/wp-json/wc/v3/products/${p.id}/variations?per_page=3&consumer_key=${WC_CONSUMER_KEY}&consumer_secret=${WC_CONSUMER_SECRET}`;
    const vRes = await fetch(vUrl);
    const vars = await vRes.json();

    results.push({
      parent_name: p.name,
      parent_sku: p.sku,
      parent_meta_keys: p.meta_data?.map((m: any) => `${m.key}=${m.value?.toString().substring(0, 50)}`),
      variations: vars.slice(0, 2).map((v: any) => ({
        id: v.id,
        sku: v.sku,
        meta_keys: v.meta_data?.map((m: any) => `${m.key}=${m.value?.toString().substring(0, 50)}`),
        attributes: v.attributes,
      })),
    });
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
