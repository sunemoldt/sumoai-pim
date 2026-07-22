// Generates SEO-optimized description + meta title + meta description for a Shopify collection.
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
    const { collection_id } = await req.json();
    if (!collection_id) return json({ error: "collection_id påkrævet" }, 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: collection, error: cErr } = await supabase
      .from("shopify_collections")
      .select("id, title, handle, description_html, meta_title, meta_description, collection_type")
      .eq("id", collection_id)
      .single();
    if (cErr || !collection) return json({ error: "Collection ikke fundet" }, 404);

    // Sample of products in the collection for context (top 20 by stock)
    const { data: rows } = await supabase
      .from("master_product_collections")
      .select("master_products(title, brand, category, attributes)")
      .eq("collection_id", collection_id)
      .limit(20);

    const products = (rows ?? [])
      .map((r: any) => r.master_products)
      .filter(Boolean);

    const brands = Array.from(new Set(products.map((p: any) => p.brand).filter(Boolean))).slice(0, 10);
    const productTitles = products.map((p: any) => `- ${p.title}${p.brand ? ` (${p.brand})` : ""}`).slice(0, 15).join("\n");

    const systemPrompt = `Du er en dansk SEO-tekstforfatter for en webshop-kategori (collection).

OPGAVE: Skriv en helt ny, sælgende og SEO-optimeret kategoritekst på dansk.

REGLER:
- description_html: Velstruktureret HTML med <p>, <ul><li>, evt. <h2>/<h3>. 150-300 ord. Beskriv hvad kategorien indeholder, hvorfor kunden skal vælge produkterne, hvilke brands/typer der er, og typiske anvendelser. Salgsorienteret men troværdig tone.
- meta_title: SEO title (max 60 tegn). Inkluder kategorinavn + fordel/USP. Skal give lyst til at klikke i Google.
- meta_description: SEO description (max 155 tegn). Ét flydende afsnit der opsummerer kategorien og opfordrer til klik.
- Brug kategoriens navn naturligt. Nævn 2-4 relevante brands hvis de findes.
- Aldrig opdigt tekniske detaljer der ikke er i input.
- Output kun via tool-call.`;

    const userPrompt = `Kategori:
- Titel: ${collection.title}
- Handle: ${collection.handle}
- Type: ${collection.collection_type ?? "manual"}
- Brands i kategorien: ${brands.length ? brands.join(", ") : "—"}
- Antal produkter (sample): ${products.length}

Eksempler på produkter:
${productTitles || "(ingen)"}

NUVÆRENDE beskrivelse: ${collection.description_html || "(tom)"}
NUVÆRENDE meta titel: ${collection.meta_title || "(tom)"}
NUVÆRENDE meta beskrivelse: ${collection.meta_description || "(tom)"}

Skriv nye tekster.`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "save_collection_texts",
            description: "Returner nye kategori-tekster",
            parameters: {
              type: "object",
              properties: {
                description_html: { type: "string", description: "Kategoribeskrivelse (HTML)" },
                meta_title: { type: "string", description: "SEO title, max 60 tegn" },
                meta_description: { type: "string", description: "SEO description, max 155 tegn" },
              },
              required: ["description_html", "meta_title", "meta_description"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "save_collection_texts" } },
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
      description_html: args.description_html ?? "",
      meta_title: (args.meta_title ?? "").slice(0, 70),
      meta_description: (args.meta_description ?? "").slice(0, 160),
    }, 200);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("ai-rewrite-collection:", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
