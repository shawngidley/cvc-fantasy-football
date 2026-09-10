import { useMemo, useState } from "react";
import { Link } from "wouter";
import { getCvcLivePoints, useCvcTank01LiveScores } from "@/hooks/useCvcTank01LiveScores";
import { getCvcProjectedPoints, useCvcNFLProjections } from "@/hooks/useCvcNFLProjections";
import { useCvcTank01PlayerProfiles, profileKey } from "@/hooks/useCvcTank01PlayerProfiles";
import { minutesRemainingInGame, useCvcNFLGameStatus } from "@/hooks/useCvcNFLGameStatus";
import { trpc } from "@/lib/trpc";
import { TeamLogo } from "@/components/TeamLogo";
import { useCvcOwnerAuth } from "@/hooks/useCvcOwnerAuth";

const teamLogoUrlForDst = (team: string | null | undefined) => `https://a.espncdn.com/i/teamlogos/nfl/500/${({ kan: "kc", tam: "tb", arz: "ari", jax: "jac", was: "wsh" }[(team ?? "").toLowerCase()] ?? (team ?? "").toLowerCase())}.png`;
const isDst = (position: string | null | undefined) => ["DST", "DEF"].includes((position ?? "").toUpperCase());

const teamInitial = (name: string) => name.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
const opponentLabel = (team: string | null | undefined, matchups: ReturnType<typeof useCvcTank01LiveScores>["nflMatchups"]) => {
  const matchup = matchups[(team ?? "").toLowerCase()];
  if (!matchup) return "Bye / schedule pending";
  const dateStr = matchup.gameDate;
  const day = dateStr && dateStr.length >= 8 ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}T12:00:00`).getDay()] : "";
  return `${matchup.isHome ? "vs" : "@"} ${matchup.opponent.toUpperCase()} ${day} ${matchup.gameTime || ""}`.replace(/\s+/g, " ").trim();
};

// Same starter ordering as WRC's build (SLOT_ORDER in LiveScoring.tsx), adapted to
// CVC's actual configured roster_slot codes. CVC previously used distinct RB1/RB2 and
// WR1/WR2 codes but merged them into single RB/WR slots with capacity 2 each, so two
// players can share the same rank here -- Array.sort is stable, so their relative
// order is preserved rather than jumping around. Anything not in this list (i.e.
// BENCH) sorts after all starters.
const SLOT_ORDER = ["QB", "RB", "WR", "TE", "FLEX", "K", "DST"];
const slotRank = (code: unknown) => { const rank = SLOT_ORDER.indexOf(String(code ?? "").toUpperCase()); return rank === -1 ? SLOT_ORDER.length : rank; };
const isStarterSlot = (code: unknown) => SLOT_ORDER.includes(String(code ?? "").toUpperCase());

export function CvcLiveScoring() {
  const [selectedWeekNumber, setSelectedWeekNumber] = useState<number | null>(null);
  const weeksList = trpc.league.scheduleWeeksList.useQuery();
  const board = trpc.league.liveScoringBoard.useQuery({ weekNumber: selectedWeekNumber ?? undefined });
  const rules = trpc.league.scoringRules.useQuery();
  const slots = trpc.league.rosterSlots.useQuery();
  const live = useCvcTank01LiveScores(board.data?.week?.weekNumber, 2026, rules.data ?? []);
  const { projections } = useCvcNFLProjections(board.data?.week?.weekNumber, 2026, rules.data ?? []);
  const { isAuthenticated } = useCvcOwnerAuth();
  const myFranchise = trpc.league.myFranchise.useQuery(undefined, { enabled: isAuthenticated });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const matchups = board.data?.matchups ?? [];
  // Live scoring should open on the logged-in owner's own game by default, not
  // whichever matchup happens to sort first. Only kicks in until the person
  // manually picks a different matchup (selectedId then takes over); recomputed
  // each render (not stored in state) so it also applies once myFranchise loads
  // in, since that query resolves after the initial render.
  const myMatchup = myFranchise.data ? matchups.find(matchup => matchup.homeFranchiseId === myFranchise.data.id || matchup.awayFranchiseId === myFranchise.data.id) : undefined;
  const selected = matchups.find(matchup => matchup.id === selectedId) ?? myMatchup ?? matchups[0];
  const selectedAway = useMemo(() => [...(selected?.awayLineup ?? [])].filter(entry => isStarterSlot(entry.slot)).sort((a, b) => slotRank(a.slot) - slotRank(b.slot)), [selected]);
  const selectedHome = useMemo(() => [...(selected?.homeLineup ?? [])].filter(entry => isStarterSlot(entry.slot)).sort((a, b) => slotRank(a.slot) - slotRank(b.slot)), [selected]);
  // Bench players (assigned_slot_code = 'BENCH') were previously mixed into the same
  // alphabetically-sorted list as starters instead of appearing as their own section
  // below, same as WRC's build.
  const benchAway = useMemo(() => [...(selected?.awayLineup ?? [])].filter(entry => !isStarterSlot(entry.slot)), [selected]);
  const benchHome = useMemo(() => [...(selected?.homeLineup ?? [])].filter(entry => !isStarterSlot(entry.slot)), [selected]);
  const visiblePlayers = useMemo(() => [...selectedAway, ...selectedHome, ...benchAway, ...benchHome].flatMap(entry => entry.player && !isDst(entry.player.position) ? [entry.player] : []), [selectedAway, selectedHome, benchAway, benchHome]);
  const profiles = useCvcTank01PlayerProfiles(visiblePlayers, 40);
  const starterSlots = (slots.data ?? []).filter(slot => !["BENCH", "BN", "IR", "TAXI"].includes(slot.code.toUpperCase())).flatMap(slot => Array.from({ length: Math.max(1, Number(slot.maximum_count ?? 1)) }, () => slot.code)).sort((a, b) => slotRank(a) - slotRank(b));
  const maxRows = Math.max(selectedAway.length, selectedHome.length, starterSlots.length);
  const maxBenchRows = Math.max(benchAway.length, benchHome.length);
  const points = (entry: any) => entry?.player ? getCvcLivePoints(live.scores, entry.player.display_name, entry.player.position, entry.player.nfl_team) : null;
  const total = (lineup: any[]) => lineup.reduce((sum, entry) => sum + (points(entry) ?? 0), 0);
  const awayTotal = total(selectedAway);
  const homeTotal = total(selectedHome);
  const hasLiveScores = Object.keys(live.scores).length > 0;
  const gameDates = useMemo(() => Array.from(new Set(Object.values(live.nflMatchups).map(m => m.gameDate).filter(Boolean))), [live.nflMatchups]);
  const { gameStatus } = useCvcNFLGameStatus(gameDates);
  // Same aggregation as WRC's build: sum minutesRemainingInGame and projected points
  // across every starter, and count how many have finished/are live/haven't started
  // yet, based on each player's own NFL team's game status. An empty slot (no player
  // assigned) still counts as a full 60 minutes remaining, same reasoning as WRC's:
  // it reflects the fixed starter-slot count regardless of whether every slot happens
  // to be filled right now.
  function sideStats(lineup: any[]) {
    let played = 0; let playing = 0; let minutesRemaining = 0; let projTotal = 0;
    for (const entry of lineup) {
      const player = entry.player;
      if (!player) { minutesRemaining += 60; continue; }
      const status = gameStatus[(player.nfl_team ?? "").toUpperCase()];
      if (status?.state === "post") played += 1; else if (status?.state === "in") playing += 1;
      minutesRemaining += minutesRemainingInGame(status);
      projTotal += getCvcProjectedPoints(projections, player.display_name, isDst(player.position) ? "DST" : player.position, player.nfl_team) ?? 0;
    }
    return { played, playing, yetToPlay: lineup.length - played - playing, minutesRemaining: Math.round(minutesRemaining), projTotal };
  }
  const awayStats = sideStats(selectedAway);
  const homeStats = sideStats(selectedHome);

  if (board.isLoading || rules.isLoading || slots.isLoading) return <div className="cvc-card"><div className="cvc-card-title"><span>Live scoring</span></div><div className="cvc-card-body text-sm text-slate-500">Loading the current CVC week, configured starters, and scoring rules…</div></div>;
  if (board.error || rules.error || slots.error) return <div className="cvc-card"><div className="cvc-card-title"><span>Live scoring</span></div><div className="cvc-card-body text-sm text-red-700">{(board.error ?? rules.error ?? slots.error)?.message}</div></div>;
  if (!selected || !board.data?.week) return <div className="cvc-card"><div className="cvc-card-title"><span>Live scoring</span></div><div className="cvc-card-body text-sm text-slate-500">No current CVC scoring week is available.</div></div>;

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-display text-4xl uppercase tracking-[0.04em] text-white">Live scoring</h2></div><label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.1em] text-cvc-accent">Week<select value={selectedWeekNumber ?? board.data?.week?.weekNumber ?? ""} onChange={event => { setSelectedWeekNumber(Number(event.target.value)); setSelectedId(null); }} className="rounded-md border border-cvc-accent/40 bg-cvc-accent/10 px-3 py-1.5 text-xs font-bold text-white">{(weeksList.data ?? []).map(week => <option key={week.id} value={week.week_number} className="text-cvc-deep">{week.label}</option>)}</select></label></div>

    <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"><div className="flex min-w-max gap-3">{matchups.map(matchup => { const selectedMatchup = matchup.id === selected.id; const away = hasLiveScores ? total(matchup.awayLineup.filter((entry: any) => isStarterSlot(entry.slot))) : Number(matchup.awayScore); const home = hasLiveScores ? total(matchup.homeLineup.filter((entry: any) => isStarterSlot(entry.slot))) : Number(matchup.homeScore); return <button key={matchup.id} type="button" onClick={() => setSelectedId(matchup.id)} className={`flex min-w-[220px] items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${selectedMatchup ? "border-cvc-accent bg-cvc-tint shadow-sm" : "border-white/15 bg-white/5 hover:border-cvc-accent/60"}`}><TeamLogo name={matchup.away} logoUrl={matchup.awayLogoUrl} size="sm"/><strong className="font-display text-lg text-white">{away.toFixed(1)}</strong><span className="text-xs text-cvc-muted">vs</span><strong className="font-display text-lg text-white">{home.toFixed(1)}</strong><TeamLogo name={matchup.home} logoUrl={matchup.homeLogoUrl} size="sm"/></button>; })}</div></div>

    <section className="overflow-hidden rounded-[1.5rem] bg-white shadow-2xl ring-1 ring-black/10">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-slate-200 px-3 py-5 sm:gap-3 sm:px-7">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3"><TeamLogo name={selected.away} logoUrl={selected.awayLogoUrl} size="lg" className="shrink-0 rounded-xl border-cvc-deep/20"/><div className="min-w-0"><p className="min-w-0 truncate font-display text-base uppercase leading-tight text-cvc-deep sm:text-3xl">{selected.away}</p><p className="text-[10px] text-slate-500 sm:text-xs">PROJ {awayStats.projTotal.toFixed(1)}</p><div className="mt-1 flex items-center gap-2 text-[9px] text-slate-500 sm:text-[10px]"><span title="Played / Playing now / Yet to play">👥 {awayStats.played} {awayStats.playing} {awayStats.yetToPlay}</span><span title="Total minutes remaining across all your starters' games">⏱ {awayStats.minutesRemaining}</span></div></div></div>
        <div className="shrink-0 text-center"><p className="whitespace-nowrap font-display text-3xl text-cvc-deep sm:text-5xl">{awayTotal.toFixed(1)} <span className="text-cvc-accent">:</span> {homeTotal.toFixed(1)}</p><p className="mt-1 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">{live.isPolling ? "Live" : selected.resultState}</p></div>
        <div className="flex min-w-0 items-center justify-end gap-2 sm:gap-3"><div className="min-w-0 text-right"><p className="min-w-0 truncate text-right font-display text-base uppercase leading-tight text-cvc-deep sm:text-3xl">{selected.home}</p><p className="text-[10px] text-slate-500 sm:text-xs">PROJ {homeStats.projTotal.toFixed(1)}</p><div className="mt-1 flex items-center justify-end gap-2 text-[9px] text-slate-500 sm:text-[10px]"><span title="Played / Playing now / Yet to play">👥 {homeStats.played} {homeStats.playing} {homeStats.yetToPlay}</span><span title="Total minutes remaining across all your starters' games">⏱ {homeStats.minutesRemaining}</span></div></div><TeamLogo name={selected.home} logoUrl={selected.homeLogoUrl} size="lg" className="shrink-0 rounded-xl border-cvc-accent/40"/></div>
      </div>
      <div className="divide-y divide-slate-200">{Array.from({ length: maxRows }).map((_, index) => { const away = selectedAway[index]; const home = selectedHome[index]; const slot = away?.slot ?? home?.slot ?? starterSlots[index] ?? "Open"; return <LineupRow key={`${away?.id ?? "away"}-${home?.id ?? "home"}-${index}`} away={away} home={home} slot={slot} points={points} live={live} profiles={profiles} projections={projections} />; })}</div>
      {maxBenchRows ? <><div className="bg-slate-100 px-4 py-3 text-center text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Bench</div>
      <div className="divide-y divide-slate-200 opacity-80">{Array.from({ length: maxBenchRows }).map((_, index) => { const away = benchAway[index]; const home = benchHome[index]; return <LineupRow key={`bn-${away?.id ?? "away"}-${home?.id ?? "home"}-${index}`} away={away} home={home} slot="BN" points={points} live={live} profiles={profiles} projections={projections} />; })}</div></> : null}
    </section>
    {live.error ? <p className="text-center text-xs text-cvc-muted">Tank01 status: {live.error}</p> : null}
  </div>;
}

function Avatar({ player, profiles }: { player: any; profiles: Record<string, any> }) {
  const [failed, setFailed] = useState(false);
  if (!player) return <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cvc-tint text-xs font-bold text-cvc-deep sm:flex">—</span>;
  const source = isDst(player.position) ? teamLogoUrlForDst(player.nfl_team) : profiles[profileKey(player.display_name)]?.espnHeadshot;
  return <span className="hidden h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-cvc-tint text-xs font-bold text-cvc-deep sm:flex">{source && !failed ? <img src={source} alt="" className={isDst(player.position) ? "h-8 w-8 object-contain" : "h-full w-full object-cover object-top"} onError={() => setFailed(true)} /> : teamInitial(player.display_name)}</span>;
}

function LineupRow({ away, home, slot, points, live, profiles, projections }: { away: any; home: any; slot: string; points: (entry: any) => number | null; live: ReturnType<typeof useCvcTank01LiveScores>; profiles: Record<string, any>; projections: ReturnType<typeof useCvcNFLProjections>["projections"] }) {
  const awayPoints = points(away); const homePoints = points(home);
  const isBench = slot === "BN";
  const emptyName = isBench ? "—" : "Lineup not submitted";
  const emptyDetail = isBench ? "" : "Owner must set this slot";
  const projFor = (entry: any) => entry?.player ? getCvcProjectedPoints(projections, entry.player.display_name, isDst(entry.player.position) ? "DST" : entry.player.position, entry.player.nfl_team) : null;
  const awayProj = projFor(away); const homeProj = projFor(home);
  return <div className="grid grid-cols-[1fr_28px_1fr] items-stretch sm:grid-cols-[1fr_56px_1fr]"><div className="flex min-w-0 items-center gap-1.5 p-2 sm:gap-3 sm:p-4"><Avatar player={away?.player} profiles={profiles} /><div className="min-w-0 flex-1">{away?.player ? <Link href={`/player/${away.player.id}`} className="block truncate font-display text-base uppercase text-cvc-deep hover:text-cvc-accent sm:text-xl">{away.player.display_name}</Link> : <p className="truncate font-display text-base uppercase text-cvc-deep sm:text-xl">{emptyName}</p>}<p className="text-[11px] text-slate-500 sm:text-xs">{away?.player ? `${away.player.position} · ${away.player.nfl_team ?? "FA"}` : emptyDetail}</p><span className="mt-1 block max-w-full truncate rounded bg-slate-100 px-1.5 py-1 text-[9px] font-semibold text-slate-600 sm:inline-block sm:max-w-none sm:px-2 sm:text-[10px]">{away?.player ? opponentLabel(away.player.nfl_team, live.nflMatchups) : "—"}</span></div><div className="ml-1 shrink-0 text-right sm:ml-auto"><strong className="font-display text-xl text-cvc-deep sm:text-2xl">{awayPoints?.toFixed(1) ?? "0.0"}</strong>{away?.player && awayProj != null ? <p className="text-[9px] font-bold uppercase tracking-[0.06em] text-slate-400 sm:text-[10px]">Proj {awayProj.toFixed(1)}</p> : null}</div></div><div className="flex items-center justify-center border-x border-slate-200 bg-slate-50 text-[9px] font-bold uppercase tracking-[0.08em] text-slate-500 [writing-mode:vertical-rl] sm:text-[10px] sm:tracking-[0.12em]">{slot}</div><div className="flex min-w-0 items-center gap-1.5 p-2 text-right sm:gap-3 sm:p-4"><div className="mr-1 shrink-0 sm:mr-auto"><strong className="font-display text-xl text-cvc-deep sm:text-2xl">{homePoints?.toFixed(1) ?? "0.0"}</strong>{home?.player && homeProj != null ? <p className="text-[9px] font-bold uppercase tracking-[0.06em] text-slate-400 sm:text-[10px]">Proj {homeProj.toFixed(1)}</p> : null}</div><div className="min-w-0 flex-1">{home?.player ? <Link href={`/player/${home.player.id}`} className="block truncate font-display text-base uppercase text-cvc-deep hover:text-cvc-accent sm:text-xl">{home.player.display_name}</Link> : <p className="truncate font-display text-base uppercase text-cvc-deep sm:text-xl">{emptyName}</p>}<p className="text-[11px] text-slate-500 sm:text-xs">{home?.player ? `${home.player.position} · ${home.player.nfl_team ?? "FA"}` : emptyDetail}</p><span className="mt-1 block max-w-full truncate rounded bg-slate-100 px-1.5 py-1 text-[9px] font-semibold text-slate-600 sm:inline-block sm:max-w-none sm:px-2 sm:text-[10px]">{home?.player ? opponentLabel(home.player.nfl_team, live.nflMatchups) : "—"}</span></div><Avatar player={home?.player} profiles={profiles} /></div></div>;
}
