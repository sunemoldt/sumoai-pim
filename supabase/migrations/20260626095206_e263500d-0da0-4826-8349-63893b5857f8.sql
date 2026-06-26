
ALTER TABLE public.master_products
  ADD COLUMN IF NOT EXISTS exclude_from_feeds boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_master_products_feed_eligible
  ON public.master_products (lifecycle_status, exclude_from_feeds);

CREATE TABLE IF NOT EXISTS public.feed_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_key text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  product_count integer,
  file_path text,
  file_size_bytes integer,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

GRANT SELECT ON public.feed_runs TO authenticated;
GRANT ALL ON public.feed_runs TO service_role;

ALTER TABLE public.feed_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "feed_runs read for authenticated"
  ON public.feed_runs FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_feed_runs_key_started
  ON public.feed_runs (feed_key, started_at DESC);
