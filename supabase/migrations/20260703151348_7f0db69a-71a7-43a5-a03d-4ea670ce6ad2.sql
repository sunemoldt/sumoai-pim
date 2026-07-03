revoke execute on function public.get_monitoring_overview() from public, anon;
grant execute on function public.get_monitoring_overview() to authenticated, service_role;