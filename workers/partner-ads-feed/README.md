# Cloudflare Worker: Partner-ads feed proxy

Denne Worker kører på Cloudflare og eksponerer `https://pim.sumoai.dk/partner-ads.xml` (samt `/partnerads.xml` som alias) ved at proxye til Supabase edge-funktionen `partner-ads-feed`.

## Formål

- Skjul Supabase backend-URL for Partner-ads og andre tredjeparter.
- Behold det pæne domæne `pim.sumoai.dk` til feedet.

## Forudsætninger

- Cloudflare-konto med adgang til `sumoai.dk`-zonen.
- `pim.sumoai.dk` er sat op med Cloudflare proxy (Lovable "Proxy Mode" eller DNS gennem Cloudflare).

## Deploy

1. Installer dependencies:
   ```bash
   cd workers/partner-ads-feed
   npm install
   ```

2. (Valgfrit) Tilføj en delt hemmelig nøgle mellem Worker og Supabase edge-funktionen:
   ```bash
   npx wrangler secret put FEED_API_KEY
   ```
   Sæt derefter den samme værdi som secret `FEED_API_KEY` i Lovable/Supabase for edge-funktionen `partner-ads-feed`.

3. Deploy Worker:
   ```bash
   npx wrangler deploy
   ```

4. Sørg for at routes i `wrangler.toml` matcher det domæne, du har i Cloudflare-zonen.

## Hvordan det fungerer

- Worker fanger kun `/partner-ads.xml` og `/partnerads.xml`.
- Alle andre stier returnerer 404, så Lovable SPA-routing ikke forstyrres.
- Hvis `FEED_API_KEY` er sat, sendes den som header til Supabase edge-funktionen, der så validerer den.
