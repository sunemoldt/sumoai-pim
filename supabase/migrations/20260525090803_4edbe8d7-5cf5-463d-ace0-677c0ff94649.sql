
-- 1. Remove authenticated SELECT on shopify_connection (access_token exposure)
-- Frontend uses shopify_connection_status view; edge functions use service_role.
DROP POLICY IF EXISTS "Authenticated read non-secret columns" ON public.shopify_connection;

-- Ensure view is accessible
GRANT SELECT ON public.shopify_connection_status TO authenticated;

-- 2. Realtime authorization - restrict realtime.messages subscriptions to authenticated only
-- (defaults to public; require authenticated to subscribe)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='realtime' AND tablename='messages') THEN
    EXECUTE 'ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated can subscribe to realtime" ON realtime.messages';
    EXECUTE 'CREATE POLICY "Authenticated can subscribe to realtime" ON realtime.messages FOR SELECT TO authenticated USING (true)';
  END IF;
END $$;

-- 3. Storage: supplier-feeds bucket - add UPDATE/DELETE for authenticated (single-tenant)
DROP POLICY IF EXISTS "Authenticated update supplier-feeds" ON storage.objects;
CREATE POLICY "Authenticated update supplier-feeds"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'supplier-feeds')
  WITH CHECK (bucket_id = 'supplier-feeds');

DROP POLICY IF EXISTS "Authenticated delete supplier-feeds" ON storage.objects;
CREATE POLICY "Authenticated delete supplier-feeds"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'supplier-feeds');

-- 4. SECURITY DEFINER functions - revoke EXECUTE from anon/authenticated
-- Internal helpers (triggers/sync) - revoke entirely
REVOKE EXECUTE ON FUNCTION public.trigger_recompute_master_stock() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_change_source(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_master_product_changes() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_recompute_on_settings_change() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_product_stock(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_stock_for_supplier(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_bulk_supplier_import(boolean) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_enqueue_shopify_update() FROM anon, authenticated;

-- Client-facing RPCs: revoke from anon, keep authenticated
REVOKE EXECUTE ON FUNCTION public.revert_change_log_entry(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.merge_attribute_definitions(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_db_stats() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_change_log_daily(integer) FROM anon;
