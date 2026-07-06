
CREATE OR REPLACE FUNCTION public.list_ean_suggestions()
RETURNS TABLE(
  master_product_id uuid,
  title text,
  sku text,
  image_url text,
  current_ean text,
  suggested_ean text,
  shopify_product_id text,
  shopify_variant_id text,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH invalid_master AS (
    SELECT mp.*
    FROM public.master_products mp
    WHERE mp.shopify_product_id IS NOT NULL
      AND (
        mp.ean IS NULL
        OR mp.ean LIKE 'wc-%'
        OR btrim(mp.ean) = ''
        OR mp.ean !~ '^\d{12}$|^\d{13}$'
      )
  ),
  variant_candidate AS (
    SELECT DISTINCT ON (pv.master_product_id)
      pv.master_product_id,
      pv.ean AS suggested_ean,
      pv.shopify_variant_id
    FROM public.product_variants pv
    JOIN invalid_master im ON im.id = pv.master_product_id
    WHERE pv.ean IS NOT NULL
      AND pv.ean ~ '^\d{12}$|^\d{13}$'
      AND (im.shopify_variant_id IS NULL OR pv.shopify_variant_id = im.shopify_variant_id)
    ORDER BY pv.master_product_id,
             CASE WHEN pv.shopify_variant_id = (SELECT shopify_variant_id FROM invalid_master i2 WHERE i2.id = pv.master_product_id) THEN 0 ELSE 1 END,
             pv.position ASC NULLS LAST
  )
  SELECT im.id AS master_product_id,
         im.title,
         im.sku,
         im.image_url,
         im.ean AS current_ean,
         vc.suggested_ean,
         im.shopify_product_id,
         im.shopify_variant_id,
         im.updated_at
  FROM invalid_master im
  JOIN variant_candidate vc ON vc.master_product_id = im.id
  WHERE vc.suggested_ean IS DISTINCT FROM im.ean
    AND NOT EXISTS (
      SELECT 1 FROM public.master_products dup
      WHERE dup.ean = vc.suggested_ean AND dup.id <> im.id
    )
  ORDER BY im.title NULLS LAST;
$$;

CREATE OR REPLACE FUNCTION public.approve_ean_suggestion(p_master_id uuid, p_ean text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conflict uuid;
BEGIN
  IF p_ean IS NULL OR p_ean !~ '^\d{12}$|^\d{13}$' THEN
    RAISE EXCEPTION 'Invalid EAN: %', p_ean;
  END IF;

  SELECT id INTO v_conflict FROM public.master_products
   WHERE ean = p_ean AND id <> p_master_id LIMIT 1;
  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'EAN % already in use by another product (%)', p_ean, v_conflict;
  END IF;

  PERFORM set_config('app.change_source', 'shopify-pull', true);
  UPDATE public.master_products
     SET ean = p_ean, updated_at = now()
   WHERE id = p_master_id;

  RETURN jsonb_build_object('ok', true, 'master_product_id', p_master_id, 'ean', p_ean);
END;
$$;
