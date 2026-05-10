
-- Step 2: Master-field sync policy
CREATE TABLE IF NOT EXISTS public.field_sync_policy (
  field_name text PRIMARY KEY,
  master text NOT NULL CHECK (master IN ('pim','shopify')),
  direction text NOT NULL DEFAULT 'two_way' CHECK (direction IN ('push','pull','two_way','off')),
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.field_sync_policy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read" ON public.field_sync_policy FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON public.field_sync_policy FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON public.field_sync_policy FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete" ON public.field_sync_policy FOR DELETE TO authenticated USING (true);
CREATE POLICY "Service role access" ON public.field_sync_policy FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER update_field_sync_policy_updated_at
BEFORE UPDATE ON public.field_sync_policy
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed defaults matching current sync behavior
INSERT INTO public.field_sync_policy (field_name, master, direction, description) VALUES
  ('title',             'shopify', 'pull',     'Produktets titel'),
  ('short_description', 'shopify', 'pull',     'Kort produktbeskrivelse'),
  ('long_description',  'shopify', 'pull',     'Lang produktbeskrivelse'),
  ('meta_title',        'shopify', 'pull',     'SEO meta-titel'),
  ('meta_description',  'shopify', 'pull',     'SEO meta-beskrivelse'),
  ('image_url',         'shopify', 'pull',     'Hovedbillede'),
  ('webshop_price',     'pim',     'push',     'Salgspris inkl. moms'),
  ('sale_price',        'pim',     'push',     'Tilbudspris inkl. moms'),
  ('stock_quantity',    'pim',     'push',     'Lagerantal'),
  ('stock_status',      'pim',     'push',     'Lagerstatus'),
  ('backorders_allowed','pim',     'push',     'Restordre tilladt'),
  ('purchase_price',    'pim',     'off',      'Indkøbspris (intern, sendes ikke)'),
  ('ean',               'pim',     'push',     'EAN/stregkode'),
  ('sku',               'pim',     'push',     'Varenummer'),
  ('brand',             'pim',     'push',     'Brand/vendor'),
  ('category',          'pim',     'push',     'Kategori (product_type)'),
  ('weight',            'pim',     'push',     'Vægt'),
  ('attributes',        'pim',     'push',     'Tekniske attributter')
ON CONFLICT (field_name) DO NOTHING;

-- Step 3: Lifecycle status on master_products
ALTER TABLE public.master_products
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('draft','pending_activation','active','archived'));

CREATE INDEX IF NOT EXISTS idx_master_products_lifecycle ON public.master_products(lifecycle_status);

COMMENT ON COLUMN public.master_products.lifecycle_status IS
  'draft: kun i PIM | pending_activation: oprettet i Shopify som DRAFT, venter på manuel aktivering | active: synket | archived';
