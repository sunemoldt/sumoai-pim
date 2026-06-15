# Mål
Sænke "Database server"-forbruget fra 96% til under 40% uden at ændre forretningslogik. Resten af din kapacitet (Network 3%, Compute 1%, Storage 0%) er fin — kun DB er flaskehalsen.

# Hvad belaster databasen i dag
Top 10 slow queries (samlet tid på 7 dage) viser tre tydelige mønstre:

1. **`scheduled-sync` polling** — `SELECT … FROM master_products WHERE auto_stock_sync = true`
   - 15.710 + 2.220 kald på 7 dage = ~108 kald i timen.
   - Returnerer alle 593 rækker hver gang (`auto_stock_sync = true` for alle produkter) og laver full table read.
   - Samlet: **573 sekunder DB-tid** (klart værst).
2. **Produktliste-query** (`master_products` + `supplier_products` joined, `ORDER BY title`)
   - 5 varianter af samme query, i alt ~1.150 kald, 232 sekunder DB-tid.
   - `ORDER BY title` har intet index → sort i hukommelsen + LATERAL join uden composite-index.
3. **Per-produkt stock-UPDATEs** — 136.355 single-row updates på 7 dage (74 sekunder DB-tid).
   - Det er `recompute_product_stock`-sweepet der opdaterer hver række hver gang, også når intet er ændret.
4. **`product_analytics` ORDER BY updated_at DESC** — 1.080 kald, 57 sek., intet index på `updated_at`.

Memory 53%, connections 12/60, disk 6% — så det er **CPU og query-volumen** der koster, ikke opbevaring. Konklusion: opgrader IKKE instansstørrelsen før vi har trimmet queries.

# Plan (5 trin, fra størst effekt til mindst)

## 1. Stop unødvendig `scheduled-sync`-polling (forventet besparelse ~50%)
Dagens `scheduled-sync` kører hvert minut og henter ALLE `auto_stock_sync = true`-produkter (593 rækker) selvom safety-net-sweepet kun reelt gør arbejde ved `minute === 0` (1 ud af 60 ticks).

Ændringer i `supabase/functions/scheduled-sync/index.ts`:
- Flyt `minute === 0`-checket op FØR `SELECT` på `master_products` — tjek tid først, query bagefter.
- Spørg kun efter relevante produkter for det aktuelle interval (filter på `stock_sync_interval` baseret på time/ugedag).
- Reducer pg_cron-frekvensen fra hvert minut til hvert 5. minut (cron `*/5 * * * *`) — supplier-feeds og WC-import bruger 5-min granularitet allerede.

## 2. Index på `master_products(title)` for produktlisten (besparelse ~15%)
Tilføj migration:
```sql
CREATE INDEX IF NOT EXISTS idx_master_products_title ON public.master_products (title);
CREATE INDEX IF NOT EXISTS idx_master_products_auto_stock_sync
  ON public.master_products (auto_stock_sync) WHERE auto_stock_sync = true;
CREATE INDEX IF NOT EXISTS idx_product_analytics_updated_at
  ON public.product_analytics (updated_at DESC);
```
- `title`-index fjerner sorteringsomkostningen for produktlisten.
- Partial index på `auto_stock_sync` (kun true) gør scheduled-sync-spørgsmål næsten gratis.
- `product_analytics.updated_at` fjerner full-scan i AI-insights-widget.

## 3. Spring uændrede UPDATEs over i `recompute_product_stock` (besparelse ~10%)
136k UPDATEs er for mange. Tilføj i SQL-funktionen en `WHERE` der kun skriver hvis værdien faktisk er ændret:
```sql
UPDATE master_products
SET stock_quantity = v_new_qty, stock_status = v_new_status, updated_at = now()
WHERE id = p_master_product_id
  AND (stock_quantity IS DISTINCT FROM v_new_qty
       OR stock_status IS DISTINCT FROM v_new_status);
```
Det fjerner skrive-I/O, trigger-arbejde (`auto_enqueue_shopify_update`) og WAL-trafik for no-op updates.

## 4. Reducer kolonne-bredde og polling i ProductListPage (besparelse ~10%)
ProductListPage henter `master_products.*` (40 kolonner) inkl. lange JSON-felter (`metadata`, `long_description`). For listen behøves kun 8-10 kolonner.
- Skift `.select("*")` til eksplicit kolonneliste i `src/pages/ProductListPage.tsx` + `use-products.ts`.
- For `supplier_products`-LATERAL-joinet: hent kun `supplier_id, stock_quantity, supplier_price, in_stock` — ikke `*`.
- Sæt `React Query staleTime: 60_000` på produktlisten så listen ikke refeches på hver navigation.

## 5. Sæt loft på `shopify_update_queue`-worker og dashboard-polling (besparelse ~5%)
- `ShopifyQueueCard` og `MonitoringPage` poller via realtime + interval. Sæt interval til 30s når fanen er aktiv og pause når `document.hidden`.
- `pg_cron`-job `shopify-queue-worker` køres pt. hvert minut; tidlig-exit findes allerede, men hvert tomt tick koster et roundtrip. Skift til hvert 2. minut.

# Tekniske detaljer
- **Migration** (én fil):
  - 3x `CREATE INDEX IF NOT EXISTS` (trin 2).
  - `CREATE OR REPLACE FUNCTION public.recompute_product_stock(...)` med `IS DISTINCT FROM`-guard (trin 3).
  - `SELECT cron.unschedule(...)` + `cron.schedule(...)` for `scheduled-sync` (1m → 5m) og `shopify-queue-worker` (1m → 2m).
- **Edge function-edit** (`scheduled-sync/index.ts`): omarranger `minute === 0`-check og partiel filtrering.
- **Frontend-edits**: `src/pages/ProductListPage.tsx`, `src/hooks/use-products.ts`, `src/components/ShopifyQueueCard.tsx`, `src/pages/MonitoringPage.tsx`.
- **Ingen ændring** i forretningslogik, sync-targets eller UI/UX.

# Verifikation
1. Efter migration: kør `EXPLAIN` på produktliste-query → `Index Scan using idx_master_products_title`, ikke Sort.
2. Efter 24 timer: kør `supabase--slow_queries` igen — top-query bør være faldet fra 489s til <50s total.
3. Kig på Cloud Usage-grafen igen efter 7 dage → Database server bør være <40%.
4. Test at produktlisten stadig viser samme data, at scheduled-sync stadig kører safety-net-sweepet kl. 06 UTC, og at Shopify-kø stadig drænes.

# Hvad vi IKKE rører
- Instansstørrelse — der er ingen grund til at betale mere når CPU-presset kan fjernes ved query-tuning.
- `nightly-backup`, `mcp-server`, supplier-feed-import — disse optræder ikke i top 10.
- Stock-sync-logik, master-data eller policy-regler — kun teknisk performance.
