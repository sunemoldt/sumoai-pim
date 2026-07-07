CREATE OR REPLACE FUNCTION public.prevent_below_purchase_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active_price numeric;
  v_active_ex_vat numeric;
  v_cheapest_purchase numeric;
BEGIN
  -- Only validate when the active selling price can change.
  IF TG_OP = 'UPDATE'
     AND NEW.webshop_price IS NOT DISTINCT FROM OLD.webshop_price
     AND NEW.sale_price IS NOT DISTINCT FROM OLD.sale_price THEN
    RETURN NEW;
  END IF;

  -- PIM prices are incl. VAT; supplier purchase prices are excl. VAT.
  v_active_price := CASE
    WHEN NEW.sale_price IS NOT NULL
         AND NEW.sale_price > 0
         AND (NEW.webshop_price IS NULL OR NEW.sale_price < NEW.webshop_price)
      THEN NEW.sale_price
    ELSE NEW.webshop_price
  END;

  IF v_active_price IS NULL OR v_active_price <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT min(sp.purchase_price)
    INTO v_cheapest_purchase
  FROM public.supplier_products sp
  WHERE sp.master_product_id = NEW.id
    AND sp.purchase_price IS NOT NULL
    AND sp.purchase_price > 0
    AND sp.in_stock = true
    AND (sp.stock_quantity IS NULL OR sp.stock_quantity > 0);

  IF v_cheapest_purchase IS NULL THEN
    SELECT min(sp.purchase_price)
      INTO v_cheapest_purchase
    FROM public.supplier_products sp
    WHERE sp.master_product_id = NEW.id
      AND sp.purchase_price IS NOT NULL
      AND sp.purchase_price > 0;
  END IF;

  IF v_cheapest_purchase IS NULL THEN
    RETURN NEW;
  END IF;

  v_active_ex_vat := v_active_price / 1.25;
  IF v_active_ex_vat + 0.005 < v_cheapest_purchase THEN
    RAISE EXCEPTION 'Aktiv salgspris % kr inkl. moms er under indkøb % kr ekskl. moms',
      round(v_active_price, 2), round(v_cheapest_purchase, 2)
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_below_purchase_price ON public.master_products;
CREATE TRIGGER trg_prevent_below_purchase_price
BEFORE INSERT OR UPDATE OF webshop_price, sale_price ON public.master_products
FOR EACH ROW
EXECUTE FUNCTION public.prevent_below_purchase_price();