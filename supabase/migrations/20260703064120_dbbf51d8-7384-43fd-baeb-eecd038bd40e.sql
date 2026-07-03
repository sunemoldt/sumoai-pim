
-- Debounce the poke trigger and serialize queue-worker runs to prevent
-- 99-in-5-seconds bursts that get throttled by Shopify.

-- 1. Debounce table (single row)
CREATE TABLE IF NOT EXISTS public.shopify_queue_worker_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  last_poked_at timestamptz NOT NULL DEFAULT 'epoch'::timestamptz
);
INSERT INTO public.shopify_queue_worker_state (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON public.shopify_queue_worker_state TO authenticated;
GRANT ALL ON public.shopify_queue_worker_state TO service_role;
ALTER TABLE public.shopify_queue_worker_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read state" ON public.shopify_queue_worker_state;
CREATE POLICY "auth read state" ON public.shopify_queue_worker_state
  FOR SELECT TO authenticated USING (true);

-- 2. Replace poke trigger function with a debounced version.
-- Only fires an HTTP poke if we haven't poked in the last 15 seconds.
-- Skips inserts whose next_attempt_at is in the future (backoff retries).
CREATE OR REPLACE FUNCTION public.poke_shopify_queue_worker()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last timestamptz;
BEGIN
  IF NEW.status <> 'pending' OR NEW.next_attempt_at > now() + interval '30 seconds' THEN
    RETURN NEW;
  END IF;

  -- Atomic check-and-set: only one concurrent inserter wins the poke.
  UPDATE public.shopify_queue_worker_state
     SET last_poked_at = now()
   WHERE id = true AND last_poked_at < now() - interval '15 seconds'
  RETURNING last_poked_at INTO v_last;

  IF v_last IS NULL THEN
    -- Another recent poke already scheduled the worker; skip.
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://qanxmacwntyxfhznxriz.supabase.co/functions/v1/shopify-queue-worker',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhbnhtYWN3bnR5eGZoem54cml6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5Njg4NTMsImV4cCI6MjA5MDU0NDg1M30.IzMFm6WSjjGtGCwDoxGmDQ_SRQ4WZu_9Ofqt5TLsyNI","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhbnhtYWN3bnR5eGZoem54cml6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5Njg4NTMsImV4cCI6MjA5MDU0NDg1M30.IzMFm6WSjjGtGCwDoxGmDQ_SRQ4WZu_9Ofqt5TLsyNI"}'::jsonb,
    body := '{}'::jsonb
  );

  RETURN NEW;
END;
$$;
