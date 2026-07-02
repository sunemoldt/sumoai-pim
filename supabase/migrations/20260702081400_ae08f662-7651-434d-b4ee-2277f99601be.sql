CREATE OR REPLACE FUNCTION public.set_wc_trigger_enabled(p_enabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_enabled THEN
    EXECUTE 'ALTER TABLE public.master_products ENABLE TRIGGER trg_auto_push_wc_update';
  ELSE
    EXECUTE 'ALTER TABLE public.master_products DISABLE TRIGGER trg_auto_push_wc_update';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_wc_trigger_enabled(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_wc_trigger_enabled(boolean) TO authenticated, service_role;