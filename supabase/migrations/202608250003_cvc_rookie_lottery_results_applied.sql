-- Tracks whether a COMPLETE lottery's drawn order has actually been written to
-- draft_pick. Previously that write only ever happened once, in the same request
-- that flipped status to COMPLETE (10 sequential draft_pick updates inline) -- if
-- that write failed or the request timed out partway through, status stayed
-- COMPLETE forever with nothing to ever retry it, since the retry logic was
-- gated behind status='RUNNING'. results_applied lets rookieLottery detect and
-- self-heal that exact situation on the next request, regardless of status.
alter table public.rookie_draft_lottery add column if not exists results_applied boolean not null default false;
