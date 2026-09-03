-- Per-franchise player watchlist for the Free Agents page, ported from WRC's model.
create table if not exists public.watchlist (
  id uuid primary key default gen_random_uuid(),
  franchise_id uuid not null references public.franchise(id) on delete cascade,
  player_id uuid not null references public.player(id) on delete cascade,
  added_at timestamptz not null default now(),
  unique (franchise_id, player_id)
);

create index if not exists watchlist_franchise_id_idx on public.watchlist(franchise_id);

alter table public.watchlist enable row level security;
revoke all on table public.watchlist from anon, authenticated;
grant select, insert, update, delete on table public.watchlist to service_role;
