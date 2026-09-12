-- Weekly skins game: $20 base pot, highest league score of the week wins if it's >=150
-- and unique; otherwise pushes (accumulates) to next week. The season's last week
-- drops the threshold (highest score wins regardless) and breaks a tie by the
-- highest-scoring individual player in an active (non-bench) lineup slot, among only
-- the tied teams.
create table if not exists public.cvc_skin (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.season(id) on delete cascade,
  week_number integer not null,
  pot_amount numeric(8,2) not null,
  status text not null default 'pending' check (status in ('pending', 'won', 'pushed')),
  winner_franchise_id uuid references public.franchise(id) on delete set null,
  winning_score numeric(7,2),
  tiebreaker_used boolean not null default false,
  tiebreaker_player_id uuid references public.player(id) on delete set null,
  tiebreaker_player_name text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (season_id, week_number)
);

alter table public.cvc_skin enable row level security;
revoke all on table public.cvc_skin from anon, authenticated;
grant select, insert, update, delete on table public.cvc_skin to service_role;

