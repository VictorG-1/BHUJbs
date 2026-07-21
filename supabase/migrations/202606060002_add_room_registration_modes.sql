do $$
begin
  if not exists (
    select 1 from pg_type
    where typname = 'registration_type'
  ) then
    create type registration_type as enum ('pothi_room', 'private_room', 'general_room');
  end if;
end $$;

alter table public.families
  add column if not exists reference_pothi_id integer references public.pothis(id),
  add column if not exists private_room_number text,
  add column if not exists registration_type registration_type not null default 'private_room';

alter table public.pothis
  add column if not exists primary_holder_name text,
  add column if not exists city text,
  add column if not exists co_holders jsonb not null default '[]'::jsonb,
  add column if not exists handover_name text,
  add column if not exists contact_name text,
  add column if not exists contact_mobile text;

alter table public.rooms
  add column if not exists room_type registration_type,
  add column if not exists venue_name text,
  add column if not exists section_name text,
  add column if not exists source_room_number text,
  add column if not exists floor text,
  add column if not exists ac_type text,
  add column if not exists bed_count integer,
  add column if not exists extra_count integer,
  add column if not exists owner_type text,
  add column if not exists linked_pothi_id integer references public.pothis(id),
  add column if not exists allotment_note text,
  add column if not exists sort_order integer;

update public.rooms
set room_type = 'private_room'
where room_type is null;

alter table public.rooms
  alter column room_type set not null;

alter table public.rooms
  drop column if exists gender;
