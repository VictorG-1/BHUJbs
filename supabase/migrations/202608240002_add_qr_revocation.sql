alter table public.members
  add column if not exists qr_revoked_at timestamptz;
