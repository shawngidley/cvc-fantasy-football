create table if not exists public.provider_cache (
  cache_key text primary key,
  provider text not null,
  payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_error text,
  updated_at timestamptz not null default now()
);

create index if not exists provider_cache_expiry_idx on public.provider_cache (expires_at);

alter table public.provider_cache enable row level security;
revoke all on table public.provider_cache from anon, authenticated;
grant select, insert, update, delete on table public.provider_cache to service_role;
