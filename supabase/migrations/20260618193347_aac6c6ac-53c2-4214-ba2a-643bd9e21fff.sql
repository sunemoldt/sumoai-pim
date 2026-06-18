
CREATE OR REPLACE FUNCTION public.auto_push_wc_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_source text;
  v_enabled text;
  v_changed boolean := false;
BEGIN
  -- Only WooCommerce-tied products
  IF NEW.webshop_platform IS DISTINCT FROM 'woocommerce'
     OR NEW.webshop_product_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Avoid loops from inbound WC syncs / reverts / order webhooks
  v_source := coalesce(nullif(current_setting('app.change_source', true), ''), 'manual');
  IF v_source IN ('wc-update-product', 'wc-import', 'revert', 'shopify-order',
                  'shopify-update-product', 'shopify-pull', 'shopify-import') THEN
    RETURN NEW;
  END IF;

  -- Respect global WooCommerce toggle
  SELECT setting_value INTO v_enabled
  FROM public.analytics_settings
  WHERE setting_key = 'woocommerce_enabled';
  IF coalesce(v_enabled, 'false') <> 'true' THEN
    RETURN NEW;
  END IF;

  -- Trigger only on the fields that actually move stock/price downstream
  IF NEW.stock_quantity     IS DISTINCT FROM OLD.stock_quantity
  OR NEW.stock_status       IS DISTINCT FROM OLD.stock_status
  OR NEW.webshop_price      IS DISTINCT FROM OLD.webshop_price
  OR NEW.sale_price         IS DISTINCT FROM OLD.sale_price
  OR NEW.backorder_policy   IS DISTINCT FROM OLD.backorder_policy
  OR NEW.backorders_allowed IS DISTINCT FROM OLD.backorders_allowed THEN
    v_changed := true;
  END IF;

  IF NOT v_changed THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://qanxmacwntyxfhznxriz.supabase.co/functions/v1/wc-update-product',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhbnhtYWN3bnR5eGZoem54cml6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5Njg4NTMsImV4cCI6MjA5MDU0NDg1M30.IzMFm6WSjjGtGCwDoxGmDQ_SRQ4WZu_9Ofqt5TLsyNI","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhbnhtYWN3bnR5eGZoem54cml6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5Njg4NTMsImV4cCI6MjA5MDU0NDg1M30.IzMFm6WSjjGtGCwDoxGmDQ_SRQ4WZu_9Ofqt5TLsyNI"}'::jsonb,
    body := jsonb_build_object(
      'master_product_id', NEW.id,
      'use_db_values', true,
      'source', 'auto-pim-edit'
    )
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_auto_push_wc_update ON public.master_products;
CREATE TRIGGER trg_auto_push_wc_update
AFTER UPDATE ON public.master_products
FOR EACH ROW
EXECUTE FUNCTION public.auto_push_wc_update();
