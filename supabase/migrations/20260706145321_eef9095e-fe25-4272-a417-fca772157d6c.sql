
CREATE OR REPLACE FUNCTION public.list_ean_diagnostic_products(p_category text)
RETURNS TABLE (
  master_product_id uuid,
  title text,
  sku text,
  image_url text,
  current_ean text,
  shopify_product_id text,
  note text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH invalid_master AS (
    SELECT mp.id, mp.title, mp.sku, mp.image_url, mp.ean, mp.shopify_product_id, mp.shopify_variant_id
    FROM public.master_products mp
    WHERE mp.shopify_product_id IS NOT NULL
      AND mp.lifecycle_status IS DISTINCT FROM 'archived'
      AND (
        mp.ean IS NULL OR mp.ean LIKE 'wc-%' OR btrim(mp.ean) = ''
        OR mp.ean !~ '^\d{12}$|^\d{13}$'
      )
  )
  SELECT im.id, im.title, im.sku, im.image_url, im.ean, im.shopify_product_id,
         CASE
           WHEN p_category = 'blocked' THEN 'EAN ' || pv.ean || ' bruges allerede af andet produkt'
           ELSE NULL
         END AS note
  FROM invalid_master im
  LEFT JOIN LATERAL (
    SELECT pv.ean
    FROM public.product_variants pv
    JOIN public.master_products dup ON dup.ean = pv.ean AND dup.id <> im.id
    WHERE pv.master_product_id = im.id
      AND pv.ean ~ '^\d{12}$|^\d{13}$'
    LIMIT 1
  ) pv ON p_category = 'blocked'
  WHERE
    CASE p_category
      WHEN 'invalid' THEN true
      WHEN 'missing_linked' THEN NOT EXISTS (
        SELECT 1 FROM public.product_variants v
        WHERE v.master_product_id = im.id
          AND v.shopify_variant_id = im.shopify_variant_id
          AND v.ean ~ '^\d{12}$|^\d{13}$'
      )
      WHEN 'no_valid_anywhere' THEN NOT EXISTS (
        SELECT 1 FROM public.product_variants v
        WHERE v.master_product_id = im.id
          AND v.ean ~ '^\d{12}$|^\d{13}$'
      )
      WHEN 'blocked' THEN pv.ean IS NOT NULL
      ELSE false
    END
  ORDER BY im.title NULLS LAST;
$$;

REVOKE EXECUTE ON FUNCTION public.list_ean_diagnostic_products(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_ean_diagnostic_products(text) TO authenticated, service_role;
