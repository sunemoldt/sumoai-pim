## Dupliker-knap til produkter

Tilføj en "Dupliker"-knap så et eksisterende produkt kan bruges som skabelon for et nyt.

### Sådan virker det
- Klik på "Dupliker" → bruger navigeres til `/products/new` med felter forudfyldt fra kildeproduktet.
- Intet gemmes i databasen før brugeren trykker "Gem som kladde" eller "Gem og send til Shopify".
- EAN og SKU er **tomme** (skal udfyldes manuelt — EAN er unikt).
- Titel får " (kopi)" tilføjet, så det er tydeligt.

### Placering af knap
1. **Produktdetalje-siden** (`ProductDetailPage.tsx`) — ny knap i toppen ved siden af eksisterende handlinger (Copy-ikon).
2. **Produktlisten** (`ProductListPage.tsx`) — ikon-knap i rækken (Copy-ikon, tooltip "Dupliker").

### Felter der kopieres
Alt fra master_products **undtagen** EAN, SKU, og leverandør-koblinger:
- Tekster: titel (+ " (kopi)"), short_description, long_description, meta_title, meta_description
- Priser & vægt: webshop_price, sale_price, weight_kg, custom_markup_percentage
- Billede & kategori: image_url, brand, category, categories, attributes
- Indstillinger: backorder_policy

**Ikke kopieret:** ean, sku, shopify_product_id, shopify_variant_id, shopify_sync_enabled, stock_quantity, supplier_products, sync_tags, lifecycle_status (sættes til `draft` ved gem).

### Teknisk
- `NewProductPage.tsx` udvides til at læse `location.state.duplicateFrom` (master_product objekt) eller en URL-query `?duplicate=<id>` der henter produktet via `useMasterProduct`.
- Ved mount: hvis duplicate-data findes, prefill `form` state (EAN/SKU tomme, titel med " (kopi)").
- Vis et lille info-banner øverst: "Duplikat af: [original titel] — udfyld EAN og SKU".
- Knap på detalje-side og liste navigerer: `navigate('/products/new', { state: { duplicateFrom: product } })`.

### Filer der ændres
- `src/pages/NewProductPage.tsx` — modtag og prefill duplikat-data, vis banner.
- `src/pages/ProductDetailPage.tsx` — tilføj "Dupliker"-knap.
- `src/pages/ProductListPage.tsx` — tilføj Dupliker-ikon i rækkehandlinger.

Ingen database-ændringer.