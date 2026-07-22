
# Ryd op: WooCommerce, Feeds og indstillinger — plus stabilitetstjek

## Mål
1. Fjern WooCommerce fra brugerfladen (kode/DB bevares midlertidigt som "død", så intet ødelægges).
2. Fjern Feeds-siden (Partner Ads) fra brugerfladen og stop den natlige generering.
3. Verificér at pris- og lagerregler ikke modstrider hinanden efter oprydningen.
4. Fjern ubrugte indstillinger fra Indstillinger-siden.
5. Sikkerheds-, drifts- og performance-gennemgang.

Nuværende bekræftede state (fra læsning nu):
- WooCommerce er allerede kill-switched (`woocommerce_enabled=false`, trigger `trg_auto_push_wc_update` er DISABLED). Menupunktet "WooCommerce" peger reelt kun på `/import` (WC-import UI).
- Feeds-siden viser kun `PartnerAdsFeedCard`. Cron `generate-partner-ads-feed-nightly` (02:15) og `partner-ads-feed`/`feed`/`generate-partner-ads-feed` edge functions kører stadig.
- Cron jobs aktive: cleanup-change-log, nightly-backup, sale-campaign-scheduler (5m), scheduled-sync (30m), shopify-analytics-daily, below-cost-scanner-daily, shopify-queue-worker (15m), generate-partner-ads-feed-nightly.

---

## Del 1 — Fjern WooCommerce fra UI (ikke-destruktivt)

Behold DB, edge functions og trigger som de er (allerede deaktiveret). Vi fjerner kun brugerens indgange, så systemet ikke belastes med kode/queries der aldrig skal bruges igen.

- `src/components/AppSidebar.tsx`: Fjern menupunktet **"WooCommerce"** (der peger på `/import`).
- `src/App.tsx`: Fjern `/import` route + `ImportPage`-importen. `ImportPage.tsx` selve filen slettes.
- `src/pages/SettingsPage.tsx`:
  - Fjern legacy `<details>`-blokken med `WoocommerceToggleCard` og `WoocommerceForcePushCard`.
  - Fjern importerne.
- Filer der slettes (kun UI, ingen andre imports):
  - `src/pages/ImportPage.tsx`
  - `src/components/WoocommerceToggleCard.tsx`
  - `src/components/WoocommerceForcePushCard.tsx`
  - `src/hooks/useWoocommerceEnabled.ts` (kun brugt af ovenstående; verificeres inden sletning)
- `scheduled-sync/index.ts`: Fjern WC-import blokken (læser `price_settings.wc_schedule` og kalder `wc-import`), så cron aldrig kalder WC.
- Edge functions `wc-import` og `wc-update-product` bevares på disk (ingen nye deploys nødvendige), men får ingen kaldere længere. Ingen sletning her — reducerer risiko for at ødelægge noget.
- DB: `analytics_settings.woocommerce_enabled` og `woocommerce_scope` bevares (giver dokumenteret "off"-state). `price_settings` scope `wc_schedule` bevares.
- Sidebar-ikon: n8n Workflows beholdes (uændret).

## Del 2 — Fjern Feeds

- `src/App.tsx`: Fjern `/feeds` route + `FeedsPage`-import.
- `src/components/AppSidebar.tsx`: Fjern "Feeds"-menupunkt.
- Filer der slettes:
  - `src/pages/FeedsPage.tsx`
  - `src/components/PartnerAdsFeedCard.tsx`
- Cron: Deaktivér `generate-partner-ads-feed-nightly` via `cron.unschedule('generate-partner-ads-feed-nightly')` (kun DATA-ændring i cron-schema, ikke migration).
- Edge functions `generate-partner-ads-feed`, `partner-ads-feed`, `feed` bevares (kaldes ikke længere; sletning kan gøres senere hvis ønsket).

## Del 3 — Verificér pris- og lagerregler (ingen kodeændring, kun rapport)

Efter oprydningen skal jeg kontrollere at intet trigger-flow modarbejder hinanden. Jeg leverer en kort rapport uden at ændre logik medmindre der findes en konflikt:

