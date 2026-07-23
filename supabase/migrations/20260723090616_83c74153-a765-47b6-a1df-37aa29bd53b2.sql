
REVOKE EXECUTE ON FUNCTION public.raise_margin_blocked_alert(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.raise_margin_blocked_alert(uuid) TO service_role;
