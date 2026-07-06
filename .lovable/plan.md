## Formål

Når flere master-produkter (eller variants) har samme EAN, skal du kunne se konflikterne og vælge hvilket produkt der beholder EAN'et. De andre får en `wc-*` placeholder, så unique-constraint holder og Shopify-pull automatisk kan hente den korrekte barcode ved næste sync.

## Hvor det bor

Ny side: **Indstillinger → Data → Dublet-EAN'er** (`/settings/duplicate-eans`), plus et lille badge på Settings-forsiden når der findes konflikter.

## Flow

1. Siden loader alle EAN'er som optræder på >1 master_product (ignorerer `wc-*` placeholders og NULL).
2. Hver konflikt vises som en gruppe med:
   - EAN
   - Liste af kandidater: titel, SKU, Shopify-link (hvis synket), lifecycle status, sidste Shopify-pull, thumbnail
   - Radio-knap: "Behold på dette produkt"
   - Knap: "Ryd EAN på alle" (til hvis ingen er korrekt)
3. Ved "Gem": det valgte produkt beholder EAN, de øvrige får `wc-dup-<slug>` placeholder. Ændringen logges med source `duplicate-ean-resolve`.
4. Efter gem: option "Kør Shopify-pull nu" for de nulstillede produkter, så de får korrekt barcode fra Shopify.

## Teknisk

- Ny SQL-funktion `public.list_duplicate_eans()` (SECURITY DEFINER, `SET search_path = public`) returnerer `ean, product_ids[], products jsonb` — filtrerer `ean NOT LIKE 'wc-%'` og `count(*) > 1`.
- Ny SQL-funktion `public.resolve_duplicate_ean(p_ean text, p_keep_id uuid)`:
  - Sætter `app.change_source = 'duplicate-ean-resolve'`
  - For hvert andet produkt med samme EAN: sæt `ean = 'wc-dup-' || substr(id::text,1,8)`
  - Returnerer antal opdaterede.
- Ny SQL-funktion `public.clear_duplicate_ean(p_ean text)` — samme men på alle.
- Frontend: `src/pages/DuplicateEansPage.tsx` med react-query, kalder RPC'erne, viser groupering via `Card` + `RadioGroup` fra shadcn. Efter resolve trigger `supabase.functions.invoke('shopify-pull', { body: { master_product_id } })` for hver ryddet, hvis den har `shopify_product_id`.
- Route tilføjes i `src/App.tsx`, link i `src/pages/SettingsPage.tsx` (kort med badge der viser antal konflikter — bruger `list_duplicate_eans` count).

## Uden for scope

- Variant-niveau dubletter (kun master_products i denne omgang).
- Auto-fusion af produkter.
- Bulk-import af EAN-korrektioner via CSV.