- `prevent_below_purchase_price` (BEFORE UPDATE) vs. `auto_enqueue_shopify_update` (AFTER UPDATE) + `auto_push_wc_update` (nu død).
- `recompute_product_stock` bruger prioritet: produkt-override → `suppliers.priority` → pris. `apply_low_margin_guard` bruger samme sortering.
- Kill-switch check: bekræft `trg_auto_push_wc_update` fortsat er DISABLED, så ingen WC-push kan smutte ud.
- `attach_own_stock_supplier`-trigger: bekræft at den kun tilføjer eget-lager-supplier hvis `own_stock_supplier_id` er sat (er sat: `9ec4390b…`). Ingen kollision med prioritetslogik.
- `sync_backorders_allowed_from_policy` synkroniserer korrekt med `backorder_policy` — ingen konflikt med Shopify-payload i `shopify-update-product`.
- Ingen ændringer sker med mindre rapporten viser en konkret konflikt; i så fald listes den i sluttekst og du beslutter fix.

## Del 4 — Ryd op i Indstillinger

Baseret på faktisk indhold på siden i dag, fjerner jeg kun det der nu er utvetydigt ubrugt:

- Fjern legacy WooCommerce-details (Del 1).
- MCP-server kortet: viser `list_products, update_product, get_price_settings, get_webhooks, ...`. Beholdes uændret — bruges af Claude/Manus.ai per memory.
- Webhooks-kortet: beholdes (dokumenteret n8n/Make.com-integration).
- Prisafrunding, restordre-default, markup, low-margin-guard, analysetærskler, Shopify-queue/pull/order/backup, sprog, field-sync-policy, cleanup, dupe-EANs, EAN-forslag, attributdefinitioner: alle aktive → beholdes.
- Dinero-kort (viser at secrets er gemt): beholdes.
- Ingen sletning i `price_settings` eller `analytics_settings` — kun UI-oprydning, så vi ikke bryder edge functions der læser default'erne.

## Del 5 — Sikkerhed / drift / stabilitet

Efter kodeoprydningen kører jeg:

1. `supabase--linter` — rapportér advarsler; ret kun hvis lav-risiko og entydigt.
2. `security--get_scan_results` — gennemgå listen; foreslå fixes eller ignoreringer (beder om godkendelse for kritiske).
3. Cron-audit rapport: bekræfte at kun disse jobs kører efter oprydningen:
   - cleanup-product-change-log (03:15)
   - nightly-pim-backup (01:30)
   - sale-campaign-scheduler (hver 5. min)
   - scheduled-sync (hver 30. min) — reduceret arbejde efter WC-blokken fjernes
   - shopify-analytics-daily (02:00)
   - shopify-below-cost-scanner-daily (06:15)
   - shopify-queue-worker (hver 15. min)
   - generate-partner-ads-feed-nightly → **unscheduled**
4. Stabilitetstjek: bekræfte at ingen kode-sti mere kalder `wc-*` eller `generate-partner-ads-feed`.
5. Rapportér om der er tydeligt overforbrug (fx queue-backlog, error-rate 24h) via `get_monitoring_overview` og `get_db_stats`.

## Sådan er det ikke-destruktivt

- Ingen `DROP TABLE`, ingen sletning af edge functions, ingen migration der ændrer eksisterende regler.
- Kun cron-`unschedule` af én job (partner-ads), som let kan genoprettes hvis nødvendigt.
- WC-integration bevares fuldt på disk + DB; kill-switch var i forvejen aktiv, så adfærd er identisk med i dag.
- Alle ændringer sker i UI-lag + fjernelse af én cron-entry og WC-blokken i `scheduled-sync`.

## Teknisk (kort)

Filer redigeres: `src/App.tsx`, `src/components/AppSidebar.tsx`, `src/pages/SettingsPage.tsx`, `supabase/functions/scheduled-sync/index.ts`.
Filer slettes: `src/pages/ImportPage.tsx`, `src/pages/FeedsPage.tsx`, `src/components/PartnerAdsFeedCard.tsx`, `src/components/WoocommerceToggleCard.tsx`, `src/components/WoocommerceForcePushCard.tsx`, `src/hooks/useWoocommerceEnabled.ts` (efter verifikation).
Cron: `SELECT cron.unschedule('generate-partner-ads-feed-nightly')` via insert-tool.
Ingen migrations. Ingen datamutationer udover cron-unschedule.
