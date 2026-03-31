ALTER TABLE public.master_products
  ADD COLUMN IF NOT EXISTS sale_price numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS custom_markup_percentage numeric DEFAULT NULL;