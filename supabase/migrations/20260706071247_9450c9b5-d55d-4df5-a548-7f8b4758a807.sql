
REVOKE EXECUTE ON FUNCTION public.reapply_low_margin_guard_all() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reapply_low_margin_guard_all() TO authenticated, service_role;
