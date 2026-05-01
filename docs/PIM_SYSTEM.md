# Comtek PIM — Komplet teknisk reference

> **Live URL**: https://pim.sumoai.dk
> **Stack**: React 18 + Vite + TypeScript + Tailwind, Supabase (Postgres + Edge Functions + pg_cron + Storage), Lovable AI Gateway (Gemini 2.5 Flash)
> **Type**: Single-tenant — manuelt oprettede brugere, ingen self-signup, RLS-policies tillader alle authenticated brugere fuld adgang.

---

## 1. Forretningsmodel & domæne

Comtek PIM er et Product Information Management-system der:

1. **Aggregerer leverandørpriser** fra flere leverandører (CSV/XML/FTP/API)
2. **Beriger produktdata** (SEO, attributter, oversættelser) centralt
3. **Pusher til webshops** (WooCommerce — primær; Shopify — pauset)
4. **Anbefaler prisændringer** baseret på indkøbspris, avance og lager
5. **Viser performance** via GA4 + Google Search Console + interne marginer

### Konventioner

| Regel | Værdi |
|---|---|
| Moms | 25% (DK) |
| Webshop-pris | Inklusiv moms |
| Leverandør-indkøbspris | Eksklusiv moms |
| Avance-beregning | På ex-moms beløb |
| EAN | Strip leading zeros før lagring |
| Fallback EAN | `wc-{webshop_product_id}` når EAN mangler |
| Sprog | Primær: `da`. Oversættelser i `product_translations`. |

---

## 2. Datamodel

Alle tabeller ligger i `public` skemaet med RLS aktiveret. Single-tenant — alle authenticated brugere kan læse/skrive.

### 2.1 `master_products` — kerne

Den centrale produkttabel. Hver række = én produkt-variant (variants identificeres via `webshop_parent_id`).

| Felt | Type | Beskrivelse |
|---|---|---|
| `id` | uuid PK | |
| `ean` | text NOT NULL | Barcode. Strip leading zeros. Kan være `wc-{id}` fallback. |
| `title` | text NOT NULL | Visnings-titel |
| `sku` | text | Webshop SKU |
| `brand` | text | |
| `category` | text | Primær kategori (denormaliseret) |
| `categories` | text[] | Alle kategorier |
| `image_url` | text | Hovedbillede-URL |
| `short_description` | text (HTML) | |
| `long_description` | text (HTML) | |
| `meta_title` | text | SEO titel (Rank Math) |
| `meta_description` | text | SEO beskrivelse (Rank Math) |
| `attributes` | jsonb | Tekniske attributter `{ "color": "white", "voltage": "12V" }` |
| `webshop_price` | numeric | Salgspris **incl. VAT** (DKK) |
| `sale_price` | numeric | Tilbudspris **incl. VAT** |
| `custom_markup_percentage` | numeric | Overrider global avance hvis sat |
| `stock_quantity` | int | |
| `stock_status` | text | `instock` \| `onbackorder` \| `outofstock` |
| `backorders_allowed` | bool | |
| `webshop_product_id` | text | WooCommerce/Shopify product ID |
| `webshop_parent_id` | text | Parent for variants |
| `webshop_platform` | text | `woocommerce` \| `shopify` (default: woocommerce) |
| `auto_stock_sync` | bool | Aktiver per-produkt automatisk lager-sync |
| `stock_sync_supplier_ids` | uuid[] | Leverandører til auto-sync |
| `stock_sync_supplier_id` | uuid | Legacy single-supplier (deprecated) |
| `stock_sync_interval` | text | `hourly` \| `daily` \| `weekly` |
| `min_sync_margin` | numeric | Minimum margin % før auto-push |
| `shopify_product_id` | text | |
| `shopify_variant_id` | text | |
| `shopify_sync_enabled` | bool | |
| `created_at`, `updated_at` | timestamptz | |

**Triggers**:
- `update_master_products_updated_at` — sætter `updated_at` ved hver UPDATE
- `log_master_product_changes` — diff'er gamle vs nye værdier og indsætter pr. ændret felt i `product_change_log` med kilde fra session-variablen `app.change_source` (default `'manual'`)

