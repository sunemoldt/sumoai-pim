# Opret produkt direkte fra EAN-opslag

I dag viser EAN-opslag kun en "Opret produkt"-knap når EAN'et slet ikke findes, og den sender kun EAN med videre. Alt andet skal tastes manuelt. Planen gør opslaget til et fuldt startpunkt for oprettelse: leverandørdata fra feed-cachen forudfylder produktet, og AI skriver teksterne i den tone og efter de regler, der allerede bruges i PIM.

## Sådan kommer det til at virke

1. Du søger fx `8720254406879` i EAN-opslag.
2. Findes produktet ikke i PIM, men en eller flere leverandører har det i feedet, vises et felt "Opret produkt i PIM" med:
   - valg af hvilket leverandør-tilbud der skal bruges som udgangspunkt (default: billigste på lager, med respekt for leverandørprioritet)
   - forhåndsvisning af titel, brand, SKU, indkøbspris og beregnet salgspris
3. Klik på "Opret produkt" åbner oprettelsessiden med felterne forudfyldt:
   - EAN (nulstrippet), titel, brand, SKU fra feedet
   - vægt hvis feedet har den
   - salgspris inkl. moms beregnet ud fra indkøbspris + gældende avance, afrundet med den margin-sikre afrundingsregel (aldrig under min. avance)
4. AI kører automatisk med det samme og udfylder titel, kort beskrivelse, lang beskrivelse, meta titel og meta beskrivelse ud fra leverandørens produktnavn, brand og kategori — efter de eksisterende danske regler (h2 + teaser + 4–8 bullets, meta titel ≤60 tegn, meta beskrivelse 140–160 tegn, ingen opdigtede specs).
5. Har leverandørfeedet et produktbillede, hentes billed-URL'en med og vises i oprettelsen. Billedet følger med til Shopify-kladden, så du ikke selv skal uploade det.
6. Du kan rette alt inden du gemmer. Produktet oprettes som kladde, og leverandøren kobles automatisk på via den eksisterende rematch-funktion, så indkøbspris og lager følger med.

Findes produktet allerede i PIM, ændres intet — du får som nu et link til produktet.

## Billeder

I dag gemmer feed-importen ingen billeder, og Shopify-oprettelsen sender ingen billeder med. Det tilføjes:

- Nyt felt "Billede-URL" i leverandørens kolonne-mapping, så feeds der har et billedfelt kan mappe det.
- Billed-URL'en gemmes på feed-cachen og vises i EAN-opslaget og i oprettelsen (med forhåndsvisning).
- Ved push til Shopify sendes billedet med som medie på produktkladden ud fra URL'en — Shopify henter selv filen, så intet skal uploades manuelt.
- Har feedet intet billede, opretter systemet som i dag uden billede, og du kan indsætte en URL selv.

## Teknisk

- `supabase/functions/supplier-ean-lookup/index.ts`: udvid feed-tilbud med de felter der findes i `supplier_feed_cache` (produktnavn, brand, SKU, billede) i selve svaret.
- Migration: tilføj `image_url text` til `supplier_feed_cache` (ingen andre skemaændringer).
- `supabase/functions/supplier-feed-import/index.ts`: understøt `mapping.image_url` for CSV/XML-feeds og gem værdien på cache-rækken.
- `src/components/SupplierMappingDialog.tsx`: nyt valgfrit mapping-felt "Billede-URL".
- `src/components/SupplierEanLookupDialog.tsx`: nyt "Opret produkt"-panel når `master_product` er null og der findes tilbud. Vælg tilbud, beregn foreslået salgspris via `getRecommendedPriceInclVat` + `applyRoundingWithMinMargin` (afrundingstilstand og min. avance hentes fra `price_settings`/`analytics_settings` som andre sider gør). Navigér til `/products/new` med `state.prefill` inkl. billed-URL.
- `src/pages/NewProductPage.tsx`: læs `location.state.prefill` (samme mønster som `duplicateFrom`) og forudfyld felterne inkl. billede. Kør `ai-generate-product` automatisk én gang ved mount når prefill har et leverandør-produktnavn.
- `supabase/functions/shopify-create-product/index.ts` (+ varianter-versionen): send `media: [{ originalSource: image_url, mediaContentType: IMAGE }]` med i `productCreate`, kun når PIM har en gyldig http(s)-URL; fejl på medie må ikke vælte oprettelsen.
- `supabase/functions/ai-generate-product/index.ts`: uændret prompt/regler.
- Ingen ændringer i sync- eller prislogik.

