# Redesign af Monitoring — "Hvad sker der lige nu?"

Den nuværende side viser DB-størrelse og et 14-dages søjlediagram, men ikke **hvad systemet reelt laver**. Ny side prioriterer live-aktivitet, sync-sundhed og fejl — det man har brug for daglig drift.

## Ny layout (top → bund)

### 1. Status-stribe (4 kort)
- **Shopify-kø**: pending / processing / failed antal + ældste pending-alder ("2m gammel"). Rødt hvis failed > 0 eller ældste pending > 10 min.
- **Ændringer sidste time**: antal `product_change_log`-rækker + delta vs. forrige time.
- **Aktive leverandører**: X af Y kørt inden for planlagt interval; rødt hvis en er forsinket.
- **Fejl sidste 24t**: import-fejl + failed queue-jobs samlet. Klik → scroller til fejl-panel.

### 2. Live aktivitetsfeed (venstre, 2/3 bredde)
Seneste 40 `product_change_log` entries — realtime via Supabase-subscription på `product_change_log`. Hver linje:
- Tidsstempel (relativ: "3s siden")
- Produkt-titel (link til `/products/:id`)
- Felt der ændrede sig (`webshop_price`, `stock_quantity`, …)
- Gammel → ny værdi (trunkeret)
- Kilde-badge farvekodet: `supplier:*` blå, `shopify-*` lilla, `stock-sync` grøn, `manual`/`auto-pim-edit` grå, `low-margin-guard` orange, `revert` rød.

Filter-chips øverst: "Alle / Priser / Lager / Shopify / Leverandører / Manuelt".

### 3. Kilde-fordeling (højre, 1/3)
Donut over sidste 24t change-log grupperet på source-familie (supplier / shopify / stock / manuel / guard / andet). Svarer på "hvem ændrer mest?".

### 4. Shopify-kø detaljer
- Sparkline: jobs behandlet pr. 10 min sidste 6 timer (fra `completed_at`).
- Tabel: seneste 10 failed jobs — produkt, source, attempts, `last_error` (klik → udvidet).
- Knap "Genstart worker" (invoker `shopify-queue-worker`).

### 5. Leverandør-sync status
Én række pr. leverandør:
- Navn, feed_type, sidste kørsel (relativ), sidste resultat (imported/skipped/errors), næste planlagte kørsel, "Kør nu"-knap.
- Rød indikator hvis `last_sync_at` > 2× planlagt interval eller sidste run havde fejl.

### 6. Fejl-panel
- Failed rows fra `shopify_update_queue` (status='failed').
- Import-runs med `errors` array ikke-tom sidste 7d, med expandable error-liste.

### 7. Change-log volume (behold nuværende chart, men rykket ned)
14-dages stacked bar — nu som "trend"-kontekst i bunden.

### 8. DB-plads (behold som accordion i bunden)
Foldbar; ikke primær info.

## Data-hentning

Én ny RPC: `get_monitoring_overview()` returnerer JSONB med alt i status-striben + donut-data + queue-buckets i ét kald, så siden loader hurtigt.

```sql
create or replace function public.get_monitoring_overview()
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'queue', (select jsonb_build_object(
      'pending', count(*) filter (where status='pending'),
      'processing', count(*) filter (where status='processing'),
      'failed', count(*) filter (where status='failed'),
      'oldest_pending_seconds',
        extract(epoch from now() - min(created_at)) filter (where status='pending')
    ) from public.shopify_update_queue),
    'changes_last_hour', (select count(*) from public.product_change_log where created_at > now() - interval '1 hour'),
    'changes_prev_hour', (select count(*) from public.product_change_log where created_at > now() - interval '2 hours' and created_at <= now() - interval '1 hour'),
    'errors_24h', (
      (select count(*) from public.shopify_update_queue where status='failed' and updated_at > now() - interval '24 hours')
      + (select count(*) from public.import_logs where status='failed' and started_at > now() - interval '24 hours')
    ),
    'source_breakdown_24h', (
      select jsonb_object_agg(src, cnt)
      from (
        select coalesce(source,'unknown') as src, count(*) as cnt
        from public.product_change_log
        where created_at > now() - interval '24 hours'
        group by 1 order by 2 desc
      ) t
    ),
    'queue_throughput_6h', (
      select jsonb_agg(jsonb_build_object('bucket', bucket, 'count', cnt) order by bucket)
      from (
        select date_trunc('minute', completed_at) - (extract(minute from completed_at)::int % 10) * interval '1 minute' as bucket,
               count(*) as cnt
        from public.shopify_update_queue
        where completed_at > now() - interval '6 hours' and status='completed'
        group by 1
      ) t
    )
  );
$$;
grant execute on function public.get_monitoring_overview() to authenticated;
```

Realtime subscription på `product_change_log` INSERT for aktivitetsfeedet — kræver at tabellen er i `supabase_realtime` publikationen (migration tilføjer den hvis den mangler).

Failed queue-jobs + seneste supplier-runs hentes med separate queries.

## Filer

- **Rewrite** `src/pages/MonitoringPage.tsx` — ny struktur med sections.
- **Ny komponent** `src/components/monitoring/ActivityFeed.tsx` — realtime feed.
- **Ny komponent** `src/components/monitoring/QueueHealthCard.tsx`.
- **Ny komponent** `src/components/monitoring/SupplierStatusTable.tsx`.
- **Ny komponent** `src/components/monitoring/SourceDonut.tsx` (Recharts PieChart).
- **Migration** — `get_monitoring_overview()` RPC + realtime på `product_change_log`.

## Ikke omfattet
- Edge function logs (kræver analytics-DB adgang; separat feature).
- Ingen ændringer i business-logik/sync-motor.
