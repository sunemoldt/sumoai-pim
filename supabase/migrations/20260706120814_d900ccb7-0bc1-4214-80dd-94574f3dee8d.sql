
CREATE OR REPLACE FUNCTION public.ean_suggestions_diagnostic()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH invalid_master AS (
    SELECT mp.id, mp.ean, mp.shopify_variant_id
    FROM public.master_products mp
    WHERE mp.shopify_product_id IS NOT NULL
      AND mp.lifecycle_status IS DISTINCT FROM 'archived'
      AND (
        mp.ean IS NULL OR mp.ean LIKE 'wc-%' OR btrim(mp.ean) = ''
        OR mp.ean !~ '^\d{12}$|^\d{13}$'
      )
  ),
  linked_barcode AS (
    SELECT im.id AS master_id, pv.ean AS linked_ean
    FROM invalid_master im
    LEFT JOIN public.product_variants pv
      ON pv.master_product_id = im.id
     AND pv.shopify_variant_id = im.shopify_variant_id
  ),
  any_valid AS (
    SELECT im.id AS master_id,
           bool_or(pv.ean ~ '^\d{12}$|^\d{13}$') AS has_valid
    FROM invalid_master im
    LEFT JOIN public.product_variants pv ON pv.master_product_id = im.id
    GROUP BY im.id
  ),
  ready AS (
    SELECT count(*)::int AS n FROM public.list_ean_suggestions()
  ),
  blocked AS (
    SELECT count(DISTINCT im.id)::int AS n
    FROM invalid_master im
    JOIN public.product_variants pv ON pv.master_product_id = im.id
    JOIN public.master_products dup ON dup.ean = pv.ean AND dup.id <> im.id
    WHERE pv.ean ~ '^\d{12}$|^\d{13}$'
  )
  SELECT jsonb_build_object(
    'total_invalid', (SELECT count(*)::int FROM invalid_master),
    'linked_variant_missing_barcode',
      (SELECT count(*)::int FROM linked_barcode
        WHERE linked_ean IS NULL OR linked_ean = '' OR linked_ean !~ '^\d{12}$|^\d{13}$'),
    'no_valid_barcode_anywhere',
      (SELECT count(*)::int FROM any_valid WHERE has_valid IS DISTINCT FROM true),
    'blocked_by_other_product', (SELECT n FROM blocked),
    'ready_to_suggest', (SELECT n FROM ready)
  );
$$;
