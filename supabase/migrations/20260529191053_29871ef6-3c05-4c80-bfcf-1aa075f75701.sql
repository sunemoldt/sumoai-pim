
-- Lower queue-worker cron from every 10 min to every 15 min (safety-net only;
-- new items are pushed immediately by the trigger below).
DO $$
BEGIN
  PERFORM cron.unschedule('shopify-queue-worker');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'shopify-queue-worker',
  '*/15 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://qanxmacwntyxfhznxriz.supabase.co/functions/v1/shopify-queue-worker',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhbnhtYWN3bnR5eGZoem54cml6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5Njg4NTMsImV4cCI6MjA5MDU0NDg1M30.IzMFm6WSjjGtGCwDoxGmDQ_SRQ4WZu_9Ofqt5TLsyNI","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhbnhtYWN3bnR5eGZoem54cml6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5Njg4NTMsImV4cCI6MjA5MDU0NDg1M30.IzMFm6WSjjGtGCwDoxGmDQ_SRQ4WZu_9Ofqt5TLsyNI"}'::jsonb,
    body := '{}'::jsonb
  );
  $cron$
);

-- Trigger function: pokes the worker via pg_net when a new pending item is enqueued.
-- Uses pg_net so the HTTP call is async and doesn't block the inserting transaction.
CREATE OR REPLACE FUNCTION public.poke_shopify_queue_worker()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending' AND NEW.next_attempt_at <= now() + interval '1 minute' THEN
    PERFORM net.http_post(
      url := 'https://qanxmacwntyxfhznxriz.supabase.co/functions/v1/shopify-queue-worker',
      headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhbnhtYWN3bnR5eGZoem54cml6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5Njg4NTMsImV4cCI6MjA5MDU0NDg1M30.IzMFm6WSjjGtGCwDoxGmDQ_SRQ4WZu_9Ofqt5TLsyNI","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhbnhtYWN3bnR5eGZoem54cml6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5Njg4NTMsImV4cCI6MjA5MDU0NDg1M30.IzMFm6WSjjGtGCwDoxGmDQ_SRQ4WZu_9Ofqt5TLsyNI"}'::jsonb,
      body := '{}'::jsonb
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_poke_shopify_queue_worker ON public.shopify_update_queue;
CREATE TRIGGER trg_poke_shopify_queue_worker
AFTER INSERT ON public.shopify_update_queue
FOR EACH ROW
EXECUTE FUNCTION public.poke_shopify_queue_worker();
