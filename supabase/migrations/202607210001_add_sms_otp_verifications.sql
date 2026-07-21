create table if not exists public.sms_otp_verifications (
  id uuid primary key default gen_random_uuid(),
  mobile text not null,
  otp_hash text not null,
  verification_token text,
  expires_at timestamptz not null,
  verified_at timestamptz,
  consumed_at timestamptz,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists sms_otp_verifications_mobile_idx
  on public.sms_otp_verifications (mobile, created_at desc);

alter table public.sms_otp_verifications enable row level security;

create policy "admins manage otp verifications" on public.sms_otp_verifications
for all using (public.is_admin()) with check (public.is_admin());
