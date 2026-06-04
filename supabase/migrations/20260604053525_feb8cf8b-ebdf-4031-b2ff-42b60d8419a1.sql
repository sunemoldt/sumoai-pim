REVOKE ALL ON public.shopify_connection FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.poke_shopify_queue_worker() FROM PUBLIC, anon, authenticated;