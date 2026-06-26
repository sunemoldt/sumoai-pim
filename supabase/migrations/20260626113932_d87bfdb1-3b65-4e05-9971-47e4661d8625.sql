-- Explicit policies on storage.objects for product-feeds bucket.
-- The bucket is private and only served via the partner-ads-feed/feed edge
-- functions using the service role (which bypasses RLS). These policies make
-- the intent explicit and deny all anon/authenticated access.

DROP POLICY IF EXISTS "product-feeds service role manage" ON storage.objects;
CREATE POLICY "product-feeds service role manage"
ON storage.objects
AS PERMISSIVE
FOR ALL
TO service_role
USING (bucket_id = 'product-feeds')
WITH CHECK (bucket_id = 'product-feeds');

DROP POLICY IF EXISTS "product-feeds deny anon/auth" ON storage.objects;
CREATE POLICY "product-feeds deny anon/auth"
ON storage.objects
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (bucket_id <> 'product-feeds')
WITH CHECK (bucket_id <> 'product-feeds');
