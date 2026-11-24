import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeftRight, Clock } from "lucide-react";
import { formatTradeDeadline, shouldShowTradeDeadlineBanner, tradeDeadlineCountdown } from "@shared/tradeDeadline";

/** Re-renders once a second while the deadline is ahead. */
export function useTradeDeadlineCountdown() {
  const [countdown, setCountdown] = useState(() => tradeDeadlineCountdown());
  useEffect(() => {
    if (countdown.passed) return;
    const timer = setInterval(() => setCountdown(tradeDeadlineCountdown()), 1000);
    return () => clearInterval(timer);
  }, [countdown.passed]);
  return countdown;
}

const pad = (value: number) => String(value).padStart(2, "0");

function Unit({ value, label }: { value: number; label: string }) {
  return <div className="flex flex-col items-center rounded-lg bg-black/25 px-2.5 py-1.5 min-w-[3.25rem]"><span className="font-display text-2xl leading-none text-white tabular-nums">{pad(value)}</span><span className="mt-1 text-[9px] font-black uppercase tracking-[0.14em] text-amber-200/80">{label}</span></div>;
}

/** Trade deadline countdown. Shown on the homepage and the Trade desk while the
 * deadline is ahead; a short "passed" notice for a week after; nothing later. */
export function CvcTradeDeadlineBanner({ showLink = true }: { showLink?: boolean }) {
  const countdown = useTradeDeadlineCountdown();
  if (!shouldShowTradeDeadlineBanner()) return null;

  if (countdown.passed) {
    return <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-slate-300/40 bg-slate-800 px-4 py-3 text-sm text-slate-200"><Clock size={16} className="shrink-0 text-slate-400" /><span><b className="text-white">Trade deadline has passed</b> ({formatTradeDeadline()}). Trades are closed for the rest of the season.</span></div>;
  }

  const urgent = countdown.msLeft < 6 * 3_600_000;
  return <div className={`mb-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border px-4 py-3 ${urgent ? "border-rose-400/60 bg-gradient-to-r from-rose-900 to-[#4a1020]" : "border-amber-400/50 bg-gradient-to-r from-[#3b2a06] to-[#1f1a08]"}`}>
    <div className="flex items-center gap-3">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${urgent ? "bg-rose-500/30 text-rose-200" : "bg-amber-400/20 text-amber-300"}`}><ArrowLeftRight size={16} /></span>
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-300">Trade deadline</p>
        <p className="text-sm font-semibold text-white">{formatTradeDeadline()} · trades must be <u>accepted</u> by then</p>
      </div>
    </div>
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5" aria-label={`${countdown.days} days ${countdown.hours} hours ${countdown.minutes} minutes ${countdown.seconds} seconds until the trade deadline`}>
        {countdown.days > 0 ? <Unit value={countdown.days} label={countdown.days === 1 ? "day" : "days"} /> : null}
        <Unit value={countdown.hours} label="hrs" />
        <Unit value={countdown.minutes} label="min" />
        <Unit value={countdown.seconds} label="sec" />
      </div>
      {showLink ? <Link href="/trades" className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-black uppercase tracking-[0.1em] text-cvc-deep hover:bg-amber-300">Trade desk</Link> : null}
    </div>
  </div>;
}
