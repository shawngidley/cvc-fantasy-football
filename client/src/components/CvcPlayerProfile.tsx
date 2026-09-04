import { useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { ArrowLeft, BarChart3, CalendarDays, ClipboardList, Newspaper, ShieldCheck, TrendingUp } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { normalizePlayerName } from "@shared/playerNameMatch";
import { CvcNewsRow, type CvcNewsItem } from "@/components/CvcNewsRow";

type TankRecord = Record<string, unknown>;
type TankPlayerInfo = { body?: TankRecord | TankRecord[] };
type TankNewsItem = { title?: string; link?: string; image?: string; playerIDs?: string[] };
type FlattenedStats = { row: TankRecord; stats: TankRecord; passing: TankRecord; rushing: TankRecord; receiving: TankRecord; kicking: TankRecord; defense: TankRecord };

const positionColor: Record<string, string> = { QB: "bg-red-600", RB: "bg-emerald-700", WR: "bg-blue-700", TE: "bg-amber-700", K: "bg-violet-700", DST: "bg-slate-700" };
const NEWS_CACHE_KEY = "cvc_tank01_news_v1";
const NEWS_TTL_MS = 15 * 60_000;
const infoCache = new Map<string, TankRecord | null>();
const scheduleCache = new Map<string, TankRecord[] | null>();

function asRecord(value: unknown): TankRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as TankRecord : {}; }
function firstOf(source: TankRecord | undefined, keys: string[]): string | null { for (const key of keys) { const candidate = source?.[key]; if (candidate !== undefined && candidate !== null && candidate !== "") return String(candidate); } return null; }
function flattenStats(row: TankRecord | null): FlattenedStats { const source = row ?? {}; const stats = asRecord(source.stats); const flat = Object.keys(stats).length ? stats : source; return { row: source, stats: flat, passing: asRecord(flat.Passing), rushing: asRecord(flat.Rushing), receiving: asRecord(flat.Receiving), kicking: asRecord(flat.Kicking), defense: asRecord(flat.Defense) }; }
function looksLikeInjury(text: string) { return /injur|questionable|doubtful| ruled out|out for|ir |surgery|concussion|hamstring|ankle|knee|illness/i.test(text); }
const normalizeTeam = (team: string | null | undefined) => ({ kan: "kc", tam: "tb", arz: "ari", jax: "jac", was: "wsh" }[(team ?? "").toLowerCase()] ?? (team ?? "").toLowerCase());

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

/** getNFLTeamSchedule has no existing usage anywhere else in this codebase, so its response
 * shape is unverified — parsed defensively against Tank01's documented field names and hidden
 * entirely if nothing recognizable comes back, rather than risk showing wrong data. */
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

