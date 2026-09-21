-- Shared L2 response cache for the Tank01 proxy (server/tank01Proxy.ts), sitting in
-- front of the in-memory per-instance cache. On Vercel, each request can hit a
-- different, short-lived serverless instance, so the in-memory Map alone doesn't
-- collapse overlapping polls across instances/viewers the way this shared table
-- does. Every read/write from the proxy is best-effort -- any error, including this
-- table not existing, falls through to a normal upstream Tank01 fetch.
create table if not exists public.tank01_response_cache (
  cache_key varchar(512) primary key,
  status integer not null,
  content_type varchar(128) not null,
  body text not null,
  updated_at timestamptz not null default now()
);

alter table public.tank01_response_cache enable row level security;
revoke all on table public.tank01_response_cache from anon, authenticated;
grant select on table public.tank01_response_cache to anon, authenticated;
grant select, insert, update, delete on table public.tank01_response_cache to service_role;
