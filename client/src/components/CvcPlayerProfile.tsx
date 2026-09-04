import { useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { ArrowLeft, BarChart3, CalendarDays, ChevronDown, ClipboardList, ExternalLink, Newspaper, ShieldCheck, Star, TrendingUp } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { normalizePlayerName } from "@shared/playerNameMatch";
import { useCvcOwnerAuth } from "@/hooks/useCvcOwnerAuth";
import { CvcNewsRow, type CvcNewsItem } from "@/components/CvcNewsRow";

type TankRecord = Record<string, unknown>;
type TankPlayerInfo = { body?: TankRecord | TankRecord[] };
type TankNewsItem = { title?: string; link?: string; image?: string; playerIDs?: string[] };

const positionColor: Record<string, string> = { QB: "bg-red-600", RB: "bg-emerald-700", WR: "bg-blue-700", TE: "bg-amber-700", K: "bg-violet-700", DST: "bg-slate-700" };
const NEWS_CACHE_KEY = "cvc_tank01_news_v1";
const NEWS_TTL_MS = 15 * 60_000;
const infoCache = new Map<string, TankRecord | null>();
const scheduleCache = new Map<string, TankRecord[] | null>();
const TEAM_CODE_ALIASES: Record<string, string> = { kan: "kc", tam: "tb", arz: "ari", jax: "jac", was: "wsh" };

function asRecord(value: unknown): TankRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as TankRecord : {}; }
function firstOf(source: TankRecord | undefined, keys: string[]): string | null { for (const key of keys) { const candidate = source?.[key]; if (candidate !== undefined && candidate !== null && candidate !== "") return String(candidate); } return null; }
function looksLikeInjury(text: string) { return /injur|questionable|doubtful| ruled out|out for|ir |surgery|concussion|hamstring|ankle|knee|illness/i.test(text); }
const normalizeTeam = (team: string | null | undefined) => (TEAM_CODE_ALIASES[(team ?? "").toLowerCase()] ?? (team ?? "").toLowerCase());
const teamLogoUrl = (team: string | null | undefined) => `https://a.espncdn.com/i/teamlogos/nfl/500/${normalizeTeam(team)}.png`;
function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr || dateStr.length < 8) return "—";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = Number.parseInt(dateStr.slice(4, 6), 10);
  const day = Number.parseInt(dateStr.slice(6, 8), 10);
  return `${months[month - 1] ?? ""} ${day}`;
}

/** Fetches Tank01's getNFLPlayerInfo for one player, cached by name for the session. Every
 * field below beyond `espnHeadshot` (already used in Protections.tsx/CvcOwnerLineup.tsx)
 * is read defensively and simply omitted if Tank01 doesn't return it — this endpoint requires
 * TANK01_RAPIDAPI_KEY, which is not configured in every environment. */
function useTank01PlayerInfo(displayName: string | undefined) {
  const [row, setRow] = useState<TankRecord | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!displayName) return;
    if (infoCache.has(displayName)) { setRow(infoCache.get(displayName) ?? null); return; }
    let ignore = false;
    setLoading(true);
    fetch(`/api/tank01/getNFLPlayerInfo?playerName=${encodeURIComponent(displayName)}&getStats=true`)
      .then(response => (response.ok ? response.json() : null) as Promise<TankPlayerInfo | null>)
      .then(payload => { const next = Array.isArray(payload?.body) ? payload!.body[0] as TankRecord : (payload?.body as TankRecord | undefined) ?? null; infoCache.set(displayName, next); if (!ignore) setRow(next); })
      .catch(() => { infoCache.set(displayName, null); if (!ignore) setRow(null); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [displayName]);
  return { row, loading };
}

/** Reuses the same cached feed as CvcPlayerNews.tsx, filtered client-side to one player's
 * name — cheaper than a dedicated per-player fetch and consistent with the existing pattern. */
