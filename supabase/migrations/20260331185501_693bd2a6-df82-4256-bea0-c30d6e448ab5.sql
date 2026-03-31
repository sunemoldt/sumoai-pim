ALTER TABLE public.master_products
  ADD COLUMN IF NOT EXISTS short_description text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS long_description text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS meta_title text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS meta_description text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sku text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS attributes jsonb DEFAULT '{}';
