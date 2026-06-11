
## Problem

87 aktive PIM-produkter har ingen `shopify_product_id` og bliver derfor sprunget over af både auto-kø-triggeren og `shopify-update-product`. Eksempel: `Ubiquiti UniFi 7 Pro` (EAN `0810084693650` — leading zero bryder match-reglen).

Fordeling:
- 3 med leading-zero EAN
- 63 med fallback `wc-` EAN (ikke ægte EAN — disse skal IKKE auto-matches)
- ~21 med "rigtigt" EAN der burde matche

## Anbefalet løsning: Bulk EAN-rematch (option A skaleret op)

Den bedste vej er at lave et batch-værktøj der gør det samme som det vi gjorde manuelt for G6 Bullet, men automatisk for alle 87 (med fallback-EAN'er ekskluderet).

### Hvad bygges

1. **Ny edge function `shopify-bulk-rematch`** (kalder eksisterende `shopify-match` logik):
   - Henter alle `master_products` hvor `shopify_product_id IS NULL`, `lifecycle_status='active'`, EAN findes og ikke starter med `wc-`.
   - For hvert produkt: normaliser EAN (strip leading zeros), søg Shopify via GraphQL `productVariants(query: "barcode:...")`.
   - Ved præcis match → opdater `shopify_product_id`, `shopify_variant_id`, sæt `shopify_sync_enabled=true`.
   - Returner rapport: matched / not_found / ambiguous (flere Shopify-varianter har samme EAN).

2. **Dry-run mode** (`{ apply: false }` default): viser hvad der ville ske uden at skrive — så du kan reviewe før commit.

3. **Ny UI-knap på `ShopifyPage.tsx`**: "Rematch ulinkede produkter" → kalder funktionen i dry-run, viser tabel med foreslåede matches, derefter "Bekræft og link" → kører `apply: true`.

4. **EAN-normalisering ved import**: Tilføj `TRIM(LEADING '0' FROM ean)` i `wc-import`, `supplier-feed-import` og `shopify-pull` så fremtidige imports ikke genintroducerer problemet (matcher core memory-reglen "Strip leading zeros from EANs").

### Hvorfor denne tilgang

- **Skalerbart**: ét klik dækker alle nuværende og fremtidige unlinkede produkter.
- **Sikker**: dry-run + manuel godkendelse før vi rører Shopify-ID'er.
- **Selvhelende**: import-normaliseringen forhindrer at problemet kommer igen.
- **Fallback-EAN'er ignoreres**: `wc-`-produkter har ikke et rigtigt EAN — de skal håndteres separat (manuel link eller send som ny kladde).

### Hvad der IKKE er med (kan tilføjes senere)

- Auto-oprettelse i Shopify for produkter uden match (kræver lifecycle=draft + bevidst beslutning per produkt — for risikabelt at bulk-køre).
- Håndtering af `wc-`-fallback produkter (separat oprydningstask).

### Filer der ændres

- `supabase/functions/shopify-bulk-rematch/index.ts` (ny)
- `supabase/functions/wc-import/index.ts` (EAN-strip ved insert)
- `supabase/functions/supplier-feed-import/index.ts` (EAN-strip)
- `supabase/functions/shopify-pull/index.ts` (EAN-strip ved write-back)
- `src/pages/ShopifyPage.tsx` (ny rematch-card med dry-run preview)
- Migration: engangs-UPDATE der stripper leading zeros fra eksisterende `master_products.ean` (3 rækker)

Godkend, så bygger jeg.
