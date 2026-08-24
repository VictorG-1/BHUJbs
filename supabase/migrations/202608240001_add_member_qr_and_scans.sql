alter table public.members
  add column if not exists qr_token uuid not null default gen_random_uuid();

create unique index if not exists members_qr_token_key on public.members(qr_token);

create table if not exists public.qr_scans (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  scan_type text not null default 'entry' check (scan_type in ('entry', 'lunch', 'dinner')),
  scanned_by uuid not null references auth.users(id) on delete restrict,
  scanned_at timestamptz not null default now()
);

create index if not exists qr_scans_member_type_date_idx
  on public.qr_scans(member_id, scan_type, scanned_at desc);

alter table public.qr_scans enable row level security;

drop policy if exists "event staff manage qr scans" on public.qr_scans;
create policy "event staff manage qr scans" on public.qr_scans
for all using (public.is_admin()) with check (public.is_admin());

grant select, insert on public.qr_scans to authenticated;
