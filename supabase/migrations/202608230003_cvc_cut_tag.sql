-- Tags a released contract with the franchise that executed the cut, when the
-- player held an active rookie-match or waiver-match right at the moment of
-- release. Surfaced as a visual "Cut by <franchise>" tag on Free Agents.
alter table public.player_contract add column if not exists last_cut_by_franchise_id uuid references public.franchise(id) on delete set null;
alter table public.player_contract add column if not exists last_cut_tag_type text check (last_cut_tag_type in ('rookie_match', 'waiver_match'));