### 2.2 `supplier_products` — leverandør-mapping

| Felt | Type | Beskrivelse |
|---|---|---|
| `id` | uuid PK | |
| `master_product_id` | uuid → master_products | |
| `supplier_id` | uuid → suppliers | |
| `supplier_sku` | text | Leverandørens SKU |
| `purchase_price` | numeric NOT NULL | **Excl. VAT** |
| `in_stock` | bool default true | |
| `stock_quantity` | int | |
| `last_updated`, `created_at`, `updated_at` | timestamptz | |

**Unique constraint**: `(master_product_id, supplier_id)` — bruges til upsert.

### 2.3 `suppliers`

| Felt | Type | Beskrivelse |
|---|---|---|
| `id` | uuid PK | |
| `name` | text NOT NULL | |
| `feed_url` | text | URL til CSV/XML feed |
| `feed_type` | text | `manual` \| `csv` \| `xml` \| `ftp` \| `api` |
| `feed_schedule` | text | Cron expression (default `0 6 * * *`) |
| `column_mapping` | jsonb | Map fra leverandørens kolonnenavne → vores |
| `is_active` | bool | |
| `last_sync_at` | timestamptz | |

### 2.4 `price_settings` — globale pris-regler

| Felt | Type | Beskrivelse |
|---|---|---|
| `scope` | text | `global` \| `category` \| `brand` \| `price_rounding` \| `default_backorder` |
| `scope_value` | text | Hvis ikke global: kategorinavn / brand / `nearest_5` / `notify` |
| `markup_percentage` | numeric default 30 | |
| `minimum_margin` | numeric default 10 | |

**Afrundings-modes**: `nearest_1`, `nearest_5`, `nearest_10`, `nearest_25`, `nearest_49`, `nearest_95`, `nearest_99`.

**Backorder-modes**: `yes` (tilladt), `no`, `notify` (tilladt + besked).

### 2.5 `price_history`

Snapshot af leverandør-priser over tid. Skrives ved hver supplier-feed import.

### 2.6 `product_change_log` — audit log

| Felt | Type | Beskrivelse |
|---|---|---|
| `master_product_id` | uuid | |
| `field_name` | text | Kolonnenavn der ændredes |
| `change_type` | text | `update` \| `insert` \| `delete` |
| `old_value` | text | Tekstrepr. af gammel værdi |
| `new_value` | text | Tekstrepr. af ny værdi |
| `source` | text | `manual` \| `wc-import` \| `shopify-sync` \| `n8n` \| `mcp` osv. |
| `created_at` | timestamptz | |

**Hvordan kilde sættes**: Sync-jobs/automation kalder `select set_change_source('wc-import')` i samme session før UPDATE. Triggeren læser session-variablen `app.change_source`.

### 2.7 `product_translations`

| Felt | Type |
|---|---|
| `master_product_id` | uuid |
| `language_code` | text (`en`, `de`, ...) |
| `title`, `short_description`, `long_description`, `meta_title`, `meta_description`, `attributes` | per-sprog data |
| `status` | `draft` \| `published` |
| `source` | `manual` \| `ai` \| `mcp` |

**Unique**: `(master_product_id, language_code)`.

### 2.8 `product_analytics` — performance

GA4 (page_views, add_to_carts, purchases, conversion_rate) + GSC (impressions, clicks, ctr, avg_position) per produkt og periode. Matchet via URL-slug.

### 2.9 `product_recommendations` — AI-forslag

Genereret af `ai-analyze` edge function. Felter: `recommendation_type` (`price` / `stock` / `seo` / ...), `severity` (`info` \| `warning` \| `critical`), `data` (jsonb med suggested_price, suggested_stock_status osv.), `is_dismissed`, `resolved_at`.

### 2.10 `import_logs`

