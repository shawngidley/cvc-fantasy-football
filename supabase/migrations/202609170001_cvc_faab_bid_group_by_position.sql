-- Opt-in grouped waiver claims: lets an owner scope a claim's
-- max_players_desired cap to same-position claims only (e.g. "1 RB, 1 WR"
-- as two independent pools) instead of one shared cap across every claim
-- this period. Defaults to false, which reproduces today's behavior exactly
-- for every bid already placed -- a fully backward-compatible opt-in.

alter table public.faab_bid
  add column if not exists group_by_position boolean not null default false;
