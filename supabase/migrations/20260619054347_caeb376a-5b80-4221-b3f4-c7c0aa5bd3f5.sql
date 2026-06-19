
-- 1) Revoke public EXECUTE on internal trigger function
REVOKE EXECUTE ON FUNCTION public.auto_push_wc_update() FROM PUBLIC, anon, authenticated;

-- 2) Harden shopify_connection: explicit deny for authenticated/anon
ALTER TABLE public.shopify_connection ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny authenticated access to shopify_connection" ON public.shopify_connection;
CREATE POLICY "Deny authenticated access to shopify_connection"
ON public.shopify_connection
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (false)
WITH CHECK (false);

REVOKE ALL ON public.shopify_connection FROM anon, authenticated;
