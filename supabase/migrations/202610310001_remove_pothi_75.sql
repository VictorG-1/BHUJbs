-- There are only 74 pothis. Drop the extra seeded row and tighten the id check.

delete from public.room_allocations
where room_id in (select id from public.rooms where linked_pothi_id = 75 or room_number = 'POTHI-75');

delete from public.rooms
where linked_pothi_id = 75 or room_number = 'POTHI-75';

update public.families
set pothi_id = null
where pothi_id = 75;

update public.families
set reference_pothi_id = null
where reference_pothi_id = 75;

delete from public.pothis
where id = 75;

alter table public.pothis
  drop constraint if exists pothis_id_check;

alter table public.pothis
  add constraint pothis_id_check check (id between 1 and 74);
