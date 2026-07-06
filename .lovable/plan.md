## Mål
Kontrollér at alle prisregler/indstillinger faktisk kan justeres fra backend (Indstillinger), at logikken virker i praksis, og at der ikke er dubleret/ubrugt kode.

## Fundne problemer

### 1. Global markup & minimum-margin er read-only i UI (kritisk)
`price_settings` indeholder `global markup=30%, minimum_margin=10%` — men Settings-siden viser dem kun i en tabel. Der er ingen edit-knap. Ændring kræver direkte DB-adgang. Samme problem for brand-niveau.

### 2. Prisafrundingsregler er buggy
`applyRounding` i `ProductDetailPage.tsx` og `AiInsightsWidget.tsx`:
- `nearest_49` = `floor(price/10)*10 + 9` → runder altid ned til _9 (748 → 739 i stedet for 749). 
- `nearest_99` = `floor(price/10)*10 - 0.01` → runder altid ned (748 → 739,99 i stedet for 749,99).
- `nearest_95` bruger `floor` i stedet for nærmeste.
Logikken er også **duplikeret to steder** (ude af sync-risiko).

### 3. Skjulte tærskler ingen UI (analytics_settings)
`low_stock_threshold`, `min_traffic_threshold`, `min_ctr_threshold`, `analysis_period_days` er gemt men kan ikke ændres fra backend.

### 4. `min_sync_margin` hardcoded default 15 %
I `recompute_product_stock` og andre steder: `COALESCE(v_product.min_sync_margin, 15)`. Der er ingen global fallback-indstilling — 15 % er skjult i SQL.

### 5. `price_settings`-tabellen forurenet
Rounding og backorder gemmes som falske rows med `markup=0, minimum_margin=0` og vises i "Avanceprocenter"-tabellen som støj.

### 6. Global tærskeltilrettelse propagerer ikke
Når man ændrer `low_margin_guard_threshold` globalt kører `apply_low_margin_guard` ikke over eksisterende produkter — kun ved næste pris/lagerændring pr. produkt. Samme for `low_margin_guard_enabled`.

## Ændringer

### Frontend (`src/pages/SettingsPage.tsx`)
1. Gør "Avanceprocenter"-tabellen redigerbar: inline-edit + "Tilføj brand-override"-knap, med gem/slet. Filtrér rounding/backorder/wc_schedule rows ud af visningen.
2. Nyt kort **"AI/Analyse-tærskler"** der redigerer `analytics_settings`: `low_stock_threshold`, `min_traffic_threshold`, `min_ctr_threshold`, `analysis_period_days`.
3. Nyt felt i "Avanceprocenter"-kortet: **global standard for `min_sync_margin`** (fallback når produktet ikke har eget).

### Fælles util (`src/lib/price-rounding.ts` — ny)
- Ryk `applyRounding` hertil, én kilde til sandhed.
- Fix `nearest_49/95/99` så de finder **nærmeste** værdi der ender på 49/95/99, ikke bare runder ned.
- Enhedstest i `src/test/price-rounding.test.ts` med de eksempler der vises i UI.
- Erstat inline-implementationer i `ProductDetailPage.tsx` og `AiInsightsWidget.tsx` med importen.

### Backend
- Migration: udvid `recompute_product_stock` og `apply_low_margin_guard` så de læser global fallback for `min_sync_margin` fra en ny `analytics_settings`-nøgle (`min_sync_margin_default`) i stedet for hardcoded 15.
- Ny SQL-funktion `reapply_low_margin_guard_all()` (SECURITY DEFINER). Kald den fra Settings efter gem af global tærskel/enabled, så alle produkter revurderes med det samme.
- Trigger på `analytics_settings` UPDATE af `low_margin_guard_*`: kør `reapply_low_margin_guard_all()` async (via `net.http_post` til en lille edge-funktion, eller inline hvis rækkeantal er lavt — vi vælger inline med grænse fordi <1500 produkter).

### Cleanup
- Filtrer rounding/backorder/wc_schedule rows ud af `usePriceSettings`-visningen (data bliver liggende, men vises ikke som "avance").

## Tekniske detaljer
- Ingen ændring til edge functions (`ai-analyze` læser stadig `price_rounding` fra samme tabel).
- Ingen ændring til RLS — samme roller.
- Alle ændringer bagudkompatible med eksisterende produkter og queue.

## Uden for scope
- Ny UI for `field_sync_policy` (allerede eksisterende kort).
- Ændringer til Shopify-sync-logik.
