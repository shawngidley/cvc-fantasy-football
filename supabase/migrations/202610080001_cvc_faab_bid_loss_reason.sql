-- Saves a plain language reason on every waiver claim that loses, so My Bids can show
-- owners exactly why (outbid, tiebreak, their own limit, budget, hold). Safe to run any
-- time: the app works without this column and starts saving reasons once it exists.
alter table public.faab_bid add column if not exists loss_reason text;