export function CvcPlayerProfile() {
  const [, params] = useRoute("/player/:playerId");
  const playerId = params?.playerId ?? "";
  const valid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(playerId);
  const detail = trpc.league.playerDetail.useQuery({ playerId: valid ? playerId : "00000000-0000-0000-0000-000000000000" }, { enabled: valid });
  const [tab, setTab] = useState<"stats" | "schedule" | "gamelog">("stats");
  const { row: tank, loading: loadingInfo } = useTank01PlayerInfo(detail.data?.display_name);
  const { items: news, loading: loadingNews } = usePlayerNews(detail.data?.display_name);
  // Same source and matching approach as the main News page (CvcPlayerNews.tsx) --
  // fetches the general FantasyPros feed and filters client-side to this one player via
  // the shared canonical name normalizer, rather than a separate per-player API call.
  const fantasyProsNews = trpc.league.fantasyProsNews.useQuery({ limit: 100 }, { staleTime: 15 * 60_000 });
  const normalizedPlayerName = detail.data?.display_name ? normalizePlayerName(detail.data.display_name) : "";
  const fantasyProsPlayerNews = useMemo<CvcNewsItem[]>(() => {
    if (!normalizedPlayerName) return [];
    return (fantasyProsNews.data?.items ?? [])
      .filter(item => normalizePlayerName(item.playerName) === normalizedPlayerName)
      .map(item => ({
        playerName: item.playerName, pos: item.position ?? "", nflTeam: item.team ?? "",
        headline: item.title, description: item.impact || item.description || undefined,
        published: item.published, url: item.link, isInjury: item.isInjury,
        source: "FantasyPros" as const, playerId: item.playerId,
      }));
  }, [fantasyProsNews.data, normalizedPlayerName]);
  const tank01PlayerNews = useMemo<CvcNewsItem[]>(() => news.map((item, index) => ({
    playerName: detail.data?.display_name ?? "", pos: detail.data?.position ?? "", nflTeam: detail.data?.nfl_team ?? "",
    headline: item.title ?? "", published: new Date(Date.now() - index).toISOString(), url: item.link,
    isInjury: looksLikeInjury(item.title ?? ""), source: "Tank01" as const, playerId: detail.data?.id ?? null,
  })), [news, detail.data]);
  // FantasyPros first (real dates, richer detail) then Tank01, since Tank01 items have
  // no real timestamp to interleave by (see the synthetic `published` above).
  const combinedPlayerNews = [...fantasyProsPlayerNews, ...tank01PlayerNews];
  const outlook = trpc.league.fantasyProsPlayerOutlook.useQuery({ playerId: params?.playerId ?? "" }, { enabled: Boolean(params?.playerId), staleTime: 30 * 60_000 });
  const { games: schedule } = useTeamSchedule(detail.data?.nfl_team, valid);
  const { games: gameLog, loading: loadingGameLog } = useTeamSchedule(detail.data?.nfl_team, tab === "gamelog"); // shares the schedule shape/cache; see note in Game Log tab below
  const metrics = useMemo(() => flattenStats(tank), [tank]);
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
  const statusPillClass = looksLikeInjury(statusLabel) ? "cvc-pill questionable" : "cvc-pill";
  const rankEcr = (player.metadata as { rank_ecr?: number } | null)?.rank_ecr;
  const rankAdp = (player.metadata as { rank_adp?: number } | null)?.rank_adp;
  const hasExpertConsensus = Boolean(rankEcr || rankAdp);
  const upcoming = schedule?.map(game => ({ game, opponent: gameOpponent(game, player.nfl_team ?? "") })).find(entry => entry.opponent);

  const positionStats = pos === "QB"
    ? [["PASS YDS", firstOf(metrics.passing, ["passYds", "passingYards"]) ?? "—"], ["PASS TD", firstOf(metrics.passing, ["passTD", "passingTD"]) ?? "—"], ["INT", firstOf(metrics.passing, ["int", "interceptions"]) ?? "—"]]
    : pos === "K"
    ? [["FGM", firstOf(metrics.kicking, ["fgMade", "fieldGoalsMade"]) ?? "—"], ["XPM", firstOf(metrics.kicking, ["xpMade", "extraPointsMade"]) ?? "—"], ["PTS", firstOf(metrics.stats, ["fantasyPoints"]) ?? "—"]]
    : pos === "DST"
    ? [["SACK", firstOf(metrics.defense, ["sacks"]) ?? "—"], ["INT", firstOf(metrics.defense, ["defensiveInterceptions", "interceptions"]) ?? "—"], ["TD", firstOf(metrics.defense, ["defTD", "touchdowns"]) ?? "—"]]
    : [["RUSH YDS", firstOf(metrics.rushing, ["rushYds", "rushingYards"]) ?? "—"], ["REC", firstOf(metrics.receiving, ["receptions", "rec"]) ?? "—"], ["REC YDS", firstOf(metrics.receiving, ["recYds", "receivingYards"]) ?? "—"], ["TD", firstOf(metrics.receiving, ["recTD", "receivingTD"]) ?? "—"]];
  const hasStats = Object.keys(metrics.stats).length > 0;

  return <div className="mx-auto max-w-5xl">
    <Link href="/free-agents" className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-cvc-accent hover:text-[var(--cvc-accent-soft)]"><ArrowLeft size={15} /> Back to players</Link>

    <section className="cvc-card mt-5"><div className="cvc-card-stripe" /><div className="cvc-card-body sm:p-7"><div className="flex flex-wrap items-start gap-5">
      <span className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-2xl bg-cvc-deep text-2xl font-black text-white">{headshot && !headshotFailed ? <img src={headshot} alt="" className="h-full w-full object-cover object-top" onError={() => setHeadshotFailed(true)} /> : initials}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><h1 className="font-display text-4xl uppercase leading-none tracking-[0.02em] text-cvc-deep sm:text-5xl">{player.display_name}</h1><span className={`rounded px-2 py-1 text-xs font-black text-white ${positionColor[pos] ?? "bg-slate-700"}`}>{pos}</span>{jerseyNum ? <span className="text-lg font-bold text-slate-400">#{jerseyNum}</span> : null}</div>
        <p className="mt-2 text-sm text-slate-500">{player.nfl_team ?? "NFL team pending"}{height ? ` · ${height}` : ""}{weight ? ` · ${weight} lb` : ""}{age ? ` · Age ${age}` : ""}{experience ? ` · ${experience} yr exp` : ""}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {player.ownership ? <span className="inline-flex items-center gap-1.5 rounded-full bg-cvc-tint px-3 py-1 text-xs font-bold text-[var(--cvc-primary)]"><ShieldCheck size={13} />{player.ownership.franchiseName}{player.ownership.ownerName ? ` · ${player.ownership.ownerName}` : ""}</span> : <span className="inline-flex rounded-full bg-[var(--cvc-accent)] px-3 py-1 text-xs font-black text-cvc-deep">Free agent</span>}
          <span className={statusPillClass}>{statusLabel}</span>
        </div>
      </div>
    </div></div></section>

    {hasExpertConsensus || outlook.data?.positionRank || outlook.data?.overallRank || outlook.data?.projection ? <section className="cvc-card mt-5"><div className="cvc-card-title"><span>Expert Consensus</span><TrendingUp size={16} /></div><div className="cvc-card-body grid grid-cols-2 gap-4 sm:grid-cols-4">
      {outlook.data?.overallRank?.ecr ?? rankEcr ? <div><p className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">Overall rank</p><p className="mt-1 font-display text-3xl text-cvc-deep">#{outlook.data?.overallRank?.ecr ?? rankEcr}</p></div> : null}
      {outlook.data?.positionRank?.positionRank ? <div><p className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">Position rank</p><p className="mt-1 font-display text-3xl text-cvc-deep">{outlook.data.positionRank.positionRank}</p>{outlook.data.positionRank.tier ? <p className="text-xs text-slate-500">Tier {outlook.data.positionRank.tier}</p> : null}</div> : null}
      {rankAdp ? <div><p className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">ADP</p><p className="mt-1 font-display text-3xl text-cvc-deep">{rankAdp}</p></div> : null}
      {outlook.data?.projection?.pprPoints != null ? <div><p className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">Proj. pts (PPR){outlook.data.weekNumber ? ` · Wk ${outlook.data.weekNumber}` : ""}</p><p className="mt-1 font-display text-3xl text-cvc-deep">{outlook.data.projection.pprPoints.toFixed(1)}</p></div> : null}
    </div>
    {outlook.data?.projection && (outlook.data.projection.passYards || outlook.data.projection.rushYards) ? <div className="cvc-card-body grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-4">
      {outlook.data.projection.passYards ? <div><p className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">Proj. pass yds</p><p className="mt-1 text-lg font-black text-cvc-deep">{outlook.data.projection.passYards.toFixed(0)}</p></div> : null}
      {outlook.data.projection.passTouchdowns ? <div><p className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">Proj. pass TD</p><p className="mt-1 text-lg font-black text-cvc-deep">{outlook.data.projection.passTouchdowns.toFixed(1)}</p></div> : null}
      {outlook.data.projection.rushYards ? <div><p className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">Proj. rush yds</p><p className="mt-1 text-lg font-black text-cvc-deep">{outlook.data.projection.rushYards.toFixed(0)}</p></div> : null}
      {outlook.data.projection.rushTouchdowns ? <div><p className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">Proj. rush TD</p><p className="mt-1 text-lg font-black text-cvc-deep">{outlook.data.projection.rushTouchdowns.toFixed(1)}</p></div> : null}
    </div> : null}
    </section> : null}

    {upcoming ? <section className="cvc-card mt-5"><div className="cvc-card-title"><span>Upcoming Matchup</span><CalendarDays size={16} /></div><div className="cvc-card-body flex items-center justify-between"><p className="font-display text-2xl text-cvc-deep">{upcoming.opponent!.atOrVs} {upcoming.opponent!.opponent}</p><p className="text-sm text-slate-500">{firstOf(upcoming.game, ["gameWeek", "week"]) ? `Week ${firstOf(upcoming.game, ["gameWeek", "week"])}` : ""} {firstOf(upcoming.game, ["gameDate", "date"]) ?? ""}</p></div></section> : null}

    {loadingNews || fantasyProsNews.isLoading || combinedPlayerNews.length ? <section className="cvc-card mt-5"><div className="cvc-card-title"><span>Player News</span><Newspaper size={16} /></div>{(loadingNews || fantasyProsNews.isLoading) && !combinedPlayerNews.length ? <div className="cvc-card-body text-sm text-slate-500">Loading player news…</div> : combinedPlayerNews.length ? <div>{combinedPlayerNews.map((item, index) => <CvcNewsRow key={`${item.source}-${item.headline}-${index}`} item={item} isFirst={index === 0} />)}</div> : <div className="cvc-card-body text-sm text-slate-500">No recent news found for this player.</div>}</section> : null}

    <section className="cvc-card mt-5">
      <div className="flex items-center gap-1 border-b border-slate-200 bg-white px-3 pt-2">
        {([["stats", "Season Stats", BarChart3], ["schedule", "Schedule", CalendarDays], ["gamelog", "Game Log", ClipboardList]] as const).map(([id, label, Icon]) => <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-1.5 border-b-[3px] px-4 py-3 text-xs font-black uppercase tracking-[0.08em] ${tab === id ? "border-[var(--cvc-accent)] text-cvc-deep" : "border-transparent text-slate-400 hover:text-cvc-deep"}`}><Icon size={14} />{label}</button>)}
      </div>
      <div className="cvc-card-body">
        {tab === "stats" ? (hasStats ? <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-slate-200 sm:grid-cols-4">{positionStats.map(([label, value]) => <div key={label} className="bg-white p-4"><p className="text-[10px] font-black uppercase text-slate-500">{label}</p><p className="mt-1 text-xl font-black text-cvc-deep">{value}</p></div>)}</div> : <p className="text-sm text-slate-500">{loadingInfo ? "Loading Tank01 season stats…" : "Season stats are unavailable for this player right now."}</p>) : null}
        {tab === "schedule" ? (schedule?.length ? <div className="overflow-x-auto"><table className="cvc-table"><thead><tr><th>Week</th><th>Opponent</th><th>Date</th></tr></thead><tbody>{schedule.map((game, index) => { const opponent = gameOpponent(game, player.nfl_team ?? ""); return opponent ? <tr key={index}><td>{firstOf(game, ["gameWeek", "week"]) ?? "—"}</td><td>{opponent.atOrVs} {opponent.opponent}</td><td>{firstOf(game, ["gameDate", "date"]) ?? "—"}</td></tr> : null; })}</tbody></table></div> : <p className="text-sm text-slate-500">Schedule data is unavailable for this player right now.</p>) : null}
        {/* Game Log reuses the team-schedule fetch as a stand-in for a played-games list since
            getNFLGamesForPlayer has no existing usage/parsing anywhere in this codebase — its real
            response shape needs confirming against a live call before this tab shows box-score-level
            detail (points, targets, etc.) rather than just the schedule. */}
        {tab === "gamelog" ? (gameLog?.length ? <p className="text-sm text-slate-500">Game-by-game detail requires confirming getNFLGamesForPlayer's response shape against a live Tank01 call — showing schedule context only for now.</p> : <p className="text-sm text-slate-500">{loadingGameLog ? "Loading…" : "Game log is unavailable for this player right now."}</p>) : null}
      </div>
    </section>
  </div>;
}
