alter table public.suppliers drop constraint if exists suppliers_feed_type_check;
alter table public.suppliers add constraint suppliers_feed_type_check
  check (feed_type = any (array['csv','txt','xml','ftp','api','manual']));