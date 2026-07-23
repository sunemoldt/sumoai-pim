## 1. Slet-funktion i Tilbud

**`src/pages/QuoteListPage.tsx`**
- Tilføj slet-knap (Trash2-ikon) i handling-kolonnen ved siden af Kopier.
- Bekræft via `confirm()` dialog ("Slet tilbud #X?").
- Sletter `quote_lines` først, derefter `quotes`-rækken, invaliderer `quotes-list`.

**`src/pages/QuoteEditorPage.tsx`**
- Tilføj tilsvarende slet-knap i topbar (kun når tilbuddet findes, ikke ved nyt).
- Efter slet: naviger til `/quotes`.

## 2. Ny "Salg"-side

Bruger den eksisterende `shopify_processed_orders` tabel (indeholder allerede `raw` jsonb med linjer + `total_decremented`).

**Ny route `/sales` i `src/App.tsx`** og menupunkt i `src/components/AppSidebar.tsx` (`ShoppingCart`-ikon, label "Salg", placeret efter Tilbud).

**Ny `src/pages/SalesListPage.tsx`**
- Tabel a la QuoteList: ordrenummer, dato, antal linjer, omsætning (ex. moms), samlet indkøb, dækningsbidrag (kr og %).
- Data hentes fra `shopify_processed_orders` order by `processed_at` desc, paginer 50 ad gangen.
- Klik på række → `/sales/:orderId`.

**Ny `src/pages/SalesDetailPage.tsx`** (read-only, layout inspireret af QuoteEditor)
- Header: ordrenummer, dato, kunde (fra `raw.customer` hvis muligt), Shopify-link.
- Linjetabel: produkt (title fra `raw.line_items[].title`), antal, salgspris pr. stk (ex. moms), linjeomsætning, indkøbspris (fundet via EAN/SKU-match i `master_products` + billigste `supplier_products.purchase_price` på salgstidspunktet — hvis ikke findes, vis "—").
- Totaler nederst: omsætning, indkøb, DB kr, DB %.
- Ingen redigering, ingen knapper udover "Åbn i Shopify".

**Indkøbspris-logik**: For hver linje slå produkt op via `raw.line_items[].sku` → `master_products.sku` (eller `variant_id` / barcode). Hent aktuel cheapest purchase price fra `supplier_products` blandt `stock_sync_supplier_ids` (samme prioritering som `recompute_product_stock`). Bemærk: dette er *nuværende* indkøb, ikke historisk — noter dette i UI ("indkøb pr. i dag").

## 3. Mobil-responsivt design

Kritiske sider der skal gennemgås (viewport <768px):

- **`AppLayout.tsx`** — bekræft sidebar bliver til drawer/sheet på mobil.
- **`QuoteEditorPage.tsx`** — 2-kolonne grid → stack, tabel-linjer → kort-visning.
- **Ny SalesListPage/SalesDetailPage** — bygges responsivt fra start (tabel → kort under `md:`).
- **`ProductListPage.tsx`** — filter-bar wrapper og tabel horizontal scroll.
- **`ProductDetailPage.tsx`** — tabs og pris/lager-kort skal stacke.
- **`CampaignEditorPage.tsx`** — allerede delvist ok, verificér knap-rækken øverst wrapper.

Fælles patterns:
- Erstat faste `grid-cols-2/3` med `grid-cols-1 md:grid-cols-2`.
- Tabel-wrapper `overflow-x-auto` hvor tabel bevares; ellers card-list under `md:hidden`.
- Top-action-bars: `flex-wrap gap-2`.
- Skjul ikke-kritiske kolonner under `sm`.

## Teknisk

- Ingen DB-skemaændringer nødvendige (bruger eksisterende `shopify_processed_orders.raw`).
- Ingen edge function-ændringer.
- Alt sker klient-side med eksisterende Supabase-læsninger.
