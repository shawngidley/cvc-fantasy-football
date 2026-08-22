create table if not exists public.trade_offer (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.season(id) on delete cascade,
  proposer_franchise_id uuid not null references public.franchise(id) on delete cascade,
  recipient_franchise_id uuid not null references public.franchise(id) on delete cascade,
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'rejected', 'cancelled', 'approved', 'processed', 'reversed')),
  note text,
  proposed_at timestamptz not null default now(),
  responded_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by_owner_id uuid references public.owner(id) on delete set null,
  check (proposer_franchise_id <> recipient_franchise_id)
);

create table if not exists public.trade_asset (
  id uuid primary key default gen_random_uuid(),
  trade_offer_id uuid not null references public.trade_offer(id) on delete cascade,
  from_franchise_id uuid not null references public.franchise(id) on delete cascade,
  player_id uuid references public.player(id) on delete restrict,
  draft_pick_id uuid references public.draft_pick(id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((player_id is not null and draft_pick_id is null) or (player_id is null and draft_pick_id is not null))
);

create index if not exists trade_offer_season_status_idx on public.trade_offer(season_id, status, proposed_at desc);
create index if not exists trade_asset_offer_idx on public.trade_asset(trade_offer_id);

alter table public.trade_offer enable row level security;
alter table public.trade_asset enable row level security;
revoke all on table public.trade_offer, public.trade_asset from anon, authenticated;
grant select, insert, update, delete on table public.trade_offer, public.trade_asset to service_role;
