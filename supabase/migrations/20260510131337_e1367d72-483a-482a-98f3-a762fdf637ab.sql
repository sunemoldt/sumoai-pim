
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
  v_queued int := 0;
  v_affected_ids uuid[];
BEGIN
  IF p_source_id = p_target_id THEN
    RAISE EXCEPTION 'Source and target must differ';
  END IF;

  SELECT * INTO v_source FROM public.attribute_definitions WHERE id = p_source_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source definition not found'; END IF;

  SELECT * INTO v_target FROM public.attribute_definitions WHERE id = p_target_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target definition not found'; END IF;

  PERFORM set_config('app.change_source', 'attribute-merge', true);

  -- Collect master_product_ids that will be touched (directly or via variants)
  SELECT array_agg(DISTINCT id) INTO v_affected_ids
  FROM (
    SELECT id FROM public.master_products WHERE attributes ? v_source.key
    UNION
    SELECT master_product_id AS id FROM public.product_variants WHERE attributes ? v_source.key
  ) t;

  -- master_products
  WITH affected AS (
    SELECT id, attributes FROM public.master_products WHERE attributes ? v_source.key
  ),
  upd AS (
    UPDATE public.master_products mp
    SET attributes = CASE
          WHEN mp.attributes ? v_target.key THEN (mp.attributes - v_source.key)
          ELSE jsonb_set(mp.attributes - v_source.key, ARRAY[v_target.key], mp.attributes -> v_source.key, true)
        END,
        updated_at = now()
    FROM affected a
    WHERE mp.id = a.id
    RETURNING mp.id
  )
  SELECT count(*) INTO v_products_updated FROM upd;

  -- product_variants
  WITH affected AS (
    SELECT id, attributes FROM public.product_variants WHERE attributes ? v_source.key
  ),
  upd AS (
    UPDATE public.product_variants pv
    SET attributes = CASE
          WHEN pv.attributes ? v_target.key THEN (pv.attributes - v_source.key)
          ELSE jsonb_set(pv.attributes - v_source.key, ARRAY[v_target.key], pv.attributes -> v_source.key, true)
        END,
        updated_at = now()
    FROM affected a
    WHERE pv.id = a.id
    RETURNING pv.id
  )
  SELECT count(*) INTO v_variants_updated FROM upd;

  -- Enqueue Shopify push for affected products that are Shopify-synced
  IF v_affected_ids IS NOT NULL THEN
    WITH ins AS (
      INSERT INTO public.shopify_update_queue (master_product_id, payload, source, status, next_attempt_at)
      SELECT mp.id,
             jsonb_build_object('reason', 'attribute-merge', 'source_key', v_source.key, 'target_key', v_target.key),
             'attribute-merge',
             'pending',
             now()
      FROM public.master_products mp
      WHERE mp.id = ANY(v_affected_ids)
        AND mp.shopify_product_id IS NOT NULL
        AND mp.shopify_sync_enabled = true
        AND NOT EXISTS (
          SELECT 1 FROM public.shopify_update_queue q
          WHERE q.master_product_id = mp.id
            AND q.status IN ('pending', 'processing')
        )
      RETURNING id
    )
    SELECT count(*) INTO v_queued FROM ins;
  END IF;

  DELETE FROM public.attribute_definitions WHERE id = p_source_id;

  RETURN jsonb_build_object(
    'success', true,
    'source_key', v_source.key,
    'target_key', v_target.key,
    'products_updated', v_products_updated,
    'variants_updated', v_variants_updated,
    'queued_for_shopify', v_queued
  );
END;
$$;
