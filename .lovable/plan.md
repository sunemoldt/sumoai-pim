## Mål
Leverandør-prioritet skal styre hvilken kilde der bruges til lager/pris — ikke automatisk billigste. Fallback går til næste prioriterede leverandør der er på lager og clearer margin.

## Model

**Global default** på `suppliers`:
- Ny kolonne `priority integer NOT NULL DEFAULT 100` (lavere tal = højere prioritet).
- Redigeres på Indstillinger → Leverandører (drag/sort eller talfelt).

**Pr. produkt override** på `master_products`:
- Bruger den eksisterende `stock_sync_supplier_ids uuid[]` — rækkefølgen i arrayet = prioritet på det produkt.
- Ny kolonne `stock_supplier_order_override boolean DEFAULT false`. Når `false` sorteres arrayet efter global `suppliers.priority` ved beregning; når `true` respekteres den manuelle rækkefølge fra UI.

## Beregningsregel (ny)
I `recompute_product_stock` og `apply_low_margin_guard`:
1. Kandidater = `supplier_products` for produktet hvor `supplier_id = ANY(stock_sync_supplier_ids)`.
2. Sortér efter: override-array-index hvis `stock_supplier_order_override=true`, ellers `suppliers.priority ASC, purchase_price ASC` som tiebreak.
3. Walk listen: første leverandør der er `in_stock`, har `stock_quantity>0` (eller null) og margin ≥ `min_sync_margin` bliver aktiv kilde.
4. `stock_quantity` = den aktive kildes lager. Ingen sum.
5. Ingen match → 0 / outofstock.

## UI

**Indstillinger → Leverandører**
- Ny kolonne "Prioritet" med talfelt (eller pil op/ned). Gemmer `suppliers.priority`.

**Produktside (ProductDetailPage) → Lagerkilder-sektion**
- Viser de valgte leverandører sorteret efter gældende prioritet.
- Toggle "Brug egen rækkefølge for dette produkt" → sætter `stock_supplier_order_override`.
- Når slået til: drag-handles / op-ned knapper til at omordne `stock_sync_supplier_ids`.
- Breakdown-listen (allerede indført) markerer stadig "aktiv kilde" og viser status pr. leverandør (udsolgt / lav margin / aktiv).

## Migrationer
1. `ALTER TABLE suppliers ADD COLUMN priority integer NOT NULL DEFAULT 100;`
2. `ALTER TABLE master_products ADD COLUMN stock_supplier_order_override boolean NOT NULL DEFAULT false;`
3. Genskriv `recompute_product_stock` + `apply_low_margin_guard` til at bruge ny sortering.
4. Kør engangs-rebuild af alle aktive produkter (som sidste gang).

## Filer der røres
- `supabase/migrations/*` — schema + funktioner
- `src/pages/settings/SuppliersPage.tsx` (eller tilsvarende) — prioritets-kolonne
- `src/pages/ProductDetailPage.tsx` — override-toggle + omordning + brug den nye rækkefølge i preview-logikken
- Evt. `src/hooks/useSuppliers.ts` / query hvor `priority` skal med

## Ikke i scope
- Ændringer i shopify-push / Woo-push (bruger stadig `stock_quantity` fra master_products).
- Ændringer i tilbudsmodul / EAN-lookup.