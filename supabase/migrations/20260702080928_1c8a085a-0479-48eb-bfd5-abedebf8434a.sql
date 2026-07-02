
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

CREATE TABLE IF NOT EXISTS private.function_secrets (
  key text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON private.function_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON private.function_secrets TO service_role;
ALTER TABLE private.function_secrets ENABLE ROW LEVEL SECURITY;

INSERT INTO private.function_secrets(key, value)
VALUES ('internal_invoke_secret', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (key) DO NOTHING;

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
  v_secret text;
BEGIN
  IF NEW.webshop_platform IS DISTINCT FROM 'woocommerce'
     OR NEW.webshop_product_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_source := coalesce(nullif(current_setting('app.change_source', true), ''), 'manual');
  IF v_source IN ('wc-update-product', 'wc-import', 'revert', 'shopify-order',
                  'shopify-update-product', 'shopify-pull', 'shopify-import') THEN
    RETURN NEW;
  END IF;

  SELECT setting_value INTO v_enabled
  FROM public.analytics_settings
  WHERE setting_key = 'woocommerce_enabled';
  IF coalesce(v_enabled, 'false') <> 'true' THEN
    RETURN NEW;
  END IF;

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

  SELECT value INTO v_secret FROM private.function_secrets WHERE key = 'internal_invoke_secret';

  PERFORM net.http_post(
    url := 'https://qanxmacwntyxfhznxriz.supabase.co/functions/v1/wc-update-product',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhbnhtYWN3bnR5eGZoem54cml6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5Njg4NTMsImV4cCI6MjA5MDU0NDg1M30.IzMFm6WSjjGtGCwDoxGmDQ_SRQ4WZu_9Ofqt5TLsyNI',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhbnhtYWN3bnR5eGZoem54cml6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5Njg4NTMsImV4cCI6MjA5MDU0NDg1M30.IzMFm6WSjjGtGCwDoxGmDQ_SRQ4WZu_9Ofqt5TLsyNI',
      'x-internal-secret', v_secret
    ),
    body := jsonb_build_object(
      'master_product_id', NEW.id,
      'use_db_values', true,
      'source', 'auto-pim-edit'
    )
  );

  RETURN NEW;
END;
$function$;