function usePlayerNews(displayName: string | undefined) {
  const [items, setItems] = useState<TankNewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let ignore = false;
    const load = async () => {
      try {
        const cached = sessionStorage.getItem(NEWS_CACHE_KEY);
        if (cached) { const parsed = JSON.parse(cached) as { ts: number; data: TankNewsItem[] }; if (Date.now() - parsed.ts < NEWS_TTL_MS) { if (!ignore) { setItems(parsed.data); setLoading(false); } return; } }
        const response = await fetch("/api/tank01/getNFLNews?recentNews=true");
        if (!response.ok) throw new Error("unavailable");
        const payload = await response.json() as { body?: TankNewsItem[] };
        const fresh = Array.isArray(payload.body) ? payload.body.filter(item => item.title) : [];
        sessionStorage.setItem(NEWS_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: fresh }));
        if (!ignore) setItems(fresh);
      } catch { if (!ignore) setItems([]); } finally { if (!ignore) setLoading(false); }
    };
    void load();
    return () => { ignore = true; };
  }, []);
  const mine = useMemo(() => displayName ? items.filter(item => item.title?.toLowerCase().includes(displayName.toLowerCase())) : [], [items, displayName]);
  return { items: mine, loading };
}

/** getNFLTeamSchedule has no existing usage anywhere else in this codebase beyond this
 * page, so its response shape is parsed defensively against Tank01's documented field
 * names and hidden entirely if nothing recognizable comes back, rather than risk
 * showing wrong data. */
function useTeamSchedule(team: string | null | undefined, enabled: boolean) {
  const [games, setGames] = useState<TankRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled || !team) return;
    const abv = normalizeTeam(team).toUpperCase();
    if (scheduleCache.has(abv)) { setGames(scheduleCache.get(abv) ?? null); return; }
    let ignore = false;
    setLoading(true);
    fetch(`/api/tank01/getNFLTeamSchedule?teamAbv=${encodeURIComponent(abv)}`)
      .then(response => (response.ok ? response.json() : null) as Promise<{ body?: TankRecord | TankRecord[] } | null>)
      .then(payload => {
        const raw = payload?.body;
        const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw as Record<string, unknown>).filter((entry): entry is TankRecord => Boolean(entry) && typeof entry === "object") : [];
        scheduleCache.set(abv, list.length ? list : null);
        if (!ignore) setGames(list.length ? list : null);
      })
      .catch(() => { scheduleCache.set(abv, null); if (!ignore) setGames(null); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [team, enabled]);
  return { games, loading };
}

function gameOpponent(game: TankRecord, team: string) {
  const abv = normalizeTeam(team).toUpperCase();
  const away = firstOf(game, ["away", "awayTeam", "away_team"]);
  const home = firstOf(game, ["home", "homeTeam", "home_team"]);
  if (!away || !home) return null;
  return away.toUpperCase() === abv ? { opponent: home, atOrVs: "@" } : { opponent: away, atOrVs: "vs" };
}

/** Schedule rows in week-number order, with a synthetic BYE WEEK row inserted at any
 * gap in the sequence (Tank01's schedule response has no explicit bye-week entry). */
function buildScheduleWithBye(schedule: TankRecord[], team: string) {
  const rows = schedule
    .map(game => ({ game, week: Number.parseInt(firstOf(game, ["gameWeek", "week"])?.replace(/\D/g, "") ?? "0", 10), opponent: gameOpponent(game, team) }))
    .filter(row => row.week > 0 && row.opponent)
    .sort((a, b) => a.week - b.week);
  const withBye: ({ type: "game"; week: number; game: TankRecord; opponent: { opponent: string; atOrVs: string } } | { type: "bye"; week: number })[] = [];
  let expected = 1;
  for (const row of rows) {
    while (expected < row.week) { withBye.push({ type: "bye", week: expected }); expected += 1; }
    withBye.push({ type: "game", week: row.week, game: row.game, opponent: row.opponent! });
    expected = row.week + 1;
  }
  return withBye;
}

