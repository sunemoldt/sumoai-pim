-- Part 1: sync timestamp columns
ALTER TABLE public.master_products
  ADD COLUMN IF NOT EXISTS last_shopify_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_shopify_sync_status text;

-- Part 2: webhook config (singleton row, gid=1)
CREATE TABLE IF NOT EXISTS public.shopify_webhook_config (
  id integer PRIMARY KEY DEFAULT 1,
  orders_cutoff_at timestamptz,
  orders_webhook_id text,
  registered_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT singleton_row CHECK (id = 1)
);

GRANT SELECT ON public.shopify_webhook_config TO authenticated;
GRANT ALL ON public.shopify_webhook_config TO service_role;
ALTER TABLE public.shopify_webhook_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read webhook config" ON public.shopify_webhook_config
  FOR SELECT TO authenticated USING (true);

-- Part 3: processed orders (idempotency)
CREATE TABLE IF NOT EXISTS public.shopify_processed_orders (
  order_id bigint PRIMARY KEY,
  shopify_order_number text,
  processed_at timestamptz NOT NULL DEFAULT now(),
  line_count integer NOT NULL DEFAULT 0,
  total_decremented integer NOT NULL DEFAULT 0,
  skipped_reason text,
  raw jsonb
);

GRANT SELECT ON public.shopify_processed_orders TO authenticated;
GRANT ALL ON public.shopify_processed_orders TO service_role;
ALTER TABLE public.shopify_processed_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read processed orders" ON public.shopify_processed_orders
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_processed_orders_processed_at
  ON public.shopify_processed_orders (processed_at DESC);

-- Part 4: update log_master_product_changes to exclude sync timestamp columns
CREATE OR REPLACE FUNCTION public.log_master_product_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_source text;
  v_old jsonb;
  v_new jsonb;
  v_key text;
  v_old_val text;
  v_new_val text;
  v_excluded text[] := ARRAY['id', 'created_at', 'updated_at', 'last_shopify_sync_at', 'last_shopify_sync_status'];
BEGIN
  v_source := coalesce(nullif(current_setting('app.change_source', true), ''), 'manual');

  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);

  FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
    IF v_key = ANY(v_excluded) THEN CONTINUE; END IF;

    v_old_val := CASE WHEN v_old->v_key IS NULL OR jsonb_typeof(v_old->v_key) = 'null' THEN NULL
                      WHEN jsonb_typeof(v_old->v_key) IN ('object','array') THEN v_old->>v_key
                      ELSE v_old->>v_key END;
    v_new_val := CASE WHEN v_new->v_key IS NULL OR jsonb_typeof(v_new->v_key) = 'null' THEN NULL
                      WHEN jsonb_typeof(v_new->v_key) IN ('object','array') THEN v_new->>v_key
                      ELSE v_new->>v_key END;

    IF v_old_val IS DISTINCT FROM v_new_val THEN
      INSERT INTO public.product_change_log (master_product_id, field_name, change_type, old_value, new_value, source)
      VALUES (NEW.id, v_key, 'update', v_old_val, v_new_val, v_source);
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

-- Part 5: add 'shopify-order' to auto_enqueue_shopify_update skip-list
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