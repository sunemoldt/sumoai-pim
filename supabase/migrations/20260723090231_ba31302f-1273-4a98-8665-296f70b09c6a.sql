
CREATE OR REPLACE FUNCTION public.raise_margin_blocked_alert(p_master_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product RECORD;
  v_active_inc numeric;
  v_active_ex numeric;
  v_min_margin numeric;
  v_global_min text;
  v_cheapest_selected numeric;
  v_any_selected_in_stock boolean;
  v_any_passes boolean;
  v_existing uuid;
BEGIN
  SELECT id, title, sku, shopify_variant_id, stock_quantity, sale_price, webshop_price,
         auto_stock_sync, stock_sync_supplier_ids, min_sync_margin, lifecycle_status
  INTO v_product
  FROM public.master_products
  WHERE id = p_master_product_id;

  IF NOT FOUND THEN RETURN; END IF;
  IF v_product.lifecycle_status = 'archived' THEN RETURN; END IF;
  IF NOT v_product.auto_stock_sync THEN RETURN; END IF;
  IF v_product.stock_sync_supplier_ids IS NULL
     OR array_length(v_product.stock_sync_supplier_ids, 1) IS NULL THEN RETURN; END IF;
  IF COALESCE(v_product.stock_quantity, 0) > 0 THEN RETURN; END IF;

  v_active_inc := COALESCE(v_product.sale_price, v_product.webshop_price);
  IF v_active_inc IS NULL OR v_active_inc <= 0 THEN RETURN; END IF;
  v_active_ex := v_active_inc / 1.25;

  SELECT setting_value INTO v_global_min FROM public.analytics_settings WHERE setting_key = 'min_sync_margin_default';
  v_min_margin := COALESCE(v_product.min_sync_margin, NULLIF(v_global_min,'')::numeric, 15);

  SELECT bool_or(true), min(sp.purchase_price),
         bool_or(((v_active_ex - sp.purchase_price) / v_active_ex) * 100 >= v_min_margin)
  INTO v_any_selected_in_stock, v_cheapest_selected, v_any_passes
  FROM public.supplier_products sp
  WHERE sp.master_product_id = p_master_product_id
    AND sp.supplier_id = ANY(v_product.stock_sync_supplier_ids)
    AND sp.in_stock = true
    AND (sp.stock_quantity IS NULL OR sp.stock_quantity > 0)
    AND sp.purchase_price IS NOT NULL AND sp.purchase_price > 0;

  IF v_any_selected_in_stock IS NOT TRUE THEN RETURN; END IF;
  IF v_any_passes IS TRUE THEN RETURN; END IF;
  IF v_cheapest_selected IS NULL THEN RETURN; END IF;

  SELECT id INTO v_existing FROM public.price_alerts
  WHERE master_product_id = p_master_product_id AND resolved_at IS NULL
  LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN; END IF;

  INSERT INTO public.price_alerts (
    master_product_id, shopify_price, shopify_compare_at_price,
    cheapest_purchase_price, margin_pct, severity, source, details
  ) VALUES (
    p_master_product_id, v_active_inc, NULL,
    v_cheapest_selected,
    round(((v_active_ex - v_cheapest_selected) / v_active_ex) * 100, 2),
    'margin_blocked', 'recompute-stock',
    jsonb_build_object(
      'title', v_product.title,
      'sku', v_product.sku,
      'shopify_variant_id', v_product.shopify_variant_id,
      'min_sync_margin_pct', v_min_margin,
      'reason', 'Salg stoppet automatisk fordi margin er under min_sync_margin'
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.raise_margin_blocked_alert(uuid) FROM anon;

CREATE OR REPLACE FUNCTION public.recompute_product_stock(p_master_product_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product RECORD;
  v_active_price numeric;
  v_active_ex numeric;
  v_min_margin numeric;
  v_global_default text;
  v_new_stock integer := 0;
  v_new_status text := 'outofstock';
  r RECORD;
BEGIN
  SELECT id, auto_stock_sync, stock_sync_supplier_ids, min_sync_margin,
         webshop_price, sale_price, stock_quantity, stock_status,
         stock_supplier_order_override
  INTO v_product
  FROM public.master_products
  WHERE id = p_master_product_id;

  IF NOT FOUND THEN RETURN; END IF;
  IF NOT v_product.auto_stock_sync THEN
    PERFORM public.apply_low_margin_guard(p_master_product_id);
    PERFORM public.raise_margin_blocked_alert(p_master_product_id);
    RETURN;
  END IF;

  IF v_product.stock_sync_supplier_ids IS NULL
     OR array_length(v_product.stock_sync_supplier_ids, 1) IS NULL THEN
    IF v_product.stock_quantity IS DISTINCT FROM 0
       OR v_product.stock_status IS DISTINCT FROM 'outofstock' THEN
      PERFORM set_config('app.change_source', 'stock-sync', true);
      UPDATE public.master_products
      SET stock_quantity = 0, stock_status = 'outofstock', updated_at = now()
      WHERE id = p_master_product_id;
    END IF;
    PERFORM public.apply_low_margin_guard(p_master_product_id);
    RETURN;
  END IF;

  v_active_price := COALESCE(v_product.sale_price, v_product.webshop_price);
  v_active_ex := CASE WHEN v_active_price IS NULL OR v_active_price = 0 THEN NULL ELSE v_active_price / 1.25 END;

  SELECT setting_value INTO v_global_default
  FROM public.analytics_settings WHERE setting_key = 'min_sync_margin_default';
  v_min_margin := COALESCE(v_product.min_sync_margin, NULLIF(v_global_default,'')::numeric, 15);

  FOR r IN
    SELECT sp.purchase_price, sp.stock_quantity, sp.in_stock, sp.supplier_id,
           COALESCE(s.priority, 100) AS supplier_priority,
           array_position(v_product.stock_sync_supplier_ids, sp.supplier_id) AS override_pos
    FROM public.supplier_products sp
    JOIN public.suppliers s ON s.id = sp.supplier_id
    WHERE sp.master_product_id = p_master_product_id
      AND sp.supplier_id = ANY(v_product.stock_sync_supplier_ids)
      AND sp.in_stock = true
      AND (sp.stock_quantity IS NULL OR sp.stock_quantity > 0)
    ORDER BY
      CASE WHEN v_product.stock_supplier_order_override THEN
        array_position(v_product.stock_sync_supplier_ids, sp.supplier_id)
      END ASC NULLS LAST,
      COALESCE(s.priority, 100) ASC,
      sp.purchase_price ASC NULLS LAST
  LOOP
    IF v_active_ex IS NOT NULL AND r.purchase_price IS NOT NULL AND r.purchase_price > 0 THEN
      IF ((v_active_ex - r.purchase_price) / v_active_ex) * 100 < v_min_margin THEN
        CONTINUE;
      END IF;
    END IF;
    v_new_stock := CASE WHEN r.stock_quantity IS NOT NULL THEN GREATEST(r.stock_quantity, 0) ELSE 1 END;
    v_new_status := 'instock';
    EXIT;
  END LOOP;

  IF v_product.stock_quantity IS DISTINCT FROM v_new_stock
     OR v_product.stock_status IS DISTINCT FROM v_new_status THEN
    PERFORM set_config('app.change_source', 'stock-sync', true);
    UPDATE public.master_products
    SET stock_quantity = v_new_stock,
        stock_status = v_new_status,
        updated_at = now()
    WHERE id = p_master_product_id;
  END IF;

  PERFORM public.apply_low_margin_guard(p_master_product_id);
  PERFORM public.raise_margin_blocked_alert(p_master_product_id);
END;
$function$;
