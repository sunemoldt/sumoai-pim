-- Helper: recompute master_products stock from supplier_products using rule:
-- 1) Sum stock from suppliers in stock_sync_supplier_ids where margin >= min_sync_margin
-- 2) If none qualify, fall back to cheapest in-stock supplier (any in stock_sync_supplier_ids)
-- 3) If no eligible suppliers / no stock_sync_supplier_ids / auto_stock_sync=false: do nothing
CREATE OR REPLACE FUNCTION public.recompute_product_stock(p_master_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  IF NOT v_product.auto_stock_sync THEN RETURN; END IF;
  IF v_product.stock_sync_supplier_ids IS NULL OR array_length(v_product.stock_sync_supplier_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  v_active_price := COALESCE(v_product.sale_price, v_product.webshop_price);
  v_min_margin := COALESCE(v_product.min_sync_margin, 15);

  -- Sum stock from margin-eligible suppliers (price ex VAT 25%)
  SELECT COALESCE(SUM(GREATEST(sp.stock_quantity, 0)), 0)::integer,
         BOOL_OR(sp.in_stock AND COALESCE(sp.stock_quantity, 0) > 0),
         COUNT(*)::integer
  INTO v_total_stock, v_any_in_stock, v_eligible_count
  FROM public.supplier_products sp
  WHERE sp.master_product_id = p_master_product_id
    AND sp.supplier_id = ANY(v_product.stock_sync_supplier_ids)
    AND (
      v_active_price IS NULL OR v_active_price = 0
      OR ((v_active_price / 1.25) - sp.purchase_price) / NULLIF(v_active_price / 1.25, 0) * 100 >= v_min_margin
    );

  -- Fallback: cheapest in-stock supplier when no margin-eligible suppliers
  IF v_eligible_count = 0 OR v_total_stock = 0 THEN
    SELECT sp.stock_quantity, sp.in_stock
    INTO v_cheapest
    FROM public.supplier_products sp
    WHERE sp.master_product_id = p_master_product_id
      AND sp.supplier_id = ANY(v_product.stock_sync_supplier_ids)
      AND sp.in_stock = true
      AND COALESCE(sp.stock_quantity, 0) > 0
    ORDER BY sp.purchase_price ASC NULLS LAST
    LIMIT 1;

    IF FOUND THEN
      v_total_stock := COALESCE(v_cheapest.stock_quantity, 0);
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
END;
$$;

-- Trigger function: when a supplier_products row changes, recompute master stock
CREATE OR REPLACE FUNCTION public.trigger_recompute_master_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_product_stock(OLD.master_product_id);
    RETURN OLD;
  END IF;
  PERFORM public.recompute_product_stock(NEW.master_product_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supplier_products_recompute_master_stock ON public.supplier_products;
CREATE TRIGGER supplier_products_recompute_master_stock
AFTER INSERT OR UPDATE OF stock_quantity, in_stock, purchase_price
   OR DELETE
ON public.supplier_products
FOR EACH ROW
EXECUTE FUNCTION public.trigger_recompute_master_stock();

-- Also recompute when auto_stock_sync or stock_sync_supplier_ids changes on the master product
CREATE OR REPLACE FUNCTION public.trigger_recompute_on_settings_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.auto_stock_sync IS DISTINCT FROM OLD.auto_stock_sync
     OR NEW.stock_sync_supplier_ids IS DISTINCT FROM OLD.stock_sync_supplier_ids
     OR NEW.min_sync_margin IS DISTINCT FROM OLD.min_sync_margin THEN
    PERFORM public.recompute_product_stock(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS master_products_settings_recompute ON public.master_products;
CREATE TRIGGER master_products_settings_recompute
AFTER UPDATE OF auto_stock_sync, stock_sync_supplier_ids, min_sync_margin
ON public.master_products
FOR EACH ROW
EXECUTE FUNCTION public.trigger_recompute_on_settings_change();

-- One-time backfill: recompute stock for all products where auto_stock_sync = true
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.master_products WHERE auto_stock_sync = true LOOP
    PERFORM public.recompute_product_stock(r.id);
  END LOOP;
END $$;