
CREATE TABLE public.shopify_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_collection_id text NOT NULL UNIQUE,
  handle text,
  title text NOT NULL,
  description_html text,
  meta_title text,
  meta_description text,
  collection_type text NOT NULL DEFAULT 'custom',
  products_count integer NOT NULL DEFAULT 0,
  image_url text,
  sort_order text,
  last_shopify_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shopify_collections TO authenticated;
GRANT ALL ON public.shopify_collections TO service_role;

ALTER TABLE public.shopify_collections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read collections" ON public.shopify_collections FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert collections" ON public.shopify_collections FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update collections" ON public.shopify_collections FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete collections" ON public.shopify_collections FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_shopify_collections_updated
BEFORE UPDATE ON public.shopify_collections
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_shopify_collections_handle ON public.shopify_collections(handle);
CREATE INDEX idx_shopify_collections_type ON public.shopify_collections(collection_type);

CREATE TABLE public.master_product_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id uuid NOT NULL REFERENCES public.master_products(id) ON DELETE CASCADE,
  collection_id uuid NOT NULL REFERENCES public.shopify_collections(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (master_product_id, collection_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.master_product_collections TO authenticated;
GRANT ALL ON public.master_product_collections TO service_role;

ALTER TABLE public.master_product_collections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read product collections" ON public.master_product_collections FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert product collections" ON public.master_product_collections FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update product collections" ON public.master_product_collections FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete product collections" ON public.master_product_collections FOR DELETE TO authenticated USING (true);

CREATE INDEX idx_mpc_master ON public.master_product_collections(master_product_id);
CREATE INDEX idx_mpc_collection ON public.master_product_collections(collection_id);
