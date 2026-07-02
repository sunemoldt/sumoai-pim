ALTER TABLE public.shopify_collections
  ADD COLUMN IF NOT EXISTS views_30d integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sessions_30d integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS analytics_updated_at timestamptz;