Hver sync-kørsel logger: `source`, `total_fetched`, `imported`, `skipped`, `deduplicated`, `duplicate_eans`, `errors`, `ean_snapshot`, `started_at`, `completed_at`, `status`.

### 2.11 `webhook_configs`

Brugerdefinerede webhooks der fyrer ved events (`product.updated`, `stock.changed` osv.).

### 2.12 `shopify_connection`, `shopify_oauth_state`

OAuth-state for Shopify Admin API.

### 2.13 `analytics_settings` — key-value

Generiske app-settings: `wc_last_import_at`, `supported_languages` (JSON array), `gsc_site_url`, osv.

---

## 3. Edge Functions

Alle ligger i `supabase/functions/` og deployes automatisk. Default `verify_jwt = false`; auth valideres in-code via JWKS hvor relevant.

### 3.1 Webshop-integrationer

| Function | Formål |
|---|---|
| `wc-import` | Hent alle produkter fra WooCommerce. Strip leading zeros fra `_avecdo_ean`. Skriver til `master_products` + `import_logs`. |
| `wc-update-product` | PATCH ét produkt til WooCommerce (price, stock, backorders). Bruges af "Opdater shop" tab. |
| `shopify-import` | Importér produkter via Shopify GraphQL Admin API. |
| `shopify-update-product` | Push felter til Shopify variant via `productVariantsBulkUpdate`. |
| `shopify-compare` | Sammenlign PIM ↔ Shopify SEO-felter. Mode: `report` \| `apply`. |
| `shopify-fix-barcode` | Synk `master_products.ean` → Shopify variant `barcode`. Springer dupes og fallback-EAN over. |
| `shopify-clear-barcode` | One-shot: nulstil bogus barcode på én Shopify variant. |
| `shopify-seo-backfill` | Backfill `meta_title` + `meta_description` til Shopify SEO-felter. |
| `shopify-match` | Match Shopify-produkter til PIM via SKU/EAN. |
| `shopify-oauth-start` / `shopify-oauth-callback` | OAuth-flow til at koble en ny butik. |
| `shopify-connections` | List/aktivér/deaktivér butiks-forbindelser. |
| `shopify-admin-test` | Diagnostik mod Shopify Admin API. |
| `shopify-metafield-probe` | Inspect metafields på en variant. |

### 3.2 Leverandør-integrationer

| Function | Formål |
|---|---|
| `supplier-feed-import` | Hent CSV/XML/FTP feed for én leverandør, parse via `column_mapping`, opdatér `supplier_products`. **Kun produkter med EAN der findes i `master_products`** importeres. |
| `supplier-feed-preview` | Preview parsed feed-rækker uden at gemme. Bruges til column-mapping UI. |

**Aurdel API** (Distit/Aurora XML) bruger 55s timeout. Item + stock fetches merges i DB.

### 3.3 Automation & sync

| Function | Formål |
|---|---|
| `scheduled-sync` | Kaldes af pg_cron. Læser `analytics_settings` for hvilke jobs der skal køre, fyrer dem off. `verify_jwt = false`. |
| `fetch-analytics` | Henter GA4 + GSC metrics, opdaterer `product_analytics`. |
| `ai-analyze` | Kører Gemini 2.5 Flash mod produktdata + analytics, genererer `product_recommendations`. |

### 3.4 Eksterne API'er

| Function | Formål |
|---|---|
| `mcp-server` | OAuth 2.1 + Bearer authenticated MCP-server. Eksponerer alle PIM-felter som tools til Claude/Manus.ai/n8n. Se §5. |
| `n8n-proxy` | Generisk webhook-proxy til n8n workflows. |

---

## 4. Frontend (React)

Routing i `src/pages/`:

