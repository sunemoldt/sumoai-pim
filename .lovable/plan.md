# Shopify ↔ PIM: Find umatchede Shopify-produkter

## Mål
Vis alle Shopify-varianter, der IKKE er linket til et PIM-produkt (`master_products`), og giv to handlinger pr. variant:
1. **Peg til eksisterende PIM-produkt** (manuel link via dropdown/søg)
2. **Opret nyt PIM-produkt** fra Shopify-data (kun hvis EAN/SKU ikke allerede findes i PIM)

## Hvor i UI
Ny sektion på `src/pages/ShopifyPage.tsx`: **"Umatchede Shopify-produkter"** — under det eksisterende rematch-kort.

Tabel med kolonner:
- Billede, titel, variant, SKU, EAN (barcode), pris, lager
- Status-badge: `EAN findes i PIM` / `SKU findes i PIM` / `Helt ny`
- Handlinger: **"Link til PIM"** (åbner søge-dialog) eller **"Opret i PIM"** (disabled hvis EAN allerede er taget)

## Backend

### Ny edge function: `shopify-find-unmatched`
- Henter alle Shopify-varianter (samme GraphQL-paginering som `shopify-match`).
- Henter alle `master_products` (id, ean, sku, shopify_product_id, shopify_variant_id, title).
- Returnerer kun varianter hvor `variantId` IKKE findes i PIM som `shopify_variant_id`.
- For hver umatched variant: angiv `pim_ean_conflict_id` / `pim_sku_conflict_id` hvis normaliseret EAN/SKU findes på en PIM-række (så UI ved om "Opret" skal disables og hvilken eksisterende række der kan linkes).
- Cache-svar i 60s via in-memory map (samme mønster som andre lookups).

### Ny edge function: `shopify-link-variant`
Body: `{ shopify_product_id, shopify_variant_id, master_product_id }`
- Validerer at variant findes i Shopify.
- Sætter `shopify_product_id`, `shopify_variant_id`, `shopify_sync_enabled = true` på master.
- Kalder `shopify-pull` for den master for at hente friske data.

### Ny edge function: `shopify-create-from-variant`
Body: `{ shopify_product_id, shopify_variant_id }`
- Henter produkt/variant via GraphQL (samme query som `shopify-pull`).
- Tjekker at normaliseret EAN ikke allerede findes i `master_products` — hvis den gør, returner 409 med ID på konflikten.
- Indsætter ny `master_products`-række med basale felter (title, ean, sku, shopify_product_id, shopify_variant_id, shopify_sync_enabled=true, lifecycle_status=mapped fra Shopify status).
- Kalder `shopify-pull` med den nye `master_product_id` for at fylde alle felter + variants.

Ingen ændringer til `supabase/config.toml` — alle tre arver default `verify_jwt = true`.

## Frontend

Ny komponent `src/components/ShopifyUnmatchedCard.tsx`:
- Knap "Scan Shopify for umatchede" → kalder `shopify-find-unmatched`.
- Tabel med resultater + de to handlingsknapper.
- "Link til PIM"-knap åbner en `Dialog` med søgefelt (søger `master_products` via eksisterende `useMasterProducts`-pattern på title/ean/sku) og bekræft-knap → kalder `shopify-link-variant`.
- "Opret i PIM"-knap → kalder `shopify-create-from-variant`, viser toast med link til det nye produkt.
- Auto-refresh listen efter handlinger.

Tilføj `<ShopifyUnmatchedCard />` til `ShopifyPage.tsx`.

## Edge cases
- Slettede Shopify-produkter: filtreres væk fordi GraphQL kun returnerer aktive/draft.
- Varianter uden barcode og uden SKU: vises stadig, "Opret i PIM" tilladt (EAN bliver null, vi falder tilbage til en `wc-`-lignende fallback? — **nej**, vi tillader null EAN og advarer i UI om at brugeren bør sætte EAN manuelt bagefter).
- Konflikt-håndtering: hvis "Opret" rammer eksisterende EAN, viser UI knappen "Link til [eksisterende produkt]" i stedet.

## Out of scope
- Bulk-link/bulk-create (kan tilføjes senere hvis nødvendigt).
- Auto-match — det dækker `shopify-match` allerede.
