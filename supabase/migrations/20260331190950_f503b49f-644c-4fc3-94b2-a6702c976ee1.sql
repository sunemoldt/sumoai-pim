ALTER TABLE public.master_products
  ADD COLUMN IF NOT EXISTS stock_quantity integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS stock_status text DEFAULT 'instock',
  ADD COLUMN IF NOT EXISTS backorders_allowed boolean DEFAULT false;