- `/` — Dashboard: nøgletal, top 10 produkter, marginadvarsler (<10% eller >40%)
- `/products` — Produktliste med URL-baserede filtre (search, category, brand, sort)
- `/products/:id` — Produktdetalje med tabs:
  - **Produktdetaljer** — alle felter inline-redigerbare (komponent: `InlineEditField`)
  - **Attributter** — JSONB technical attributes
  - **Avance** — global vs custom markup, leverandørpriser
  - **Leverandører** — manuel pris-tilføjelse, prishistorik
  - **Sammenligning** — supplier price comparison
  - **Opdater shop** — push price/stock/backorders til webshop
  - **Performance** — GA4 + GSC metrics, conversion funnel
  - **SEO** — meta_title/description, Google preview, inline edit
  - **Oversættelser** — per-sprog edit (`ProductTranslationsTab`)
  - **Ændringslog** — audit trail fra `product_change_log`
- `/suppliers` — leverandør-liste, feed-konfiguration, EAN-matching
- `/import` — CSV import + batch logs
- `/settings` — globale pris-regler, afrunding, backorder defaults, sync-intervaller, MCP API key

### Centrale hooks (`src/hooks/use-products.ts`)

`useMasterProducts(search?)`, `useMasterProduct(id)`, `useSuppliers()`, `usePriceSettings()`, `usePriceHistory()`, `useProductChangeLog()`, `useProductAnalytics()`, `useProductRecommendations()`, `useAllProductAnalytics()`, `useWebhookConfigs()`.

### Math-utilities

```ts
exVat(priceInclVat) // fjern moms
inclVat(priceExVat) // tilføj moms
getRecommendedPrice(purchasePrice, markupPct) // ex-VAT → ex-VAT
getRecommendedPriceInclVat(purchasePrice, markupPct) // ex-VAT → incl-VAT
getMarginPercent(salePriceExVat, purchasePriceExVat) // begge ex-VAT
getCheapestSupplier(supplierProducts) // kun in_stock
getCheapestSupplierAny(supplierProducts) // ignorer stock
```

### Inline-edit komponent

`src/components/InlineEditField.tsx` — generisk hover→pencil→input→save. Understøtter `text`, `number`, `textarea`, `html`, `select`, `boolean`. Skriver direkte til `master_products`; trigger logger automatisk.

---

## 5. MCP Server (n8n / Claude / Manus.ai integration)

`supabase/functions/mcp-server/index.ts` — eksponerer hele PIM som MCP tools.

**Endpoint**: `https://qanxmacwntyxfhznxriz.supabase.co/functions/v1/mcp-server`
**Auth**: OAuth 2.1 (Dynamic Client Registration) eller `Authorization: Bearer ${MCP_API_KEY}` for headless brug (n8n).

### 5.1 Tools (komplet liste)

#### Discovery
- **`describe_schema`** — returnerer fuld liste over skrivbare felter, deres typer, beskrivelser, relations til andre tabeller, og konventioner. **Kald først** for at vide hvad der findes.

#### Read
- `list_products({ limit?, offset? })` — op til 100 produkter ad gangen
- `search_products({ query })` — fritekstsøgning på title/ean/sku/brand/category
- `get_product({ product_id })` — UUID eller EAN, returnerer produkt + alle leverandørpriser
- `list_suppliers()`
- `get_supplier({ supplier_id })` — leverandør + alle deres produkter
- `get_price_info({ product_id })` — sammenligning på tværs af leverandører + recommended price
- `get_price_history({ supplier_product_id, limit? })`
- `get_change_log({ product_id, limit? })` — audit trail
- `get_price_settings()` — global + scoped settings
- `get_import_logs({ limit? })`
- `get_webhooks()`
- `get_product_analytics({ product_id?, limit? })` — GA4 + GSC
- `get_recommendations({ product_id?, severity? })` — AI suggestions
- `list_translations({ product_id, language_code? })`
- `get_supported_languages()`

