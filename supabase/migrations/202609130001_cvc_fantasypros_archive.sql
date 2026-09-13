-- 30-day rolling archive of FantasyPros news items, ported from WRC's proven
-- approach. FantasyPros' live /nfl/news endpoint only returns its most recent ~100
-- items league-wide with no date-range guarantee -- during a busy news cycle that
-- window can shrink to just a few hours, and a lower-profile player's item can fall
-- off entirely with no way to recover it. A daily scheduled job snapshots the live
-- feed into this table; requests merge the live feed with this archive (deduped),
-- guaranteeing at least daily-granularity coverage for a full 30 days regardless of
-- how busy the news cycle gets. Items expire 30 days after their OWN published date,
-- not 30 days from when they were archived.
create table if not exists public.cvc_fantasypros_news_archive (
  id bigint generated always as identity primary key,
  archive_key varchar(128) not null unique,
  source varchar(32) not null default 'FantasyPros',
  source_item_id varchar(64),
  player_id integer,
  player_name varchar(160) not null,
  team varchar(8),
  position varchar(8),
  title text not null,
  description text,
  impact text,
  author varchar(160),
  article_url text,
  published_at timestamptz not null,
  captured_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists cvc_fantasypros_news_archive_published_at_idx
  on public.cvc_fantasypros_news_archive (published_at);
create index if not exists cvc_fantasypros_news_archive_position_published_idx
  on public.cvc_fantasypros_news_archive (position, published_at);

create table if not exists public.cvc_fantasypros_news_archive_config (
  id varchar(64) primary key,
  retention_days integer not null default 30,
  last_collected_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.cvc_fantasypros_news_archive enable row level security;
alter table public.cvc_fantasypros_news_archive_config enable row level security;
revoke all on table public.cvc_fantasypros_news_archive from anon, authenticated;
revoke all on table public.cvc_fantasypros_news_archive_config from anon, authenticated;
grant select, insert, update, delete on table public.cvc_fantasypros_news_archive to service_role;
grant select, insert, update, delete on table public.cvc_fantasypros_news_archive_config to service_role;
