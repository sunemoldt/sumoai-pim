import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// Public callback — Shopify redirects here. No JWT, but we validate HMAC + state.
const SHOPIFY_CLIENT_ID = Deno.env.get("SHOPIFY_CLIENT_ID")!;
const SHOPIFY_CLIENT_SECRET = Deno.env.get("SHOPIFY_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// App URL to redirect user back to after install (the Lovable app)
const APP_RETURN_URL = "https://pim.sumoai.dk/shopify";

async function verifyHmac(params: URLSearchParams, secret: string): Promise<boolean> {
  const hmac = params.get("hmac");
  if (!hmac) return false;
  const message = Array.from(params.entries())
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const computed = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  // timing-safe-ish compare
  if (computed.length !== hmac.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ hmac.charCodeAt(i);
  return diff === 0;
}

function htmlResponse(title: string, msg: string, ok: boolean) {
  const color = ok ? "#10b981" : "#ef4444";
  const buttonText = ok ? "Tilbage til PIM" : "Start Shopify-installation forfra";
  const buttonHref = ok ? APP_RETURN_URL : `${SUPABASE_URL}/functions/v1/shopify-oauth-start`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#fff}
.card{background:#1e293b;padding:2rem 3rem;border-radius:12px;border:1px solid #334155;max-width:480px;text-align:center}
h1{color:${color};margin:0 0 .5rem 0;font-size:1.5rem}
p{color:#cbd5e1;line-height:1.5}
a{color:#3b82f6;text-decoration:none;display:inline-block;margin-top:1rem;padding:.6rem 1.2rem;border:1px solid #3b82f6;border-radius:6px}
a:hover{background:#3b82f6;color:#fff}</style></head>
<body><div class="card"><h1>${title}</h1><p>${msg}</p>
<a href="${buttonHref}">${buttonText}</a></div>
${ok ? `<script>setTimeout(()=>location.href="${APP_RETURN_URL}",2500)</script>` : ""}</body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const params = url.searchParams;
    const code = params.get("code");
    const shop = params.get("shop");
    const state = params.get("state");

    if (!code || !shop || !state) {
      return htmlResponse("Manglende parametre", "OAuth callback mangler obligatoriske felter.", false);
    }

    // Validate shop domain format
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) {
      return htmlResponse("Ugyldig butik", "Shop domain har forkert format.", false);
    }

    // Verify HMAC
    const hmacValid = await verifyHmac(params, SHOPIFY_CLIENT_SECRET);
    if (!hmacValid) {
      return htmlResponse("HMAC fejl", "Signaturen fra Shopify kunne ikke verificeres.", false);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Validate state (CSRF)
    const { data: stateRow } = await supabase
      .from("shopify_oauth_state").select("*").eq("state", state).maybeSingle();
    if (!stateRow) {
      console.warn("OAuth state not found", { received_shop: shop });
      return htmlResponse("Linket er udløbet", "Shopify-linket er ikke længere gyldigt. Klik nedenfor for at starte installationen med et helt nyt link.", false);
    }
    if (stateRow.shop_domain !== shop) {
      console.warn("OAuth shop domain canonicalized during install", {
        requested_shop: stateRow.shop_domain,
        authorized_shop: shop,
      });
    }
    if (new Date(stateRow.expires_at) < new Date()) {
      await supabase.from("shopify_oauth_state").delete().eq("state", state);
      return htmlResponse("Udløbet", "Install-linket er udløbet. Prøv igen.", false);
    }

    // Exchange code for access token
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: SHOPIFY_CLIENT_ID,
        client_secret: SHOPIFY_CLIENT_SECRET,
        code,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error("Token exchange failed:", errText);
      return htmlResponse("Token-fejl", `Shopify afviste token-exchange: ${tokenRes.status}`, false);
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    const scope = tokenData.scope || "";

    if (!accessToken) {
      return htmlResponse("Token mangler", "Shopify returnerede ingen access token.", false);
    }

    // Deaktiver alle eksisterende forbindelser før ny aktiveres (sikrer unique-index)
    await supabase.from("shopify_connection").update({ is_active: false }).eq("is_active", true);

    // Upsert connection og marker som aktiv (nyligt installeret = master tenant)
    await supabase.from("shopify_connection").upsert({
      shop_domain: shop,
      access_token: accessToken,
      scope,
      is_active: true,
      installed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "shop_domain" });

    // Cleanup state
    await supabase.from("shopify_oauth_state").delete().eq("state", state);

    return htmlResponse(
      "✓ Forbundet!",
      `Shopify-butikken <strong>${shop}</strong> er nu forbundet til PIM. Du sendes tilbage...`,
      true
    );
  } catch (err: any) {
    console.error("Callback error:", err);
    return htmlResponse("Server-fejl", err.message || "Ukendt fejl", false);
  }
});
