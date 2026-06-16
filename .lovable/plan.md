# Hvorfor DCS (og de andre planlagte feeds) ikke synker

Jeg har gravet i pg_cron + pg_net logs. Problemet er ikke selve `scheduled-sync` — funktionen virker fint når den kaldes. Problemet er at **pg_cron's HTTP-kald til funktionen bliver afvist eller timer ud**:

Sidste 12 timers `net._http_response` viser ét af to mønstre hver halve time:

- `status_code: 401` (de fleste kald — gateway afviser før funktionen rammes)
- `Timeout of 5000 ms reached` (pg_net's default 5 s timeout — funktionen bruger længere tid på at iterere supplier-feeds)

Konsekvens:
- DCS (`0 */4 * * *`) sidst synket **2026-06-15 12:47** — burde have kørt 16:00, 20:00, 00:00, 04:00 i dag.
- Allenet + Aurdel (`0 6 * * *`) sidst synket **2026-06-14 06:54** — burde have kørt 06-15 og 06-16.
- COMTEK / EET / SecPro / Solar er sat til `manual` — ikke ramt af problemet.
- Shopify-køen og nightly-backup har samme 401-problem i pg_cron logs.

Roden:

1. **Forældet anon-nøgle i pg_cron-jobs.** Alle 4 cron-jobs sender en hardcoded JWT (`iat: 1774968853`). Efter security-rotationen tidligere på dagen er den nøgle ikke gyldig mere på gateway-niveauet — `verify_jwt = false` skipper kun in-function check, ikke platform-nøgletjek.
2. **pg_net default timeout 5 s.** `scheduled-sync` kan tage 10-40 s når den loop'er supplier-feeds; pg_net giver op før funktionen er færdig, så hverken supplier-import eller stock-sync når at registrere noget.

## Hvad jeg foreslår

### 1. Genopret de 4 cron-jobs med korrekt opsætning
- Brug **aktuel anon-nøgle** fra `SUPABASE_ANON_KEY` secret i headers.
- Send både `apikey` og `Authorization: Bearer` header (gateway accepterer begge formater).
- Sæt `timeout_milliseconds := 55000` på `net.http_post` så lange runs ikke afbrydes.
- Behold eksisterende schedules: `*/30 * * * *` (scheduled-sync), `*/15 * * * *` (shopify-queue-worker), `30 1 * * *` (nightly-backup), `15 3 * * *` (cleanup-product-change-log).

Sker via `supabase--insert` med `cron.unschedule(...)` + ny `cron.schedule(...)` for hver — ikke en migration, fordi nøglen er user-specific.

### 2. Kør DCS + Allenet + Aurdel manuelt én gang
For at indhente det tabte og bekræfte at supplier-feed-import stadig virker som forventet (status, antal importerede rækker).

### 3. Verificér efter fix
- Tjek `net._http_response` 15-30 min efter — skal vise `200`, ingen 401, ingen 5000ms-timeouts.
- Tjek `last_sync_at` på DCS/Allenet/Aurdel rykker frem ved næste matchende tick.

## Hvad jeg IKKE rører
- `scheduled-sync/index.ts`, `shopify-queue-worker/index.ts`, `nightly-backup/index.ts` koden — de er fine, kun cron-opkaldet er brudt.
- Supplier-konfigurationer (feed_url, feed_schedule, currency osv.).
- `verify_jwt = false` settings i `config.toml`.

## Teknisk detalje (kan springes over)
```sql
SELECT cron.unschedule('scheduled-sync-check');
SELECT cron.schedule(
  'scheduled-sync-check', '*/30 * * * *',
  $$ SELECT net.http_post(
       url := '.../scheduled-sync',
       headers := jsonb_build_object(
         'Content-Type','application/json',
         'apikey', '<current anon>',
         'Authorization','Bearer <current anon>'
       ),
       body := '{}'::jsonb,
       timeout_milliseconds := 55000
     ); $$
);
```
Samme mønster for de tre andre jobs.

Skal jeg gå i gang?
