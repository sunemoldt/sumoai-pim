CREATE OR REPLACE FUNCTION public.get_db_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'database_size_bytes', pg_database_size(current_database()),
    'database_size_pretty', pg_size_pretty(pg_database_size(current_database())),
    'tables', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'name', relname,
          'row_estimate', n_live_tup,
          'total_bytes', pg_total_relation_size(c.oid),
          'total_pretty', pg_size_pretty(pg_total_relation_size(c.oid))
        ) ORDER BY pg_total_relation_size(c.oid) DESC
      )
      FROM pg_stat_user_tables s
      JOIN pg_class c ON c.oid = s.relid
      WHERE s.schemaname = 'public'
    ),
    'change_log_total', (SELECT count(*) FROM public.product_change_log),
    'change_log_last_24h', (SELECT count(*) FROM public.product_change_log WHERE created_at > now() - interval '24 hours'),
    'change_log_last_7d', (SELECT count(*) FROM public.product_change_log WHERE created_at > now() - interval '7 days'),
    'wc_last_import_at', (SELECT setting_value FROM public.analytics_settings WHERE setting_key = 'wc_last_import_at')
  ) INTO result;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_db_stats() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_change_log_daily(days int DEFAULT 14)
RETURNS TABLE(day date, count bigint, source text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT date_trunc('day', created_at)::date AS day,
         count(*)::bigint,
         coalesce(source, 'unknown') AS source
  FROM public.product_change_log
  WHERE created_at > now() - (days || ' days')::interval
  GROUP BY 1, 3
  ORDER BY 1 ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_change_log_daily(int) TO authenticated;