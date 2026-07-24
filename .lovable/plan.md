## Bekræftet problem

`supplier-feed-import` fejler på store feeds med `WORKER_RESOURCE_LIMIT` (546) og 503. Årsag i `supabase/functions/supplier-feed-import/index.ts`:

1. **Non-FTP feeds læses helt ind i hukommelsen** (linje 471–473): `text = await res.text()` for hele CSV/XML-svaret, og derefter bygger `parseCsv`/`parseXml`/`parseAurdelItemXml` endnu et fuldt array med alle rækker. Store feeds → OOM.
2. **Dobbelt-iteration af `feedRows`** (cache-loop 595–629 + hoved-loop 679–752) beholder både `feedRows`, `cacheRows` og `spRows` i hukommelsen samtidig.
3. **Async self-invoke sluger fejl** (linje 297–317): svarer altid 202 `{success:true, started:true}`, uanset om det interne kald returnerer 546/503. Brugeren tror import lykkedes.
4. **Mindre bug**: linje 497 `mp.ean.replace(...)` crasher hvis `mp.ean` er `null` (masterProducts-select tillader null).

## Rettelser

### 1. Streaming for HTTP/storage feeds (CSV)
- Erstat `text = await res.text()` med en linje-baseret stream (`res.body!.pipeThrough(new TextDecoderStream())` + akkumulér til `\n`), samme mønster som FTP-`onLine`-stien (linje 203–226).
- Genbrug den eksisterende `eanToIdEarlyOuter`-forfiltrering: kun rækker med EAN der matcher `master_products` (eller matcher `targetEan`) beholdes i `feedRows`. Store feeds med mange ikke-relevante rækker slipper for at fylde hukommelsen op.
- Gælder både `res.body` (ekstern URL) og storage-bucket downloads (skift `blob.text()` → `blob.stream()`).

### 2. Streaming for Aurdel XML API
- `parseAurdelItemXml`/`parseAurdelStockXml` kører regex på hele filen. Skift til en scanner der læser stream chunk-vis og finder `<item …>…</item>` grænser, så vi kan pushe rækker inkrementelt i stedet for at holde hele XML-teksten + fuldt array.

### 3. Fjern dobbelt-loop
- Byg `supplier_feed_cache`-rækker i **samme** loop som `spRows`, så `feedRows` kan itereres én gang og `cacheRows` slipper for at være en separat kopi. Reducerer peak-memory markant.

### 4. Surface async fejl
- I async-blokken (linje 294–318): opret et `import_logs`-row med `status='running'` inden `EdgeRuntime.waitUntil`, og opdater det til `status='failed'` med `errors` når det interne kald returnerer non-2xx eller kaster. Returnér `import_log_id` i 202-svaret, så UI kan pulle status.

### 5. Null-guard bugfix
- Linje 497: `const rawEan = mp.ean; if (!rawEan) continue; const normEan = rawEan.replace(/^0+/, '') || rawEan;`

## Ude af scope

- Køre importen som en dedikeret worker/queue (større arkitektur-ændring).
- Ændringer i UI ud over evt. at læse `import_log_id` fra svaret.

## Verifikation

- Deploy edge function.
- Kør en manuel import af det største feed (Kosatec eller DCS) og bekræft:
  - Ingen 546/503 i edge-logs.
  - `import_logs`-row markeret `done`/`failed` korrekt.
  - `supplier_feed_cache` og `supplier_products` opdateret som før.
