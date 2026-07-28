## Diagnose

- **pg_cron kalder `scheduled-sync` hvert 30. minut** (`*/30 * * * *`), men `scheduled-sync` staggerer på 15‑minutters slots → slots på `:15`/`:45` fyres **aldrig**. Det rammer især **Aurdel** (slot :15) og forklarer hvorfor den ikke har hentet i dag.
- Da Aurdel *undtagelsesvis* kørte manuelt → **504 IDLE_TIMEOUT (150s)** fordi API‑kaldet holder hovedrequesten åben.
- 09:27 i dag fejlede alle 4 feeds med `No rows found in feed` — samtidige manuelle "Kør nu"‑kald kolliderede med en cron‑kørsel. Flere `Stale running log closed` på DCS bekræfter overlappende runs.
- KOSATEC (`0 6 * * *`) missede 06:00 i dag samme mekanisme.

## Plan — fuldt forskudt kørsel

### 1. Erstat minut‑slots med en "sidst‑kørt" gate (rigtig staggering)
- Ændr `scheduled-sync` så den **ikke** længere bruger cron‑minutfelter til at bestemme hvem der fyres.
- Ny logik pr. tick:
  1. Hent alle aktive leverandører med `feed_schedule ≠ manual`.
  2. Mappér `feed_schedule` → intervaltimer (samme tabel som findes i `SupplierStatusTable`).
  3. Betragt en leverandør som **due** hvis `now - last_sync_at ≥ interval` (eller `last_sync_at IS NULL`).
  4. Sortér due leverandører efter `last_sync_at ASC NULLS FIRST` (den mest forsømte først).
  5. **Fyre kun én due leverandør pr. tick.** Resten venter til næste tick → naturlig forskydning.
- pg_cron `scheduled-sync-check` sættes til **hvert 5. minut** (`*/5 * * * *`). Med 4 aktive skema‑feeds giver det ~20 minutters minimum afstand mellem to leverandør‑jobs.
- Effekten: Aurdel og KOSATEC bliver aldrig "sprunget over" fordi de ligger på et minuttal cron ikke rammer. Overlap mellem to feeds i samme tick er umuligt.

### 2. Advisory lock pr. leverandør i `supplier-feed-import`
- Første handling: `pg_try_advisory_lock(hashtext('supplier-feed:'||supplier_id))`. Hvis låsen ikke fås → returnér `{ skipped: 'already_running' }` uden at røre `import_logs`. Fjerner "No rows found in feed"‑spøgelser fra samtidige manuelle + cron‑kald.
- `Stale running log`‑oprydning scopes til den enkelte supplier_id og kun logs > 20 min gamle.

### 3. Gør Aurdel timeout‑sikker
- Flyt `EdgeRuntime.waitUntil` **før** første fetch, så hoved‑responsen returnerer 202 straks (ingen 150s idle‑timer på callerens request).
- Stream Aurdel's items/stock i chunks (samme mønster som DCS): parse XML → flush hver N rækker → clear buffer → fortsæt. Fjerner in‑memory stockMap som holdt hele feedet.

### 4. Bedre status på Leverandør‑siden
- Udvid `SupplierStatusTable` + `SupplierListPage` med kolonner: `sidst OK`, `sidste fejl`, badge `Forsinket` (hvis `now - last_sync_at > 2× interval`).
- Knap "Vis seneste log" åbner dialog med nyeste `import_logs`‑række (`status`, `total_fetched`, `imported`, `errors`).

### 5. Efter deploy
- Manuel trigger af `scheduled-sync` for at hente Aurdel + KOSATEC nu.
- Verificér næste tick: kun én leverandør fyres, resten venter, ingen overlap i `import_logs`.

## Tekniske detaljer

**Filer:**
- `supabase/functions/scheduled-sync/index.ts` — ny "sidst‑kørt" gate, dropper cron‑minut‑logik, fyrer én due leverandør pr. tick.
- `supabase/functions/supplier-feed-import/index.ts` — advisory lock, scoped stale‑log‑cleanup, tidligere `waitUntil` for Aurdel, streamet Aurdel‑parser.
- `src/components/monitoring/SupplierStatusTable.tsx` + `src/pages/SupplierListPage.tsx` — nye kolonner + "Vis seneste log" dialog.
- pg_cron (via `supabase--insert`, ikke migration jf. project‑memory): unschedule + reschedule `scheduled-sync-check` til `*/5 * * * *`.

**Ingen skema‑ændringer, ingen data‑migration.**

## Åbne spørgsmål

1. OK med at fyre **én leverandør pr. tick** (max ~1 kørsel hvert 5. minut)? Alle leverandører når stadig deres respektive intervaller, men to store feeds vil aldrig køre samtidigt igen.
2. Skal jeg samtidig sætte Aurdel og KOSATEC til hyppigere skema (fx hver 2. time) mens vi er i gang, eller behold nuværende frekvens?
