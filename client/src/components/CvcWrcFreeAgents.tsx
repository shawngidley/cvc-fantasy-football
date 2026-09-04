// @ts-nocheck
import { trpc } from "@/lib/trpc";
import { useCvcOwnerAuth } from "@/hooks/useCvcOwnerAuth";
import { Link } from "wouter";
import { ArrowDownUp, DollarSign, Search, ShieldCheck, SlidersHorizontal, Star, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  FREE_AGENT_CONFIGURABLE_COLUMNS,
  normalizeFreeAgentVisibleColumns,
  toggleFreeAgentVisibleColumn,
  type FreeAgentConfigurableColumn,
} from "@/lib/freeAgentColumnPreferences";

const POSITIONS = ["ALL", "SFLEX", "QB", "RB", "WR", "TE", "K", "DST"];
const SFLEX_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
const badgeTone: Record<string, string> = { QB: "bg-violet-50 text-violet-700", RB: "bg-emerald-50 text-emerald-700", WR: "bg-sky-50 text-sky-700", TE: "bg-amber-50 text-amber-700", K: "bg-fuchsia-50 text-fuchsia-700", DST: "bg-slate-100 text-slate-700" };
const normalizeTeam = (team: string | null | undefined) => ({ kan: "kc", tam: "tb", arz: "ari", jax: "jac", was: "wsh" }[(team ?? "").toLowerCase()] ?? (team ?? "").toLowerCase());
const teamLogo = (team: string | null | undefined) => `https://a.espncdn.com/i/teamlogos/nfl/500/${normalizeTeam(team)}.png`;
const fmt = (value: number | null | undefined) => value === null || value === undefined ? "—" : Number.isInteger(value) ? String(value) : value.toFixed(1);

// Column labels/season-stat keys, matching what CVC's player_season_stat table actually
// carries (see attachSeasonStats in league.ts). Unlike WRC's model, CVC has no NFL
// schedule/bye-week/opponent or projections data source, so Age/Bye/Opp/Game/Proj are
// intentionally not included here -- that would need a separate subsystem, not just a
// UI change.
const COLUMN_DEFS: Record<FreeAgentConfigurableColumn, { label: string; statKey: string }> = {
  gp: { label: "GP", statKey: "games_played" },
  fpts: { label: "FPTS", statKey: "fantasy_points" },
  fpg: { label: "FP/G", statKey: "fantasy_points_per_game" },
  passYds: { label: "PASS YDS", statKey: "pass_yds" },
  passTD: { label: "PASS TD", statKey: "pass_td" },
  passInt: { label: "INT", statKey: "pass_int" },
  rushAtt: { label: "ATT", statKey: "rush_att" },
  rushYds: { label: "RUSH YDS", statKey: "rush_yds" },
  rushTD: { label: "RUSH TD", statKey: "rush_td" },
  targets: { label: "TGT", statKey: "targets" },
  receptions: { label: "REC", statKey: "receptions" },
  recYds: { label: "REC YDS", statKey: "rec_yds" },
  recTD: { label: "REC TD", statKey: "rec_td" },
  fgMade: { label: "FGM", statKey: "fg_made" },
  xpMade: { label: "XPM", statKey: "xp_made" },
  sacks: { label: "SACK", statKey: "sacks" },
  defInt: { label: "D.INT", statKey: "def_int" },
  defTD: { label: "D.TD", statKey: "def_td" },
};

const COLUMN_STORAGE_KEY = "cvc_free_agent_columns_v1";
function loadStoredColumns(): FreeAgentConfigurableColumn[] {
  try {
    const raw = localStorage.getItem(COLUMN_STORAGE_KEY);
    return normalizeFreeAgentVisibleColumns(raw ? JSON.parse(raw) : null);
  } catch { return normalizeFreeAgentVisibleColumns(null); }
}

