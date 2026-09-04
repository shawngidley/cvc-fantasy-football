-- Support for CVC's actual waiver rules: $30 season FAAB cap, Thursday/Sunday
-- resolution, a post-Sunday flat-$1 waiver-priority free period, and a
-- temporary cut-lock on newly acquired players until the next resolution.

alter table public.roster_assignment
  add column if not exists acquired_via text check (acquired_via in ('draft', 'auction', 'protection', 'waiver_bid', 'waiver_free', 'trade', 'commissioner')),
  add column if not exists locked_until timestamptz;

alter table public.faab_bid
  add column if not exists max_players_desired integer not null default 1 check (max_players_desired > 0);

-- Season-long rotating priority for the Sunday free period (flat $1, first-come by
-- priority, not bid amount). Lower number = higher priority = processed first. A
-- franchise moves to the back of the line (highest number) after winning a free-period
-- claim. Separate from faab_bid.priority, which ranks an owner's own simultaneous bids
-- against each other, not franchises against each other.
alter table public.franchise
  add column if not exists waiver_priority integer;
