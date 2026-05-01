CREATE OR REPLACE FUNCTION public.set_change_source(source text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.change_source', coalesce(source, 'manual'), false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_change_source(text) TO authenticated, service_role;