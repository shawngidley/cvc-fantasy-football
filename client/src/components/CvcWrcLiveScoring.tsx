import { useMemo, useState } from "react";
import { getCvcLivePoints, useCvcTank01LiveScores } from "@/hooks/useCvcTank01LiveScores";
import { trpc } from "@/lib/trpc";

const teamInitial = (name: string) => name.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
const opponentLabel = (team: string | null | undefined, matchups: ReturnType<typeof useCvcTank01LiveScores>["nflMatchups"]) => {
  const matchup = matchups[(team ?? "").toLowerCase()];
  if (!matchup) return "Bye / schedule pending";
  return `${matchup.isHome ? "vs" : "@"} ${matchup.opponent.toUpperCase()} ${matchup.gameTime || ""}`.trim();
};

export function CvcWrcLiveScoring() {
  const board = trpc.league.liveScoringBoard.useQuery();
  const rules = trpc.league.scoringRules.useQuery();
  const slots = trpc.league.rosterSlots.useQuery();
  const live = useCvcTank01LiveScores(board.data?.week?.weekNumber, 2026, rules.data ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const matchups = board.data?.matchups ?? [];
  const selected = matchups.find(matchup => matchup.id === selectedId) ?? matchups[0];
  const selectedAway = useMemo(() => [...(selected?.awayLineup ?? [])].sort((a, b) => String(a.slot).localeCompare(String(b.slot))), [selected]);
  const selectedHome = useMemo(() => [...(selected?.homeLineup ?? [])].sort((a, b) => String(a.slot).localeCompare(String(b.slot))), [selected]);
  const starterSlots = (slots.data ?? []).filter(slot => !["BENCH", "BN", "IR", "TAXI"].includes(slot.code.toUpperCase())).flatMap(slot => Array.from({ length: Math.max(1, Number(slot.maximum_count ?? 1)) }, () => slot.code));
  const maxRows = Math.max(selectedAway.length, selectedHome.length, starterSlots.length);
  const points = (entry: any) => entry?.player ? getCvcLivePoints(live.scores, entry.player.display_name, entry.player.position, entry.player.nfl_team) : null;
  const total = (lineup: any[]) => lineup.reduce((sum, entry) => sum + (points(entry) ?? 0), 0);
  const awayTotal = total(selectedAway);
  const homeTotal = total(selectedHome);
  const hasLiveScores = Object.keys(live.scores).length > 0;

  if (board.isLoading || rules.isLoading || slots.isLoading) return <div className="cvc-card"><div className="cvc-card-title"><span>Live scoring</span></div><div className="cvc-card-body text-sm text-slate-500">Loading the current CVC week, configured starters, and scoring rules…</div></div>;
  if (board.error || rules.error || slots.error) return <div className="cvc-card"><div className="cvc-card-title"><span>Live scoring</span></div><div className="cvc-card-body text-sm text-red-700">{(board.error ?? rules.error ?? slots.error)?.message}</div></div>;
  if (!selected || !board.data?.week) return <div className="cvc-card"><div className="cvc-card-title"><span>Live scoring</span></div><div className="cvc-card-body text-sm text-slate-500">No current CVC scoring week is available.</div></div>;

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="cvc-eyebrow">Tank01 game center</p><h2 className="mt-2 font-display text-4xl uppercase tracking-[0.04em] text-white">Live scoring</h2><p className="mt-2 text-sm text-cvc-muted">{board.data.week.label} · {live.lastUpdated ? `Last updated ${live.lastUpdated.toLocaleTimeString()}` : "Monitoring Tank01 for active games"}</p></div><span className="rounded-full border border-cvc-accent/40 bg-cvc-accent/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-cvc-accent">{live.isPolling ? "Live · 30-second refresh" : "Current week only"}</span></div>

    <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"><div className="flex min-w-max gap-3">{matchups.map(matchup => { const selectedMatchup = matchup.id === selected.id; const away = hasLiveScores ? total(matchup.awayLineup) : Number(matchup.awayScore); const home = hasLiveScores ? total(matchup.homeLineup) : Number(matchup.homeScore); return <button key={matchup.id} type="button" onClick={() => setSelectedId(matchup.id)} className={`flex min-w-[220px] items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${selectedMatchup ? "border-cvc-accent bg-cvc-tint shadow-sm" : "border-white/15 bg-white/5 hover:border-cvc-accent/60"}`}><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-cvc-deep text-xs font-bold text-white">{teamInitial(matchup.away)}</span><strong className="font-display text-lg text-white">{away.toFixed(1)}</strong><span className="text-xs text-cvc-muted">vs</span><strong className="font-display text-lg text-white">{home.toFixed(1)}</strong><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 text-xs font-bold text-white">{teamInitial(matchup.home)}</span></button>; })}</div></div>

    <section className="overflow-hidden rounded-[1.5rem] bg-white shadow-2xl ring-1 ring-black/10">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-slate-200 px-4 py-5 sm:px-7">
        <div className="flex items-center gap-3"><span className="flex h-14 w-14 items-center justify-center rounded-xl bg-cvc-deep font-display text-xl text-white">{teamInitial(selected.away)}</span><div><p className="font-display text-2xl uppercase text-cvc-deep sm:text-3xl">{selected.away}</p><p className="text-xs text-slate-500">Away · {selectedAway.length} starters</p></div></div>
        <div className="text-center"><p className="font-display text-4xl text-cvc-deep sm:text-5xl">{awayTotal.toFixed(1)} <span className="text-cvc-accent">:</span> {homeTotal.toFixed(1)}</p><p className="mt-1 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">{live.isPolling ? "Live" : selected.resultState}</p></div>
        <div className="flex items-center justify-end gap-3 text-right"><div><p className="font-display text-2xl uppercase text-cvc-deep sm:text-3xl">{selected.home}</p><p className="text-xs text-slate-500">Home · {selectedHome.length} starters</p></div><span className="flex h-14 w-14 items-center justify-center rounded-xl bg-cvc-accent font-display text-xl text-cvc-deep">{teamInitial(selected.home)}</span></div>
      </div>
      <div className="bg-slate-50 px-4 py-3 text-center text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Configured starters · Tank01 live totals · CVC scoring rules</div>
      <div className="divide-y divide-slate-200">{Array.from({ length: maxRows }).map((_, index) => { const away = selectedAway[index]; const home = selectedHome[index]; const slot = away?.slot ?? home?.slot ?? starterSlots[index] ?? "Open"; const awayPoints = points(away); const homePoints = points(home); return <div key={`${away?.id ?? "away"}-${home?.id ?? "home"}-${index}`} className="grid grid-cols-[1fr_38px_1fr] items-stretch sm:grid-cols-[1fr_56px_1fr]"><div className="flex min-w-0 items-center gap-3 p-3 sm:p-4"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cvc-tint text-xs font-bold text-cvc-deep">{away?.player ? teamInitial(away.player.display_name) : "—"}</span><div className="min-w-0"><p className="truncate font-display text-lg uppercase text-cvc-deep sm:text-xl">{away?.player?.display_name ?? "Lineup not submitted"}</p><p className="text-xs text-slate-500">{away?.player ? `${away.player.position} · ${away.player.nfl_team ?? "FA"}` : "Owner must set this slot"}</p><span className="mt-1 inline-block rounded bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">{away?.player ? opponentLabel(away.player.nfl_team, live.nflMatchups) : "—"}</span></div><strong className="ml-auto font-display text-2xl text-cvc-deep">{awayPoints?.toFixed(1) ?? "0.0"}</strong></div><div className="flex items-center justify-center border-x border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 [writing-mode:vertical-rl]">{slot}</div><div className="flex min-w-0 items-center gap-3 p-3 text-right sm:p-4"><strong className="mr-auto font-display text-2xl text-cvc-deep">{homePoints?.toFixed(1) ?? "0.0"}</strong><div className="min-w-0"><p className="truncate font-display text-lg uppercase text-cvc-deep sm:text-xl">{home?.player?.display_name ?? "Lineup not submitted"}</p><p className="text-xs text-slate-500">{home?.player ? `${home.player.position} · ${home.player.nfl_team ?? "FA"}` : "Owner must set this slot"}</p><span className="mt-1 inline-block rounded bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">{home?.player ? opponentLabel(home.player.nfl_team, live.nflMatchups) : "—"}</span></div><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cvc-tint text-xs font-bold text-cvc-deep">{home?.player ? teamInitial(home.player.display_name) : "—"}</span></div></div>; })}</div>
    </section>
    <p className="text-center text-xs text-cvc-muted">{live.error ? `Tank01 status: ${live.error}` : "Tank01 is the sole CVC source for live totals and automatic final results."}</p>
  </div>;
}
