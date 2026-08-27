import { useEffect, useMemo, useState } from "react";
import { Newspaper, RefreshCw, ShieldAlert } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCvcOwnerAuth } from "@/hooks/useCvcOwnerAuth";
import { CvcNewsRow, type CvcNewsItem } from "@/components/CvcNewsRow";

type TankNews = { title?: string; link?: string; image?: string; playerIDs?: string[] };
type NewsSource = "FANTASYPROS" | "TANK01" | "ALL";
const CACHE_KEY = "cvc_tank01_news_v1";
const TTL_MS = 15 * 60_000;
const ELIGIBLE_POSITIONS = ["QB", "RB", "WR", "TE", "K"];
const INJURY_KEYWORDS = ["injur", "questionable", "doubtful", " ruled out", "out for", " ir ", "surgery", "concussion", "hamstring", "ankle", "knee", "illness"];

// Same normalization used server-side (fantasyProsNews procedure in league.ts) for
// matching news headlines against CVC's own player records -- kept in sync manually,
// same as the existing convention elsewhere in this codebase (rosterNewsMapping-style
// per-file normalizers) rather than introducing a shared import for one small function.
function normalizeName(name: string) {
  return name.toLowerCase().replace(/\./g, "").replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/\s+/g, " ").trim();
}

export function CvcWrcPlayerNews() {
  const auth = useCvcOwnerAuth();
  const mine = trpc.league.myFranchise.useQuery(undefined, { enabled: auth.isAuthenticated });
  const roster = trpc.league.franchiseRoster.useQuery({ franchiseId: mine.data?.id ?? "00000000-0000-0000-0000-000000000000" }, { enabled: Boolean(mine.data?.id) });
  const playerIndex = trpc.league.newsPlayerIndex.useQuery();
  const fantasyPros = trpc.league.fantasyProsNews.useQuery({ limit: 100 }, { staleTime: 0, refetchOnMount: "always" });

  const [tankItems, setTankItems] = useState<TankNews[]>([]);
  const [tankLoading, setTankLoading] = useState(true);
  const [tankError, setTankError] = useState("");
  const [myTeamOnly, setMyTeamOnly] = useState(false);
  const [position, setPosition] = useState("ALL");
  const [source, setSource] = useState<NewsSource>("FANTASYPROS");

  const loadTank01 = async (force = false) => {
    setTankLoading(true); setTankError("");
    try {
      if (!force) {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) { const parsed = JSON.parse(cached) as { ts: number; data: TankNews[] }; if (Date.now() - parsed.ts < TTL_MS) { setTankItems(parsed.data); setTankLoading(false); return; } }
      }
      const response = await fetch("/api/tank01/getNFLNews?recentNews=true");
      if (!response.ok) throw new Error("Tank01 news is unavailable");
      const payload = await response.json() as { body?: TankNews[] };
      const fresh = Array.isArray(payload.body) ? payload.body.filter(item => item.title) : [];
      setTankItems(fresh); sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: fresh }));
    } catch (cause) { setTankError(cause instanceof Error ? cause.message : "Tank01 news is unavailable"); }
    finally { setTankLoading(false); }
  };
  useEffect(() => { void loadTank01(); }, []);

  const playerByName = useMemo(() => new Map((playerIndex.data ?? []).map(row => [normalizeName(row.display_name), row])), [playerIndex.data]);

  const tankMapped = useMemo<CvcNewsItem[]>(() => {
    return tankItems.map(item => {
      const title = item.title ?? "";
      // Tank01 news doesn't carry a player name field directly -- the same
      // leading-name-before-a-verb heuristic FantasyPros' own feed needs (their
      // generic items omit player_name too) works here as well, since both are
      // headline-style "Player Name did X" text.
      const cleaned = title.replace(/\s*\([^)]*\)/g, "").trim();
      const verbs = "is|to|week|primed|signing|signs|released|waived|misses|suffers|works|returns|dealing|placed|goes|not|will|plays|starts|exits|practices|participated|expected|day|activated|traded|cut";
      const match = cleaned.match(new RegExp(`^([A-Z][A-Za-z.'-]*(?:\\s+(?:[A-Z][A-Za-z.'-]*|Jr\\.?|Sr\\.?|II|III)){1,3})(?=\\s+(?:${verbs})\\b)`));
      const inferredName = match?.[1] ?? "";
      const player = inferredName ? playerByName.get(normalizeName(inferredName)) : undefined;
      if (!player) return null as CvcNewsItem | null;
      const text = title.toLowerCase();
      const mapped: CvcNewsItem = {
        playerName: player.display_name, pos: player.position ?? "", nflTeam: player.nfl_team ?? "",
        headline: title, published: new Date().toISOString(), url: item.link,
        isInjury: INJURY_KEYWORDS.some(keyword => text.includes(keyword)),
        source: "Tank01", playerId: player.id,
      };
      return mapped;
    }).filter((item): item is CvcNewsItem => item !== null);
  }, [tankItems, playerByName]);

  const fantasyProsMapped = useMemo<CvcNewsItem[]>(() => {
    return (fantasyPros.data?.items ?? []).map(item => ({
      playerName: item.playerName, pos: item.position ?? "", nflTeam: item.team ?? "",
      headline: item.title, description: item.impact || item.description || undefined,
      published: item.published, url: item.link, isInjury: item.isInjury,
      source: "FantasyPros" as const, playerId: item.playerId,
    }));
  }, [fantasyPros.data]);

  const bySource: Record<NewsSource, CvcNewsItem[]> = {
    FANTASYPROS: fantasyProsMapped,
    TANK01: tankMapped,
    ALL: [...fantasyProsMapped, ...tankMapped].sort((a, b) => new Date(b.published).getTime() - new Date(a.published).getTime()),
  };

  const rosterNames = new Set((roster.data?.players.map(row => row.player?.display_name).filter(Boolean) as string[] | undefined ?? []).map(normalizeName));
  const shown = useMemo(() => bySource[source].filter(item => {
    const relevant = !myTeamOnly || rosterNames.has(normalizeName(item.playerName));
    const positional = position === "ALL" || item.pos === position;
    return relevant && positional;
  }), [bySource, source, myTeamOnly, position, rosterNames]);

  const isLoading = source === "TANK01" ? tankLoading : source === "FANTASYPROS" ? fantasyPros.isLoading : tankLoading || fantasyPros.isLoading;
  const isUnavailable = source === "FANTASYPROS" && fantasyPros.isError && !fantasyPros.data;
  const positions = ["ALL", "QB", "RB", "WR", "TE", "K"];
  const refresh = () => { void loadTank01(true); void fantasyPros.refetch(); };

  return <section className="min-h-screen bg-[#06121b] px-3 pb-14 pt-5 text-white sm:px-6"><div className="mx-auto max-w-4xl">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div><p className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-cvc-accent">Player Wire</p><h1 className="font-display text-5xl uppercase leading-none sm:text-6xl">News</h1><p className="mt-3 text-sm text-slate-300">NFL news — ESPN, Tank01 &amp; FantasyPros updates</p></div>
      <div className="flex gap-2">
        {auth.isAuthenticated ? <button onClick={() => setMyTeamOnly(value => !value)} className={`rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.1em] ${myTeamOnly ? "border-cvc-accent bg-cvc-accent text-cvc-deep" : "border-white/20 bg-white/5 text-white"}`}>{myTeamOnly ? "✓ My Team" : "My Team"}</button> : null}
        <button onClick={refresh} className="rounded-full border border-white/20 bg-white/5 p-2.5 text-cvc-accent" aria-label="Refresh news"><RefreshCw size={15} className={isLoading ? "animate-spin" : ""} /></button>
      </div>
    </div>

    <div className="mb-4 flex flex-wrap items-center gap-2">
      <label htmlFor="news-source" className="text-xs font-black uppercase tracking-[0.06em] text-white">News source</label>
      <select id="news-source" value={source} onChange={event => setSource(event.target.value as NewsSource)} className="rounded-lg border border-white/20 bg-white px-3 py-2 text-sm font-bold text-cvc-deep">
        <option value="FANTASYPROS">FantasyPros</option>
        <option value="TANK01">Tank01</option>
        <option value="ALL">All News</option>
      </select>
    </div>

    <div className="mb-4 flex flex-wrap gap-2">{positions.map(value => <button key={value} onClick={() => setPosition(value)} className={`rounded-full border px-3 py-1.5 text-xs font-black ${position === value ? "border-cvc-accent bg-cvc-accent text-cvc-deep" : "border-white/20 bg-white/5 text-slate-200"}`}>{value}</button>)}</div>

    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white text-cvc-deep">
      <div className="border-b-4 border-cvc-accent px-5 py-4"><div className="flex items-center gap-2"><Newspaper size={17} className="text-cvc-accent" /><span className="text-xs font-black uppercase tracking-[0.16em]">NFL Player News</span><span className="ml-auto text-xs text-slate-500">{isLoading ? "Loading…" : source === "FANTASYPROS" ? `${shown.length} articles · Last 7 days` : `${shown.length} articles`}</span></div></div>
      {isUnavailable ? (
        <div className="p-8 text-center"><ShieldAlert className="mx-auto text-amber-600" /><p className="mt-3 font-semibold">FantasyPros news is temporarily unavailable.</p><button onClick={refresh} className="mt-4 rounded-lg bg-cvc-deep px-3 py-2 text-xs font-black uppercase text-white">Try again</button></div>
      ) : tankError && source !== "FANTASYPROS" ? (
        <div className="p-8 text-center"><ShieldAlert className="mx-auto text-amber-600" /><p className="mt-3 font-semibold">{tankError}</p><button onClick={refresh} className="mt-4 rounded-lg bg-cvc-deep px-3 py-2 text-xs font-black uppercase text-white">Try again</button></div>
      ) : isLoading ? (
        <div className="p-10 text-center text-slate-500">Loading player news…</div>
      ) : shown.length ? (
        <div>{shown.map((item, index) => <CvcNewsRow key={`${item.source}-${item.playerName}-${item.published}-${index}`} item={item} isFirst={index === 0} />)}</div>
      ) : (
        <div className="p-10 text-center text-slate-500">No player news matches this CVC filter.</div>
      )}
      <div className="border-t border-slate-100 px-4 py-2 text-[10px] text-slate-500">FantasyPros data is used under its personal, non-commercial API license.</div>
    </div>
  </div></section>;
}
