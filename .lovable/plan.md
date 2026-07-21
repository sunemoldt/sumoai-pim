# Plan: Pilot-drænet + BF payload-merge (revideret)

Sekvensen er nu strikt: trin 1-3 kører først, du verificerer i Shopify, og først ved grønt lys deployes trin 4.

## Trin 1 — Prioritér pilot + BF-rækker (én migration)

To updates i samme migration, ingen INSERT'er, ingen nye rækker.

**1a. Pilot (11 master_product_ids) — 60 min tilbage:**
```sql
UPDATE public.shopify_update_queue
SET next_attempt_at = now() - interval '60 minutes',
    updated_at = now()
WHERE status = 'pending'
  AND master_product_id IN ( … 11 pilot-UUIDs … );
```

**1b. BF (17 PIM-rækker bag 11 shopify_product_ids) — 55 min tilbage + payload-merge:**

For hver eksisterende pending-række på de 17 master_product_ids:
- `changed_fields` unioneres med `["long_description", "short_description"]` via `jsonb_agg(DISTINCT …)` (samme mønster som `auto_enqueue_shopify_update`).
- `payload.long_description` og `payload.short_description` sættes fra `master_products` — så worker sender aktuelle DB-værdier og `descriptionHtml` bygges som short+long concat.
- `source` sættes til `seo-bf-merge` for sporbarhed.
- `next_attempt_at = now() - interval '55 minutes'` — deterministisk bag piloten.

BF-produkter: KeyPad Outdoor, 2× Apple Watch-opladere, USB-Lightning, 20W-oplader, 11-i-1 dock, 33W Nano, HDMI-dock, PD nylon sort + hvid, MFi-kabel.

Hvis et af de 17 mod forventning ikke har en pending række, logges det i migration-output — ingen INSERT-fallback i denne runde (håndteres separat hvis nødvendigt).

## Trin 2 — Manuel worker-kørsel

`POST /shopify-queue-worker?batch=25`, én gang. Piloten (11) ligger deterministisk forrest pga. den ældre timestamp, så de 25 dækker alle 11 pilot + 14 af 17 BF. Sidste 3 BF-rækker plukkes af næste automatiske cron-kørsel (≤15 min).

## Trin 3 — Status-rapport til dig

Jeg poster:
- Queue-state for de 11 pilot + 17 BF master_product_ids (done/failed/pending, evt. fejlbeskeder).
- Payload-verificering på et par BF-rækker efter merge: bekræfter at `changed_fields` indeholder både `long_description` og `short_description`, og at `payload` har DB-friske tekster.

**Herefter stopper jeg og venter på dit grønt/rødt lys** fra Shopify-verificeringen (4 pilot-tilstande + BF-links væk fra 11 live-beskrivelser).

## Trin 4 — Throughput (KUN efter dit grønne lys — separat deploy)

`supabase/functions/shopify-queue-worker/index.ts`:
- default `batchSize` 10 → 25
- item-sleep 1200 ms → 400 ms

Ingen ændringer i rate-limit-guards eller mapping-logik. Deployes først når du siger grønt — indtil da drænes køen med nuværende hastighed (10/15 min).

## Teknisk

- Trin 1: `supabase--migration` (én samlet migration for 1a + 1b).
- Trin 2: `supabase--curl_edge_functions` mod `/shopify-queue-worker?batch=25`.
- Trin 3: `supabase--read_query` for status + payload-inspection.
- Trin 4: `supabase--deploy_edge_functions` — kun efter dit grønne lys.
- Ingen skema-ændringer, ingen RLS, ingen nye kodepaths i worker.
