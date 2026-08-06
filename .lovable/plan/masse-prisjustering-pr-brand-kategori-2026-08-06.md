# Masse-prisjustering pr. brand / kategori

Et nyt værktøj hvor du vælger fx brand "Ubiquiti" (eller en kategori), sætter ønsket avance til 10%, ser en forhåndsvisning af hvad hver vare ændres til, og først derefter gemmer og pusher til Shopify.

## Sådan virker det

1. Ny side **Priser → Masse-prisjustering** (link fra Indstillinger og fra produktlisten).
2. Vælg målgruppe: brand, kategori eller de varer du har markeret i produktlisten.
3. Indtast ønsket **avance (dækningsgrad)** i procent, fx 10.
   - Beregning: salgspris ekskl. moms = billigste valgte leverandørs indkøbspris / (1 − avance/100), derefter moms lagt på og afrundet efter den globale afrundingsregel.
4. Preview-tabel viser pr. vare: titel, leverandør, indkøbspris, nuværende pris, ny pris, nuværende avance → ny avance, og en årsag hvis varen springes over. Hver række kan fravælges.
5. Tryk **Anvend** → priserne gemmes, markup-værdien gemmes pr. vare, og ændringerne lægges i Shopify-køen.

## Varer der springes over (vises som "springes over" i preview)

- Varer på tilbud (aktiv `sale_price`)
- Varer med egen markup-override (`custom_markup_percentage` sat)
- Varer uden valgt leverandør / uden indkøbspris

Du kan tvinge en enkelt oversprunget vare med igennem ved manuelt at markere den i preview, hvis du vil.

## Sikkerhed og alarmer

Ingen eksisterende beskyttelse omgås:

- Databasens `prevent_below_purchase_price`-trigger gælder stadig — en beregnet pris under indkøb afvises og vises som fejl i resultatet.
- Lav-avance-vagten (`apply_low_margin_guard`) og lagerberegning kører som i dag efter opdateringen, så varer der ryger under grænsen stadig markeres/stoppes og giver prisalarm.
- Varer uden lager behandles uændret.

## Teknisk

- Ny side `src/pages/BulkPricingPage.tsx` + rute i `src/App.tsx` og menupunkt i `AppSidebar`.
- Genbruger `usePriceSettings`, `getCheapestSupplier`-logikken (respekterer `stock_sync_supplier_ids` og leverandør-prioritet som på produktsiden) samt `applyRounding` fra `src/lib/price-rounding.ts`.
- Ny hjælpefunktion `priceFromMargin(purchaseExVat, marginPct)` i `src/hooks/use-products.ts` (avance-formel), ved siden af den eksisterende markup-formel.
- Anvend-knappen opdaterer `master_products.webshop_price` (og `custom_markup_percentage` som den ækvivalente markup) i batches med fejlopsamling pr. vare; eksisterende trigger `auto_enqueue_shopify_update` sørger for Shopify-push.
- Ingen skemaændringer nødvendige.
