-- Distinguishes a normal FAAB bid cycle from the post-Sunday waiver-priority-ordered
-- free period (flat $1, bid-exempt).
alter table public.waiver_period
  add column if not exists period_type text not null default 'bid' check (period_type in ('bid', 'free'));

-- One restricted-rights designation per franchise per season: which single
-- waiver-acquired player (if any) the owner protects from the end-of-season contract
-- termination, giving them match rights at the following year's auction.
create table if not exists public.waiver_restricted_designation (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.season(id) on delete cascade,
  franchise_id uuid not null references public.franchise(id) on delete cascade,
  player_id uuid not null references public.player(id) on delete cascade,
  designated_at timestamptz not null default now(),
  unique (season_id, franchise_id)
);

alter table public.waiver_restricted_designation enable row level security;
revoke all on table public.waiver_restricted_designation from anon, authenticated;
grant select, insert, update, delete on table public.waiver_restricted_designation to service_role;
