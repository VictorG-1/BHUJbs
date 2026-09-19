alter table public.members
  add column if not exists event_date date;
