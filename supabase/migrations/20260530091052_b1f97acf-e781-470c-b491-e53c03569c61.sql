CREATE OR REPLACE FUNCTION public.auto_enqueue_shopify_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_source text;
  v_changed_fields text[] := ARRAY[]::text[];
  v_payload jsonb;
BEGIN
  IF NEW.shopify_sync_enabled IS NOT TRUE OR NEW.shopify_product_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_source := coalesce(nullif(current_setting('app.change_source', true), ''), 'manual');
  IF v_source IN (
    'shopify-update-product', 'shopify-create-product', 'shopify-pull', 'shopify-import',
    'wc-import', 'wc-update-product', 'stock-sync', 'supplier-feed', 'revert'
  ) OR v_source LIKE 'supplier:%' THEN
    RETURN NEW;
  END IF;

  IF NEW.title              IS DISTINCT FROM OLD.title              THEN v_changed_fields := array_append(v_changed_fields, 'title'); END IF;
  IF NEW.short_description  IS DISTINCT FROM OLD.short_description  THEN v_changed_fields := array_append(v_changed_fields, 'short_description'); END IF;
  IF NEW.long_description   IS DISTINCT FROM OLD.long_description   THEN v_changed_fields := array_append(v_changed_fields, 'long_description'); END IF;
  IF NEW.meta_title         IS DISTINCT FROM OLD.meta_title         THEN v_changed_fields := array_append(v_changed_fields, 'meta_title'); END IF;
  IF NEW.meta_description   IS DISTINCT FROM OLD.meta_description   THEN v_changed_fields := array_append(v_changed_fields, 'meta_description'); END IF;
  IF NEW.webshop_price      IS DISTINCT FROM OLD.webshop_price      THEN v_changed_fields := array_append(v_changed_fields, 'webshop_price'); END IF;
  IF NEW.sale_price         IS DISTINCT FROM OLD.sale_price         THEN v_changed_fields := array_append(v_changed_fields, 'sale_price'); END IF;
  IF NEW.stock_quantity     IS DISTINCT FROM OLD.stock_quantity     THEN v_changed_fields := array_append(v_changed_fields, 'stock_quantity'); END IF;
  IF NEW.stock_status       IS DISTINCT FROM OLD.stock_status       THEN v_changed_fields := array_append(v_changed_fields, 'stock_status'); END IF;
  IF NEW.backorders_allowed IS DISTINCT FROM OLD.backorders_allowed THEN v_changed_fields := array_append(v_changed_fields, 'backorders_allowed'); END IF;
  IF NEW.image_url          IS DISTINCT FROM OLD.image_url          THEN v_changed_fields := array_append(v_changed_fields, 'image_url'); END IF;
  IF NEW.brand              IS DISTINCT FROM OLD.brand              THEN v_changed_fields := array_append(v_changed_fields, 'brand'); END IF;
  IF NEW.category           IS DISTINCT FROM OLD.category           THEN v_changed_fields := array_append(v_changed_fields, 'category'); END IF;
  IF NEW.ean                IS DISTINCT FROM OLD.ean                THEN v_changed_fields := array_append(v_changed_fields, 'ean'); END IF;

  IF array_length(v_changed_fields, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.shopify_update_queue
    WHERE master_product_id = NEW.id
      AND status IN ('pending', 'processing')
  ) THEN
    RETURN NEW;
  END IF;

  v_payload := jsonb_build_object('reason', 'auto-pim-edit', 'changed_fields', v_changed_fields, 'change_source', v_source);
  -- Embed ean explicitly so update-product pushes barcode (otherwise it only pushes when caller overrode)
  IF 'ean' = ANY(v_changed_fields) AND NEW.ean IS NOT NULL AND NEW.ean NOT LIKE 'wc-%' THEN
    v_payload := v_payload || jsonb_build_object('ean', NEW.ean);
  END IF;

  INSERT INTO public.shopify_update_queue (master_product_id, payload, source, status, next_attempt_at)
  VALUES (NEW.id, v_payload, 'auto-pim-edit', 'pending', now());

  RETURN NEW;
END;
$function$;