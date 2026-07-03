## Ændringer

### 1. Responsivt design (mobil)
- `AppLayout` + `AppSidebar`: gør sidebar til en `Sheet`/off-canvas på mobil (<768px) med hamburger-trigger i en top-header. På desktop bevares nuværende faste sidebar.
- Gennemgå de mest brugte sider (`DashboardPage`, `ProductListPage`, `SupplierListPage`, `MonitoringPage`, `ProductDetailPage`) og justér grid/tabeller: `grid-cols-*` med sm/md breakpoints, tabeller får horisontal scroll wrapper, statistik-kort stables på mobil.
- Padding i `AppLayout` reduceres på mobil (`p-4 lg:p-8`).

### 2. AI-indsigter som egen menu
- Fjern `AiInsightsWidget` fra `DashboardPage`.
- Ny rute `/ai-insights` + `src/pages/AiInsightsPage.tsx` der viser widget'et i fuld bredde.
- Nyt menupunkt i `AppSidebar` ("AI-indsigter", Sparkles-ikon) placeret over Monitoring.

### 3. Omdøb "WC Import" → "WooCommerce"
- `AppSidebar` label ændres. Rute `/import` bevares (ingen breaking changes).

### 4. Åbn produkter i nyt vindue fra dashboard-lister
- På Dashboard: "Produkter med lav avance", "Udsolgte produkter" og "Mest besøgte" — hver række/kort skal åbne `/products/:id` i ny fane (`window.open(..., "_blank")` eller `<a target="_blank">`) i stedet for at navigere i samme vindue.

### 5. Lav avance kun for produkter med tilknyttet leverandør
- Logikken der beregner lav-avance skal filtrere produkter fra hvor `supplier_products.length === 0` (dvs. ingen leverandør tilknyttet). Kun produkter hvor mindst én leverandør er tilknyttet — og hvor avancen mod billigste (in-stock, ellers any) leverandør er under tærsklen — skal vises.
- Gælder både dashboard-listen og evt. tælleren i `StatCard`.

### 6. Ny oversigt: "Produkter hos leverandør men ikke tilknyttet"
- På leverandør-detaljesiden (eller ny fane på `SupplierListPage` → klik på leverandør): vis alle rækker fra `supplier_products` for den valgte leverandør hvor `master_product_id` er null **eller** hvor EAN'et findes i leverandørens feed men ikke er koblet til et `master_products`-produkt.
- Query: hent leverandørens rå feed-rækker (fra `supplier_products` eller seneste `feed_run` payload) og cross-reference med `master_products.ean`. Vis EAN, titel fra feed, pris, lager, samt knap "Opret produkt" / "Match til eksisterende".
- Placering: ny tab "Ikke tilknyttet" på en leverandør-detaljeside (opret `SupplierDetailPage` hvis den ikke findes), tilgængelig via klik på leverandøren i listen.

## Tekniske detaljer

- Ingen DB-migrationer nødvendige — al data findes allerede i `supplier_products` og `master_products`.
- `useIsMobile` bruges til at skifte mellem Sheet-sidebar og fast sidebar.
- Nye komponenter: `src/pages/AiInsightsPage.tsx`, `src/pages/SupplierDetailPage.tsx`, `src/components/MobileHeader.tsx`.
- Rute-tilføjelser i `src/App.tsx`: `/ai-insights`, `/suppliers/:id`.

## Spørgsmål inden implementering

1. På leverandør-oversigten "ikke tilknyttet": skal jeg matche på EAN alene, eller også vise leverandørens SKU/varenummer som fallback når EAN mangler?
2. Skal AI-indsigter siden være helt tom udover widget'et, eller vil du have flere sektioner (fx historik, gemte anbefalinger)?
