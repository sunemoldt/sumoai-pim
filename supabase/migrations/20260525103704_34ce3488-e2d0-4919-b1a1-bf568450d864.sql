
-- 1) Lock down shopify_connection: revoke direct table access from anon/authenticated.
--    The shopify_connection_status view (which excludes access_token) keeps working
--    because it runs with the view owner's privileges.
REVOKE ALL ON TABLE public.shopify_connection FROM anon, authenticated;

-- 2) Revoke EXECUTE from anon on every SECURITY DEFINER function in public.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM anon, public',
                   r.nspname, r.proname, r.args);
  END LOOP;
END $$;

-- 3) Revoke EXECUTE from authenticated on internal trigger/helper functions
--    that are never meant to be called via the REST API.
REVOKE EXECUTE ON FUNCTION public.log_master_product_changes() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_enqueue_shopify_update() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_recompute_master_stock() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_recompute_on_settings_change() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_apply_guard_master() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_apply_guard_supplier() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_low_margin_guard(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.set_change_source(text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.set_bulk_supplier_import(boolean) FROM authenticated;
