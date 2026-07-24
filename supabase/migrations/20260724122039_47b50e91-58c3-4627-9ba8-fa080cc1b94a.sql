
CREATE OR REPLACE FUNCTION public.raise_margin_blocked_alert(p_master_product_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
         auto_stock_sync, stock_sync_supplier_ids, min_sync_margin, lifecycle_status,
         low_margin_guard
  INTO v_product
  FROM public.master_products
  WHERE id = p_master_product_id;

  IF NOT FOUND THEN RETURN; END IF;
  IF v_product.lifecycle_status = 'archived' THEN RETURN; END IF;
  IF v_product.low_margin_guard = 'off' THEN RETURN; END IF;
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
$function$;

-- Auto-resolve currently open low_margin / margin_blocked alerts for products
-- where the guard is now forced off.
UPDATE public.price_alerts pa
SET resolved_at = now()
FROM public.master_products mp
WHERE pa.master_product_id = mp.id
  AND pa.resolved_at IS NULL
  AND mp.low_margin_guard = 'off'
  AND pa.severity IN ('low_margin', 'margin_blocked');
