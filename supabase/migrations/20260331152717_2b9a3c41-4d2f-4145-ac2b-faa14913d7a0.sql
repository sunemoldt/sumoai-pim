
-- Create update_updated_at function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Suppliers table
CREATE TABLE public.suppliers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  feed_url TEXT,
  feed_type TEXT NOT NULL DEFAULT 'manual' CHECK (feed_type IN ('xml', 'csv', 'google_drive', 'manual')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  feed_schedule TEXT DEFAULT '0 6 * * *',
  column_mapping JSONB DEFAULT '{}',
  last_sync_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Master products table
CREATE TABLE public.master_products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ean TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  image_url TEXT,
  brand TEXT,
  category TEXT,
  webshop_price NUMERIC(10,2),
  webshop_product_id TEXT,
  webshop_platform TEXT DEFAULT 'woocommerce' CHECK (webshop_platform IN ('woocommerce', 'shopify')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Supplier products (link table with pricing)
CREATE TABLE public.supplier_products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  master_product_id UUID NOT NULL REFERENCES public.master_products(id) ON DELETE CASCADE,
  purchase_price NUMERIC(10,2) NOT NULL,
  in_stock BOOLEAN NOT NULL DEFAULT true,
  stock_quantity INTEGER,
  supplier_sku TEXT,
  last_updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(supplier_id, master_product_id)
);

-- Price settings (global, brand, or product level)
CREATE TABLE public.price_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'brand', 'product')),
  scope_value TEXT,
  markup_percentage NUMERIC(5,2) NOT NULL DEFAULT 30.00,
  minimum_margin NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Webhook configurations
CREATE TABLE public.webhook_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  event_types TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Price history
CREATE TABLE public.price_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_product_id UUID NOT NULL REFERENCES public.supplier_products(id) ON DELETE CASCADE,
  price NUMERIC(10,2) NOT NULL,
  recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_master_products_ean ON public.master_products(ean);
CREATE INDEX idx_master_products_brand ON public.master_products(brand);
CREATE INDEX idx_supplier_products_supplier ON public.supplier_products(supplier_id);
CREATE INDEX idx_supplier_products_master ON public.supplier_products(master_product_id);
CREATE INDEX idx_price_history_product ON public.price_history(supplier_product_id);
CREATE INDEX idx_price_history_date ON public.price_history(recorded_at);

-- Enable RLS (public access for internal tool)
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_history ENABLE ROW LEVEL SECURITY;

-- Public read/write policies for all tables (internal admin tool, no auth in MVP)
CREATE POLICY "Public access" ON public.suppliers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access" ON public.master_products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access" ON public.supplier_products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access" ON public.price_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access" ON public.webhook_configs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access" ON public.price_history FOR ALL USING (true) WITH CHECK (true);

-- Triggers for updated_at
CREATE TRIGGER update_suppliers_updated_at BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_master_products_updated_at BEFORE UPDATE ON public.master_products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_supplier_products_updated_at BEFORE UPDATE ON public.supplier_products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_price_settings_updated_at BEFORE UPDATE ON public.price_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_webhook_configs_updated_at BEFORE UPDATE ON public.webhook_configs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default global price setting
INSERT INTO public.price_settings (scope, scope_value, markup_percentage, minimum_margin)
VALUES ('global', NULL, 30.00, 10.00);
