
CREATE TABLE public.supplier_feed_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  ean text NOT NULL,
  product_title text,
  supplier_sku text,
  brand text,
  purchase_price numeric,
  stock_quantity integer,
  in_stock boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, ean)
);

CREATE INDEX supplier_feed_cache_ean_idx ON public.supplier_feed_cache(ean);

GRANT SELECT ON public.supplier_feed_cache TO authenticated;
GRANT ALL ON public.supplier_feed_cache TO service_role;

ALTER TABLE public.supplier_feed_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read supplier feed cache"
  ON public.supplier_feed_cache
  FOR SELECT
  TO authenticated
  USING (true);

CREATE TRIGGER update_supplier_feed_cache_updated_at
  BEFORE UPDATE ON public.supplier_feed_cache
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
