
CREATE OR REPLACE FUNCTION public.list_invalid_ean_product_ids()
RETURNS TABLE(id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT mp.id
  FROM public.master_products mp
  WHERE mp.shopify_product_id IS NOT NULL
    AND mp.lifecycle_status IS DISTINCT FROM 'archived'
    AND (
      mp.ean IS NULL
      OR mp.ean LIKE 'wc-%'
      OR btrim(mp.ean) = ''
      OR mp.ean !~ '^\d{12}$|^\d{13}$'
    )
  ORDER BY mp.updated_at DESC NULLS LAST;
$$;
