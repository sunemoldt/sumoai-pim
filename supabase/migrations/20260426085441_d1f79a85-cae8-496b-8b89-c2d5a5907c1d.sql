ALTER TABLE public.master_products
ADD COLUMN IF NOT EXISTS categories text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_master_products_categories
ON public.master_products USING GIN (categories);