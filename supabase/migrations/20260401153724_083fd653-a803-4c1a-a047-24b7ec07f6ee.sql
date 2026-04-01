
-- Product analytics table for GA4 + GSC data
CREATE TABLE public.product_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id uuid NOT NULL REFERENCES public.master_products(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  -- GA4 metrics
  page_views integer DEFAULT 0,
  add_to_carts integer DEFAULT 0,
  purchases integer DEFAULT 0,
  conversion_rate numeric DEFAULT 0,
  -- GSC metrics
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  avg_position numeric DEFAULT 0,
  ctr numeric DEFAULT 0,
  -- Mapping
  matched_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(master_product_id, period_start, period_end)
);

ALTER TABLE public.product_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public access" ON public.product_analytics FOR ALL TO public USING (true) WITH CHECK (true);

-- Product recommendations table
CREATE TABLE public.product_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id uuid NOT NULL REFERENCES public.master_products(id) ON DELETE CASCADE,
  recommendation_type text NOT NULL, -- 'high_traffic_no_sales', 'high_traffic_low_stock', 'good_position_bad_ctr'
  severity text NOT NULL DEFAULT 'warning', -- 'info', 'warning', 'critical'
  title text NOT NULL,
  description text NOT NULL,
  action_suggestion text,
  is_dismissed boolean NOT NULL DEFAULT false,
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

ALTER TABLE public.product_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public access" ON public.product_recommendations FOR ALL TO public USING (true) WITH CHECK (true);

-- Analytics settings table
CREATE TABLE public.analytics_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text NOT NULL UNIQUE,
  setting_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.analytics_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public access" ON public.analytics_settings FOR ALL TO public USING (true) WITH CHECK (true);

-- Enable realtime for recommendations
ALTER PUBLICATION supabase_realtime ADD TABLE public.product_recommendations;