#### Write (alle accepterer `change_source` parameter, default `'n8n'`)
- **`update_product({ product_id, updates, change_source? })`** — opdatér ALLE skrivbare felter på master_products. `updates` er objekt med field:value. Felter der ikke er skrivbare returneres i `rejected_fields`.
- **`create_product({ ean, title, fields?, change_source? })`** — opret nyt produkt
- **`delete_product({ product_id })`** — sletter (cascade til supplier_products via app-logik)
- **`bulk_update_products({ eans, updates, change_source? })`** — samme update på mange produkter
- **`upsert_supplier_product({ master_product_id, supplier_id, purchase_price, supplier_sku?, in_stock?, stock_quantity? })`**
- **`delete_supplier_product({ supplier_product_id })`**
- **`upsert_translation({ product_id, language_code, title?, short_description?, ..., status?, source? })`**
- **`dismiss_recommendation({ recommendation_id })`**

#### Trigger
- `sync_analytics()` — kalder `fetch-analytics` edge function

### 5.2 n8n setup

1. I n8n: tilføj **MCP Client Tool** node
2. URL: `https://qanxmacwntyxfhznxriz.supabase.co/functions/v1/mcp-server`
3. Auth: Header `Authorization: Bearer <MCP_API_KEY>` (hentes fra Settings i PIM)
4. Workflow: kald først `describe_schema` for at læse alle felter, derefter `update_product` med præcis hvilke felter der skal sættes.

---

## 6. Automation

### 6.1 pg_cron jobs

Konfigureret i Supabase. Læser `analytics_settings.scheduled_sync_*` for at vide hvilke jobs der er aktive og deres intervaller. Default: dagligt kl 06:00 (Europe/Copenhagen).

| Job | Funktion | Default schedule |
|---|---|---|
| `wc-daily-import` | `wc-import` | Daglig 06:00 |
| `analytics-sync` | `fetch-analytics` | Daglig 03:00 |
| `ai-recommendations` | `ai-analyze` | Hver 30. dag |
| `supplier-feeds` | `supplier-feed-import` per supplier | `suppliers.feed_schedule` |
| `stock-auto-sync` | per-produkt baseret på `auto_stock_sync` | `stock_sync_interval` |

### 6.2 Webhooks (`webhook_configs`)

Brugerdefinerede outbound webhooks til eksterne systemer. Events: `product.updated`, `product.created`, `stock.changed`, `recommendation.created`. Payload = JSON af relevant ressource.

### 6.3 AI-anbefalinger

`ai-analyze` (Gemini 2.5 Flash via Lovable AI Gateway) kører proaktivt hver 30. dag og genererer `product_recommendations` for produkter med:
- Margin uden for [10%, 40%]
- Lavt traffic relativt til konkurrenter
- Stock mismatch (PIM siger instock men leverandør udsolgt)
- Manglende SEO felter
- Prisafvigelse fra cheapest supplier

Loven brugeren kan **acceptere/dismisse** i UI'et — accept skriver direkte til `master_products`.

---

## 7. Sikkerhed & adgang

### 7.1 RLS

**Single-tenant model**: Alle tabeller har RLS aktiveret med policies `USING (true)` for `authenticated` rolle. Service-role har fuld adgang til alt. Linter advarer om `Always True` policies — det er **bevidst** for dette setup. Hvis multi-tenant tilføjes senere, skal alle policies omskrives.

### 7.2 Storage buckets

- **`supplier-feeds`** (private) — uploadede CSV/XML feeds. Kun authenticated kan upload, kun service-role kan læse til parsing.

### 7.3 Secrets

