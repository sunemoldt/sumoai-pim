CREATE OR REPLACE FUNCTION public.apply_low_margin_guard(p_master_product_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product RECORD;
  v_enabled_global text;
  v_threshold_global text;
  v_enabled boolean;
  v_threshold numeric;
  v_active_price numeric;
  v_active_ex numeric;
  v_min_margin numeric;
  v_safe_stock integer := 0;
  v_has_any_supplier boolean := false;
  r RECORD;
  v_supplier_qty integer;
  v_margin numeric;
  v_new_status text;
BEGIN
  SELECT id, webshop_price, sale_price, stock_quantity, stock_status,
         low_margin_guard, low_margin_threshold, auto_stock_sync,
         stock_sync_supplier_ids, min_sync_margin
  INTO v_product
  FROM public.master_products
  WHERE id = p_master_product_id;

  IF NOT FOUND THEN RETURN; END IF;

  SELECT setting_value INTO v_enabled_global
  FROM public.analytics_settings WHERE setting_key = 'low_margin_guard_enabled';
  SELECT setting_value INTO v_threshold_global
  FROM public.analytics_settings WHERE setting_key = 'low_margin_guard_threshold';

  v_enabled := CASE
    WHEN v_product.low_margin_guard = 'on' THEN true
    WHEN v_product.low_margin_guard = 'off' THEN false
    ELSE COALESCE(v_enabled_global = 'true', true)
  END;

  IF NOT v_enabled THEN RETURN; END IF;

  v_threshold := COALESCE(
    v_product.low_margin_threshold,
    NULLIF(v_threshold_global, '')::numeric,
    10
  );

  v_active_price := COALESCE(v_product.sale_price, v_product.webshop_price);
  IF v_active_price IS NULL OR v_active_price <= 0 THEN RETURN; END IF;
  v_active_ex := v_active_price / 1.25;

  -- Walk suppliers cheapest-first, accumulate units while margin holds.
  -- Only consider suppliers linked as stock-sources on this product; if none
  -- are configured, fall back to all in-stock suppliers (guard is opt-in per
  -- product via stock_sync_supplier_ids elsewhere in the app).
  FOR r IN
    SELECT sp.purchase_price, sp.stock_quantity, sp.in_stock
    FROM public.supplier_products sp
    WHERE sp.master_product_id = p_master_product_id
      AND sp.in_stock = true
      AND sp.purchase_price IS NOT NULL
      AND sp.purchase_price > 0
      AND (
        v_product.stock_sync_supplier_ids IS NULL
        OR array_length(v_product.stock_sync_supplier_ids, 1) IS NULL
        OR sp.supplier_id = ANY(v_product.stock_sync_supplier_ids)
      )
    ORDER BY sp.purchase_price ASC
  LOOP
    v_has_any_supplier := true;
    v_margin := ((v_active_ex - r.purchase_price) / v_active_ex) * 100;
    EXIT WHEN v_margin < v_threshold;

    v_supplier_qty := CASE
      WHEN r.stock_quantity IS NOT NULL THEN GREATEST(r.stock_quantity, 0)
      ELSE 1   -- supplier reports in_stock without exact qty
    END;
    v_safe_stock := v_safe_stock + v_supplier_qty;
  END LOOP;

  -- No linked in-stock supplier at all: nothing to guard against.
  IF NOT v_has_any_supplier THEN RETURN; END IF;

  -- Cap current stock to what we can profitably fulfil.
  IF v_product.stock_quantity IS NULL OR v_product.stock_quantity > v_safe_stock THEN
    v_new_status := CASE WHEN v_safe_stock > 0 THEN 'instock' ELSE 'outofstock' END;

    IF v_product.stock_quantity IS DISTINCT FROM v_safe_stock
       OR v_product.stock_status IS DISTINCT FROM v_new_status THEN
      PERFORM set_config('app.change_source', 'low-margin-guard', true);
      UPDATE public.master_products
      SET stock_quantity = v_safe_stock,
          stock_status = v_new_status,
          updated_at = now()
      WHERE id = p_master_product_id;
    END IF;
  END IF;
END;
$function$;