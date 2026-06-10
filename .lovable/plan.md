## Hvad der bygges

To uafhængige features, leveret i samme omgang men separat aktiverbare.

---

### Del 1 — Tidsstempel for sidste Shopify-sync

**Database**
- Tilføj `last_shopify_sync_at timestamptz` og `last_shopify_sync_status text` på `master_products`.
- Begge nullable, ingen default (eksisterende rækker forbliver NULL = "aldrig synket via ny logik").
- Tilføj kolonnerne til ekskluderingslisten i `log_master_product_changes`-triggeren så de ikke spammer `product_change_log`.
- Tilføj dem også til "skip"-listen i `auto_enqueue_shopify_update` så en sync-stempel-opdatering ikke trigger en ny kø-opgave (loop-beskyttelse).

**Edge function `shopify-update-product`**
- Ved success: `UPDATE master_products SET last_shopify_sync_at = now(), last_shopify_sync_status = 'ok'` (kører som `service_role`, sættes via `set_change_source('shopify-update-product')` så triggeren allerede springer over – men vi tilføjer kolonnerne til ekskluderingslisten som sikkerhedsbælte).
- Ved fejl: `last_shopify_sync_status = 'failed'` (timestamp opdateres ikke).

**UI**
- Vis "Synket for X siden ✓" / "Fejlet" på produktdetalje-siden (kompakt badge ved siden af Shopify-status).
- Tilføj kolonne i produktlisten (sorterbar) — kun synlig hvis user toggler den til, så listen ikke bliver bredere som default.

---

### Del 2 — Salgs-modregning fra Shopify (webhook)

**Sikkerhedsregel: kun fremtidige ordrer.**

To lag af beskyttelse:

1. **Cutoff-timestamp**: Ny tabel `shopify_webhook_config` med én række der indeholder `orders_cutoff_at timestamptz`. Sættes til `now()` første gang webhook'en registreres. Ordrer hvor `created_at < orders_cutoff_at` afvises (logges, men trækker ikke fra lager).
2. **Idempotens-tabel**: `shopify_processed_orders (order_id bigint primary key, processed_at, line_count, total_decremented)` — samme ordre kan ikke modregnes to gange selv hvis Shopify gen-sender webhook'en.

**Ny edge function `shopify-order-webhook`** (`verify_jwt = false`, HMAC valideret)
- Validerer Shopify HMAC-signaturen mod `SHOPIFY_WEBHOOK_SECRET` (ny secret).
- Parser ordre payload.
- Hvis `order.created_at < orders_cutoff_at` → returner 200 OK med `{skipped: "before_cutoff"}` og log til `import_logs`.
- Hvis order_id allerede i `shopify_processed_orders` → returner 200 OK med `{skipped: "duplicate"}`.
- For hver line item:
  - Find produkt via `shopify_variant_id`.
  - Spring over hvis produktet har `auto_stock_sync = true` (leverandør-styret lager — ellers overskriver næste supplier-sync alligevel).
  - `UPDATE master_products SET stock_quantity = GREATEST(stock_quantity - line.quantity, 0)` med `set_change_source('shopify-order')`.
  - Den eksisterende `auto_enqueue_shopify_update`-trigger får `shopify-order` tilføjet til skip-listen — vi sender IKKE den nye lagerværdi tilbage til Shopify, fordi Shopify selv har trukket fra i sin egen lagerstyring.
- Indsæt i `shopify_processed_orders`.

**Ny edge function `shopify-register-webhook`**
- Kaldes manuelt fra Settings-siden. Registrerer `orders/create` webhook hos Shopify via Admin API mod URL'en til `shopify-order-webhook`.
- Sætter `orders_cutoff_at = now()` ved første registrering (idempotent: rør ikke ved feltet ved gen-registrering).

**Ny secret**
- `SHOPIFY_WEBHOOK_SECRET` — Shopify viser den når webhook'en oprettes. Tilføjes via secret-prompten før webhook'en aktiveres.

**UI på SettingsPage**
- Nyt kort "Salgs-modregning fra Shopify":
  - Status (Ikke aktiveret / Aktiv siden DATO).
  - Knap "Aktivér modregning fra nu" → kalder `shopify-register-webhook`.
  - Viser `orders_cutoff_at` så det er tydeligt at intet før det tidspunkt modregnes.
  - Lille tæller: "Ordrer modregnet sidste 24t / 7d" fra `shopify_processed_orders`.

---

### Dobbeltcheck før udrulning (kritiske invarianter)

1. **Ingen historiske ordrer modregnes**: cutoff-feltet sættes første gang webhook'en registreres, og webhook'en lytter kun på `orders/create` (ikke `orders/updated` og ikke historiske batch-API'er).
2. **Ingen webhook = ingen modregning**: webhook'en er disabled by default. Brugeren skal aktivt trykke "Aktivér".
3. **Idempotens**: samme `order_id` kan ikke trækkes to gange.
4. **Negativt lager**: `GREATEST(..., 0)` forhindrer negative tal.
5. **Auto-stock-produkter**: springes helt over, så leverandør-baseret lager ikke fucker op.
6. **Ingen sync-loop**: `shopify-order` tilføjes til skip-listen i `auto_enqueue_shopify_update`, så vi ikke pusher den nye lagerværdi tilbage til Shopify (Shopify har allerede trukket den fra selv).

---

### Rækkefølge

1. Migration: nye kolonner på `master_products`, ny tabel `shopify_webhook_config`, ny tabel `shopify_processed_orders`, opdater triggers.
2. Edge function: `shopify-update-product` opdaterer timestamp.
3. UI: vis timestamp på detaljeside.
4. Edge functions: `shopify-order-webhook` + `shopify-register-webhook`.
5. Settings-UI: aktiverings-kort.
6. Beder dig om at tilføje `SHOPIFY_WEBHOOK_SECRET` før Del 2 kan aktiveres.

Del 1 (timestamp) virker straks. Del 2 (modregning) er bygget men slumrer indtil du trykker "Aktivér" — ingen risiko for at gamle ordrer rammer.
