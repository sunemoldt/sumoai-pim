
-- Trigger that appends the own-stock supplier to stock_sync_supplier_ids on new products
CREATE OR REPLACE FUNCTION public.attach_own_stock_supplier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_own uuid;
BEGIN
  SELECT NULLIF(setting_value, '')::uuid INTO v_own
  FROM public.analytics_settings
  WHERE setting_key = 'own_stock_supplier_id';

  IF v_own IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.stock_sync_supplier_ids IS NULL THEN
    NEW.stock_sync_supplier_ids := ARRAY[v_own];
  ELSIF NOT (v_own = ANY(NEW.stock_sync_supplier_ids)) THEN
    NEW.stock_sync_supplier_ids := NEW.stock_sync_supplier_ids || v_own;
  END IF;

  IF NEW.auto_stock_sync IS DISTINCT FROM true THEN
    NEW.auto_stock_sync := true;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attach_own_stock_supplier ON public.master_products;
CREATE TRIGGER trg_attach_own_stock_supplier
BEFORE INSERT ON public.master_products
FOR EACH ROW
EXECUTE FUNCTION public.attach_own_stock_supplier();
