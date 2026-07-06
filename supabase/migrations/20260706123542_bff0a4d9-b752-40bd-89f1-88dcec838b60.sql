
REVOKE EXECUTE ON FUNCTION public.approve_ean_suggestion(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ean_suggestions_diagnostic() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_duplicate_eans() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_ean_suggestions() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_invalid_ean_product_ids() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.resolve_duplicate_ean(text, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.approve_ean_suggestion(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ean_suggestions_diagnostic() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_duplicate_eans() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_ean_suggestions() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_invalid_ean_product_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_duplicate_ean(text, uuid) TO authenticated, service_role;
