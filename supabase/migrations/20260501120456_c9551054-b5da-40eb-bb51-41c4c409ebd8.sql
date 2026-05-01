-- Single-row table for the active Shopify store connection
CREATE TABLE public.shopify_connection (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_domain TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  scope TEXT,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.shopify_connection ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read status, but NOT the access_token (see view below)
-- We expose only safe columns via a view, and lock the table down to service_role only
CREATE POLICY "Service role full access"
  ON public.shopify_connection
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Safe view: exposes connection status without leaking the access_token
CREATE OR REPLACE VIEW public.shopify_connection_status AS
SELECT
  id,
  shop_domain,
  scope,
  installed_at,
  updated_at,
  (access_token IS NOT NULL AND length(access_token) > 0) AS is_connected
FROM public.shopify_connection;

GRANT SELECT ON public.shopify_connection_status TO authenticated;

-- Trigger for updated_at
CREATE TRIGGER update_shopify_connection_updated_at
  BEFORE UPDATE ON public.shopify_connection
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- OAuth state table (short-lived, for CSRF protection during install flow)
CREATE TABLE public.shopify_oauth_state (
  state TEXT NOT NULL PRIMARY KEY,
  shop_domain TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes')
);

ALTER TABLE public.shopify_oauth_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only"
  ON public.shopify_oauth_state
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);