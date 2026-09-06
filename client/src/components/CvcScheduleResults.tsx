import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Radio, Trophy } from "lucide-react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { TeamLogo } from "@/components/TeamLogo";
import { useCvcOwnerAuth } from "@/hooks/useCvcOwnerAuth";

type Matchup = {
  id: string;
  away: string;
  home: string;
  away_score: number | string | null;
  home_score: number | string | null;
  result_state: string;
  awayLogoUrl?: string | null;
  homeLogoUrl?: string | null;
  awayAbbreviation?: string | null;
  homeAbbreviation?: string | null;
  week?: { week_number?: number | null; label?: string | null } | null;
};

function ResultState({ state }: { state: string }) {
  const normalized = state?.toLowerCase();
  if (normalized === "final") return <span className="rounded-full bg-emerald-950 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-200">Final</span>;
  if (normalized === "live") return <span className="inline-flex items-center gap-1 rounded-full bg-rose-950 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-rose-200"><Radio size={10} className="animate-pulse" /> Live</span>;
  return <span className="rounded-full bg-slate-200 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-600">Scheduled</span>;
}

function MatchupCard({ matchup }: { matchup: Matchup }) {
  const isFinal = matchup.result_state === "final";
  const away = Number(matchup.away_score ?? 0);
  const home = Number(matchup.home_score ?? 0);
  return <article className="group flex flex-col gap-3 px-4 py-5 text-cvc-deep transition hover:bg-cvc-tint sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-3 sm:px-6">
    <div className="flex items-center gap-3"><TeamLogo name={matchup.away} abbreviation={matchup.awayAbbreviation} logoUrl={matchup.awayLogoUrl} size="md" className="shrink-0 border-slate-200"/><div className="min-w-0"><p className={`break-words font-display text-lg leading-[1.05] uppercase sm:truncate sm:text-3xl ${isFinal && away < home ? "text-slate-400" : ""}`}>{matchup.away}</p><p className="mt-1 text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 sm:mt-2">Away</p></div></div>
    <div className="flex items-center justify-center gap-3 sm:min-w-[102px] sm:flex-col sm:text-center">
      {isFinal ? <div className="font-display text-3xl sm:text-5xl"><span className={away > home ? "text-cvc-deep" : "text-slate-400"}>{away.toFixed(1)}</span><span className="mx-1 text-cvc-accent">–</span><span className={home > away ? "text-cvc-deep" : "text-slate-400"}>{home.toFixed(1)}</span></div> : matchup.result_state === "live" ? <Link href="/live" className="inline-flex items-center gap-1 rounded-lg bg-cvc-deep px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-white">Live</Link> : <CalendarDays className="text-slate-400 sm:mx-auto" size={20} />}
      <ResultState state={matchup.result_state} />
    </div>
    <div className="flex items-center gap-3 sm:flex-row-reverse sm:justify-end sm:text-right"><TeamLogo name={matchup.home} abbreviation={matchup.homeAbbreviation} logoUrl={matchup.homeLogoUrl} size="md" className="shrink-0 border-slate-200"/><div className="min-w-0"><p className={`break-words font-display text-lg leading-[1.05] uppercase sm:truncate sm:text-3xl ${isFinal && home < away ? "text-slate-400" : ""}`}>{matchup.home}</p><p className="mt-1 text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 sm:mt-2">Home</p></div></div>
  </article>;
}

