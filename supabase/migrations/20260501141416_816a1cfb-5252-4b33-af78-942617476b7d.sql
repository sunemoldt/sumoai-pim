DROP VIEW IF EXISTS public.shopify_connection_status;

CREATE VIEW public.shopify_connection_status AS
SELECT id, shop_domain, scope, installed_at, updated_at, is_active,
       (access_token IS NOT NULL AND length(access_token) > 0) AS is_connected
  FROM public.shopify_connection
 ORDER BY is_active DESC, installed_at DESC
 LIMIT 1;