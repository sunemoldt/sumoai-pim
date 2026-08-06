# Marker produkter med ukendt lagerantal

## Problemet (bekræftet)

Når en valgt leverandør melder "på lager" men ikke oplyser et antal, sætter lagerberegningen antallet til 1 som antagelse, og produktet står som På lager. Der er i dag 23 produkter i den situation. Filteret "På lager med 0" fanger dem ikke, fordi antallet står som 1 — ikke 0.

## Løsning

Produkterne skal fortsat være på lager, men vises tydeligt som "ukendt antal" og kunne filtreres frem.

1. **Nyt filter i produktlisten**: valgmuligheden "Ukendt lagerantal" i lager-filteret, som viser præcis de produkter, hvor de valgte leverandører melder på lager uden at oplyse et antal.
2. **Markering i listen**: i Lager-kolonnen vises antallet som `1?` med en grå "ukendt"-markering og et tooltip, der forklarer at leverandøren ikke oplyser lagertal.
3. **Markering på produktsiden**: under Lagerstyring vises samme note ved lagerantallet, så det er tydeligt hvorfra tallet kommer, når man retter det.

## Teknisk

- Ingen databaseændring. Produktlisten henter allerede `stock_sync_supplier_ids` samt leverandørernes `in_stock`/`stock_quantity`, så tilstanden udledes i frontend: status = `instock`, mindst én valgt leverandør har `in_stock = true` med `stock_quantity` = null, og ingen valgt leverandør har et reelt antal > 0.
- Hjælpefunktion `hasUnknownStockQty(product)` placeres i `src/hooks/use-products.ts` og bruges både i `ProductListPage.tsx` (filter + kolonne) og `ProductDetailPage.tsx` (note under Lagerstyring).
- `StockFilter`-typen udvides med `unknown_qty`, og valget gemmes i URL-parametre som de øvrige filtre.
- Lagerberegningen i backend ændres ikke — produkterne sælges videre som i dag.
