-- Trigger: log every change to master_products into product_change_log
CREATE OR REPLACE FUNCTION public.log_master_product_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source text;
  v_old jsonb;
  v_new jsonb;
  v_key text;
  v_old_val text;
  v_new_val text;
  v_excluded text[] := ARRAY['id', 'created_at', 'updated_at'];
BEGIN
  -- Source can be set per-session by sync jobs via: SET LOCAL app.change_source = 'woocommerce';
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
$$;

DROP TRIGGER IF EXISTS log_master_product_changes ON public.master_products;
CREATE TRIGGER log_master_product_changes
AFTER UPDATE ON public.master_products
FOR EACH ROW
EXECUTE FUNCTION public.log_master_product_changes();