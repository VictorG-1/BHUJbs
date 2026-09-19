alter table public.members
  add column if not exists arrival_date date,
  add column if not exists departure_date date;