export function CvcScheduleResults() {
  const overview = trpc.league.overview.useQuery();
  const { owner } = useCvcOwnerAuth();
  const [tab, setTab] = useState<"schedule" | "my-schedule">("schedule");
  const groups = useMemo<Array<{ week: number; label: string; matchups: Matchup[] }>>(() => {
    const rows = [...((overview.data?.matchups ?? []) as Matchup[])].sort((a, b) => Number(a.week?.week_number ?? 0) - Number(b.week?.week_number ?? 0));
    const byWeek = new Map<number, Matchup[]>();
    for (const row of rows) {
      const week = Number(row.week?.week_number ?? 0);
      if (!week) continue;
      byWeek.set(week, [...(byWeek.get(week) ?? []), row]);
    }
    return Array.from(byWeek.entries()).map(([week, matchups]) => ({ week, label: matchups[0]?.week?.label ?? `Week ${week}`, matchups }));
  }, [overview.data?.matchups]);
  const suggestedWeek = groups.find(group => group.matchups.some((matchup: Matchup) => matchup.result_state === "live"))?.week
    ?? groups.find(group => group.matchups.some((matchup: Matchup) => matchup.result_state !== "final"))?.week
    ?? groups.at(-1)?.week
    ?? 1;
  const [selectedWeek, setSelectedWeek] = useState<number | "all" | null>(null);
  const activeWeek = selectedWeek ?? suggestedWeek;
  const active = activeWeek === "all" ? null : groups.find(group => group.week === activeWeek);
  const index = activeWeek === "all" ? -1 : groups.findIndex(group => group.week === activeWeek);
  const isCurrent = active?.matchups.some(matchup => matchup.result_state === "live") || activeWeek === suggestedWeek;

  const myFranchiseId = owner?.franchise?.id;
  const myGames = useMemo(() => {
    if (!myFranchiseId) return [];
    return groups
      .map(group => ({ ...group, matchup: group.matchups.find((matchup: any) => matchup.home_franchise_id === myFranchiseId || matchup.away_franchise_id === myFranchiseId) }))
      .filter((group): group is typeof group & { matchup: Matchup } => Boolean(group.matchup));
  }, [groups, myFranchiseId]);

  if (overview.isLoading) return <div className="p-8 text-sm text-slate-400">Loading CVC schedule and Tank01 result state…</div>;
  if (overview.error) return <div className="rounded-2xl border border-rose-400/30 bg-rose-950/30 p-6 text-rose-100">CVC schedule could not load: {overview.error.message}</div>;
  if (!groups.length) return <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-8 text-slate-300">No imported CVC matchups are available for this season.</div>;

  return <section className="min-h-screen bg-[#06121b] px-3 pb-12 pt-4 text-white sm:px-6">
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-cvc-accent">Game Center</p>
          <h1 className="font-display text-5xl uppercase leading-none sm:text-6xl">Schedule &amp; Results</h1>
        </div>
        {isCurrent && <Link href="/live" className="inline-flex items-center gap-2 rounded-xl bg-cvc-accent px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-cvc-deep shadow-lg shadow-cvc-accent/20"><Radio size={15} /> Open Live Scoring</Link>}
      </div>

      <div className="mb-5 flex gap-2 border-b border-white/10">
        <button onClick={() => setTab("schedule")} className={`border-b-[3px] px-4 py-3 text-xs font-black uppercase tracking-[0.12em] ${tab === "schedule" ? "border-cvc-accent text-white" : "border-transparent text-slate-400 hover:text-white"}`}>Schedule</button>
        {owner?.franchise ? <button onClick={() => setTab("my-schedule")} className={`border-b-[3px] px-4 py-3 text-xs font-black uppercase tracking-[0.12em] ${tab === "my-schedule" ? "border-cvc-accent text-white" : "border-transparent text-slate-400 hover:text-white"}`}>My Schedule</button> : null}
      </div>

      {tab === "schedule" ? <>
        <div className="mb-5"><label className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.1em] text-cvc-accent">Week<select value={activeWeek} onChange={event => setSelectedWeek(event.target.value === "all" ? "all" : Number(event.target.value))} className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-white">{groups.map(group => <option key={group.week} value={group.week} className="text-cvc-deep">{group.label}</option>)}<option value="all" className="text-cvc-deep">All Weeks</option></select></label></div>

        {activeWeek === "all" ? <div className="space-y-6">{groups.map(group => <div key={group.week} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] shadow-2xl shadow-black/20"><header className="bg-[#10283a] px-4 py-3 sm:px-6"><h2 className="font-display text-2xl uppercase">{group.label}</h2></header><div className="divide-y divide-slate-200 bg-white">{group.matchups.map(matchup => <MatchupCard key={matchup.id} matchup={matchup} />)}</div></div>)}</div> : active ? <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] shadow-2xl shadow-black/20">
          <header className="flex items-center justify-between border-b border-white/10 bg-[#10283a] px-4 py-4 sm:px-6">
            <button aria-label="Previous week" disabled={index <= 0} onClick={() => setSelectedWeek(groups[index - 1]?.week ?? activeWeek)} className="rounded-lg p-2 text-slate-300 transition hover:bg-white/10 disabled:opacity-25"><ChevronLeft /></button>
            <div className="text-center"><p className="text-[11px] font-black uppercase tracking-[0.18em] text-cvc-accent">CVC 2026 Regular Season</p><h2 className="mt-1 font-display text-3xl uppercase">{active.label}</h2></div>
            <button aria-label="Next week" disabled={index >= groups.length - 1} onClick={() => setSelectedWeek(groups[index + 1]?.week ?? activeWeek)} className="rounded-lg p-2 text-slate-300 transition hover:bg-white/10 disabled:opacity-25"><ChevronRight /></button>
          </header>
          <div className="divide-y divide-slate-200 bg-white">{active.matchups.map(matchup => <MatchupCard key={matchup.id} matchup={matchup} />)}</div>
          <footer className="flex items-center gap-2 bg-[#10283a] px-5 py-3 text-xs text-slate-300"><Trophy size={14} className="text-cvc-accent" /> Tank01 writes final CVC results automatically after NFL stat corrections are complete.</footer>
        </div> : null}
      </> : <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] shadow-2xl shadow-black/20">
        <header className="bg-[#10283a] px-4 py-4 sm:px-6"><p className="text-[11px] font-black uppercase tracking-[0.18em] text-cvc-accent">{owner?.franchise?.name ?? "My team"}</p><h2 className="mt-1 font-display text-3xl uppercase">Full Season Schedule</h2></header>
        {myGames.length ? <div className="divide-y divide-slate-200 bg-white">{myGames.map(group => <div key={group.week}><div className="bg-slate-50 px-4 py-2 text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 sm:px-6">{group.label}</div><MatchupCard matchup={group.matchup} /></div>)}</div> : <div className="p-8 text-center text-sm text-slate-300">No CVC matchups have been imported for your franchise yet.</div>}
      </div>}
    </div>
  </section>;
}
