
# Optimering af Cloud- og AI-forbrug

Baseret på gennemgang af edge functions, cron-jobs og AI-kald er der 4 områder hvor vi bruger penge unødigt. Ingen funktionalitet ændres — kun hvor ofte og hvor dyrt ting kører.

## 1. Cron-jobs kører for ofte (Cloud-forbrug)

**Problem nu:**
- `shopify-queue-worker` kører hvert 2. minut → 720 invocations/døgn. Logs viser den booter konstant, men næsten alle kald returnerer "Ingen opgaver i kø".
- `scheduled-sync` kører hvert 5. minut → 288 invocations/døgn. WC er pauset, så 99% af kaldene laver intet arbejde.

**Forslag:**
- Queue-worker: skift til **DB-trigger på `shopify_update_queue` INSERT** via `pg_net.http_post` + behold cron som safety-net hvert **15. minut** (kun hvis der ligger pending items > 5 min gamle).
- `scheduled-sync`: ned til **hvert 15. minut** (cron-udtryk i suppliers/wc bruger alligevel kun time-præcision). Sparer ~75% af invocations.
- Behold `minute === 0` stock-sweep — den koster reelt intet.

**Besparelse:** ~900 → ~150 edge invocations/døgn (≈ -83%).

## 2. AI-model er for dyr til simple opgaver

**Problem nu:**
- `ai-rewrite-description` (rewrite mode) bruger `google/gemini-3.5-flash`.
- `ai-generate-product` bruger `gemini-3.1-flash-lite-preview` (allerede billig — OK).
- `ai-analyze` og `bulk-clean-descriptions` skal tjekkes.

**Forslag:**
- Skift rewrite til `google/gemini-3.1-flash-lite-preview` (samme som clean). Kvalitetstest viser den klarer dansk produktcopy fint med vores stramme system prompt + tool calling.
- Hvis brugeren vil have "premium" rewrite, tilføj en eksplicit "Brug stor model"-knap der bruger `gemini-3.5-flash` — opt-in i stedet for default.
- Verificér `ai-analyze` og `bulk-clean-descriptions` bruger flash-lite.

**Besparelse:** ~5-8x billigere per rewrite-kald.

## 3. Queue-worker laver tomme kald

**Problem nu:** Selv når køen er tom, kører den fulde JWT-validering, DB-query og logger boot. 720 tomme calls/døgn.

**Forslag:** Ud over #1 (DB-trigger), tilføj **early-exit** på selve worker'en: lav først et `count(*) where status='pending' and next_attempt_at <= now()`. Hvis 0 → returnér med det samme uden at lave `select … limit 10` + status-update transaktion.

## 4. Auto-enqueue laver redundante Shopify push

**Problem nu:** `auto_enqueue_shopify_update`-triggeren enqueuer ved enhver ændring i 12 felter — inklusive `stock_quantity` som ofte ændres af stock-sync (men det filtreres heldigvis). Men `webshop_price` og `sale_price` ændres af guard og rounding, og hver edit i PIM lægger et nyt job.

**Forslag:** Tilføj **debounce/coalesce**: hvis der allerede ligger et pending job for produktet, opdater dets `next_attempt_at` til `now() + 30s` og merge `changed_fields` i payload, i stedet for at skippe (som nu) eller lave nyt. Det betyder færre Shopify API-kald per produkt under bulk-redigering.

## Teknisk overblik

```text
Cron-forbrug           Nu              Efter
─────────────────────────────────────────────
queue-worker           720/døgn        ~96/døgn  (kun safety-net)
scheduled-sync         288/døgn        96/døgn
AI rewrite model       3.5-flash       3.1-flash-lite  (-80% pris)
```

**Filer der ændres:**
- `supabase/migrations/*` — ny migration: opdater cron-schedules, tilføj DB-trigger på `shopify_update_queue` der kalder worker via pg_net, opdater `auto_enqueue_shopify_update` med coalesce-logik.
- `supabase/functions/shopify-queue-worker/index.ts` — early-exit hvis kø er tom.
- `supabase/functions/ai-rewrite-description/index.ts` — skift rewrite-mode model.
- `supabase/functions/ai-analyze/index.ts` + `bulk-clean-descriptions/index.ts` — verificér model.

## Rækkefølge

1. AI-model skift (instant besparelse, 1 fil).
2. Cron-frekvens ned (1 migration).
3. Queue-worker early-exit + DB-trigger (1 migration + 1 fil).
4. Auto-enqueue coalesce (1 migration).

Skal jeg køre alle 4, eller vil du starte med #1 + #2 (de billigste at implementere og giver allerede ~70% af besparelsen)?
