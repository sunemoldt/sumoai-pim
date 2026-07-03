# Fejl: kort beskrivelse synkes ikke ved oprettelse i Shopify

## Årsag

`shopify-create-product` sender kun `title`, `descriptionHtml` (lang beskrivelse), `vendor` og `productType` til Shopify. Den skriver **ikke** kort beskrivelse (som lever i metafeltet `custom.short_description` i Shopify) og heller ikke SEO-felter (`seo.title` / `seo.description`).

`shopify-update-product` håndterer det korrekt via metafield + `seo`-objekt, men auto-enqueue-triggeren fanger ikke situationen efter oprettelse: den kører kun når felter som `short_description` ændres — og ved en frisk oprettelse ændres de netop ikke bagefter, så der queues aldrig et update. Resultat: kort beskrivelse og SEO bliver i PIM men når aldrig frem til Shopify.

Samme problem gælder alle produkter oprettet via "Gem og send til Shopify"-knappen.

## Løsning

### 1. Ret `shopify-create-product` så den skubber alle relevante felter med samme
Udvid `productCreate`-mutationen så den — i samme kald — sender:
- `descriptionHtml` (allerede der)
- `metafields: [{ namespace: "custom", key: "short_description", type: "multi_line_text_field", value: ... }]` når `short_description` findes
- `seo: { title, description }` når `meta_title` / `meta_description` findes

Vælg samme feltnavne/typer som `shopify-update-product` bruger, så de to funktioner er konsistente.

### 2. Backfill for allerede oprettede produkter
Tilføj en engangs-knap i **Indstillinger → Shopify** ("Genskub kort beskrivelse + SEO til Shopify") som:
- Finder produkter med `shopify_product_id IS NOT NULL` og `shopify_sync_enabled = true`, hvor `short_description IS NOT NULL` eller `meta_title/meta_description IS NOT NULL`
- Indsætter en række i `shopify_update_queue` med payload der eksplicit angiver `short_description`, `meta_title`, `meta_description` og `changed_fields`, så `shopify-update-product` skubber dem
- Kører via eksisterende køarbejder — ingen ny throttling-risiko

Alternativt (mere målrettet, hvis vi vil holde det snævert): kun produkter oprettet inden for de sidste 30 dage og oprettet af `shopify-create-product` (kan filtreres via `product_change_log` hvor `source = 'shopify-create-product'`).

### 3. Verifikation
- Opret et testprodukt via "Gem og send til Shopify" med kort beskrivelse udfyldt → tjek Shopify-admin at metafeltet `custom.short_description` er sat straks
- Kør backfill og bekræft at HP Thunderbolt 4 Ultra 180 W G6 får sin kort beskrivelse i Shopify

## Teknisk detalje

- Filer der ændres: `supabase/functions/shopify-create-product/index.ts` (udvid `productInput`), ny lille UI-komponent + evt. ny edge function `shopify-backfill-short-description` — eller genbrug direkte insert i `shopify_update_queue` fra klienten (kræver ingen ny funktion, RLS tillader det allerede for authenticated).
- Ingen DB-migration nødvendig.
- Ingen ændring af `auto_enqueue_shopify_update`-trigger — vi løser det ved kilden i stedet.

Sig til hvis du vil have backfill for **alle** eksisterende Shopify-produkter (bredere, men bruger flere Shopify API-kald) eller kun for de nyligt oprettede.
