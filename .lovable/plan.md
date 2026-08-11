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
5. Du kan rette alt inden du gemmer. Produktet oprettes som kladde, og leverandøren kobles automatisk på via den eksisterende rematch-funktion, så indkøbspris og lager følger med.

Findes produktet allerede i PIM, ændres intet — du får som nu et link til produktet.

## Teknisk

- `supabase/functions/supplier-ean-lookup/index.ts`: udvid feed-tilbud med de felter der findes i `supplier_feed_cache` (produktnavn, brand, SKU) i selve svaret — de hentes allerede, men medtages ikke konsekvent for linkede tilbud. Ingen skemaændring.
- `src/components/SupplierEanLookupDialog.tsx`: nyt "Opret produkt"-panel når `master_product` er null og der findes tilbud. Vælg tilbud, beregn foreslået salgspris via `getRecommendedPriceInclVat` + `applyRoundingWithMinMargin` (henter afrundingstilstand og min. avance fra `price_settings`/`analytics_settings` som andre sider gør). Navigér til `/products/new` med `state.prefill`.
- `src/pages/NewProductPage.tsx`: læs `location.state.prefill` (samme mønster som `duplicateFrom`) og forudfyld form-felterne. Kør `ai-generate-product` automatisk én gang ved mount når prefill indeholder et leverandør-produktnavn, med brief bygget af navn + brand + kategori + EAN; vis loading-tilstand og lad brugeren generere igen.
- `supabase/functions/ai-generate-product/index.ts`: uændret prompt/regler — kaldes bare med feed-info som input, så tonen er identisk med resten af systemet.
- Ingen databasemigrationer og ingen ændringer i sync- eller prislogik.
