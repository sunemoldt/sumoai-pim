
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
      AND mp.lifecycle_status IS DISTINCT FROM 'archived'
      AND (
        mp.ean IS NULL
        OR mp.ean LIKE 'wc-%'
        OR btrim(mp.ean) = ''
        OR mp.ean !~ '^\d{12}$|^\d{13}$'
      )
  ),
  candidates AS (
    SELECT
      im.id AS master_product_id,
      pv.ean AS candidate_ean,
      CASE
        WHEN im.shopify_variant_id IS NOT NULL
          AND pv.shopify_variant_id = im.shopify_variant_id THEN 0
        ELSE 1
      END AS link_rank,
      COALESCE(pv.position, 9999) AS position
    FROM invalid_master im
    JOIN public.product_variants pv ON pv.master_product_id = im.id
    WHERE pv.ean IS NOT NULL
      AND pv.ean ~ '^\d{12}$|^\d{13}$'
  ),
  best AS (
    SELECT DISTINCT ON (master_product_id)
      master_product_id, candidate_ean
    FROM candidates
    ORDER BY master_product_id, link_rank ASC, position ASC
  )
  SELECT im.id,
         im.title,
         im.sku,
         im.image_url,
         im.ean,
         b.candidate_ean,
         im.shopify_product_id,
         im.shopify_variant_id,
         im.updated_at
  FROM invalid_master im
  JOIN best b ON b.master_product_id = im.id
  WHERE b.candidate_ean IS DISTINCT FROM im.ean
    AND NOT EXISTS (
      SELECT 1 FROM public.master_products dup
      WHERE dup.ean = b.candidate_ean AND dup.id <> im.id
    )
  ORDER BY im.title NULLS LAST;
$$;
