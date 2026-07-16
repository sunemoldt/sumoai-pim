CREATE OR REPLACE FUNCTION public.decrement_stock_from_shopify_order(p_master_product_id uuid, p_qty integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old integer;
  v_new integer;
  v_auto boolean;
  v_lifecycle text;
  v_own_supplier uuid;
  v_sp RECORD;
  v_sp_new integer;
BEGIN
  SELECT stock_quantity, auto_stock_sync, lifecycle_status
  INTO v_old, v_auto, v_lifecycle
  FROM public.master_products
  WHERE id = p_master_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped','not_found');
  END IF;
  IF v_lifecycle = 'draft' THEN
    RETURN jsonb_build_object('skipped','draft');
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN jsonb_build_object('skipped','invalid_qty');
  END IF;

  -- When auto stock sync is on, master stock is derived from supplier feeds.
  -- For the internal "own stock" supplier we still need to decrement here,
  -- otherwise Shopify sales silently vanish. External suppliers are managed
  -- by their own feed and remain untouched.
  IF v_auto THEN
    SELECT NULLIF(setting_value,'')::uuid INTO v_own_supplier
    FROM public.analytics_settings WHERE setting_key = 'own_stock_supplier_id';

    IF v_own_supplier IS NULL THEN
      RETURN jsonb_build_object('skipped','auto_stock_sync_managed_no_own_supplier');
    END IF;

    SELECT id, stock_quantity INTO v_sp
    FROM public.supplier_products
    WHERE master_product_id = p_master_product_id
      AND supplier_id = v_own_supplier
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('skipped','no_own_supplier_row');
    END IF;

    v_sp_new := GREATEST(COALESCE(v_sp.stock_quantity, 0) - p_qty, 0);

    PERFORM set_config('app.change_source', 'shopify-order', true);

    UPDATE public.supplier_products
    SET stock_quantity = v_sp_new,
        in_stock = (v_sp_new > 0),
        updated_at = now()
    WHERE id = v_sp.id;

    -- Trigger on supplier_products recomputes master stock automatically.
    RETURN jsonb_build_object(
      'decremented', p_qty,
      'source', 'own_supplier',
      'supplier_old', v_sp.stock_quantity,
      'supplier_new', v_sp_new
    );
  END IF;

  v_new := GREATEST(COALESCE(v_old, 0) - p_qty, 0);

  PERFORM set_config('app.change_source', 'shopify-order', true);

  UPDATE public.master_products
  SET stock_quantity = v_new,
      stock_status = CASE WHEN v_new > 0 THEN 'instock' ELSE 'outofstock' END,
      updated_at = now()
  WHERE id = p_master_product_id;

  RETURN jsonb_build_object('decremented', p_qty, 'old', v_old, 'new', v_new);
END;
$function$;