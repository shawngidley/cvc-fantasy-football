import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Radio, Trophy } from "lucide-react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { TeamLogo } from "@/components/TeamLogo";

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

export function CvcScheduleResults() {
  const overview = trpc.league.overview.useQuery();
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
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const activeWeek = selectedWeek ?? suggestedWeek;
  const active = groups.find(group => group.week === activeWeek);
  const index = groups.findIndex(group => group.week === activeWeek);
  const isCurrent = active?.matchups.some(matchup => matchup.result_state === "live") || activeWeek === suggestedWeek;

  if (overview.isLoading) return <div className="p-8 text-sm text-slate-400">Loading CVC schedule and Tank01 result state…</div>;
  if (overview.error) return <div className="rounded-2xl border border-rose-400/30 bg-rose-950/30 p-6 text-rose-100">CVC schedule could not load: {overview.error.message}</div>;
  if (!groups.length || !active) return <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-8 text-slate-300">No imported CVC matchups are available for this season.</div>;

  return <section className="min-h-screen bg-[#06121b] px-3 pb-12 pt-4 text-white sm:px-6">
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-cvc-accent">Game Center</p>
          <h1 className="font-display text-5xl uppercase leading-none sm:text-6xl">Schedule &amp; Results</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">CVC matchups are finalized only by the Tank01 scoring synchronization after the NFL stat-correction window.</p>
        </div>
        {isCurrent && <Link href="/live" className="inline-flex items-center gap-2 rounded-xl bg-cvc-accent px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-cvc-deep shadow-lg shadow-cvc-accent/20"><Radio size={15} /> Open Live Scoring</Link>}
      </div>

      <div className="mb-5 flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none]">
        {groups.map(group => <button key={group.week} onClick={() => setSelectedWeek(group.week)} className={`shrink-0 rounded-xl border px-4 py-2 text-xs font-black uppercase tracking-[0.12em] transition ${group.week === activeWeek ? "border-cvc-accent bg-cvc-accent text-cvc-deep" : "border-white/15 bg-white/5 text-slate-200 hover:border-white/35"}`}>WK {group.week}</button>)}
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] shadow-2xl shadow-black/20">
        <header className="flex items-center justify-between border-b border-white/10 bg-[#10283a] px-4 py-4 sm:px-6">
          <button aria-label="Previous week" disabled={index <= 0} onClick={() => setSelectedWeek(groups[index - 1]?.week ?? activeWeek)} className="rounded-lg p-2 text-slate-300 transition hover:bg-white/10 disabled:opacity-25"><ChevronLeft /></button>
          <div className="text-center"><p className="text-[11px] font-black uppercase tracking-[0.18em] text-cvc-accent">CVC 2026 Regular Season</p><h2 className="mt-1 font-display text-3xl uppercase">{active.label}</h2></div>
          <button aria-label="Next week" disabled={index >= groups.length - 1} onClick={() => setSelectedWeek(groups[index + 1]?.week ?? activeWeek)} className="rounded-lg p-2 text-slate-300 transition hover:bg-white/10 disabled:opacity-25"><ChevronRight /></button>
        </header>
        <div className="divide-y divide-slate-200 bg-white">
          {active.matchups.map((matchup: Matchup) => {
            const isFinal = matchup.result_state === "final";
            const away = Number(matchup.away_score ?? 0);
            const home = Number(matchup.home_score ?? 0);
            return <article key={matchup.id} className="group grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-5 text-cvc-deep transition hover:bg-cvc-tint sm:px-6">
              <div className="flex min-w-0 items-center gap-3"><TeamLogo name={matchup.away} abbreviation={matchup.awayAbbreviation} logoUrl={matchup.awayLogoUrl} size="md" className="border-slate-200"/><div className="min-w-0"><p className={`truncate font-display text-xl leading-[0.9] uppercase sm:text-3xl ${isFinal && away < home ? "text-slate-400" : ""}`}>{matchup.away}</p><p className="mt-2 text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Away</p></div></div>
              <div className="min-w-[102px] text-center">
                {isFinal ? <div className="font-display text-4xl sm:text-5xl"><span className={away > home ? "text-cvc-deep" : "text-slate-400"}>{away.toFixed(1)}</span><span className="mx-1 text-cvc-accent">–</span><span className={home > away ? "text-cvc-deep" : "text-slate-400"}>{home.toFixed(1)}</span></div> : matchup.result_state === "live" ? <Link href="/live" className="inline-flex items-center gap-1 rounded-lg bg-cvc-deep px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-white">Live</Link> : <CalendarDays className="mx-auto text-slate-400" size={22} />}
                <div className="mt-2"><ResultState state={matchup.result_state} /></div>
              </div>
              <div className="flex min-w-0 items-center justify-end gap-3 text-right"><div className="min-w-0"><p className={`truncate font-display text-xl leading-[0.9] uppercase sm:text-3xl ${isFinal && home < away ? "text-slate-400" : ""}`}>{matchup.home}</p><p className="mt-2 text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Home</p></div><TeamLogo name={matchup.home} abbreviation={matchup.homeAbbreviation} logoUrl={matchup.homeLogoUrl} size="md" className="border-slate-200"/></div>
            </article>;
          })}
        </div>
        <footer className="flex items-center gap-2 bg-[#10283a] px-5 py-3 text-xs text-slate-300"><Trophy size={14} className="text-cvc-accent" /> Tank01 writes final CVC results automatically after NFL stat corrections are complete.</footer>
      </div>
    </div>
  </section>;
}
