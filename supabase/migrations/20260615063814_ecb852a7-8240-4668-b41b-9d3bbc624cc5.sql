CREATE INDEX IF NOT EXISTS idx_master_products_title ON public.master_products (title);
CREATE INDEX IF NOT EXISTS idx_master_products_auto_stock_sync_true
  ON public.master_products (auto_stock_sync) WHERE auto_stock_sync = true;
CREATE INDEX IF NOT EXISTS idx_product_analytics_updated_at
  ON public.product_analytics (updated_at DESC);