
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
  v_min_global text;
  v_enabled boolean;
  v_threshold numeric;
  v_min_margin numeric;
  v_effective numeric;
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
         stock_sync_supplier_ids, stock_supplier_order_override, min_sync_margin
  INTO v_product
  FROM public.master_products
  WHERE id = p_master_product_id;

  IF NOT FOUND THEN RETURN; END IF;

  SELECT setting_value INTO v_enabled_global FROM public.analytics_settings WHERE setting_key = 'low_margin_guard_enabled';
  SELECT setting_value INTO v_threshold_global FROM public.analytics_settings WHERE setting_key = 'low_margin_guard_threshold';
  SELECT setting_value INTO v_min_global FROM public.analytics_settings WHERE setting_key = 'min_sync_margin_default';

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
  v_min_margin := COALESCE(v_product.min_sync_margin, NULLIF(v_min_global,'')::numeric, 15);
  -- Guard must never be *looser* than the stock-sync margin rule, otherwise it
  -- would cap master stock to a lower-margin supplier that recompute rejected.
  v_effective := GREATEST(v_threshold, v_min_margin);

  v_active_price := COALESCE(v_product.sale_price, v_product.webshop_price);
  IF v_active_price IS NULL OR v_active_price <= 0 THEN RETURN; END IF;
  v_active_ex := v_active_price / 1.25;

  FOR r IN
    SELECT sp.purchase_price, sp.stock_quantity, sp.supplier_id
    FROM public.supplier_products sp
    JOIN public.suppliers s ON s.id = sp.supplier_id
    WHERE sp.master_product_id = p_master_product_id
      AND sp.supplier_id = ANY(v_product.stock_sync_supplier_ids)
      AND sp.in_stock = true
      -- Same candidate filter as recompute_product_stock: a supplier flagged
      -- in stock but with quantity 0 is NOT a valid source.
      AND (sp.stock_quantity IS NULL OR sp.stock_quantity > 0)
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
    IF v_margin < v_effective THEN CONTINUE; END IF;
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

REVOKE EXECUTE ON FUNCTION public.apply_low_margin_guard(uuid) FROM anon;

-- Housekeeping: close stale "running" import logs left over from May 2026.
UPDATE public.import_logs
SET status = 'failed',
    completed_at = now(),
    errors = COALESCE(errors, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('message','Stale running log closed by drift audit'))
WHERE status = 'running' AND started_at < now() - interval '24 hours';

-- Resolve alerts on products where the low-margin guard is explicitly forced off.
UPDATE public.price_alerts pa
SET resolved_at = now(),
    resolution_note = 'Auto-lukket: lav-margin-regel er slået fra for produktet'
FROM public.master_products mp
WHERE mp.id = pa.master_product_id
  AND pa.resolved_at IS NULL
  AND mp.low_margin_guard = 'off';

-- Re-run stock recomputation for every auto-synced product so the corrected
-- guard takes effect immediately.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.master_products
           WHERE auto_stock_sync AND lifecycle_status IS DISTINCT FROM 'archived'
  LOOP
    PERFORM public.recompute_product_stock(r.id);
  END LOOP;
END $$;
