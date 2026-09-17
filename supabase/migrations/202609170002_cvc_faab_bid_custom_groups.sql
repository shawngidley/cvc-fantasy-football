-- Owner-defined custom waiver claim groups: replaces automatic position-based
-- grouping with owner-controlled pools. A pending claim with no bid_group_id stays in
-- the franchise's shared default pool -- the original pre-grouping behavior, one
-- shared max_players_desired cap off the bid's own column. A claim assigned to a
-- faab_bid_group instead shares that group's own max_players_desired cap with every
-- other claim in the group, independent of the default pool and any other group.

create table if not exists public.faab_bid_group (
  id uuid primary key default gen_random_uuid(),
  waiver_period_id uuid not null references public.waiver_period(id) on delete cascade,
  franchise_id uuid not null references public.franchise(id) on delete cascade,
  label text not null default 'Group',
  max_players_desired integer not null default 1 check (max_players_desired > 0),
  created_at timestamptz not null default now()
);

alter table public.faab_bid add column if not exists bid_group_id uuid references public.faab_bid_group(id) on delete set null;

alter table public.faab_bid_group enable row level security;
revoke all on table public.faab_bid_group from anon, authenticated;
grant select, insert, update, delete on table public.faab_bid_group to service_role;
