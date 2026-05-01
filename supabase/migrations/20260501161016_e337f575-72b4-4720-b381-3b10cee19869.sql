-- Revert a single change log entry by restoring old_value to the field on master_products.
-- Handles type casting for known column types. Logs a new change entry with source='revert'.

CREATE OR REPLACE FUNCTION public.revert_change_log_entry(p_log_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_log RECORD;
  v_sql text;
  v_allowed_text text[] := ARRAY[
    'title','image_url','brand','category','sku',
    'short_description','long_description','meta_title','meta_description',
    'stock_status','webshop_platform','webshop_product_id','webshop_parent_id',
    'stock_sync_interval'
  ];
  v_allowed_numeric text[] := ARRAY[
    'webshop_price','sale_price','custom_markup_percentage','min_sync_margin'
  ];
  v_allowed_int text[] := ARRAY['stock_quantity'];
  v_allowed_bool text[] := ARRAY['auto_stock_sync','shopify_sync_enabled','backorders_allowed'];
  v_allowed_jsonb text[] := ARRAY['attributes'];
  v_allowed_text_array text[] := ARRAY['categories'];
  v_allowed_uuid_array text[] := ARRAY['stock_sync_supplier_ids'];
  v_field text;
BEGIN
  SELECT * INTO v_log FROM public.product_change_log WHERE id = p_log_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Change log entry not found';
  END IF;

  v_field := v_log.field_name;

  -- Mark this update as a revert in the audit log
  PERFORM set_config('app.change_source', 'revert', true);

  IF v_field = ANY(v_allowed_text) THEN
    v_sql := format('UPDATE public.master_products SET %I = $1, updated_at = now() WHERE id = $2', v_field);
    EXECUTE v_sql USING v_log.old_value, v_log.master_product_id;

  ELSIF v_field = ANY(v_allowed_numeric) THEN
    v_sql := format('UPDATE public.master_products SET %I = $1::numeric, updated_at = now() WHERE id = $2', v_field);
    EXECUTE v_sql USING v_log.old_value, v_log.master_product_id;

  ELSIF v_field = ANY(v_allowed_int) THEN
    v_sql := format('UPDATE public.master_products SET %I = $1::integer, updated_at = now() WHERE id = $2', v_field);
    EXECUTE v_sql USING v_log.old_value, v_log.master_product_id;

  ELSIF v_field = ANY(v_allowed_bool) THEN
    v_sql := format('UPDATE public.master_products SET %I = $1::boolean, updated_at = now() WHERE id = $2', v_field);
    EXECUTE v_sql USING v_log.old_value, v_log.master_product_id;

  ELSIF v_field = ANY(v_allowed_jsonb) THEN
    v_sql := format('UPDATE public.master_products SET %I = COALESCE($1::jsonb, ''{}''::jsonb), updated_at = now() WHERE id = $2', v_field);
    EXECUTE v_sql USING v_log.old_value, v_log.master_product_id;

  ELSIF v_field = ANY(v_allowed_text_array) THEN
    -- old_value stored as text representation of array, e.g. {a,b}
    v_sql := format('UPDATE public.master_products SET %I = COALESCE($1::text[], ''{}''::text[]), updated_at = now() WHERE id = $2', v_field);
    EXECUTE v_sql USING v_log.old_value, v_log.master_product_id;

  ELSIF v_field = ANY(v_allowed_uuid_array) THEN
    v_sql := format('UPDATE public.master_products SET %I = COALESCE($1::uuid[], ''{}''::uuid[]), updated_at = now() WHERE id = $2', v_field);
    EXECUTE v_sql USING v_log.old_value, v_log.master_product_id;

  ELSE
    RAISE EXCEPTION 'Field % cannot be reverted', v_field;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'master_product_id', v_log.master_product_id,
    'field', v_field,
    'restored_value', v_log.old_value
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.revert_change_log_entry(uuid) TO authenticated;