function PlayerCell({ player, isWatched, onToggleWatch, canWatch }: { player: any; isWatched: boolean; onToggleWatch: () => void; canWatch: boolean }) {
  return <div className="flex items-center gap-2.5">
    {canWatch ? <button onClick={onToggleWatch} className="shrink-0 text-slate-300 hover:text-amber-500" aria-label={isWatched ? "Remove from watchlist" : "Add to watchlist"}><Star size={15} fill={isWatched ? "currentColor" : "none"} className={isWatched ? "text-amber-500" : ""} /></button> : null}
    {player.nfl_team ? <img src={teamLogo(player.nfl_team)} alt="" className="h-7 w-7 shrink-0 rounded-full bg-slate-100 object-contain" onError={event => { event.currentTarget.style.visibility = "hidden"; }} /> : <span className="h-7 w-7 shrink-0 rounded-full bg-slate-100" />}
    <div className="min-w-0">
      <Link href={`/player/${player.id}`} className="block truncate text-sm font-semibold text-cvc-deep hover:text-cvc-accent">{player.display_name}</Link>
      <div className="mt-0.5 flex items-center gap-1.5">
        <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[.06em] ${badgeTone[player.position] ?? "bg-slate-100 text-slate-700"}`}>{player.position ?? "—"}</span>
        <span className="text-[11px] text-slate-500">{player.nfl_team ?? "FA"}</span>
      </div>
      {player.cutByFranchiseName ? <p className="mt-0.5 text-[9px] font-bold uppercase tracking-[.06em] text-amber-600">Matching rights: {player.cutByFranchiseName}</p> : null}
      {player.rosteredByFranchiseName ? <p className="mt-0.5 text-[9px] font-bold uppercase tracking-[.06em] text-slate-500">Rostered: {player.rosteredByFranchiseName}</p> : null}
    </div>
  </div>;
}

export function CvcWrcFreeAgents() {
  const { owner } = useCvcOwnerAuth();
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<"free-agents" | "all-players" | "watchlist" | "manage-bids">("free-agents");
  const [position, setPosition] = useState("ALL");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<string>("fpts");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [amount, setAmount] = useState("1");
  const [maxPlayersDesired, setMaxPlayersDesired] = useState("1");
  const [matchingRightsOnly, setMatchingRightsOnly] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<FreeAgentConfigurableColumn[]>(() => loadStoredColumns());
  const [columnsOpen, setColumnsOpen] = useState(false);
  useEffect(() => { try { localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(visibleColumns)); } catch { /* ignore */ } }, [visibleColumns]);

  const queryPosition = position === "ALL" || position === "SFLEX" ? undefined : position;
  const freeAgentInput = useMemo(() => ({ search: search.trim() || undefined, position: queryPosition, limit: 1000, matchingRightsOnly: matchingRightsOnly || undefined }), [queryPosition, search, matchingRightsOnly]);
  const allPlayersInput = useMemo(() => ({ search: search.trim() || undefined, position: queryPosition, limit: 1000 }), [queryPosition, search]);

  const freeAgentsPool = trpc.league.freeAgents.useQuery(freeAgentInput, { enabled: tab === "free-agents" });
  const allPlayersPool = trpc.league.allPlayers.useQuery(allPlayersInput, { enabled: tab === "all-players" });
  const watchlistPool = trpc.league.watchlistPlayers.useQuery(undefined, { enabled: tab === "watchlist" && Boolean(owner?.franchise) });
  const watchlist = trpc.league.watchlist.useQuery(undefined, { enabled: Boolean(owner?.franchise) });
  const toggleWatch = trpc.league.toggleWatchlistPlayer.useMutation({ onSuccess: () => { utils.league.watchlist.invalidate(); utils.league.watchlistPlayers.invalidate(); } });
  const watchedIds = useMemo(() => new Set((watchlist.data ?? []).map(row => row.player_id)), [watchlist.data]);

  const waiver = trpc.league.waiverStatus.useQuery();
  const isFreePeriod = waiver.data?.period?.period_type === "free";
  const faabBalance = trpc.league.myFaabBalance.useQuery(undefined, { enabled: Boolean(owner?.franchise) });
  const myBids = trpc.league.myFaabBids.useQuery(undefined, { enabled: Boolean(owner?.franchise) });
  const commissioner = ["commissioner", "administrator"].includes(owner?.role ?? "");
  const queue = trpc.league.waiverBidQueue.useQuery(undefined, { enabled: commissioner });
  const submit = trpc.league.submitFaabBid.useMutation({ onSuccess: async () => { setSelectedPlayerId(""); setAmount("1"); setMaxPlayersDesired("1"); await Promise.all([utils.league.myFaabBids.invalidate(), utils.league.myFaabBalance.invalidate(), utils.league.activity.invalidate()]); } });
  const resolve = trpc.league.resolveFaabBid.useMutation({ onSuccess: () => { utils.league.waiverBidQueue.invalidate(); utils.league.freeAgents.invalidate(); utils.league.myFaabBalance.invalidate(); utils.league.activity.invalidate(); } });

  const activePool = tab === "all-players" ? allPlayersPool : tab === "watchlist" ? watchlistPool : freeAgentsPool;
  const rawPlayers = activePool.data ?? [];
  const positionFiltered = position === "SFLEX" ? rawPlayers.filter((player: any) => SFLEX_POSITIONS.has(player.position)) : rawPlayers;

  const players = [...positionFiltered].sort((a: any, b: any) => {
    if (sort === "name") return a.display_name.localeCompare(b.display_name) * (direction === "asc" ? 1 : -1);
    if (sort === "position") return String(a.position ?? "").localeCompare(String(b.position ?? "")) * (direction === "asc" ? 1 : -1);
    if (sort === "team") return String(a.nfl_team ?? "").localeCompare(String(b.nfl_team ?? "")) * (direction === "asc" ? 1 : -1);
    const statKey = COLUMN_DEFS[sort as FreeAgentConfigurableColumn]?.statKey ?? "fantasy_points";
    const va = a.seasonStats?.[statKey] ?? -Infinity;
    const vb = b.seasonStats?.[statKey] ?? -Infinity;
    return (va - vb) * (direction === "asc" ? 1 : -1);
  });

  const toggleSort = (next: string) => { if (next === sort) setDirection(current => current === "asc" ? "desc" : "asc"); else { setSort(next); setDirection("asc"); } };
  const SortHeader = ({ field, label }: { field: string; label: string }) => <th className="whitespace-nowrap px-3 py-3 text-right cursor-pointer select-none hover:text-cvc-accent" onClick={() => toggleSort(field)}><span className="inline-flex items-center gap-1">{label}{sort === field ? <ArrowDownUp size={11} className={direction === "desc" ? "rotate-180" : ""} /> : null}</span></th>;

  const colSpan = 3 + visibleColumns.length;
  const emptyLabel = tab === "watchlist" ? "No players on your watchlist yet — tap the star next to a player to add one." : matchingRightsOnly ? "No free agents currently carry a matching-rights tag." : "No players match this filter.";
  const isLoading = activePool.isLoading;
  const isError = activePool.error;

  return <div className="mx-auto max-w-[1440px]">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div><div className="cvc-eyebrow"><Users size={14} /> Player pool</div><h1 className="mt-2 font-display text-5xl uppercase leading-none tracking-[0.04em] text-white sm:text-6xl">Free Agents & FAAB</h1><p className="mt-3 max-w-3xl text-sm text-cvc-muted">Search the synchronized CVC player pool, review player availability, and submit a protected FAAB claim when the waiver window is open.</p>{isFreePeriod ? <p className="mt-2 inline-block rounded-full border border-amber-400/50 bg-amber-400/10 px-3 py-1 text-xs font-bold uppercase tracking-[.06em] text-amber-300">Free agent period — every player $1, awarded by waiver priority</p> : null}</div>
      {owner?.franchise ? <div className="rounded-lg border border-cvc-accent/50 bg-cvc-accent/10 px-4 py-3 text-right"><p className="font-display text-[11px] uppercase tracking-[.1em] text-cvc-accent">FAAB balance</p><p className="mt-1 font-display text-2xl text-white">${faabBalance.data?.balance ?? "—"}</p></div> : <div className="rounded-lg border border-cvc-accent/35 bg-cvc-accent/10 px-4 py-3"><p className="font-display text-[11px] uppercase tracking-[.1em] text-cvc-accent">Waiver window</p><p className="mt-1 text-sm text-white">{waiver.data?.period ? `${waiver.data.period.label} open` : "No active period"}</p></div>}
    </div>

    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-white/15">
      {[["free-agents", "Free Agents"], ["all-players", "All Players"], ["watchlist", "Watchlist"], ["manage-bids", "Manage Bids"]].map(([key, label]) => (
        (key === "watchlist" && !owner?.franchise) ? null :
        <button key={key} onClick={() => setTab(key as typeof tab)} className={tab === key ? "border-b-[3px] border-cvc-accent px-4 py-3 font-display text-sm uppercase tracking-[.08em] text-cvc-accent" : "border-b-[3px] border-transparent px-4 py-3 font-display text-sm uppercase tracking-[.08em] text-white/60 hover:text-white"}>{label}{key === "manage-bids" ? ` (${(myBids.data?.length ?? 0) + (commissioner ? queue.data?.length ?? 0 : 0)})` : key === "watchlist" ? ` (${watchlist.data?.length ?? 0})` : ""}</button>
      ))}
    </div>

    {tab === "manage-bids" ? (
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-white/10 bg-cvc-deep/60 p-5"><div className="flex items-center gap-2 text-cvc-accent"><DollarSign size={16} /><p className="font-display text-lg uppercase">My claim status</p></div><div className="mt-4 space-y-2">{owner?.franchise ? myBids.data?.length ? myBids.data.map((bid: any) => <div key={bid.id} className="rounded bg-white/5 px-3 py-2 text-sm text-white"><b>{bid.player?.[0]?.display_name ?? bid.player?.display_name}</b> · ${bid.amount} · <span className="uppercase text-cvc-accent">{bid.status}</span></div>) : <p className="text-sm text-cvc-muted">No CVC waiver claims submitted.</p> : <p className="text-sm text-cvc-muted">Sign in with an owner account to submit and review claims.</p>}</div></section>
        <section className="rounded-xl border border-white/10 bg-cvc-deep/60 p-5"><div className="flex items-center gap-2 text-cvc-accent"><ShieldCheck size={16} /><p className="font-display text-lg uppercase">Commissioner queue</p></div><div className="mt-4 space-y-2">{commissioner ? queue.data?.length ? queue.data.map((bid: any) => <div key={bid.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-white/5 px-3 py-2 text-sm text-white"><span><b>{bid.player?.[0]?.display_name ?? bid.player?.display_name}</b> · {bid.franchise?.[0]?.name ?? bid.franchise?.name} · ${bid.amount}</span><span className="flex gap-2"><button onClick={() => resolve.mutate({ bidId: bid.id, outcome: "won" })} className="cvc-mini-button">Award</button><button onClick={() => resolve.mutate({ bidId: bid.id, outcome: "lost" })} className="cvc-mini-button">Lost</button></span></div>) : <p className="text-sm text-cvc-muted">No pending CVC waiver claims.</p> : <p className="text-sm text-cvc-muted">Protected commissioner controls appear for commissioner and administrator accounts.</p>}</div></section>
      </div>
    ) : (
      <section className="overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="h-1.5 bg-cvc-accent" />
        <div className="flex flex-wrap items-center justify-between gap-3 bg-cvc-deep px-5 py-4 text-white"><div><p className="font-display text-2xl uppercase tracking-[.06em]">{tab === "watchlist" ? "Your watchlist" : tab === "all-players" ? "All players" : "Available players"}</p><p className="mt-1 text-xs text-white/65">{tab === "all-players" ? "Every CVC-tracked player, rostered or not." : tab === "watchlist" ? "Players you're tracking for a future claim or trade." : "Unrostered CVC player records only. Rookies remain in the rookie draft pool."}</p></div><span className="text-xs font-bold uppercase tracking-[.1em] text-cvc-accent">{players.length} shown</span></div>
        <div className="border-b border-slate-200 bg-[#edf4ee] px-4 pt-3"><div className="flex w-max min-w-full gap-1">{POSITIONS.map(item => <button key={item} onClick={() => setPosition(item)} className={position === item ? "rounded-t-md bg-cvc-deep px-3 py-2 font-display text-sm uppercase text-white" : "rounded-t-md px-3 py-2 font-display text-sm uppercase text-cvc-deep/60 hover:bg-white"}>{item}</button>)}</div></div>
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center">
          <label className="relative flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search player name" className="w-full rounded-md border border-slate-200 py-2.5 pl-9 pr-3 text-sm text-cvc-deep" /></label>
          <div className="flex flex-wrap gap-2">
            {tab === "free-agents" ? <button onClick={() => setMatchingRightsOnly(current => !current)} className={matchingRightsOnly ? "cvc-mini-button bg-cvc-deep text-white" : "cvc-mini-button"}><ShieldCheck size={13} /> Matching rights only</button> : null}
            <div className="relative">
              <button onClick={() => setColumnsOpen(current => !current)} className="cvc-mini-button"><SlidersHorizontal size={13} /> Columns</button>
              {columnsOpen ? <div className="absolute right-0 top-full z-10 mt-1 w-56 rounded-md border border-slate-200 bg-white p-2 shadow-lg">{FREE_AGENT_CONFIGURABLE_COLUMNS.map(column => <label key={column} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-cvc-deep hover:bg-slate-50"><input type="checkbox" checked={visibleColumns.includes(column)} onChange={() => setVisibleColumns(current => toggleFreeAgentVisibleColumn(current, column))} />{COLUMN_DEFS[column].label}</label>)}</div> : null}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1000px] w-full text-left">
            <thead className="bg-[#edf4ee]"><tr className="font-display text-xs uppercase tracking-[.08em] text-cvc-deep">
              <th className="cursor-pointer select-none px-5 py-3 hover:text-cvc-accent" onClick={() => toggleSort("name")}><span className="inline-flex items-center gap-1">Player{sort === "name" ? <ArrowDownUp size={11} className={direction === "desc" ? "rotate-180" : ""} /> : null}</span></th>
              {visibleColumns.map(column => <SortHeader key={column} field={column} label={COLUMN_DEFS[column].label} />)}
              <th className="px-3 py-3">Availability</th>
              <th className="px-5 py-3 text-right">FAAB</th>
            </tr></thead>
            <tbody>
              {isLoading ? <tr><td colSpan={colSpan} className="px-5 py-8 text-center text-sm text-slate-500">Loading CVC player pool…</td></tr>
                : isError ? <tr><td colSpan={colSpan} className="px-5 py-8 text-center text-sm text-red-700">{activePool.error.message}</td></tr>
                : players.length ? players.map((player: any) => <tr key={player.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-5 py-2.5"><PlayerCell player={player} isWatched={watchedIds.has(player.id)} canWatch={Boolean(owner?.franchise)} onToggleWatch={() => toggleWatch.mutate({ playerId: player.id })} /></td>
                    {visibleColumns.map(column => <td key={column} className="whitespace-nowrap px-3 py-2.5 text-right text-sm text-slate-600">{fmt(player.seasonStats?.[COLUMN_DEFS[column].statKey])}</td>)}
                    <td className="px-3 py-2.5">{player.rosteredByFranchiseName ? <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-[.08em] text-slate-600">Rostered</span> : <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold uppercase tracking-[.08em] text-emerald-700">Available</span>}</td>
                    <td className="px-5 py-2.5 text-right">{player.rosteredByFranchiseName ? <span className="text-xs text-slate-400">—</span> : owner?.franchise && waiver.data?.period ? <button onClick={() => setSelectedPlayerId(player.id)} className="cvc-mini-button"><DollarSign size={13} /> {isFreePeriod ? "Claim ($1)" : "Bid"}</button> : <span className="text-xs text-slate-400">{owner ? "Window closed" : "Sign in"}</span>}</td>
                  </tr>)
                : <tr><td colSpan={colSpan} className="px-5 py-8 text-center text-sm text-slate-500">{emptyLabel}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    )}

    {selectedPlayerId ? <section className="mt-6 rounded-xl border border-cvc-accent/40 bg-cvc-accent/10 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-display text-xl uppercase text-white">{isFreePeriod ? "Submit free agent claim" : "Submit FAAB claim"}</p><p className="mt-1 text-sm text-cvc-muted">{isFreePeriod ? "This is the post-Sunday free agent period: every player is $1.00, bid-exempt, and awarded by waiver priority (worst-record-first, then rotates to the back after each win) at the next Thursday 9:00am ET resolution." : "Bids are resolved automatically Thursday and Sunday mornings at 9:00am ET. Winner is the highest bid; ties go to the worse-record team."} The awarded player joins your roster at ${isFreePeriod ? "1" : "their winning bid"} as salary and can't be cut until the following resolution.</p></div><button onClick={() => setSelectedPlayerId("")} className="text-xs font-bold uppercase tracking-[.08em] text-cvc-muted">Cancel</button></div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        {isFreePeriod ? <div className="flex flex-col gap-1"><span className="text-[10px] font-black uppercase tracking-[.08em] text-cvc-muted">Claim price</span><span className="rounded-md border border-white/20 bg-cvc-deep px-3 py-2 text-sm text-white">$1 flat</span></div> : <label className="flex flex-col gap-1"><span className="text-[10px] font-black uppercase tracking-[.08em] text-cvc-muted">Bid ($1–$30)</span><input value={amount} onChange={event => setAmount(event.target.value.replace(/\D/g, ""))} className="w-28 rounded-md border border-white/20 bg-cvc-deep px-3 py-2 text-sm text-white" inputMode="numeric" placeholder="$0" /></label>}
        <label className="flex flex-col gap-1"><span className="text-[10px] font-black uppercase tracking-[.08em] text-cvc-muted">Max players to win this cycle</span><input value={maxPlayersDesired} onChange={event => setMaxPlayersDesired(event.target.value.replace(/\D/g, ""))} className="w-20 rounded-md border border-white/20 bg-cvc-deep px-3 py-2 text-sm text-white" inputMode="numeric" placeholder="1" /></label>
        {faabBalance.data?.balance != null ? <span className="pb-2.5 text-xs text-cvc-muted">${faabBalance.data.balance} left this season</span> : null}
        <button disabled={submit.isPending || (!isFreePeriod && (Number(amount) < 1 || Number(amount) > 30))} onClick={() => submit.mutate({ playerId: selectedPlayerId, amount: isFreePeriod ? 1 : Number(amount), maxPlayersDesired: Number(maxPlayersDesired) || 1 })} className="cvc-button-compact disabled:opacity-50 pb-2.5">{submit.isPending ? "Submitting…" : isFreePeriod ? "Submit claim" : "Submit bid"}</button>
        {submit.error ? <p className="w-full text-sm text-red-200">{submit.error.message}</p> : null}
      </div>
      <p className="mt-2 text-[11px] text-cvc-muted">If you submit several {isFreePeriod ? "claims" : "bids"} this cycle, "max players to win" caps how many of them you're actually willing to win at once — leave it at 1 unless you specifically want to try for more than one player and are prepared to trim your roster down to 22 afterward.</p>
    </section> : null}
  </div>;
}
