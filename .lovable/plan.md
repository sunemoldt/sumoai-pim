## Tilbudsmodul mobiloptimering + EAN-opslag på tværs af leverandører

### 1. Mobilvenligt tilbudsmodul

**QuoteListPage** (`/quotes`):
- Header stakkes lodret på mobil (titel + "Nyt tilbud"-knap under hinanden, fuld bredde).
- Under `md:` skjules tabellen og hver række vises som et kort med: tilbudsnr + status-badge øverst, kundenavn, dato, antal linjer, total. Tap på kort = åbn tilbud. "Dupliker"-knap som lille tekstknap i bunden af kortet.
- Tabellen bevares uændret for tablet/desktop (`md:` og op).

**QuoteEditorPage** (`/quotes/:id`):
- Topbar (tilbage, titel, Gem, Send, Godkendt, Afvist) bliver fleksibel: titel på egen linje, knapper wrapper og bliver ikoner + kort tekst på mobil. En "..."-menu er ikke nødvendig — vi bruger `flex-wrap` + `flex-1` på titlen.
- "Kunde og detaljer"-kortet er allerede responsive.
- **Produktlinjer** er hovedproblemet: tabellen med 10 kolonner hopper vandret. Under `md:` skjules tabellen og hver linje rendes som et kort med felter i to kolonner (Antal / Rabat%, Webshop / Tilbudspris) og små read-only rækker (Indkøb, Avance kr., Avance %, Subtotal). ProductPicker fylder hele bredden. Slet-knap i kortets header.
- Pakkepris-footer stakkes lodret på mobil (label + input under hinanden, fuld bredde).
- Total-widget/summary (linjer 388+) skal jeg først læse — bliver stakket lodret på mobil.

Ingen ændringer i beregninger, gem-flow eller datamodel.

### 2. EAN-opslag på tværs af leverandører

**Ny genbrugelig komponent** `src/components/SupplierEanLookupDialog.tsx`:
- Modal med EAN-input + "Søg"-knap. Enter = søg. Normaliserer EAN (strip leading zeros som andre steder i koden).
- Kalder ny edge function `supplier-ean-lookup` (verify_jwt=false, JWT valideret i koden) der:
  1. Slår op i `supplier_products` join `suppliers` på normaliseret EAN (SQL: strip leading zeros på begge sider).
  2. Returnerer per leverandør: navn, purchase_price ex.moms, stock_quantity, in_stock, sidst opdateret, evt. supplier_sku/title.
  3. Finder også evt. eksisterende `master_products`-match og returnerer den (så brugeren ser om produktet allerede er oprettet).
- Modal viser resultater i en sorteret liste (billigste in-stock øverst), med:
  - Leverandørnavn, lagerstatus, indkøbspris ex.moms.
  - **Avance-beregner**: input for avance% (default fra `price_settings` global). Viser beregnet udsalgspris ex.moms og inkl. moms live per leverandør (bruger `getRecommendedPriceInclVat`). Global avance% kan justeres i toppen af dialogen og gælder alle rækker.
  - Hvis PIM-match findes: link til produktet + "Brug denne pris".
  - Hvis intet PIM-match: knap "Opret produkt" der navigerer til `/products/new?ean=...` (findes allerede via `NewProductPage`).

**Indgange til opslag:**
- **Sidebar** (`AppSidebar.tsx`): nyt punkt "EAN-opslag" (ikon: `ScanBarcode`) der åbner dialogen fra en tynd wrapper-page eller globalt via context. Enkleste løsning: dedikeret route `/ean-lookup` der bare rendrer dialog-indholdet som fuld side (samme komponent, `asPage` prop).
- **QuoteEditorPage**: knap "Søg EAN på tværs af leverandører" ved siden af "Tilføj linje". Når en pris vælges i modalen, tilføjes en ny linje med `product_name` (fra PIM-match eller "EAN 5701234…"), `purchase_price` = leverandørens pris, `quote_price`/`list_price` = beregnet udsalgspris inkl. moms. `pim_product_id` sættes hvis der findes match, ellers null.

### Tekniske detaljer

**Ny edge function** `supabase/functions/supplier-ean-lookup/index.ts`:
- Body: `{ ean: string }`, zod-valideret.
- CORS + JWT-validering (samme mønster som andre funktioner).
- Bruger service role client. Query normaliserer EAN så leading zeros ignoreres begge veje.
- Response: `{ ean_normalized, master_product: {id,title,image_url,webshop_price}|null, offers: [{supplier_id, supplier_name, purchase_price, stock_quantity, in_stock, updated_at, supplier_sku, supplier_title}] }`.

**Ny route i `App.tsx`:** `/ean-lookup` → `EanLookupPage` (tynd wrapper der bruger samme dialog-komponent i "page mode").

**AppSidebar.tsx:** tilføj nav-item "EAN-opslag" med `ScanBarcode`-ikon, placeret over "Leverandører".

**Filer**
- Nye: `supabase/functions/supplier-ean-lookup/index.ts`, `src/components/SupplierEanLookupDialog.tsx`, `src/pages/EanLookupPage.tsx`.
- Ændrede: `src/pages/QuoteListPage.tsx`, `src/pages/QuoteEditorPage.tsx`, `src/components/AppSidebar.tsx`, `src/App.tsx`.

Ingen skema-ændringer, ingen migrations.
