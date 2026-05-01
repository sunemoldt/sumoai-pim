// DEPRECATED: Shopify må IKKE oprette produkter i PIM. WooCommerce er master.
// Denne funktion er bevidst deaktiveret for at forhindre dubletter.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return new Response(
    JSON.stringify({
      success: false,
      error: "Shopify-import er deaktiveret. WooCommerce er master. Brug 'Push til Shopify' manuelt fra produktsiden.",
    }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
