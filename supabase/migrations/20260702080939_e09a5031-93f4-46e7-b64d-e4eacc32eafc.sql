
CREATE OR REPLACE FUNCTION public.verify_internal_invoke_secret(p_secret text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM private.function_secrets
    WHERE key = 'internal_invoke_secret'
      AND value = p_secret
  );
$$;

REVOKE ALL ON FUNCTION public.verify_internal_invoke_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_internal_invoke_secret(text) TO service_role;
