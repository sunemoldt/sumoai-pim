
CREATE TABLE public.price_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id uuid NOT NULL REFERENCES public.master_products(id) ON DELETE CASCADE,
  shopify_price numeric NOT NULL,
  shopify_compare_at_price numeric,
  cheapest_purchase_price numeric NOT NULL,
  margin_pct numeric NOT NULL,
  severity text NOT NULL CHECK (severity IN ('below_cost','low_margin')),
  source text NOT NULL DEFAULT 'shopify-scanner',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX price_alerts_unresolved_idx ON public.price_alerts (master_product_id) WHERE resolved_at IS NULL;
CREATE INDEX price_alerts_created_at_idx ON public.price_alerts (created_at DESC);

GRANT SELECT, UPDATE ON public.price_alerts TO authenticated;
GRANT ALL ON public.price_alerts TO service_role;

ALTER TABLE public.price_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read price alerts"
  ON public.price_alerts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated resolve price alerts"
  ON public.price_alerts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access price alerts"
  ON public.price_alerts FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER update_price_alerts_updated_at
  BEFORE UPDATE ON public.price_alerts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
