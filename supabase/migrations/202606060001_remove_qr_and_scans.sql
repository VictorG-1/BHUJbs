alter table public.members
  drop column if exists qr_token;

drop table if exists public.meal_scans;

drop type if exists meal_type;
