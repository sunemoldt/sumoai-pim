
-- Step 4: Variants
CREATE TABLE IF NOT EXISTS public.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id uuid NOT NULL REFERENCES public.master_products(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  sku text,
  ean text,
  shopify_variant_id text,
  shopify_inventory_item_id text,
  purchase_price numeric,
  webshop_price numeric,
  sale_price numeric,
  stock_quantity integer DEFAULT 0,
  weight numeric,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_variants_master ON public.product_variants(master_product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_ean ON public.product_variants(ean);
CREATE INDEX IF NOT EXISTS idx_product_variants_shopify ON public.product_variants(shopify_variant_id);

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read" ON public.product_variants FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON public.product_variants FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON public.product_variants FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete" ON public.product_variants FOR DELETE TO authenticated USING (true);
CREATE POLICY "Service role access" ON public.product_variants FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER update_product_variants_updated_at
BEFORE UPDATE ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Step 5: Attribute definitions
CREATE TABLE IF NOT EXISTS public.attribute_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  unit text,
  type text NOT NULL DEFAULT 'text' CHECK (type IN ('text','number','select','boolean')),
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_variant_axis boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.attribute_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read" ON public.attribute_definitions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON public.attribute_definitions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON public.attribute_definitions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete" ON public.attribute_definitions FOR DELETE TO authenticated USING (true);
CREATE POLICY "Service role access" ON public.attribute_definitions FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER update_attribute_definitions_updated_at
BEFORE UPDATE ON public.attribute_definitions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed from existing master_products.attributes (jsonb keys), guess type from values
INSERT INTO public.attribute_definitions (key, label, type)
SELECT
  k.key,
  initcap(replace(k.key, '_', ' ')) AS label,
  CASE
    WHEN bool_and(jsonb_typeof(mp.attributes->k.key) IN ('number','null')) THEN 'number'
    WHEN bool_and(lower(mp.attributes->>k.key) IN ('true','false','ja','nej','yes','no')) THEN 'boolean'
    ELSE 'text'
  END AS type
FROM public.master_products mp,
LATERAL jsonb_object_keys(coalesce(mp.attributes, '{}'::jsonb)) AS k(key)
WHERE mp.attributes IS NOT NULL AND mp.attributes <> '{}'::jsonb
GROUP BY k.key
ON CONFLICT (key) DO NOTHING;
