## Mål

På `/products/new` skal jeg kunne markere at produktet oprettes med flere varianter (fx Farve: Hvid, Sort). Systemet opretter ét Shopify-produkt med en variant pr. række og én `master_products`-row pr. variant, alle med samme `shopify_product_id` — præcis samme mønster som auto-split i `shopify-pull` allerede bruger.

## UX på NewProductPage

- Ny switch øverst i "Grundoplysninger": **"Opret med varianter"**.
- Når slået fra: siden fungerer som i dag (én EAN, én pris osv.).
- Når slået til:
  - Feltet **Akse-navn** vises (default `Farve`, kan ændres til fx `Størrelse` eller `Model`).
  - EAN/SKU/pris/tilbudspris/vægt/lager-felterne i basis-kortet skjules (de bliver pr-variant i stedet).
  - Nyt kort **"Varianter"** med en tabel/liste, hver række har: Værdi (fx "Hvid"), EAN*, SKU, Salgspris, Tilbudspris, Lager, Vægt, Billede-URL.
  - Knapper "+ Tilføj variant" og "Fjern" pr. række. Min. 2 rækker kræves.
  - Fælles felter (titel, brand, kategori, beskrivelser, meta) redigeres én gang og deles på alle varianter — matcher `sync_meta_to_siblings`-triggerens forventning.

## Validering før submit

- Titel + akse-navn påkrævet.
- Min. 2 varianter, hver med unik værdi og gyldigt EAN (12/13 cifre, ledende nuller strippes).
- EAN-dubletcheck mod `master_products.ean` i én query (`.in("ean", [...])`).
- Salgspris kan ikke være tom hvis "Gem og send til Shopify" bruges.

## Data-flow ved "Gem"

1. **PIM først**: én `master_products.insert()` pr. variant (som i dag, men i loop), med:
   - fælles felter fra formen,
   - variant-specifikke felter fra rækken,
   - `attributes: { [akseNavn]: værdi }`,
   - `shopify_product_id`/`shopify_variant_id` = `null` (sættes efter Shopify-push).
2. **Leverandør-rematch**: kald `supplier-rematch-product` for hver ny master parallelt (samme kald som i dag).
3. Hvis brugeren trykker **"Gem som kladde"**: stop her, naviger til første variant.
4. Hvis brugeren trykker **"Gem og send til Shopify"**: kald ny edge-funktion `shopify-create-product-with-variants` (se næste sektion). Efter succes: naviger til første variant.

## Ny edge-funktion `shopify-create-product-with-variants`

Baseret på eksisterende `shopify-create-product`, men opretter ét produkt med flere varianter i én GraphQL-kæde:

- **Input**: `{ master_product_ids: string[], option_name: string }` — alle masters skal have samme `shopify_product_id=null` og deles om fælles felter (validering på server).
- **Step 1**: `productCreate` med `productOptions: [{ name: option_name, values: [{name: v1}, {name: v2}, …] }]`, `status: DRAFT`, samt titel/desc/vendor/type/SEO/short-description-metafield fra første master. Bruger samme HTML→rich_text-konverter som i dag.
- **Step 2**: `productVariantsBulkCreate` (strategy `REMOVE_STANDALONE_VARIANT`) med én variant pr. master: `optionValues: [{ optionName, name }]`, `price`, `compareAtPrice`, `barcode` (= EAN), `inventoryPolicy`, `inventoryItem.sku`, `inventoryItem.tracked: true`, `inventoryItem.measurement.weight`.
- **Below-cost guard**: kør `getCheapestPurchasePrice` + `assertNotBelowPurchase` pr. variant inden Shopify-kaldet — samme regel som i dag.
- **Step 3**: opdatér hver master med `shopify_product_id` + `shopify_variant_id` + `lifecycle_status='pending_activation'` + `shopify_sync_enabled=true`. Skriv `product_change_log`-linje pr. master.
- **Response**: `{ shopify_product_id, shopify_admin_url, variants: [{master_id, shopify_variant_id}] }`.

## Kant-tilfælde og gotchas

- `master_products.ean` er NOT NULL. Varianten skal derfor have gyldig EAN allerede ved PIM-insert — ellers blokerer vi i UI. (Ingen `shopify-` fallback her, i modsætning til auto-split, fordi brugeren indtaster manuelt.)
- Ved delvist fejlet Shopify-push: masters er allerede oprettet i PIM som kladder — de forbliver, og brugeren kan bruge eksisterende "Match til eksisterende Shopify"-knap eller retry. Fejl vises som toast med detaljer.
- `attach_own_stock_supplier`-triggeren aktiverer automatisk own-stock på hver ny master (uændret adfærd).
- `sync_meta_to_siblings`-triggeren holder tekster synkroniseret bagefter (uændret).

## Filer der ændres/oprettes

Ændres:
- `src/pages/NewProductPage.tsx` — variant-tilstand, ny variant-tabel, ændret submit-flow.

Oprettes:
- `supabase/functions/shopify-create-product-with-variants/index.ts` — ny edge-funktion.

Ingen migrationer, ingen skema-ændringer, ingen ændringer i `shopify-pull` / `shopify-update-product` / triggers.

## Teknisk noter

- Shopify GraphQL 2026-04: `productCreate` + `productVariantsBulkCreate` (ikke deprecated `productSet`) — samme pattern som `shopify-create-product` bruger for `productVariantsBulkUpdate`.
- `productOptions` skal sendes med i `productCreate`; ellers kan `productVariantsBulkCreate` ikke tildele option-værdier.
- `strategy: REMOVE_STANDALONE_VARIANT` fjerner Shopify's default "Default Title"-variant.
- HTML-håndtering, VAT-logik og price-mapping genbruges 1:1 fra `shopify-create-product`.

## Test-plan

1. Opret et testprodukt med 2 varianter (Hvid + Sort) → verificér 2 rows i `master_products` med samme `shopify_product_id`, forskellige EAN, korrekte attributes.
2. Åbn produktet i Shopify-admin → verificér 2 varianter, korrekte priser, EAN som barcode, tracked=true.
3. Rediger meta-titel på Hvid → verificér `sync_meta_to_siblings` propagerer til Sort.
4. Kør `shopify-pull` på Hvid → verificér begge varianter forbliver linket, ingen dubletter.
5. Prøv at oprette med dublet EAN → verificér fejl før nogen inserts.