const GAME_LOG_COLUMNS: Record<string, { key: string; label: string }[]> = {
  QB: [["passCmp", "CMP"], ["passAtt", "ATT"], ["passYds", "YDS"], ["passTD", "TD"], ["passInt", "INT"], ["rushAtt", "RUSH"], ["rushYds", "RUSH YDS"]].map(([key, label]) => ({ key, label })),
  RB: [["rushAtt", "CAR"], ["rushYds", "YDS"], ["rushTD", "TD"], ["rec", "REC"], ["recYds", "REC YDS"], ["recTD", "REC TD"]].map(([key, label]) => ({ key, label })),
  WR: [["rec", "REC"], ["targets", "TGT"], ["recYds", "YDS"], ["recTD", "TD"], ["rushYds", "RUSH YDS"]].map(([key, label]) => ({ key, label })),
  TE: [["rec", "REC"], ["targets", "TGT"], ["recYds", "YDS"], ["recTD", "TD"]].map(([key, label]) => ({ key, label })),
  K: [["fgMade", "FGM"], ["fgAtt", "FGA"], ["xpMade", "XPM"]].map(([key, label]) => ({ key, label })),
};

export function CvcPlayerProfile() {
  const [, params] = useRoute("/player/:playerId");
  const playerId = params?.playerId ?? "";
  const valid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(playerId);
  const { owner } = useCvcOwnerAuth();
  const utils = trpc.useUtils();
  const detail = trpc.league.playerDetail.useQuery({ playerId: valid ? playerId : "00000000-0000-0000-0000-000000000000" }, { enabled: valid });
  const [tab, setTab] = useState<"stats" | "schedule" | "gamelog">("stats");
  const [showAllNews, setShowAllNews] = useState(false);
  const { row: tank } = useTank01PlayerInfo(detail.data?.display_name);
  const { items: news, loading: loadingNews } = usePlayerNews(detail.data?.display_name);
  const fantasyProsNews = trpc.league.fantasyProsNews.useQuery({ limit: 100 }, { staleTime: 15 * 60_000 });
  const normalizedPlayerName = detail.data?.display_name ? normalizePlayerName(detail.data.display_name) : "";
  const fantasyProsPlayerNews = useMemo<CvcNewsItem[]>(() => {
    if (!normalizedPlayerName) return [];
    return (fantasyProsNews.data?.items ?? [])
      .filter(item => normalizePlayerName(item.playerName) === normalizedPlayerName)
      .map(item => ({ playerName: item.playerName, pos: item.position ?? "", nflTeam: item.team ?? "", headline: item.title, description: item.impact || item.description || undefined, published: item.published, url: item.link, isInjury: item.isInjury, source: "FantasyPros" as const, playerId: item.playerId }));
  }, [fantasyProsNews.data, normalizedPlayerName]);
  const tank01PlayerNews = useMemo<CvcNewsItem[]>(() => news.map((item, index) => ({
    playerName: detail.data?.display_name ?? "", pos: detail.data?.position ?? "", nflTeam: detail.data?.nfl_team ?? "",
    headline: item.title ?? "", published: new Date(Date.now() - index).toISOString(), url: item.link,
    isInjury: looksLikeInjury(item.title ?? ""), source: "Tank01" as const, playerId: detail.data?.id ?? null,
  })), [news, detail.data]);
  const combinedPlayerNews = [...fantasyProsPlayerNews, ...tank01PlayerNews];
  const expertImpactItem = fantasyProsPlayerNews.find(item => item.description);

  const outlook = trpc.league.fantasyProsPlayerOutlook.useQuery({ playerId: params?.playerId ?? "" }, { enabled: Boolean(params?.playerId), staleTime: 30 * 60_000 });
  const { games: schedule } = useTeamSchedule(detail.data?.nfl_team, valid);

  const espnId = firstOf(tank ?? undefined, ["espnID", "espnId"]);
  const tank01PlayerId = firstOf(tank ?? undefined, ["playerID", "playerId"]);
  const seasonStats = trpc.league.playerCareerSeasonStats.useQuery({ playerId, espnId: espnId ?? "" }, { enabled: valid && Boolean(espnId) && tab === "stats" });

  const currentSeasonYear = detail.data?.season?.year ?? new Date().getFullYear();
  const [gameLogYear, setGameLogYear] = useState(currentSeasonYear);
  useEffect(() => { setGameLogYear(currentSeasonYear); }, [currentSeasonYear]);
  const gameLog = trpc.league.playerGameLog.useQuery({ playerId, tank01PlayerId: tank01PlayerId ?? "", year: gameLogYear }, { enabled: valid && Boolean(tank01PlayerId) && tab === "gamelog" });

  const watchlist = trpc.league.watchlist.useQuery(undefined, { enabled: Boolean(owner?.franchise) });
  const isWatched = watchlist.data?.some(item => item.player_id === playerId) ?? false;
  const toggleWatch = trpc.league.toggleWatchlistPlayer.useMutation({ onSuccess: () => utils.league.watchlist.invalidate() });

  const [headshotFailed, setHeadshotFailed] = useState(false);

  if (!valid) return <div className="mx-auto max-w-3xl"><Link href="/free-agents" className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-cvc-accent"><ArrowLeft size={15} /> Player pool</Link><p className="mt-8 text-sm text-cvc-muted">Choose a CVC player from the roster, free agent, or draft views.</p></div>;
  if (detail.isLoading) return <div className="mx-auto max-w-3xl text-sm text-cvc-muted">Loading CVC player profile…</div>;
  if (detail.error || !detail.data) return <div className="mx-auto max-w-3xl text-sm text-cvc-muted">This CVC player record was not found.</div>;

  const player = detail.data;
  const pos = player.position ?? "NFL";
  const initials = player.display_name.split(" ").map((part: string) => part[0]).join("").slice(0, 2).toUpperCase();
  const headshot = firstOf(tank ?? undefined, ["espnHeadshot"]);
  const jerseyNum = firstOf(tank ?? undefined, ["jerseyNum"]);
  const height = firstOf(tank ?? undefined, ["height"]);
  const weight = firstOf(tank ?? undefined, ["weight"]);
  const age = firstOf(tank ?? undefined, ["age"]);
  const experience = firstOf(tank ?? undefined, ["exp", "yearsExp", "experience"]);
  const injuryStatus = firstOf(tank ?? undefined, ["injury_designation", "injuryStatus", "gameStatus"]);
  const statusLabel = injuryStatus || player.status || "Active";
  const isInjuryStatus = looksLikeInjury(statusLabel);
  const upcoming = schedule?.map(game => ({ game, opponent: gameOpponent(game, player.nfl_team ?? "") })).find(entry => entry.opponent);
  const scheduleRows = schedule ? buildScheduleWithBye(schedule, player.nfl_team ?? "") : [];
  const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const currentWeekIndex = scheduleRows.findIndex(row => row.type === "game" && firstOf(row.game, ["gameDate", "date"]) && (firstOf(row.game, ["gameDate", "date"]) as string) >= todayStr);
  const gameLogYearOptions = Array.from({ length: 5 }, (_, index) => currentSeasonYear - index);
  const gameLogColumns = GAME_LOG_COLUMNS[pos] ?? [];
  const espnPlayerUrl = espnId ? `https://www.espn.com/nfl/player/_/id/${espnId}` : null;

  return <div className="mx-auto max-w-5xl">
    <Link href="/free-agents" className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-cvc-accent hover:text-[var(--cvc-accent-soft)]"><ArrowLeft size={15} /> Back to players</Link>

    <section className="cvc-card mt-5"><div className="cvc-card-stripe" /><div className="cvc-card-body sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="flex flex-wrap items-start gap-5">
          <span className="relative grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-2xl bg-cvc-deep text-2xl font-black text-white">
            {headshot && !headshotFailed ? <img src={headshot} alt="" className="h-full w-full object-cover object-top" onError={() => setHeadshotFailed(true)} /> : initials}
            <span className={`absolute -right-1 -top-1 rounded-full px-2 py-0.5 text-[10px] font-black text-white ${positionColor[pos] ?? "bg-slate-700"}`}>{pos}</span>
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><h1 className="font-display text-4xl uppercase leading-none tracking-[0.02em] text-cvc-deep sm:text-5xl">{player.display_name}</h1>{jerseyNum ? <span className="text-lg font-bold text-slate-400">#{jerseyNum}</span> : null}</div>
            <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-500">
              {player.nfl_team ? <img src={teamLogoUrl(player.nfl_team)} alt="" className="h-4 w-4 object-contain" /> : null}
              {player.nfl_team ?? "NFL team pending"}{height ? ` · ${height}` : ""}{weight ? `, ${weight} lbs` : ""}{age ? ` · Age ${age}` : ""}{experience ? ` · ${experience} yrs` : ""}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {player.ownership ? <span className="inline-flex items-center gap-1.5 rounded-full bg-cvc-tint px-3 py-1 text-xs font-bold text-[var(--cvc-primary)]">{player.ownership.franchiseLogoUrl ? <img src={player.ownership.franchiseLogoUrl} alt="" className="h-4 w-4 rounded-full object-cover" /> : <ShieldCheck size={13} />}{player.ownership.franchiseName}</span> : <span className="inline-flex rounded-full bg-[var(--cvc-accent)] px-3 py-1 text-xs font-black text-cvc-deep">Free agent</span>}
              <span className={isInjuryStatus ? "cvc-pill questionable" : "cvc-pill"}>{isInjuryStatus ? statusLabel : "Active"}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 text-right">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">FantasyPros data</p>
          <div className="flex items-center gap-2">
            {espnPlayerUrl ? <a href={espnPlayerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-[var(--cvc-primary)] hover:underline">ESPN <ExternalLink size={11} /></a> : null}
            {owner?.franchise ? <button type="button" onClick={() => toggleWatch.mutate({ playerId })} className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-bold text-cvc-deep hover:bg-slate-50"><Star size={13} fill={isWatched ? "currentColor" : "none"} className={isWatched ? "text-amber-500" : ""} /> {isWatched ? "Watching" : "Watch"}</button> : null}
          </div>
        </div>
      </div>
    </div></section>

    {outlook.data?.positionRank || outlook.data?.overallRank || outlook.data?.projection ? <section className="mt-5 overflow-hidden rounded-xl bg-cvc-deep text-white">
      <div className="flex items-center justify-between px-5 py-3"><p className="text-xs font-black uppercase tracking-[0.1em] text-[var(--cvc-accent)]">FantasyPros Insights</p><p className="text-[10px] text-white/50">PPR · Expert consensus</p></div>
      <div className="grid grid-cols-2 gap-px bg-white/10 sm:grid-cols-4">
        <div className="bg-cvc-deep px-4 py-3"><p className="text-[10px] uppercase tracking-wide text-white/50">Overall ECR</p><p className="mt-0.5 text-lg font-black text-white">{outlook.data.overallRank?.ecr ?? "—"}</p></div>
        <div className="bg-cvc-deep px-4 py-3"><p className="text-[10px] uppercase tracking-wide text-white/50">Position rank</p><p className="mt-0.5 text-lg font-black text-white">{outlook.data.positionRank?.positionRank ?? "—"}</p></div>
        <div className="bg-cvc-deep px-4 py-3"><p className="text-[10px] uppercase tracking-wide text-white/50">Tier</p><p className="mt-0.5 text-lg font-black text-white">{outlook.data.positionRank?.tier ?? "—"}</p></div>
        <div className="bg-cvc-deep px-4 py-3"><p className="text-[10px] uppercase tracking-wide text-white/50">Week projection</p><p className="mt-0.5 text-lg font-black text-white">{outlook.data.projection?.pprPoints != null ? outlook.data.projection.pprPoints.toFixed(1) : "—"}</p></div>
      </div>
    </section> : null}

    {expertImpactItem ? <section className="mt-5 rounded-xl border border-[var(--cvc-primary)]/20 bg-[var(--cvc-tint)] p-5">
      <p className="text-xs font-black uppercase tracking-[0.1em] text-[var(--cvc-primary)]">FantasyPros Expert Impact</p>
      <p className="mt-3 text-sm leading-6 text-cvc-deep">{expertImpactItem.description}</p>
      {expertImpactItem.url ? <a href={expertImpactItem.url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs font-bold text-[var(--cvc-primary)] hover:underline">Read the full Expert Note on FantasyPros →</a> : null}
    </section> : null}

    <section className="cvc-card mt-5">
      <div className="cvc-card-title"><span>Latest News</span><Newspaper size={16} /></div>
      {(loadingNews || fantasyProsNews.isLoading) && !combinedPlayerNews.length ? <div className="cvc-card-body text-sm text-slate-500">Loading player news…</div>
        : combinedPlayerNews.length ? <>
          <div>{(showAllNews ? combinedPlayerNews : combinedPlayerNews.slice(0, 3)).map((item, index) => <CvcNewsRow key={`${item.source}-${item.headline}-${index}`} item={item} isFirst={index === 0} />)}</div>
          {combinedPlayerNews.length > 3 ? <button type="button" onClick={() => setShowAllNews(current => !current)} className="flex w-full items-center justify-center gap-1.5 border-t border-slate-100 py-3 text-xs font-bold uppercase tracking-[0.08em] text-slate-500 hover:bg-slate-50">{showAllNews ? "Show less" : `Show all ${combinedPlayerNews.length} updates`} <ChevronDown size={13} className={showAllNews ? "rotate-180" : ""} /></button> : null}
        </> : <div className="cvc-card-body text-sm text-slate-500">No recent news found for this player.</div>}
    </section>

    <section className="cvc-card mt-5">
      <div className="flex items-center gap-1 border-b border-slate-200 bg-white px-3 pt-2">
        {([["stats", "Stats", BarChart3], ["schedule", "Schedule", CalendarDays], ["gamelog", "Game Log", ClipboardList]] as const).map(([id, label, Icon]) => <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-1.5 border-b-[3px] px-4 py-3 text-xs font-black uppercase tracking-[0.08em] ${tab === id ? "border-[var(--cvc-accent)] text-cvc-deep" : "border-transparent text-slate-400 hover:text-cvc-deep"}`}><Icon size={14} />{label}</button>)}
      </div>

      {tab === "stats" ? <div>
        <div className="flex items-center gap-2 px-5 pt-4 text-xs font-black uppercase tracking-[0.08em] text-emerald-700"><TrendingUp size={14} /> Season Stats</div>
        <div className="mt-3 overflow-x-auto">
          {seasonStats.isLoading ? <p className="px-5 pb-5 text-sm text-slate-500">Loading season stats…</p>
            : seasonStats.data?.seasons.length ? <table className="w-full min-w-[720px] text-left text-sm">
              <thead><tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-500"><th className="px-5 py-2">Year</th><th className="px-3 py-2">Team</th><th className="px-3 py-2 text-right">GP</th><th className="px-3 py-2 text-right text-amber-600">PTS/G</th><th className="px-3 py-2 text-right text-emerald-700">CVC PTS</th>{pos === "QB" ? <><th className="px-3 py-2 text-right">CMP</th><th className="px-3 py-2 text-right">ATT</th><th className="px-3 py-2 text-right">CMP%</th><th className="px-3 py-2 text-right">YDS</th><th className="px-3 py-2 text-right">TD</th><th className="px-3 py-2 text-right">INT</th><th className="px-3 py-2 text-right">RUSH YDS</th><th className="px-3 py-2 text-right">RUSH TD</th></> : null}{(pos === "RB" || pos === "WR" || pos === "TE") ? <><th className="px-3 py-2 text-right">REC</th><th className="px-3 py-2 text-right">REC YDS</th><th className="px-3 py-2 text-right">REC TD</th><th className="px-3 py-2 text-right">RUSH YDS</th><th className="px-3 py-2 text-right">RUSH TD</th></> : null}{pos === "K" ? <><th className="px-3 py-2 text-right">FGM</th><th className="px-3 py-2 text-right">FGA</th><th className="px-3 py-2 text-right">XPM</th></> : null}</tr></thead>
              <tbody>{seasonStats.data.seasons.map((row, index) => <tr key={row.season} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
                <td className="px-5 py-2.5 font-bold text-cvc-deep">{row.season}{index === 0 ? <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-emerald-700">Latest</span> : null}</td>
                <td className="px-3 py-2.5">{row.team ? <img src={teamLogoUrl(row.team)} alt={row.team} className="h-5 w-5 object-contain" /> : "—"}</td>
                <td className="px-3 py-2.5 text-right">{row.gp}</td>
                <td className="px-3 py-2.5 text-right font-bold text-amber-600">{row.cvcPtsPerGame.toFixed(1)}</td>
                <td className="px-3 py-2.5 text-right font-bold text-emerald-700">{row.cvcPts.toFixed(1)}</td>
                {pos === "QB" ? <><td className="px-3 py-2.5 text-right">{row.passCmp ?? "—"}</td><td className="px-3 py-2.5 text-right">{row.passAtt ?? "—"}</td><td className="px-3 py-2.5 text-right">{row.passCmpPct != null ? `${row.passCmpPct}%` : "—"}</td><td className="px-3 py-2.5 text-right font-semibold">{row.passYds ?? "—"}</td><td className="px-3 py-2.5 text-right">{row.passTD ?? "—"}</td><td className="px-3 py-2.5 text-right">{row.passInt ?? "—"}</td><td className="px-3 py-2.5 text-right">{row.rushYds ?? "—"}</td><td className="px-3 py-2.5 text-right">{row.rushTD ?? "—"}</td></> : null}
                {(pos === "RB" || pos === "WR" || pos === "TE") ? <><td className="px-3 py-2.5 text-right">{row.rec ?? "—"}</td><td className="px-3 py-2.5 text-right">{row.recYds ?? "—"}</td><td className="px-3 py-2.5 text-right">{row.recTD ?? "—"}</td><td className="px-3 py-2.5 text-right">{row.rushYds ?? "—"}</td><td className="px-3 py-2.5 text-right">{row.rushTD ?? "—"}</td></> : null}
                {pos === "K" ? <><td className="px-3 py-2.5 text-right">{row.fgMade ?? "—"}</td><td className="px-3 py-2.5 text-right">{row.fgAtt ?? "—"}</td><td className="px-3 py-2.5 text-right">{row.xpMade ?? "—"}</td></> : null}
              </tr>)}</tbody>
            </table> : <p className="px-5 pb-5 text-sm text-slate-500">{espnId ? "No historical season stats found for this player." : "Season stats need an ESPN player ID, which Tank01 hasn't returned for this player."}</p>}
        </div>
      </div> : null}

      {tab === "schedule" ? <div className="overflow-x-auto">
        {scheduleRows.length ? <table className="w-full min-w-[520px] text-left text-sm"><thead><tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-500"><th className="px-5 py-2.5">Wk</th><th className="px-3 py-2.5">Date</th><th className="px-3 py-2.5">Opponent</th><th className="px-3 py-2.5">Time</th><th className="px-3 py-2.5">Result</th></tr></thead>
          <tbody>{scheduleRows.map((row, index) => row.type === "bye"
            ? <tr key={`bye-${row.week}`} className="border-b border-slate-100 bg-amber-50"><td className="px-5 py-2.5 font-bold text-amber-700">{row.week}</td><td colSpan={4} className="px-3 py-2.5 text-center text-xs font-black uppercase tracking-[0.08em] text-amber-700">Bye Week</td></tr>
            : <tr key={row.game.gameID as string ?? index} className={`border-b border-slate-100 last:border-b-0 hover:bg-slate-50 ${index === currentWeekIndex ? "bg-emerald-50" : ""}`}>
                <td className="px-5 py-2.5 font-bold text-cvc-deep">{index === currentWeekIndex ? "▶ " : ""}{row.week}</td>
                <td className="px-3 py-2.5 text-slate-500">{fmtDate(firstOf(row.game, ["gameDate", "date"]))}</td>
                <td className="px-3 py-2.5"><span className="inline-flex items-center gap-1.5"><img src={teamLogoUrl(row.opponent.opponent)} alt="" className="h-4 w-4 object-contain" />{row.opponent.atOrVs} {row.opponent.opponent}</span></td>
                <td className="px-3 py-2.5 text-slate-500">{firstOf(row.game, ["gameTime", "time"]) ?? "—"}</td>
                <td className="px-3 py-2.5 text-slate-400">—</td>
              </tr>)}</tbody>
        </table> : <p className="p-5 text-sm text-slate-500">Schedule data is unavailable for this player right now.</p>}
      </div> : null}

      {tab === "gamelog" ? <div>
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-5 py-3"><span className="mr-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-400">Season</span>{gameLogYearOptions.map(year => <button key={year} type="button" onClick={() => setGameLogYear(year)} className={`rounded-full px-3 py-1 text-xs font-bold ${year === gameLogYear ? "bg-emerald-700 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{year}</button>)}</div>
        <div className="overflow-x-auto">
          {gameLog.isLoading ? <p className="px-5 py-5 text-sm text-slate-500">Loading game log…</p>
            : gameLog.data?.games.length ? <table className="w-full min-w-[640px] text-left text-sm"><thead><tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-500"><th className="px-5 py-2.5">Wk</th><th className="px-3 py-2.5">Opp</th><th className="px-3 py-2.5">Result</th><th className="px-3 py-2.5 text-right text-emerald-700">CVC PTS</th>{gameLogColumns.map(column => <th key={column.key} className="px-3 py-2.5 text-right">{column.label}</th>)}</tr></thead>
              <tbody>{gameLog.data.games.map((game, index) => <tr key={game.gameId} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
                <td className="px-5 py-2.5 text-slate-500">{fmtDate(game.gameDate)}</td>
                <td className="px-3 py-2.5"><span className="inline-flex items-center gap-1.5"><img src={teamLogoUrl(game.opponent)} alt="" className="h-4 w-4 object-contain" />{game.isHome ? "vs" : "@"} {game.opponent}</span></td>
                <td className="px-3 py-2.5 text-slate-500">{game.result ?? "—"}</td>
                <td className="px-3 py-2.5 text-right font-bold text-emerald-700">{game.cvcPts.toFixed(1)}</td>
                {gameLogColumns.map(column => <td key={column.key} className="px-3 py-2.5 text-right">{(game as unknown as Record<string, number | undefined>)[column.key] ?? "—"}</td>)}
              </tr>)}</tbody>
            </table> : <p className="px-5 py-5 text-sm text-slate-500">No {gameLogYear} game log yet{gameLogYear === currentSeasonYear ? " — check back once games are underway." : "."}</p>}
        </div>
      </div> : null}
    </section>

    {upcoming ? <section className="cvc-card mt-5"><div className="cvc-card-title"><span>Week {firstOf(upcoming.game, ["gameWeek", "week"])?.replace(/\D/g, "") || "1"} Matchup</span><CalendarDays size={16} /></div><div className="cvc-card-body flex items-center justify-between"><span className="flex items-center gap-2"><img src={teamLogoUrl(upcoming.opponent!.opponent)} alt="" className="h-8 w-8 object-contain" /><span><p className="font-display text-xl text-cvc-deep">{upcoming.opponent!.atOrVs} {upcoming.opponent!.opponent}</p><p className="text-xs text-slate-500">{firstOf(upcoming.game, ["gameTime", "time"]) ?? ""}</p></span></span>{player.nfl_team ? <img src={teamLogoUrl(player.nfl_team)} alt="" className="h-8 w-8 object-contain" /> : null}</div></section> : null}
  </div>;
}
