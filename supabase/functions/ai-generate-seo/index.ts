import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

function stripHtml(s: string | null | undefined): string {
  return (s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

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
    const { title, brand, category, short_description, long_description, attributes, extra } = await req.json();
    if (!title && !short_description && !long_description) {
      return json({ error: "Produktet mangler tekst/titel til at generere SEO fra" }, 400);
    }

    const systemPrompt = `Du er en dansk SEO-copywriter for Comtek webshop.

OPGAVE: Generér en optimeret meta titel og meta beskrivelse på dansk.

REGLER (skal overholdes strengt):
- meta_title: 50-60 tegn. Format "Produkt – USP | Brand" eller "Produkt | Brand". Inkludér vigtigste keyword først. Ingen ALLE CAPS. Ingen anførselstegn.
- meta_description: 140-160 tegn. Skal indeholde: hook + primær fordel + CTA (fx "Køb online", "Bestil nu", "Se pris"). Naturligt sprog, ingen keyword-stuffing.
- Brug reelle produktinfo. Opdigt ikke specs.
- Korrekt dansk. Undgå gentagelser mellem titel og beskrivelse.`;

    const userPrompt = `Titel: ${title ?? "-"}
Brand: ${brand ?? "-"} | Kategori: ${category ?? "-"}
Kort beskrivelse: ${stripHtml(short_description).slice(0, 400)}
Lang beskrivelse: ${stripHtml(long_description).slice(0, 800)}
Specs: ${attributes ? JSON.stringify(attributes).slice(0, 400) : "-"}
${extra ? `Ekstra: ${extra}` : ""}`;

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
            name: "save_seo",
            description: "Returner meta titel og meta beskrivelse",
            parameters: {
              type: "object",
              properties: {
                meta_title: { type: "string", description: "50-60 tegn" },
                meta_description: { type: "string", description: "140-160 tegn med CTA" },
              },
              required: ["meta_title", "meta_description"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "save_seo" } },
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
      meta_title: (args.meta_title ?? "").trim(),
      meta_description: (args.meta_description ?? "").trim(),
    }, 200);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("ai-generate-seo:", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
