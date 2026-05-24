-- Auto-enqueue Shopify updates when sync-relevant fields change on master_products
CREATE OR REPLACE FUNCTION public.auto_enqueue_shopify_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source text;
  v_changed_fields text[] := ARRAY[]::text[];
BEGIN
  -- Only for Shopify-synced products that exist in Shopify
  IF NEW.shopify_sync_enabled IS NOT TRUE OR NEW.shopify_product_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Skip when change originated from a sync/import job to avoid feedback loops
  v_source := coalesce(nullif(current_setting('app.change_source', true), ''), 'manual');
  IF v_source IN (
    'shopify-update-product', 'shopify-create-product', 'shopify-pull', 'shopify-import',
    'wc-import', 'wc-update-product', 'stock-sync', 'supplier-feed', 'revert'
  ) OR v_source LIKE 'supplier:%' THEN
    RETURN NEW;
  END IF;

  -- Detect changes on sync-relevant fields
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

  IF array_length(v_changed_fields, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  -- Dedupe: skip if a pending/processing job already exists for this product
  IF EXISTS (
    SELECT 1 FROM public.shopify_update_queue
    WHERE master_product_id = NEW.id
      AND status IN ('pending', 'processing')
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.shopify_update_queue (master_product_id, payload, source, status, next_attempt_at)
  VALUES (
    NEW.id,
    jsonb_build_object('reason', 'auto-pim-edit', 'changed_fields', v_changed_fields, 'change_source', v_source),
    'auto-pim-edit',
    'pending',
    now()
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_enqueue_shopify_update ON public.master_products;
CREATE TRIGGER trg_auto_enqueue_shopify_update
AFTER UPDATE ON public.master_products
FOR EACH ROW
EXECUTE FUNCTION public.auto_enqueue_shopify_update();