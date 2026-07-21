## Problem

`shopify-update-product` sender kun `seo.title` / `seo.description` når `meta_title` / `meta_description` er eksplicit med i request-body, eller når kaldet er `queued=true` og feltet står i `changed_fields`. Alle andre opdateringer (pris, lager, beskrivelse osv.) skubber ikke SEO ud — så Shopify-siden ender med tom `seo.description` for produkter der aldrig har haft et dedikeret SEO-push. Resultat: 331 produkter i Shopify med manglende SEO.

## Fix

### 1. Altid sende SEO fra DB (`supabase/functions/shopify-update-product/index.ts`)

I SEO-blokken (linje 448-470): fjern kravet om at `effectiveMetaTitle` / `effectiveMetaDescription` skal være defineret. Fald i stedet tilbage til DB-værdien (`product.meta_title`, `product.meta_description`) hver gang funktionen skriver til Shopify, så længe `canPush("meta_title" / "meta_description")` tillader det og værdien ikke er tom.

- Loggen (`logChange` + `updatedFields`) skal kun tælle når værdien reelt er ny på Shopify-siden — brug fortsat `effectiveMeta*` (eksplicit ændring) til det, så "0 felter opdateret"-UI ikke bliver forvirrende, men medtag altid feltet i `productInput.seo` når DB har en værdi.
- Bevar `dbUpdate` sådan at PIM-tabellen ikke får unødige skrivninger.

### 2. Full re-sync af eksisterende Shopify-produkter

Kør engangs-backfill der queuer alle produkter med `shopify_product_id IS NOT NULL AND shopify_sync_enabled = true AND (meta_title IS NOT NULL OR meta_description IS NOT NULL)` i `shopify_update_queue` med `payload = { reason: 'seo-backfill', changed_fields: ['meta_title','meta_description'], meta_title, meta_description }`. Worker skubber dem løbende via ovennævnte kode-fix.

### 3. Verifikation

Efter køen er tømt: `shopify-seo-backfill` (mode `report`) forventes at rapportere 0 produkter med tom `seo.description` på Shopify — det er brugerens accept-kriterium.

## Teknisk detalje

- Filer der ændres:
  - `supabase/functions/shopify-update-product/index.ts` (SEO-blok ~L448-470)
- SQL migration/insert:
  - Batch-insert i `shopify_update_queue` (én række pr. produkt, chunkes hvis nødvendigt).
- Ingen ændringer nødvendige i `shopify-create-product` (sender allerede `seo` i `productSet`/`productCreate`).
- Sync-policy respekteres fortsat via eksisterende `canPush(...)` — brugere der har blokeret `meta_title`/`meta_description` i policy'en får dem stadig ikke skubbet.
