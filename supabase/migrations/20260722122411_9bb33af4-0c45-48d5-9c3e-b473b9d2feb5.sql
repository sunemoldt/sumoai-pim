
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 100;
ALTER TABLE public.master_products ADD COLUMN IF NOT EXISTS stock_supplier_order_override boolean NOT NULL DEFAULT false;

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
END;
$function$;

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
  v_safe_stock integer := 0;
  v_has_any_supplier boolean := false;
  r RECORD;
  v_margin numeric;
  v_new_status text;
BEGIN
  SELECT id, webshop_price, sale_price, stock_quantity, stock_status,
         low_margin_guard, low_margin_threshold, auto_stock_sync,
         stock_sync_supplier_ids, stock_supplier_order_override
  INTO v_product
  FROM public.master_products
  WHERE id = p_master_product_id;

  IF NOT FOUND THEN RETURN; END IF;

  SELECT setting_value INTO v_enabled_global FROM public.analytics_settings WHERE setting_key = 'low_margin_guard_enabled';
  SELECT setting_value INTO v_threshold_global FROM public.analytics_settings WHERE setting_key = 'low_margin_guard_threshold';

  v_enabled := CASE
    WHEN v_product.low_margin_guard = 'on' THEN true
    WHEN v_product.low_margin_guard = 'off' THEN false
    ELSE COALESCE(v_enabled_global = 'true', true)
  END;
  IF NOT v_enabled THEN RETURN; END IF;

  IF v_product.stock_sync_supplier_ids IS NULL
     OR array_length(v_product.stock_sync_supplier_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  v_threshold := COALESCE(v_product.low_margin_threshold, NULLIF(v_threshold_global,'')::numeric, 10);
  v_active_price := COALESCE(v_product.sale_price, v_product.webshop_price);
  IF v_active_price IS NULL OR v_active_price <= 0 THEN RETURN; END IF;
  v_active_ex := v_active_price / 1.25;

  FOR r IN
    SELECT sp.purchase_price, sp.stock_quantity, sp.in_stock, sp.supplier_id,
           COALESCE(s.priority, 100) AS supplier_priority
    FROM public.supplier_products sp
    JOIN public.suppliers s ON s.id = sp.supplier_id
    WHERE sp.master_product_id = p_master_product_id
      AND sp.supplier_id = ANY(v_product.stock_sync_supplier_ids)
      AND sp.in_stock = true
      AND sp.purchase_price IS NOT NULL AND sp.purchase_price > 0
    ORDER BY
      CASE WHEN v_product.stock_supplier_order_override THEN
        array_position(v_product.stock_sync_supplier_ids, sp.supplier_id)
      END ASC NULLS LAST,
      COALESCE(s.priority, 100) ASC,
      sp.purchase_price ASC
  LOOP
    v_has_any_supplier := true;
    v_margin := ((v_active_ex - r.purchase_price) / v_active_ex) * 100;
    IF v_margin < v_threshold THEN CONTINUE; END IF;
    v_safe_stock := CASE WHEN r.stock_quantity IS NOT NULL THEN GREATEST(r.stock_quantity, 0) ELSE 1 END;
    EXIT;
  END LOOP;

  IF NOT v_has_any_supplier THEN RETURN; END IF;

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

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.master_products WHERE lifecycle_status IS DISTINCT FROM 'archived' LOOP
    PERFORM public.recompute_product_stock(r.id);
  END LOOP;
END $$;
