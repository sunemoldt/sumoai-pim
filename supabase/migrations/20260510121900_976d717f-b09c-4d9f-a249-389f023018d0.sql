CREATE TABLE IF NOT EXISTS public.shopify_update_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  master_product_id uuid NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_shopify_update_queue_pending
  ON public.shopify_update_queue (status, next_attempt_at)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_shopify_update_queue_product
  ON public.shopify_update_queue (master_product_id);

ALTER TABLE public.shopify_update_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read" ON public.shopify_update_queue FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON public.shopify_update_queue FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON public.shopify_update_queue FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete" ON public.shopify_update_queue FOR DELETE TO authenticated USING (true);
CREATE POLICY "Service role access" ON public.shopify_update_queue FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER set_updated_at_shopify_update_queue
BEFORE UPDATE ON public.shopify_update_queue
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();