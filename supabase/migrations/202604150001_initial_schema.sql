create extension if not exists "pgcrypto";

create type gender_type as enum ('male', 'female', 'other');
create type registration_type as enum ('pothi_room', 'private_room', 'general_room');
create type whatsapp_status as enum ('queued', 'sent', 'failed');

create table public.families (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  head_name text not null,
  head_mobile text not null,
  city text,
  address text,
  wants_stay boolean not null default false,
  pothi_id integer unique,
  reference_pothi_id integer,
  private_room_number text,
  registration_type registration_type not null default 'private_room',
  pothi_locked_at timestamptz,
  registration_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pothis (
  id integer primary key check (id between 1 and 75),
  primary_holder_name text,
  city text,
  co_holders jsonb not null default '[]'::jsonb,
  handover_name text,
  contact_name text,
  contact_mobile text,
  family_id uuid unique references public.families(id) on delete set null,
  locked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  age integer not null check (age between 0 and 120),
  gender gender_type not null,
  mobile text,
  is_head boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  room_number text not null unique,
  venue_name text,
  section_name text,
  source_room_number text,
  floor text,
  ac_type text,
  bed_count integer,
  extra_count integer,
  owner_type text,
  linked_pothi_id integer references public.pothis(id),
  allotment_note text,
  sort_order integer,
  room_type registration_type not null,
  capacity integer not null default 4 check (capacity > 0),
  created_at timestamptz not null default now()
);

create table public.room_allocations (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  member_id uuid not null unique references public.members(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  allocated_at timestamptz not null default now()
);

create table public.whatsapp_notifications (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.families(id) on delete cascade,
  member_id uuid references public.members(id) on delete cascade,
  mobile text not null,
  template_name text not null,
  payload jsonb not null default '{}'::jsonb,
  status whatsapp_status not null default 'queued',
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table public.admin_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null default 'admin',
  created_at timestamptz not null default now()
);

alter table public.families
  add constraint families_pothi_fk foreign key (pothi_id) references public.pothis(id);

alter table public.families
  add constraint families_reference_pothi_fk foreign key (reference_pothi_id) references public.pothis(id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger families_touch_updated_at
before update on public.families
for each row execute function public.touch_updated_at();

create or replace function public.lock_family_pothi()
returns trigger language plpgsql as $$
begin
  if old.pothi_id is not null and new.pothi_id is distinct from old.pothi_id then
    raise exception 'Pothi selection is locked and cannot be changed';
  end if;

  if new.pothi_id is not null and old.pothi_id is null then
    new.pothi_locked_at = coalesce(new.pothi_locked_at, now());
  end if;

  return new;
end;
$$;

create trigger families_lock_pothi_before_update
before update on public.families
for each row execute function public.lock_family_pothi();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admin_profiles
    where user_id = auth.uid()
  );
$$;

insert into public.pothis (id)
select generate_series(1, 75)
on conflict do nothing;

alter table public.families enable row level security;
alter table public.members enable row level security;
alter table public.pothis enable row level security;
alter table public.rooms enable row level security;
alter table public.room_allocations enable row level security;
alter table public.whatsapp_notifications enable row level security;
alter table public.admin_profiles enable row level security;

create policy "public can read available pothis" on public.pothis
for select using (true);

create policy "families can read own registration" on public.families
for select using (auth.uid() = auth_user_id);

create policy "families can read own members" on public.members
for select using (
  exists (
    select 1 from public.families
    where families.id = members.family_id
      and families.auth_user_id = auth.uid()
  )
);

create policy "admins manage families" on public.families
for all using (public.is_admin()) with check (public.is_admin());

create policy "admins manage members" on public.members
for all using (public.is_admin()) with check (public.is_admin());

create policy "admins manage pothis" on public.pothis
for all using (public.is_admin()) with check (public.is_admin());

create policy "admins manage rooms" on public.rooms
for all using (public.is_admin()) with check (public.is_admin());

create policy "admins manage room allocations" on public.room_allocations
for all using (public.is_admin()) with check (public.is_admin());

create policy "admins manage notifications" on public.whatsapp_notifications
for all using (public.is_admin()) with check (public.is_admin());

create policy "admins view admin profiles" on public.admin_profiles
for select using (public.is_admin());
