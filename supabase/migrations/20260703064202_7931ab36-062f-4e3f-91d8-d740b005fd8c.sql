
-- Advisory-lock helpers used by shopify-queue-worker to serialize runs.
-- Key 8472619283746 is arbitrary but stable.

CREATE OR REPLACE FUNCTION public.try_lock_shopify_queue_worker()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_try_advisory_lock(8472619283746);
$$;

CREATE OR REPLACE FUNCTION public.unlock_shopify_queue_worker()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_advisory_unlock(8472619283746);
$$;

REVOKE ALL ON FUNCTION public.try_lock_shopify_queue_worker() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unlock_shopify_queue_worker() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_lock_shopify_queue_worker() TO service_role;
GRANT EXECUTE ON FUNCTION public.unlock_shopify_queue_worker() TO service_role;
