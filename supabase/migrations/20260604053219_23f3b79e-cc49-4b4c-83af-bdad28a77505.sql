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
  v_existing_id uuid;
BEGIN
  IF NEW.shopify_sync_enabled IS NOT TRUE OR NEW.shopify_product_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_source := coalesce(nullif(current_setting('app.change_source', true), ''), 'manual');
  IF v_source IN (
    'shopify-update-product', 'shopify-create-product', 'shopify-pull', 'shopify-import',
    'wc-import', 'wc-update-product', 'revert'
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

  v_payload := jsonb_build_object(
    'reason', 'auto-pim-edit',
    'changed_fields', v_changed_fields,
    'change_source', v_source
  );

  IF 'webshop_price' = ANY(v_changed_fields) THEN
    v_payload := v_payload || jsonb_build_object('regular_price', NEW.webshop_price);
  END IF;
  IF 'sale_price' = ANY(v_changed_fields) THEN
    v_payload := v_payload || jsonb_build_object('sale_price', NEW.sale_price);
  END IF;
  IF 'stock_quantity' = ANY(v_changed_fields) THEN
    v_payload := v_payload || jsonb_build_object('stock_quantity', NEW.stock_quantity);
  END IF;
  IF 'stock_status' = ANY(v_changed_fields) THEN
    v_payload := v_payload || jsonb_build_object('stock_status', NEW.stock_status);
  END IF;
  IF 'backorders_allowed' = ANY(v_changed_fields) THEN
    v_payload := v_payload || jsonb_build_object('backorders', CASE WHEN NEW.backorders_allowed THEN 'yes' ELSE 'no' END);
  END IF;
  IF 'ean' = ANY(v_changed_fields) AND NEW.ean IS NOT NULL AND NEW.ean NOT LIKE 'wc-%' THEN
    v_payload := v_payload || jsonb_build_object('ean', NEW.ean);
  END IF;

  SELECT id INTO v_existing_id
  FROM public.shopify_update_queue
  WHERE master_product_id = NEW.id
    AND status IN ('pending', 'processing')
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.shopify_update_queue
    SET payload = jsonb_set(
          payload || v_payload,
          '{changed_fields}',
          (
            SELECT jsonb_agg(DISTINCT value ORDER BY value)
            FROM jsonb_array_elements_text(
              COALESCE(payload->'changed_fields', '[]'::jsonb) || to_jsonb(v_changed_fields)
            ) AS fields(value)
          ),
          true
        ),
        source = 'auto-pim-edit',
        status = CASE WHEN status = 'processing' THEN status ELSE 'pending' END,
        next_attempt_at = CASE WHEN status = 'processing' THEN next_attempt_at ELSE LEAST(next_attempt_at, now()) END,
        updated_at = now()
    WHERE id = v_existing_id;
  ELSE
    INSERT INTO public.shopify_update_queue (master_product_id, payload, source, status, next_attempt_at)
    VALUES (NEW.id, v_payload, 'auto-pim-edit', 'pending', now());
  END IF;

  RETURN NEW;
END;
$function$;