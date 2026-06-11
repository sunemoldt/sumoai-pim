-- Add weight and backorder_policy fields
ALTER TABLE public.master_products
  ADD COLUMN IF NOT EXISTS weight_kg numeric,
  ADD COLUMN IF NOT EXISTS backorder_policy text NOT NULL DEFAULT 'no';

ALTER TABLE public.supplier_products
  ADD COLUMN IF NOT EXISTS weight_kg numeric;

ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS weight_kg numeric;

-- Constrain values
ALTER TABLE public.master_products
  DROP CONSTRAINT IF EXISTS master_products_backorder_policy_check;
ALTER TABLE public.master_products
  ADD CONSTRAINT master_products_backorder_policy_check
  CHECK (backorder_policy IN ('no','yes','notify'));

-- Backfill from existing backorders_allowed boolean
UPDATE public.master_products
SET backorder_policy = CASE WHEN backorders_allowed THEN 'yes' ELSE 'no' END
WHERE backorder_policy = 'no';

-- Keep backorders_allowed mirrored from backorder_policy via trigger
CREATE OR REPLACE FUNCTION public.sync_backorders_allowed_from_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  NEW.backorders_allowed := (NEW.backorder_policy = 'yes');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_backorders_allowed ON public.master_products;
CREATE TRIGGER trg_sync_backorders_allowed
BEFORE INSERT OR UPDATE OF backorder_policy ON public.master_products
FOR EACH ROW EXECUTE FUNCTION public.sync_backorders_allowed_from_policy();

-- Update auto_enqueue_shopify_update to also enqueue on weight_kg / backorder_policy changes
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
    'wc-import', 'wc-update-product', 'revert', 'shopify-order'
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
  IF NEW.backorder_policy   IS DISTINCT FROM OLD.backorder_policy   THEN v_changed_fields := array_append(v_changed_fields, 'backorder_policy'); END IF;
  IF NEW.weight_kg          IS DISTINCT FROM OLD.weight_kg          THEN v_changed_fields := array_append(v_changed_fields, 'weight_kg'); END IF;
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
  IF 'backorders_allowed' = ANY(v_changed_fields) OR 'backorder_policy' = ANY(v_changed_fields) THEN
    v_payload := v_payload || jsonb_build_object('backorder_policy', NEW.backorder_policy);
  END IF;
  IF 'weight_kg' = ANY(v_changed_fields) THEN
    v_payload := v_payload || jsonb_build_object('weight_kg', NEW.weight_kg);
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

-- Extend revert whitelist
CREATE OR REPLACE FUNCTION public.revert_change_log_entry(p_log_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_log RECORD;
  v_sql text;
  v_allowed_text text[] := ARRAY[
    'title','image_url','brand','category','sku',
    'short_description','long_description','meta_title','meta_description',
    'stock_status','webshop_platform','webshop_product_id','webshop_parent_id',
    'stock_sync_interval','backorder_policy'
  ];
  v_allowed_numeric text[] := ARRAY[
    'webshop_price','sale_price','custom_markup_percentage','min_sync_margin','weight_kg'
  ];
  v_allowed_int text[] := ARRAY['stock_quantity'];
  v_allowed_bool text[] := ARRAY['auto_stock_sync','shopify_sync_enabled','backorders_allowed'];
  v_allowed_jsonb text[] := ARRAY['attributes'];
  v_allowed_text_array text[] := ARRAY['categories'];
  v_allowed_uuid_array text[] := ARRAY['stock_sync_supplier_ids'];
  v_field text;
BEGIN
  SELECT * INTO v_log FROM public.product_change_log WHERE id = p_log_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Change log entry not found'; END IF;
  v_field := v_log.field_name;
  PERFORM set_config('app.change_source', 'revert', true);

  IF v_field = ANY(v_allowed_text) THEN
    v_sql := format('UPDATE public.master_products SET %I = $1, updated_at = now() WHERE id = $2', v_field);
    EXECUTE v_sql USING v_log.old_value, v_log.master_product_id;
  ELSIF v_field = ANY(v_allowed_numeric) THEN
    v_sql := format('UPDATE public.master_products SET %I = $1::numeric, updated_at = now() WHERE id = $2', v_field);
    EXECUTE v_sql USING v_log.old_value, v_log.master_product_id;
  ELSIF v_field = ANY(v_allowed_int) THEN
    v_sql := format('UPDATE public.master_products SET %I = $1::integer, updated_at = now() WHERE id = $2', v_field);
    EXECUTE v_sql USING v_log.old_value, v_log.master_product_id;
  ELSIF v_field = ANY(v_allowed_bool) THEN
    v_sql := format('UPDATE public.master_products SET %I = $1::boolean, updated_at = now() WHERE id = $2', v_field);
    EXECUTE v_sql USING v_log.old_value, v_log.master_product_id;
  ELSIF v_field = ANY(v_allowed_jsonb) THEN
    v_sql := format('UPDATE public.master_products SET %I = COALESCE($1::jsonb, ''{}''::jsonb), updated_at = now() WHERE id = $2', v_field);
    EXECUTE v_sql USING v_log.old_value, v_log.master_product_id;
  ELSIF v_field = ANY(v_allowed_text_array) THEN
    v_sql := format('UPDATE public.master_products SET %I = COALESCE($1::text[], ''{}''::text[]), updated_at = now() WHERE id = $2', v_field);
    EXECUTE v_sql USING v_log.old_value, v_log.master_product_id;
  ELSIF v_field = ANY(v_allowed_uuid_array) THEN
    v_sql := format('UPDATE public.master_products SET %I = COALESCE($1::uuid[], ''{}''::uuid[]), updated_at = now() WHERE id = $2', v_field);
    EXECUTE v_sql USING v_log.old_value, v_log.master_product_id;
  ELSE
    RAISE EXCEPTION 'Field % cannot be reverted', v_field;
  END IF;

  RETURN jsonb_build_object('success', true, 'master_product_id', v_log.master_product_id, 'field', v_field, 'restored_value', v_log.old_value);
END;
$function$;