
CREATE OR REPLACE FUNCTION public.merge_attribute_definitions(
  p_source_id uuid,
  p_target_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source RECORD;
  v_target RECORD;
  v_products_updated int := 0;
  v_variants_updated int := 0;
BEGIN
  IF p_source_id = p_target_id THEN
    RAISE EXCEPTION 'Source and target must differ';
  END IF;

  SELECT * INTO v_source FROM public.attribute_definitions WHERE id = p_source_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source definition not found'; END IF;

  SELECT * INTO v_target FROM public.attribute_definitions WHERE id = p_target_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target definition not found'; END IF;

  PERFORM set_config('app.change_source', 'attribute-merge', true);

  -- Move attribute value on master_products: only set target if it's not already set
  WITH affected AS (
    SELECT id, attributes
    FROM public.master_products
    WHERE attributes ? v_source.key
  ),
  upd AS (
    UPDATE public.master_products mp
    SET attributes = CASE
          WHEN mp.attributes ? v_target.key
            THEN (mp.attributes - v_source.key)
          ELSE jsonb_set(mp.attributes - v_source.key, ARRAY[v_target.key], mp.attributes -> v_source.key, true)
        END,
        updated_at = now()
    FROM affected a
    WHERE mp.id = a.id
    RETURNING mp.id
  )
  SELECT count(*) INTO v_products_updated FROM upd;

  -- Same for product_variants
  WITH affected AS (
    SELECT id, attributes
    FROM public.product_variants
    WHERE attributes ? v_source.key
  ),
  upd AS (
    UPDATE public.product_variants pv
    SET attributes = CASE
          WHEN pv.attributes ? v_target.key
            THEN (pv.attributes - v_source.key)
          ELSE jsonb_set(pv.attributes - v_source.key, ARRAY[v_target.key], pv.attributes -> v_source.key, true)
        END,
        updated_at = now()
    FROM affected a
    WHERE pv.id = a.id
    RETURNING pv.id
  )
  SELECT count(*) INTO v_variants_updated FROM upd;

  DELETE FROM public.attribute_definitions WHERE id = p_source_id;

  RETURN jsonb_build_object(
    'success', true,
    'source_key', v_source.key,
    'target_key', v_target.key,
    'products_updated', v_products_updated,
    'variants_updated', v_variants_updated
  );
END;
$$;
