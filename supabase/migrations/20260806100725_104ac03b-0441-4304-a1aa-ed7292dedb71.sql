SELECT net.http_post(
  url := 'https://qanxmacwntyxfhznxriz.supabase.co/functions/v1/fetch-analytics',
  headers := jsonb_build_object(
    'Content-Type','application/json',
    'x-internal-secret',(SELECT value FROM private.function_secrets WHERE key='internal_invoke_secret')
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 55000
);