## Mål
Du kan tilføje/redigere antal på "COMTEK - Eget lager" via den eksisterende manuelle leverandør-dialog, og dette lager lægges sammen med andre leverandørers lager. Hvis alle andre er udsolgte men eget lager har 5 stk → produktet står som **på lager (5)**.

## Hvad er problemet i dag
1. "COMTEK - Eget lager" er oprettet med feed-type `csv` → den dukker **ikke** op i den manuelle leverandør-dialog (den filtrerer kun på `manual`).
2. COMTEK er **ikke** i `stock_sync_supplier_ids` på dine produkter → selv hvis du tilføjer antal, indgår det ikke i "På lager"-beregningen.
3. Nye produkter får heller ikke automatisk COMTEK med.

## Løsning (3 trin)

### 1. Database-migration
- Tilføj `analytics_settings.own_stock_supplier_id` = COMTEK's id (gør den til "den valgte eget-lager-leverandør", så vi ikke hardcoder uuid'er).
- Opret trigger på `master_products INSERT`: appender automatisk COMTEK til `stock_sync_supplier_ids` på nye produkter og sætter `auto_stock_sync = true`.

### 2. Data-opdatering (engangs-backfill)
- Sæt `suppliers.feed_type = 'manual'` på COMTEK, så den vises i den manuelle dialog.
- For alle eksisterende `master_products`: append COMTEK's id til `stock_sync_supplier_ids` (hvis ikke allerede der) og sæt `auto_stock_sync = true`.
- Kald `recompute_product_stock()` for berørte produkter, så lager-status genberegnes med det samme.

### 3. UI — minimal ændring
- Den eksisterende `ManualSupplierPriceDialog` virker uændret efter feed_type-skiftet — COMTEK dukker op i dropdown'en automatisk.
- I produkt-detaljens leverandør-liste: vis et lille **"Eget lager"-badge** ud for COMTEK-rækken, så den er nem at skelne fra eksterne leverandører.
- I Indstillinger: tilføj et felt der viser hvilken leverandør der bruges som "eget lager" (kan ændres hvis du senere skifter navn).

## Sådan virker lager-beregningen efter ændringen (additiv)
Den eksisterende `recompute_product_stock()` summerer allerede stock fra alle leverandører i `stock_sync_supplier_ids` der opfylder margin-kravet. Eksempel:

```text
Produkt X:
  DCS:           in_stock=false, qty=0
  Aurdel:        in_stock=false, qty=0
  Eget lager:    in_stock=true,  qty=5
  →  Total: 5, status: instock  ✅
```

Hvis Aurdel kommer på lager igen med 3 stk → Total: 8.

## Tekniske detaljer
- **Trigger:** `BEFORE INSERT ON master_products` der læser `own_stock_supplier_id` fra `analytics_settings` og tilføjer til arrayet hvis ikke null og ikke allerede med.
- **Margin-filter:** COMTEK med `purchase_price = 0` (eller tom) giver margin = 100% → består altid `min_sync_margin`-tjek. Hvis du senere udfylder en intern kostpris, gælder almindelig margin-logik.
- **Shopify-sync:** Når lager-status ændres af recompute, fanger den eksisterende `auto_enqueue_shopify_update`-trigger ændringen og pusher nyt antal til Shopify automatisk.
- **Ingen breaking changes** for eksisterende leverandører eller produkter uden eget-lager-antal.

## Verifikation efter implementering
1. Åbn et udsolgt produkt → klik "Tilføj manuel pris" → vælg "COMTEK - Eget lager" → indtast 5 stk → gem.
2. Produktet skal nu vise "På lager (5)" og blive køet til Shopify-sync.
3. Sæt antallet til 0 → produktet skal falde tilbage til ekstern lager-status.