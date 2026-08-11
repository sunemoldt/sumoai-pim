REVOKE EXECUTE ON FUNCTION public.is_owner() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated, service_role;

DROP POLICY IF EXISTS "Authenticated read from supplier-feeds" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload to supplier-feeds" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update supplier-feeds" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete supplier-feeds" ON storage.objects;

CREATE POLICY "Owner read supplier-feeds" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'supplier-feeds' AND public.is_owner());

CREATE POLICY "Owner upload supplier-feeds" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'supplier-feeds' AND public.is_owner());

CREATE POLICY "Owner update supplier-feeds" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'supplier-feeds' AND public.is_owner())
  WITH CHECK (bucket_id = 'supplier-feeds' AND public.is_owner());

CREATE POLICY "Owner delete supplier-feeds" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'supplier-feeds' AND public.is_owner());