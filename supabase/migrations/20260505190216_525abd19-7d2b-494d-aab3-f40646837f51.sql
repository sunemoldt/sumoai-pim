ALTER TABLE public.master_products
ADD COLUMN IF NOT EXISTS sync_tags text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_master_products_sync_tags
ON public.master_products USING GIN (sync_tags);