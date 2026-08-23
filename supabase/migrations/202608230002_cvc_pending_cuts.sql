-- Tracks players flagged at the protection deadline as candidates for auto-cut,
-- staged for commissioner review before any roster/transaction change is made.
alter table public.player_contract add column if not exists pending_cut_flagged_at timestamptz;
