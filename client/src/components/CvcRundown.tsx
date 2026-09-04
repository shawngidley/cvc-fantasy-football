import { useMemo, useState } from "react";
import { CalendarDays, Radio, Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc";

type Matchup = {
  id: string;
  away: string;
  home: string;
  away_score: number | string | null;
  home_score: number | string | null;
  result_state: string;
  week?: { week_number?: number | null; label?: string | null } | null;
};

export function CvcRundown() {
  const overview = trpc.league.overview.useQuery();
  const mine = trpc.league.myFranchise.useQuery();
  const groups = useMemo<Array<{ week: number; label: string; matchups: Matchup[] }>>(() => {
    const byWeek = new Map<number, Matchup[]>();
    for (const row of (overview.data?.matchups ?? []) as Matchup[]) {
      const week = Number(row.week?.week_number ?? 0);
      if (week) byWeek.set(week, [...(byWeek.get(week) ?? []), row]);
    }
    return Array.from(byWeek.entries()).map(([week, matchups]) => ({ week, label: matchups[0]?.week?.label ?? `Week ${week}`, matchups }));
  }, [overview.data?.matchups]);
  const current = groups.find(group => group.matchups.some((matchup: Matchup) => matchup.result_state === "live"))?.week
    ?? groups.find(group => group.matchups.some((matchup: Matchup) => matchup.result_state !== "final"))?.week
    ?? groups.at(-1)?.week
    ?? 1;
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const active = groups.find(group => group.week === (selectedWeek ?? current));
  const finalScores = active?.matchups.filter((matchup: Matchup) => matchup.result_state === "final").flatMap((matchup: Matchup) => [Number(matchup.away_score ?? 0), Number(matchup.home_score ?? 0)]).filter(score => score > 0) ?? [];
  const median = finalScores.length ? [...finalScores].sort((a, b) => a - b).reduce((total, score, index, values) => values.length % 2 ? total + (index === Math.floor(values.length / 2) ? score : 0) : total + (index === values.length / 2 - 1 || index === values.length / 2 ? score / 2 : 0), 0) : 0;

  if (overview.isLoading) return <div className="min-h-screen bg-[#06121b] p-8 text-slate-300">Loading CVC weekly rundown…</div>;
  if (overview.error || !active) return <div className="min-h-screen bg-[#06121b] p-8 text-rose-200">CVC weekly rundown is unavailable right now.</div>;

  return <section className="min-h-screen bg-[#06121b] px-3 pb-14 pt-5 text-white sm:px-6">
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-cvc-accent">League Desk</p>
        <h1 className="font-display text-5xl uppercase leading-none sm:text-6xl">Weekly Rundown</h1>
        <p className="mt-3 text-sm text-slate-300">{active.label} · {active.matchups.some((matchup: Matchup) => matchup.result_state === "live") ? "Live" : active.matchups.every((matchup: Matchup) => matchup.result_state === "final") ? "Final" : "Upcoming"}{median ? ` · League median: ${median.toFixed(1)} pts` : ""}</p>
      </div>
      <div className="mb-6 flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none]">{groups.map(group => <button key={group.week} onClick={() => setSelectedWeek(group.week)} className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-black uppercase tracking-[0.12em] ${group.week === active.week ? "border-cvc-accent bg-cvc-accent text-cvc-deep" : "border-white/20 bg-white/5 text-slate-200"}`}>WK {group.week}</button>)}</div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{active.matchups.map((matchup: Matchup) => {
        const final = matchup.result_state === "final";
        const away = Number(matchup.away_score ?? 0); const home = Number(matchup.home_score ?? 0);
        const myMatchup = mine.data?.name === matchup.away || mine.data?.name === matchup.home;
        return <article key={matchup.id} className={`overflow-hidden rounded-2xl border bg-white text-cvc-deep shadow-xl shadow-black/20 ${myMatchup ? "border-cvc-accent ring-2 ring-cvc-accent/40" : "border-white/10"}`}>
          {myMatchup && <div className="bg-cvc-accent px-4 py-1.5 text-center text-[10px] font-black uppercase tracking-[0.16em] text-cvc-deep">My Matchup</div>}
          <div className="border-t-4 border-cvc-accent px-5 py-5"><div className="flex items-center justify-between gap-4"><div className="min-w-0"><p className={`font-display text-2xl uppercase leading-none ${final && away < home ? "text-slate-400" : ""}`}>{matchup.away}</p><p className="mt-3 font-display text-4xl">{final ? away.toFixed(1) : "—"}</p>{final && median ? <p className={`mt-1 text-[10px] font-black uppercase tracking-[0.1em] ${away >= median ? "text-emerald-700" : "text-rose-700"}`}>{away >= median ? "Above median" : "Below median"}</p> : null}</div><div className="text-center">{matchup.result_state === "live" ? <Radio size={18} className="mx-auto animate-pulse text-rose-600" /> : final ? <Trophy size={18} className="mx-auto text-cvc-accent" /> : <CalendarDays size={18} className="mx-auto text-slate-400" />}<p className="mt-2 text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">{matchup.result_state}</p></div><div className="min-w-0 text-right"><p className={`font-display text-2xl uppercase leading-none ${final && home < away ? "text-slate-400" : ""}`}>{matchup.home}</p><p className="mt-3 font-display text-4xl">{final ? home.toFixed(1) : "—"}</p>{final && median ? <p className={`mt-1 text-[10px] font-black uppercase tracking-[0.1em] ${home >= median ? "text-emerald-700" : "text-rose-700"}`}>{home >= median ? "Above median" : "Below median"}</p> : null}</div></div></div>
        </article>;
      })}</div>
      <p className="mt-6 flex items-center gap-2 text-xs text-slate-400"><Radio size={13} className="text-cvc-accent" /> Matchup outcomes and weekly rundowns are fed only by Tank01 reconciliation; CVC does not accept manual commissioner scores.</p>
    </div>
  </section>;
}
