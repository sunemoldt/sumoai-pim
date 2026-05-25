
-- Low-margin guard: force stock to 0 when margin falls below threshold
-- Defaults: enabled globally with 10% threshold. Per-product override possible.

ALTER TABLE public.master_products
  ADD COLUMN IF NOT EXISTS low_margin_guard text NOT NULL DEFAULT 'inherit'
    CHECK (low_margin_guard IN ('inherit', 'on', 'off')),
  ADD COLUMN IF NOT EXISTS low_margin_threshold numeric;

INSERT INTO public.analytics_settings (setting_key, setting_value)
VALUES
  ('low_margin_guard_enabled', 'true'),
  ('low_margin_guard_threshold', '10')
ON CONFLICT (setting_key) DO NOTHING;

-- Guard function: force out-of-stock when margin < threshold (incl-VAT price → ex-VAT vs cheapest in-stock supplier)
CREATE OR REPLACE FUNCTION public.apply_low_margin_guard(p_master_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product RECORD;
  v_enabled_global text;
  v_threshold_global text;
  v_enabled boolean;
  v_threshold numeric;
  v_active_price numeric;
  v_active_ex numeric;
  v_cheapest_purchase numeric;
  v_margin numeric;
BEGIN
  SELECT id, webshop_price, sale_price, stock_quantity, stock_status,
         low_margin_guard, low_margin_threshold
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

  SELECT MIN(purchase_price) INTO v_cheapest_purchase
  FROM public.supplier_products
  WHERE master_product_id = p_master_product_id
    AND in_stock = true
    AND purchase_price > 0;

  -- No in-stock supplier: nothing to guard against
  IF v_cheapest_purchase IS NULL THEN RETURN; END IF;

  v_margin := ((v_active_ex - v_cheapest_purchase) / v_active_ex) * 100;

  IF v_margin < v_threshold THEN
    IF v_product.stock_quantity IS DISTINCT FROM 0
       OR v_product.stock_status IS DISTINCT FROM 'outofstock' THEN
      PERFORM set_config('app.change_source', 'low-margin-guard', true);
      UPDATE public.master_products
      SET stock_quantity = 0,
          stock_status = 'outofstock',
          updated_at = now()
      WHERE id = p_master_product_id;
    END IF;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_low_margin_guard(uuid) FROM anon;

-- Extend recompute_product_stock so guard runs at the end of every recompute
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
  END IF;

  -- Always apply low-margin guard (works regardless of auto_stock_sync)
  PERFORM public.apply_low_margin_guard(p_master_product_id);
END;
$function$;

-- Trigger on supplier_products already calls recompute_product_stock for auto-sync products,
-- but we also want the guard to run when a supplier price drops on NON auto-sync products.
CREATE OR REPLACE FUNCTION public.trigger_apply_guard_supplier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF coalesce(nullif(current_setting('app.bulk_supplier_import', true), ''), 'false') = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.master_product_id ELSE NEW.master_product_id END;
  PERFORM public.apply_low_margin_guard(v_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trigger_apply_guard_supplier() FROM anon;

DROP TRIGGER IF EXISTS apply_low_margin_guard_supplier ON public.supplier_products;
CREATE TRIGGER apply_low_margin_guard_supplier
AFTER INSERT OR UPDATE OF purchase_price, in_stock OR DELETE ON public.supplier_products
FOR EACH ROW EXECUTE FUNCTION public.trigger_apply_guard_supplier();

-- Trigger on master_products: re-run guard when price or override changes
CREATE OR REPLACE FUNCTION public.trigger_apply_guard_master()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.webshop_price IS DISTINCT FROM OLD.webshop_price
     OR NEW.sale_price IS DISTINCT FROM OLD.sale_price
     OR NEW.low_margin_guard IS DISTINCT FROM OLD.low_margin_guard
     OR NEW.low_margin_threshold IS DISTINCT FROM OLD.low_margin_threshold THEN
    PERFORM public.apply_low_margin_guard(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trigger_apply_guard_master() FROM anon;

DROP TRIGGER IF EXISTS apply_low_margin_guard_master ON public.master_products;
CREATE TRIGGER apply_low_margin_guard_master
AFTER UPDATE ON public.master_products
FOR EACH ROW EXECUTE FUNCTION public.trigger_apply_guard_master();
