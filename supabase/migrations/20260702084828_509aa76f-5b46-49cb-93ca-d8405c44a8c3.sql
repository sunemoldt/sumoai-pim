CREATE OR REPLACE FUNCTION public.recompute_product_stock(p_master_product_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product RECORD;
  v_active_price numeric;
  v_min_margin numeric;
  v_total_stock integer := 0;
  v_any_in_stock boolean := false;
  v_eligible_count integer := 0;
  v_cheapest RECORD;
  v_new_status text;
BEGIN
  SELECT id, auto_stock_sync, stock_sync_supplier_ids, min_sync_margin,
         webshop_price, sale_price, stock_quantity, stock_status
  INTO v_product
  FROM public.master_products
  WHERE id = p_master_product_id;

  IF NOT FOUND THEN RETURN; END IF;

  IF v_product.auto_stock_sync
     AND v_product.stock_sync_supplier_ids IS NOT NULL
     AND array_length(v_product.stock_sync_supplier_ids, 1) IS NOT NULL THEN

    v_active_price := COALESCE(v_product.sale_price, v_product.webshop_price);
    v_min_margin := COALESCE(v_product.min_sync_margin, 15);

    -- Treat in_stock=true with NULL quantity as "at least 1" (some suppliers
    -- like SecPro don't report exact stock numbers).
    SELECT COALESCE(SUM(
             CASE
               WHEN sp.stock_quantity IS NOT NULL THEN GREATEST(sp.stock_quantity, 0)
               WHEN sp.in_stock THEN 1
               ELSE 0
             END
           ), 0)::integer,
           BOOL_OR(sp.in_stock AND (sp.stock_quantity IS NULL OR sp.stock_quantity > 0)),
           COUNT(*)::integer
    INTO v_total_stock, v_any_in_stock, v_eligible_count
    FROM public.supplier_products sp
    WHERE sp.master_product_id = p_master_product_id
      AND sp.supplier_id = ANY(v_product.stock_sync_supplier_ids)
      AND (
        v_active_price IS NULL OR v_active_price = 0
        OR ((v_active_price / 1.25) - sp.purchase_price) / NULLIF(v_active_price / 1.25, 0) * 100 >= v_min_margin
      );

    IF v_eligible_count = 0 OR v_total_stock = 0 THEN
      SELECT sp.stock_quantity, sp.in_stock
      INTO v_cheapest
      FROM public.supplier_products sp
      WHERE sp.master_product_id = p_master_product_id
        AND sp.supplier_id = ANY(v_product.stock_sync_supplier_ids)
        AND sp.in_stock = true
        AND (sp.stock_quantity IS NULL OR sp.stock_quantity > 0)
      ORDER BY sp.purchase_price ASC NULLS LAST
      LIMIT 1;

      IF FOUND THEN
        v_total_stock := COALESCE(v_cheapest.stock_quantity, 1);
        v_any_in_stock := true;
      ELSE
        v_total_stock := 0;
        v_any_in_stock := false;
      END IF;
    END IF;

    v_new_status := CASE WHEN v_any_in_stock AND v_total_stock > 0 THEN 'instock' ELSE 'outofstock' END;

    IF v_product.stock_quantity IS DISTINCT FROM v_total_stock
       OR v_product.stock_status IS DISTINCT FROM v_new_status THEN
      PERFORM set_config('app.change_source', 'stock-sync', true);
      UPDATE public.master_products
      SET stock_quantity = v_total_stock,
          stock_status = v_new_status,
          updated_at = now()
      WHERE id = p_master_product_id;
    END IF;
  END IF;

  PERFORM public.apply_low_margin_guard(p_master_product_id);
END;
$function$;