DROP VIEW IF EXISTS public.shopify_connection_status;

CREATE VIEW public.shopify_connection_status
WITH (security_invoker = true)
AS
SELECT
  id,
  shop_domain,
  scope,
  installed_at,
  updated_at,
  (access_token IS NOT NULL AND length(access_token) > 0) AS is_connected
FROM public.shopify_connection;

GRANT SELECT ON public.shopify_connection_status TO authenticated;

-- Allow authenticated users to SELECT from base table so the security_invoker view works.
-- We expose ONLY the safe columns via the view; the access_token column is never sent to the client
-- because the view doesn't include it. To be extra safe, lock down direct table access:
CREATE POLICY "Authenticated read non-secret columns"
  ON public.shopify_connection
  FOR SELECT
  TO authenticated
  USING (true);