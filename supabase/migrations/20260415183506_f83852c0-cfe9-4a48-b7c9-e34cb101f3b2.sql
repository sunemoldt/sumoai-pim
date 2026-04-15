-- Add array column for multiple supplier sync sources
ALTER TABLE public.master_products
ADD COLUMN stock_sync_supplier_ids uuid[] DEFAULT '{}';

-- Add configurable minimum margin for sync (default 15%)
ALTER TABLE public.master_products
ADD COLUMN min_sync_margin numeric DEFAULT 15;

-- Migrate existing single supplier to array
UPDATE public.master_products
SET stock_sync_supplier_ids = ARRAY[stock_sync_supplier_id]
WHERE stock_sync_supplier_id IS NOT NULL;