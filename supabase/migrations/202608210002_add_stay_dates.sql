alter table public.families
  add column if not exists stay_from date,
  add column if not exists stay_to date;
