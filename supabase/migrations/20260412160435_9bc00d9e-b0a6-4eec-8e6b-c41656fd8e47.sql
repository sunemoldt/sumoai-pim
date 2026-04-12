ALTER TABLE public.master_products 
  ADD COLUMN auto_stock_sync boolean NOT NULL DEFAULT false,
  ADD COLUMN stock_sync_supplier_id uuid DEFAULT NULL,
  ADD COLUMN stock_sync_interval text DEFAULT 'daily';