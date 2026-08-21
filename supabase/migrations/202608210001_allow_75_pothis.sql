alter table public.pothis
  drop constraint if exists pothis_id_check;

alter table public.pothis
  add constraint pothis_id_check check (id between 1 and 75);
