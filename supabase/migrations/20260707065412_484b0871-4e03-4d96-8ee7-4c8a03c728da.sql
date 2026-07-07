
CREATE TABLE public.sale_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  discount_percent numeric NOT NULL CHECK (discount_percent > 0 AND discount_percent < 100),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','active','ended','cancelled')),
  overwrite_existing_sale boolean NOT NULL DEFAULT false,
  activated_at timestamptz,
  deactivated_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_campaigns TO authenticated;
GRANT ALL ON public.sale_campaigns TO service_role;

ALTER TABLE public.sale_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read sale_campaigns" ON public.sale_campaigns
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert sale_campaigns" ON public.sale_campaigns
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update sale_campaigns" ON public.sale_campaigns
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete sale_campaigns" ON public.sale_campaigns
  FOR DELETE TO authenticated USING (true);

CREATE TRIGGER update_sale_campaigns_updated_at
  BEFORE UPDATE ON public.sale_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.sale_campaign_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.sale_campaigns(id) ON DELETE CASCADE,
  master_product_id uuid NOT NULL REFERENCES public.master_products(id) ON DELETE CASCADE,
  original_sale_price numeric,
  applied_sale_price numeric,
  applied_at timestamptz,
  reverted_at timestamptz,
  skipped_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, master_product_id)
);

CREATE INDEX idx_sale_campaign_products_campaign ON public.sale_campaign_products(campaign_id);
CREATE INDEX idx_sale_campaign_products_product ON public.sale_campaign_products(master_product_id);
CREATE INDEX idx_sale_campaigns_status_dates ON public.sale_campaigns(status, starts_at, ends_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_campaign_products TO authenticated;
GRANT ALL ON public.sale_campaign_products TO service_role;

ALTER TABLE public.sale_campaign_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read sale_campaign_products" ON public.sale_campaign_products
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert sale_campaign_products" ON public.sale_campaign_products
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update sale_campaign_products" ON public.sale_campaign_products
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete sale_campaign_products" ON public.sale_campaign_products
  FOR DELETE TO authenticated USING (true);

CREATE TRIGGER update_sale_campaign_products_updated_at
  BEFORE UPDATE ON public.sale_campaign_products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
