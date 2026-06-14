# Mål
Meta titel + meta beskrivelse skal håndteres centralt i PIM på master-produktet, vises på alle varianter (som deler samme Shopify-produkt) og pushes til Shopify (SEO → Page title / Meta description). WooCommerce-pushen forberedes som "legacy" (rank_math), men er paused jf. nuværende sync-status.

# Hvad er problemet i dag
1. På de to Ajax DoorProtect-varianter (EAN 856963007033 + 856963007040) er `meta_title` og `meta_description` tomme i PIM, selvom Shopify har dem.
2. `field_sync_policy` står på `master = shopify, direction = pull` for begge felter → PIM må ikke skubbe ændringer ud, og felterne hentes kun ved import/pull (de står tomme nu fordi ingen pull har hentet SEO ind for disse produkter siden import).
3. Begge varianter peger på samme `shopify_product_id = 10464770916691`, men der findes ingen logik der sikrer at de deler samme meta-felter i PIM. Når du redigerer den ene, opdateres søsteren ikke.
4. `shopify-update-product` skubber kun titel/beskrivelse/short_description/pris/lager — den sender ikke `seo { title, description }`.

# Løsning (4 trin)

## 1. Policy-skifte: PIM bliver master
- Sæt `field_sync_policy` for `meta_title` og `meta_description`: `master = pim`, `direction = push`.
- `auto_enqueue_shopify_update`-triggeren fanger allerede ændringer på begge felter, så ændringer i PIM køes automatisk til Shopify.

## 2. Backfill fra Shopify til PIM (engangs)
- Kør `shopify-seo-backfill` (eksisterende edge function) i `apply`-mode med `overwriteEmptyOnly = true` → henter `seo.title` / `seo.description` (eller rank_math metafields) for alle produkter hvor PIM-feltet er tomt.
- For varianter der deler `shopify_product_id`: backfill skriver samme værdi til alle masters med samme Shopify-id (én Shopify-SEO → N masters i PIM).

## 3. Push ved ændring + søster-synk
- Udvid `shopify-update-product` til at sende `seo: { title, description }` på `productUpdate`-mutationen når `meta_title` / `meta_description` er i payload (gated af `canPush("meta_title" / "meta_description")`).
- Tilføj en database-trigger `sync_meta_to_siblings` på `master_products`: når `meta_title` eller `meta_description` ændres på et produkt med `shopify_product_id`, opdateres alle andre master-produkter med samme `shopify_product_id` til samme værdi (uden at re-trigge sig selv via `app.change_source = 'sibling-sync'`). Dermed bliver de to Ajax-varianter altid identiske.
- `shopify_update_queue` får én jobopdatering pr. Shopify-produkt (eksisterende dedupe på `master_product_id` + `pending|processing` håndterer det; søster-trigger sætter samme værdi → ingen ekstra støj).

## 4. UI — minimale ændringer
- I produkt-detaljens SEO-sektion: vis en lille info-tekst når produktet har søstre med samme Shopify-id ("Deles med X variant(er) — ændringer gælder alle").
- Tilføj en "Hent fra Shopify"-knap pr. produkt der kalder `shopify-seo-backfill` for ét EAN (bruges hvis Shopify er ændret manuelt og du vil hente over).
- I `FieldSyncPolicyCard`: ingen kode-ændring nødvendig — den nye policy `pim/push` vælges automatisk efter migrationen.

## Sådan virker det efter ændringen
```text
PIM master A (856963007033) ─┐
                              ├─ samme shopify_product_id 10464770916691
PIM master B (856963007040) ─┘

Du redigerer meta_title på A i PIM
  → trigger kopierer samme værdi til B
  → auto_enqueue_shopify_update køer push til Shopify
  → shopify-update-product sender seo.title til produkt 10464770916691
  → Shopify "Page title" opdateret
```

## Tekniske detaljer
- **Migration:**
  - `UPDATE field_sync_policy` for de to felter til `pim/push`.
  - Ny funktion + trigger `sync_meta_to_siblings_trg` (BEFORE/AFTER UPDATE på `master_products`) der propagerer meta til søstre med samme `shopify_product_id`.
- **Edge function-ændring (`shopify-update-product`):** tilføj `productInput.seo = { title: meta_title, description: meta_description }` når felterne er sat og policy tillader push. Behold eksisterende `canPush`-gating.
- **WooCommerce (legacy/paused):** lad `wc-import` blive ved at læse rank_math (allerede gør det), men tilføj ikke push til WC nu — kan aktiveres senere ved at udvide `wc-update-product`.
- **Variant-niveau metafields:** Shopify har kun SEO på produkt-niveau (ikke pr. variant), så søster-synk-modellen passer 1:1.

## Verifikation
1. Kør backfill → tjek at PIM nu viser meta_title/meta_description på begge Ajax-varianter med samme værdi som Shopify.
2. Rediger meta_title på den ene Ajax-variant → den anden får samme værdi straks → kø-job dukker op → Shopify "Page title" opdateres.
3. Slet meta_description manuelt i Shopify-admin → klik "Hent fra Shopify" i PIM → felterne genfyldes.
