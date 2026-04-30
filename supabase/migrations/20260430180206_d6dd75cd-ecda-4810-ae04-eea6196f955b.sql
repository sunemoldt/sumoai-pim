-- Track last successful WC import to enable incremental sync
INSERT INTO public.analytics_settings (setting_key, setting_value)
VALUES ('wc_last_import_at', '')
ON CONFLICT DO NOTHING;

-- Ensure pg_cron is available
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Daily cleanup job: delete product_change_log entries older than 30 days
SELECT cron.schedule(
  'cleanup-product-change-log',
  '15 3 * * *',
  $$DELETE FROM public.product_change_log WHERE created_at < now() - interval '30 days'$$
);

-- Helpful index for the cleanup query
CREATE INDEX IF NOT EXISTS idx_product_change_log_created_at
  ON public.product_change_log (created_at);