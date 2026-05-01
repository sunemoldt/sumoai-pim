-- Skip per-row recompute when bulk flag is set
CREATE OR REPLACE FUNCTION public.trigger_recompute_master_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(nullif(current_setting('app.bulk_supplier_import', true), ''), 'false') = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_product_stock(OLD.master_product_id);
    RETURN OLD;
  END IF;
  PERFORM public.recompute_product_stock(NEW.master_product_id);
  RETURN NEW;
END;
$$;

-- Batch recompute for all products linked to a supplier
CREATE OR REPLACE FUNCTION public.recompute_stock_for_supplier(p_supplier_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  cnt integer := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT mp.id
    FROM public.master_products mp
    JOIN public.supplier_products sp ON sp.master_product_id = mp.id
    WHERE mp.auto_stock_sync = true
      AND p_supplier_id = ANY(mp.stock_sync_supplier_ids)
      AND sp.supplier_id = p_supplier_id
  LOOP
    PERFORM public.recompute_product_stock(r.id);
    cnt := cnt + 1;
  END LOOP;
  RETURN cnt;
END;
$$;

-- Helper to toggle bulk mode from edge functions
CREATE OR REPLACE FUNCTION public.set_bulk_supplier_import(enabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.bulk_supplier_import', CASE WHEN enabled THEN 'true' ELSE 'false' END, false);
END;
$$;