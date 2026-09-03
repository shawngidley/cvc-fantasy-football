import { useMemo, useState } from "react";
import { AlertTriangle, Newspaper, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCvcOwnerAuth } from "@/hooks/useCvcOwnerAuth";
import { CvcNewsRow, type CvcNewsItem } from "@/components/CvcNewsRow";

// Same normalization used elsewhere (fantasyProsNews procedure, CvcWrcPlayerNews) for
// matching against CVC's own player records.
function normalizeName(name: string) {
  return name.toLowerCase().replace(/\./g, "").replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/\s+/g, " ").trim();
}

function useMyRosterNames() {
  const auth = useCvcOwnerAuth();
  const mine = trpc.league.myFranchise.useQuery(undefined, { enabled: auth.isAuthenticated });
  const roster = trpc.league.franchiseRoster.useQuery({ franchiseId: mine.data?.id ?? "00000000-0000-0000-0000-000000000000" }, { enabled: Boolean(mine.data?.id) });
  const names = useMemo(() => new Set((roster.data?.players.map(row => row.player?.display_name).filter(Boolean) as string[] | undefined ?? []).map(normalizeName)), [roster.data]);
  return { names, isLoading: mine.isLoading || roster.isLoading, isAuthenticated: auth.isAuthenticated };
}

/** Ported from WRC's Standings.tsx InjuryReport -- same card layout, same "always
 * roster-scoped, no toggle" behavior (WRC shows a disabled 'My Roster' pill here,
 * unlike the full News page's togglable My Team filter). */
export function CvcInjuryReport() {
  const roster = useMyRosterNames();
  const injuries = trpc.league.fantasyProsInjuries.useQuery(undefined, { enabled: roster.isAuthenticated, staleTime: 20 * 60_000 });

  const items = useMemo<CvcNewsItem[]>(() => {
    return (injuries.data?.items ?? [])
      .filter(item => roster.names.has(normalizeName(item.playerName)))
      .map(item => ({
        playerName: item.playerName, pos: item.position ?? "", nflTeam: item.team ?? "",
        headline: item.headline, description: item.description, published: item.published,
        isInjury: true, source: "FantasyPros" as const, playerId: item.playerId,
      }));
  }, [injuries.data, roster.names]);

  const loading = roster.isLoading || injuries.isLoading;

  if (!roster.isAuthenticated) return null;

  return <section className="mb-5 overflow-hidden rounded-xl border border-white/10 bg-white text-cvc-deep">
    <div className="h-1 bg-[#dcae37]" />
    <div className="flex items-center gap-2 px-4 py-3.5">
      <span className="font-display text-base uppercase tracking-[0.02em]">Injuries</span>
      <span className="ml-auto rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold text-slate-500">My Roster</span>
      <button onClick={() => injuries.refetch()} className="rounded p-1 text-slate-500 hover:text-cvc-accent" aria-label="Refresh injuries"><RefreshCw size={13} className={loading ? "animate-spin" : ""} /></button>
    </div>
    {loading ? (
      <div className="space-y-2 px-5 pb-4">{[1, 2, 3].map(index => <div key={index} className="h-11 animate-pulse rounded-lg bg-slate-100" />)}</div>
    ) : items.length === 0 ? (
      <div className="px-5 pb-5 pt-1 text-center text-sm text-slate-500"><AlertTriangle size={20} className="mx-auto mb-1.5 opacity-35" />No injury news found for your players</div>
    ) : (
      <div className="pb-1">{items.map((item, index) => <CvcNewsRow key={index} item={item} isFirst={index === 0} />)}</div>
    )}
  </section>;
}

/** Ported from WRC's Standings.tsx MyTeamNews -- FantasyPros only (no Tank01) to match
 * WRC's actual scope for this specific panel, with the same "preview 8, show all" pattern. */
export function CvcMyTeamNews() {
  const roster = useMyRosterNames();
  const news = trpc.league.fantasyProsNews.useQuery({ limit: 100 }, { enabled: roster.isAuthenticated, staleTime: 15 * 60_000 });
  const [showAll, setShowAll] = useState(false);

  const items = useMemo<CvcNewsItem[]>(() => {
    return (news.data?.items ?? [])
      .filter(item => roster.names.has(normalizeName(item.playerName)))
      .map(item => ({
        playerName: item.playerName, pos: item.position ?? "", nflTeam: item.team ?? "",
        headline: item.title, description: item.impact || item.description || undefined,
        published: item.published, url: item.link, isInjury: item.isInjury,
        source: "FantasyPros" as const, playerId: item.playerId,
      }));
  }, [news.data, roster.names]);

  const loading = roster.isLoading || news.isLoading;
  const preview = items.slice(0, 8);
  const displayed = showAll ? items : preview;

  if (!roster.isAuthenticated) return null;

  return <section className="mb-5 overflow-hidden rounded-xl border border-white/10 bg-white text-cvc-deep">
    <div className="h-1 bg-[#dcae37]" />
    <div className="flex items-center gap-2 px-4 py-3.5">
      <span className="font-display text-base uppercase tracking-[0.02em]">Player News</span>
      <span className="ml-auto rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold text-slate-500">My Roster</span>
      <button onClick={() => news.refetch()} className="rounded p-1 text-slate-500 hover:text-cvc-accent" aria-label="Refresh player news"><RefreshCw size={13} className={loading ? "animate-spin" : ""} /></button>
    </div>
    {loading ? (
      <div className="space-y-2 px-5 pb-4">{[1, 2, 3, 4, 5].map(index => <div key={index} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}</div>
    ) : displayed.length === 0 ? (
      <div className="px-5 pb-5 pt-1 text-center text-sm text-slate-500"><Newspaper size={20} className="mx-auto mb-1.5 opacity-35" />No current FantasyPros news found for your roster</div>
    ) : (
      <div className="pb-1">
        {displayed.map((item, index) => <CvcNewsRow key={index} item={item} isFirst={index === 0} />)}
        {items.length > preview.length ? (
          <button onClick={() => setShowAll(value => !value)} className="mx-4 mb-2 mt-1 w-[calc(100%-2rem)] rounded-lg border border-slate-200 bg-slate-50 py-2 text-xs font-bold text-cvc-deep hover:bg-slate-100">{showAll ? "Show fewer updates" : `Show all ${items.length} updates`}</button>
        ) : null}
      </div>
    )}
  </section>;
}
