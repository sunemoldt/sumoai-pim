import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);
  if (!authHeader.includes(SUPABASE_SERVICE_ROLE_KEY)) {
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error } = await anon.auth.getUser();
    if (error || !user) return json({ error: "Unauthorized" }, 401);
  }

  try {
    const { input, brand, category, ean, sku } = await req.json();
    if (!input || typeof input !== "string" || input.trim().length < 3) {
      return json({ error: "Skriv lidt basisinfo om produktet (min. 3 tegn)" }, 400);
    }

    const systemPrompt = `Du er en dansk produkttekstforfatter for Comtek webshop (Shopify).

OPGAVE: Generér komplet produktopsætning på dansk ud fra brugerens basisinfo.

Generér 5 felter på dansk:
- title: Brand + model + key feature. Max ~70 tegn. Ingen ALLE CAPS.
- short_description: HTML. SKAL indeholde <h2> + <p> teaser (1-2 sætninger, hook+fordel) + <ul> med 4-8 <li> bullets. ALDRIG uden bullets. Ingen <div>/inline styles.
  Eksempel:
  <h2>Mercusys MS108GP 8-Port PoE+ Switch</h2>
  <p>Kompakt switch med stabil gigabit og PoE+ – plug-and-play.</p>
  <ul><li>8 x Gigabit RJ-45 (7 PoE+)</li><li>65 W PoE-budget</li><li>Plug-and-play</li><li>Desktop/væg</li></ul>
- long_description: HTML <p> + <ul><li> + evt. <h3>. 150-300 ord.
- meta_title: max 60 tegn. "Produkt – USP | Brand".
- meta_description: 140-160 tegn. Hook + CTA.

Regler: opdigt ikke specs. Brug brand/kategori naturligt. Korrekt dansk.`;

    const userPrompt = `Info: ${input}
Brand: ${brand || "-"} | Kategori: ${category || "-"} | EAN: ${ean || "-"} | SKU: ${sku || "-"}`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3.1-flash-lite-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "save_product_content",
            description: "Returner genereret produktindhold",
            parameters: {
              type: "object",
              properties: {
                title: { type: "string" },
                short_description: { type: "string", description: "HTML: <h2> + <p> teaser + <ul><li> 4-8 bullets. ALDRIG uden bullets." },
                long_description: { type: "string" },
                meta_title: { type: "string" },
                meta_description: { type: "string" },
              },
              required: ["title", "short_description", "long_description", "meta_title", "meta_description"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "save_product_content" } },
      }),
    });

    if (!aiRes.ok) {
      const t = await aiRes.text();
      console.error("AI gateway:", aiRes.status, t);
      if (aiRes.status === 429) return json({ error: "Rate limit – prøv igen om lidt" }, 429);
      if (aiRes.status === 402) return json({ error: "AI-kreditter opbrugt" }, 402);
      return json({ error: `AI fejl: ${aiRes.status}` }, 500);
    }

    const data = await aiRes.json();
    const tc = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!tc) return json({ error: "Intet AI-svar" }, 500);
    const args = JSON.parse(tc.function.arguments);

    return json({
      title: args.title ?? "",
      short_description: args.short_description ?? "",
      long_description: args.long_description ?? "",
      meta_title: args.meta_title ?? "",
      meta_description: args.meta_description ?? "",
    }, 200);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("ai-generate-product:", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
