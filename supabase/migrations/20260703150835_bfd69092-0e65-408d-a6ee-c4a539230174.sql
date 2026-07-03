create or replace function public.get_monitoring_overview()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'queue', (
      select jsonb_build_object(
        'pending', count(*) filter (where status = 'pending'),
        'processing', count(*) filter (where status = 'processing'),
        'failed', count(*) filter (where status = 'failed'),
        'oldest_pending_seconds',
          extract(epoch from now() - min(created_at) filter (where status = 'pending'))
      )
      from public.shopify_update_queue
    ),
    'changes_last_hour', (
      select count(*) from public.product_change_log
      where created_at > now() - interval '1 hour'
    ),
    'changes_prev_hour', (
      select count(*) from public.product_change_log
      where created_at > now() - interval '2 hours'
        and created_at <= now() - interval '1 hour'
    ),
    'changes_24h', (
      select count(*) from public.product_change_log
      where created_at > now() - interval '24 hours'
    ),
    'errors_24h', (
      (select count(*) from public.shopify_update_queue
        where status = 'failed' and updated_at > now() - interval '24 hours')
      + (select count(*) from public.import_logs
        where status = 'failed' and started_at > now() - interval '24 hours')
    ),
    'source_breakdown_24h', coalesce((
      select jsonb_object_agg(src, cnt)
      from (
        select coalesce(source, 'unknown') as src, count(*) as cnt
        from public.product_change_log
        where created_at > now() - interval '24 hours'
        group by 1
      ) t
    ), '{}'::jsonb),
    'queue_throughput_6h', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', bucket, 'count', cnt) order by bucket)
      from (
        select date_trunc('hour', completed_at)
             + (floor(extract(minute from completed_at)::int / 10.0) * interval '10 minutes') as bucket,
             count(*) as cnt
        from public.shopify_update_queue
        where completed_at > now() - interval '6 hours'
          and status = 'completed'
        group by 1
      ) t
    ), '[]'::jsonb)
  );
$$;

grant execute on function public.get_monitoring_overview() to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'product_change_log'
  ) then
    execute 'alter publication supabase_realtime add table public.product_change_log';
  end if;
end $$;

alter table public.product_change_log replica identity full;
