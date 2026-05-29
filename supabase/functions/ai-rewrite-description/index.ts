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
  if (!authHeader) {
    return json({ error: "Unauthorized" }, 401);
  }
  if (!authHeader.includes(SUPABASE_SERVICE_ROLE_KEY)) {
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error } = await anon.auth.getUser();
    if (error || !user) return json({ error: "Unauthorized" }, 401);
  }

  try {
    const { productId, mode } = await req.json();
    if (!productId || !["clean", "rewrite"].includes(mode)) {
      return json({ error: "productId og mode (clean|rewrite) påkrævet" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: product, error: pErr } = await supabase
      .from("master_products")
      .select("id, title, brand, category, ean, sku, short_description, long_description, attributes")
      .eq("id", productId)
      .single();
    if (pErr || !product) return json({ error: "Produkt ikke fundet" }, 404);

    const systemPrompt = mode === "clean"
      ? `Du er en HTML-rensemaskine for produktbeskrivelser fra en gammel WooCommerce-shop.

OPGAVE: Behold ALT meningsfuldt indhold men fjern gammelt/snavset markup.

REGLER:
- Fjern WooCommerce shortcodes ([...]), inline styles, class/id attributter, font tags, span uden formål, tomme tags, <!-- kommentarer -->, scripts, iframes, tracking pixels.
- Behold semantisk HTML: <p>, <ul>, <ol>, <li>, <strong>, <em>, <h2>, <h3>, <br>, <a href>, <table>.
- Fjern eksterne billede-URL'er og links til konkurrenter.
- Bevar al faktisk produkttekst og specifikationer ordret – du må ikke omformulere.
- Output skal være ren, valid HTML uden indledende tekst eller kodemarkering.`
      : `Du er en dansk produkttekstforfatter for en webshop.

OPGAVE: Skriv en HELT NY, sælgende produktbeskrivelse på dansk baseret på produktdata.

REGLER:
- short_description: 1-2 korte sætninger (max ~250 tegn), hook + USP. Ren tekst eller minimal HTML.
- long_description: Velstruktureret HTML med <p>, <ul><li> bullets med fordele, evt. <h3> sektioner. 150-300 ord.
- Brug en professionel, salgsorienteret men troværdig tone. Ikke "buzzwords" eller falske påstande.
- Fokus på fordele for kunden, ikke kun specs.
- Brug brand og kategori naturligt.
- Aldrig opdigt tekniske specifikationer der ikke er i input.`;

    const userPrompt = `Produkt:
- Titel: ${product.title}
- Brand: ${product.brand ?? "—"}
- Kategori: ${product.category ?? "—"}
- EAN: ${product.ean}
- SKU: ${product.sku ?? "—"}
- Tekniske attributter: ${JSON.stringify(product.attributes ?? {})}

NUVÆRENDE kort beskrivelse:
${product.short_description ?? "(tom)"}

NUVÆRENDE lang beskrivelse:
${product.long_description ?? "(tom)"}

${mode === "clean" ? "Rens beskrivelserne ovenfor og returnér resultatet." : "Skriv helt nye beskrivelser baseret på produktdata."}`;

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
            name: "save_descriptions",
            description: "Returner de nye produktbeskrivelser",
            parameters: {
              type: "object",
              properties: {
                short_description: { type: "string", description: "Kort beskrivelse (HTML eller tekst)" },
                long_description: { type: "string", description: "Lang beskrivelse (HTML)" },
              },
              required: ["short_description", "long_description"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "save_descriptions" } },
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
      short_description: args.short_description ?? "",
      long_description: args.long_description ?? "",
      mode,
    }, 200);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("ai-rewrite-description:", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
