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

FELTER:
- title: Klar, sælgende produkttitel. Brand + model + key feature. Max ~70 tegn. Ingen ALLE CAPS.
- short_description: HTML. SKAL ALTID indeholde BÅDE en teasende sælgende intro OG en punktopstilling. Følg PRÆCIST denne opbygning – ligesom de eksisterende ~500 produkter på shoppen:
    1) <h2> med produktets navn/model
    2) <p> med 1-2 sætningers teasende og sælgende intro (hook + hovedfordel)
    3) <ul> med 4-8 <li> bullets – korte, scanbare punkter med de vigtigste fordele/specs/USP'er
  Det er FORBUDT at returnere short_description uden <ul><li>...</li></ul>. Ingen <div>, ingen inline styles, ingen Google Translate-rester.

  EKSEMPEL på korrekt short_description:
  <h2>Mercusys MS108GP 8-Port PoE+ Gigabit Switch</h2>
  <p>Kompakt men kraftfuld switch der leverer stabil gigabit-forbindelse og PoE+ strøm til dine enheder – plug-and-play på få sekunder.</p>
  <ul>
  <li>8 x 10/100/1000 Mbps RJ-45 porte (7 med PoE+)</li>
  <li>65 W samlet PoE-budget, op til 30 W pr. port</li>
  <li>Plug-and-play – ingen konfiguration nødvendig</li>
  <li>Desktop- eller vægmonterbar</li>
  </ul>

- long_description: Velstruktureret HTML med <p> intro, <ul><li> bullets med fordele/specs, evt. <h3> sektioner. 150-300 ord. Sælgende men troværdig tone.
- meta_title: SEO titel max 60 tegn. Indeholder hovedkeyword. Format: "Produktnavn – USP | Brand"
- meta_description: SEO beskrivelse 140-160 tegn. Hook + CTA. Indeholder hovedkeyword.

REGLER:
- short_description SKAL indeholde <h2>, <p> OG <ul> med mindst 4 <li> bullets – aldrig kun ren tekst
- Aldrig opdigt tekniske specs der ikke er antydet i input
- Brug brand/kategori naturligt hvis givet
- Fokus på kundefordele, ikke kun specs
- Ingen "buzzwords" eller falske påstande
- Korrekt dansk, ingen anglicismer hvor unødvendigt`;

    const userPrompt = `Basisinfo fra bruger:
"""
${input}
"""

Kendt metadata:
- Brand: ${brand || "(ikke angivet)"}
- Kategori: ${category || "(ikke angivet)"}
- EAN: ${ean || "(ikke angivet)"}
- SKU: ${sku || "(ikke angivet)"}

Generér alle 5 felter.`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3.5-flash",
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
                short_description: { type: "string" },
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