| Secret | Brug |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_JWKS` | Standard Supabase |
| `LOVABLE_API_KEY` | Lovable AI Gateway (Gemini) |
| `MCP_API_KEY` | Bearer-auth til MCP-server (n8n osv.) |
| `WC_STORE_URL`, `WC_CONSUMER_KEY`, `WC_CONSUMER_SECRET` | WooCommerce REST API |
| `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_STORE_DOMAIN` | Shopify Admin API |
| `GA4_PROPERTY_ID`, `GSC_SITE_URL`, `GCP_SERVICE_ACCOUNT_JSON` | Google Analytics + Search Console |
| `IAWP_API_KEY` | Independent Analytics for WordPress (alternative analytics) |
| `N8N_BASE_URL`, `N8N_API_KEY` | Outbound n8n webhook calls |

### 7.4 Edge Function auth

- **Bruger-facing functions** (kaldes fra UI): valideres via Supabase JWKS in-code
- **MCP-server**: OAuth 2.1 ELLER Bearer
- **`scheduled-sync`**: `verify_jwt = false` (kaldes af pg_cron uden bruger-kontekst)

---

## 8. Database functions (RPC)

| Funktion | Brug |
|---|---|
| `update_updated_at_column()` | BEFORE UPDATE trigger |
| `log_master_product_changes()` | AFTER UPDATE trigger på master_products — diff'er og logger |
| `set_change_source(text)` | Sæt `app.change_source` session-variable for at tagge audit-log |
| `get_change_log_daily(days int)` | Aggregeret ændrings-aktivitet til dashboard |
| `get_db_stats()` | DB-størrelse, tabel-stats, change-log volumen — til health-dashboard |

---

## 9. Kendt teknisk gæld & roadmap

### 9.1 Teknisk gæld

1. **RLS policies er `USING (true)`** — fungerer for single-tenant, men forhindrer multi-tenant uden total omskrivning.
2. **Ingen foreign keys** mellem `supplier_products` ↔ `master_products` ↔ `suppliers`. App-logik forhindrer orphans, men databasen tillader dem.
3. **Duplicate `shopify_variant_id`** i master_products — flere PIM-rækker kan pege på samme Shopify variant. Skipped i barcode-fix, men skal ryddes op.
4. **Fallback EAN'er** (`wc-{id}`) bør ikke pushes til Shopify barcode (guard er nu på plads i `shopify-fix-barcode`).
5. **Legacy `stock_sync_supplier_id`** (singular) eksisterer side om side med `stock_sync_supplier_ids` (array). Bør deprecateres.
6. **Edge function timeouts** — eksterne langsomme API'er (Aurdel) kræver 55s timeout konfigureret per function.
7. **Shopify sync er pauset** — alle Shopify edge functions er deployet og virker, men ingen scheduled jobs kører dem.

### 9.2 Roadmap-skitser

- **Multi-tenant**: brug `tenants` tabel + RLS via `tenant_id = auth.jwt()->>'tenant_id'`
- **Foreign keys**: tilføj med `ON DELETE CASCADE` for supplier_products
- **Variant-deduplication wizard**: UI til at flette duplicate `shopify_variant_id`
- **Real-time WC webhooks**: i stedet for polling — brug WC REST webhooks med signature-verify
- **Bulk-edit UI**: rediger N produkter samtidigt med samme felter (MCP `bulk_update_products` findes allerede backend-side)
- **Image management**: bucket til at uploade billeder direkte fra PIM i stedet for kun URL
- **A/B testing af titler/beskrivelser**: koblet til GA4 conversion data

---

## 10. Quick reference — almindelige opgaver

### Tilføj nyt produkt manuelt
UI: produktliste → "Nyt produkt" knap. Eller via MCP: `create_product({ ean, title, fields: { brand, category, ... } })`.

### Ret pris på 50 produkter
MCP: `bulk_update_products({ eans: [...], updates: { custom_markup_percentage: 35 } })`.

### Find ud af hvem der ændrede et felt
UI: produktdetalje → "Ændringslog" tab. Eller `get_change_log({ product_id })`.

### Tilføj ny leverandør med CSV-feed
UI: `/suppliers` → "Tilføj leverandør" → upload CSV → konfigurér column_mapping → sæt `feed_schedule`.

### Push pris til webshop
UI: produktdetalje → "Opdater shop" tab → udfyld felter → "Push to webshop". Eller direkte: kald `wc-update-product` edge function med `{ master_product_id, regular_price, sale_price?, stock_quantity?, stock_status?, backorders? }`.

### Trigger en sync nu
- WC import: kald `wc-import` edge function
- Analytics: MCP `sync_analytics()` eller direkte kald af `fetch-analytics`
- AI-anbefalinger: kald `ai-analyze`

---

*Sidst opdateret: 2026-05-01. Vedligeholdes sammen med koden.*
