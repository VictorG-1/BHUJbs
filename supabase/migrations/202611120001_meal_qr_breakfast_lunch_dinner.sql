-- Meal QR cards (printed payloads from All_QR_Codes_2400.xlsx)
-- Validation: breakfast / lunch / dinner only — one scan per QR per meal per day (IST)

create table if not exists public.meal_qr_codes (
  id uuid primary key default gen_random_uuid(),
  qr_value text not null unique,
  category text,
  member_name text,
  room text,
  pothi text,
  city text,
  mobile text,
  arrival_date text,
  departure_date text,
  reg_code text,
  pdf_file text,
  pdf_page integer,
  sr_no integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meal_qr_codes_member_name_idx
  on public.meal_qr_codes (lower(coalesce(member_name, '')));

create index if not exists meal_qr_codes_room_idx
  on public.meal_qr_codes (lower(coalesce(room, '')));

create table if not exists public.meal_scans (
  id uuid primary key default gen_random_uuid(),
  meal_qr_code_id uuid not null references public.meal_qr_codes(id) on delete cascade,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner')),
  scanned_by uuid not null references auth.users(id) on delete restrict,
  scanned_at timestamptz not null default now(),
  scan_date date not null default ((timezone('Asia/Kolkata', now()))::date)
);

create unique index if not exists meal_scans_one_per_day_idx
  on public.meal_scans (meal_qr_code_id, meal_type, scan_date);

create index if not exists meal_scans_scanned_at_idx
  on public.meal_scans (scanned_at desc);

alter table public.meal_qr_codes enable row level security;
alter table public.meal_scans enable row level security;

drop policy if exists "event staff manage meal qr codes" on public.meal_qr_codes;
create policy "event staff manage meal qr codes" on public.meal_qr_codes
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "event staff manage meal scans" on public.meal_scans;
create policy "event staff manage meal scans" on public.meal_scans
for all using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.meal_qr_codes to authenticated;
grant select, insert on public.meal_scans to authenticated;
