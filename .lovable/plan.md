## Diagnose

Shopify-fejlen `application_cannot_be_found: api_key 387bdcbf19...` betyder at Shopify ikke kan finde nogen app med det client_id. Vores edge function bygger linket korrekt — den læser bare en forkert `SHOPIFY_CLIENT_ID` fra Cloud-secrets.

Den Partner-app der virkede tidligere har client_id `efbc597f0d9faea46003b76496026f69` (bekræftet ved at dekode signaturen i install-linket du sendte).

Hverken kode, database, butik eller flow er ændret. Kun de to secrets peger på en app der ikke findes mere.

## Plan

### Trin 1 — Opdater secrets (du gør det manuelt i sikker formular)

Jeg åbner en formular til opdatering af:
- `SHOPIFY_CLIENT_ID` → sæt til `efbc597f0d9faea46003b76496026f69`
- `SHOPIFY_CLIENT_SECRET` → den tilhørende Client Secret fra samme app

**Hvor du finder dem:**
1. Log ind på https://partners.shopify.com
2. Apps → find appen med Client ID der starter med `efbc597f`
3. Klik appen → **Client credentials** (eller "API credentials")
4. Kopier Client ID og Client Secret derfra

Hvis du ikke kan finde appen i Partners, sig til — så skifter vi til Custom App-token i comtek-webshop i stedet (kræver en lille kodeændring i edge functions, men er mere robust til single-tenant).

### Trin 2 — Verificér Partner-app indstillinger

Inden installation, tjek i Partner Dashboard at appen har:
- **App URL:** `https://pim.sumoai.dk/shopify`
- **Allowed redirection URL:** `https://qanxmacwntyxfhznxriz.supabase.co/functions/v1/shopify-oauth-callback`

Hvis ikke, tilføj dem — ellers afviser Shopify callback'et.

### Trin 3 — Test installation

1. Gå til `/shopify` i PIM
2. Indtast `comtek-webshop.myshopify.com`
3. Klik "Installér"
4. Godkend på Shopify
5. Du sendes tilbage til PIM med "✓ Forbundet!"

Den nye forbindelse markeres automatisk som aktiv tenant, og den gamle `lovable-project-iv45c`-række forbliver registreret (du kan slette den bagefter på samme side).

### Trin 4 — Validering

Tryk "Test forbindelse" på `/shopify`. Hvis den returnerer butiksnavn + scopes er alt OK.

## Tekniske detaljer

- Ingen kodeændringer nødvendige — `shopify-oauth-start` og `shopify-oauth-callback` virker korrekt med en gyldig CLIENT_ID/SECRET.
- Tidligere kalde fra preview viser at edge-funktionen returnerer `install_url` med korrekt struktur, korrekt redirect_uri og gyldig state. Eneste problem er CLIENT_ID-værdien.
- Ingen migration eller schema-ændring kræves.
