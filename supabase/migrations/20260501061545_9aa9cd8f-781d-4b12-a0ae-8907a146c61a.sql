ALTER TABLE public.master_products
  ADD COLUMN IF NOT EXISTS shopify_product_id text,
  ADD COLUMN IF NOT EXISTS shopify_variant_id text,
  ADD COLUMN IF NOT EXISTS shopify_sync_enabled boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_master_products_shopify_product_id ON public.master_products(shopify_product_id) WHERE shopify_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_master_products_shopify_variant_id ON public.master_products(shopify_variant_id) WHERE shopify_variant_id IS NOT NULL;