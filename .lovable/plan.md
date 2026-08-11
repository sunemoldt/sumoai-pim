# Anbefalet pris skal kun bruge valgte leverandører

## Problemet (bekræftet i data)

Produktet 888462698429 (Apple USB Type-C kabel 2m Hvid) har to leverandører:

- DCS — 79,00 kr — valgt (står i produktets valgte leverandører)
- KOSATEC — 65,57 kr — **ikke** valgt

Prisberegningen i frontend vælger simpelthen den billigste leverandør på lager uden at se på hvilke leverandører der er valgt på produktet. Derfor bliver anbefalet pris beregnet ud fra KOSATEC's 65,57 kr, selvom vi aldrig køber der. Samme fejl findes også i leverandør-prioritet: den laveste pris vinder, selv om en højere prioriteret leverandør skal foretrækkes.

Lager- og avance-vagten i databasen filtrerer allerede korrekt på valgte leverandører — det er kun visningen/anbefalingen i appen der ikke gør.

## Løsningen

Anbefalet pris (og indkøbspris/avance der vises sammen med den) skal beregnes ud fra samme regel som lagerstyringen:

1. Er der valgt leverandører på produktet → brug kun dem.
2. Blandt de valgte: foretræk leverandør med højeste prioritet der har varen på lager; ved samme prioritet vælges den billigste.
3. Er ingen valgte leverandører på lager → vis anbefaling ud fra billigste valgte leverandør uanset lager (som i dag), men aldrig fra en fravalgt leverandør.
4. Er der ingen valgte leverandører overhovedet → uændret adfærd (alle leverandører indgår).

Rettelsen slår igennem alle steder anbefalet pris og indkøbspris vises: produktsiden, produktlisten (tabel + kort), dashboard og bulk-prisjustering, så tallene er ens overalt.

## Teknisk

- `src/hooks/use-products.ts`: udvid `getCheapestSupplier` / `getCheapestSupplierAny` (eller tilføj `pickPricingSupplier(product)`) så de tager produktets `stock_sync_supplier_ids` og leverandørens `priority` med i valget.
- Opdater kaldsteder: `src/pages/ProductDetailPage.tsx`, `src/pages/ProductListPage.tsx`, `src/components/ProductCard.tsx`, `src/pages/DashboardPage.tsx`, `src/pages/BulkPricingPage.tsx`.
- `LIST_SUPPLIER_COLUMNS` skal hente `suppliers(id,name,priority)` så prioritet er tilgængelig i listen.
- Ingen ændringer i database eller i push til Shopify.

## Verifikation

Kontrollér på 888462698429 at Indkøb/anbefalet pris efter rettelsen bygger på DCS 79,00 kr, samt at et produkt uden valgte leverandører viser uændret resultat.
