
CREATE OR REPLACE FUNCTION public.list_duplicate_eans()
RETURNS TABLE(ean text, products jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH grouped AS (
    SELECT mp.ean AS e, count(*) AS c
    FROM public.master_products mp
    WHERE mp.ean IS NOT NULL
      AND mp.ean NOT LIKE 'wc-%'
      AND btrim(mp.ean) <> ''
    GROUP BY mp.ean
    HAVING count(*) > 1
  )
  SELECT g.e AS ean,
         jsonb_agg(
           jsonb_build_object(
             'id', mp.id,
             'title', mp.title,
             'sku', mp.sku,
             'image_url', mp.image_url,
             'shopify_product_id', mp.shopify_product_id,
             'shopify_variant_id', mp.shopify_variant_id,
             'lifecycle_status', mp.lifecycle_status,
             'last_shopify_sync_at', mp.last_shopify_sync_at,
             'updated_at', mp.updated_at
           )
           ORDER BY mp.updated_at DESC NULLS LAST
         ) AS products
  FROM grouped g
  JOIN public.master_products mp ON mp.ean = g.e
  GROUP BY g.e
  ORDER BY g.e;
$$;

CREATE OR REPLACE FUNCTION public.resolve_duplicate_ean(p_ean text, p_keep_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int := 0;
  v_ids uuid[];
BEGIN
  IF p_ean IS NULL OR btrim(p_ean) = '' THEN
    RAISE EXCEPTION 'EAN is required';
  END IF;

  PERFORM set_config('app.change_source', 'duplicate-ean-resolve', true);

  WITH upd AS (
    UPDATE public.master_products
    SET ean = 'wc-dup-' || substr(id::text, 1, 8),
        updated_at = now()
    WHERE ean = p_ean
      AND (p_keep_id IS NULL OR id <> p_keep_id)
    RETURNING id
  )
  SELECT array_agg(id), count(*)::int INTO v_ids, v_updated FROM upd;

  RETURN jsonb_build_object(
    'ean', p_ean,
    'kept_id', p_keep_id,
    'cleared_ids', COALESCE(v_ids, ARRAY[]::uuid[]),
    'updated', v_updated
  );
END;
$$;
