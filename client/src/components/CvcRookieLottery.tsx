import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Radio, ShieldCheck, Sparkles, Timer, Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCvcOwnerAuth } from "@/hooks/useCvcOwnerAuth";

const pad = (value: number) => String(Math.max(0, value)).padStart(2, "0");

function Countdown({ lottery, now }: { lottery: any; now: number }) {
  if (lottery.status !== "RUNNING" || !lottery.startedAt || lottery.revealedCount >= lottery.franchiseCount) return null;
  const elapsed = lottery.elapsedMsBeforePause + Math.max(0, now - new Date(lottery.startedAt).getTime());
  const dueAt = (lottery.revealedCount + 1) * lottery.revealIntervalSeconds * 1_000;
  const remainingSeconds = Math.ceil(Math.max(0, dueAt - elapsed) / 1_000);
  return <div className="rounded-full border border-white/15 bg-white/10 px-5 py-2 font-mono text-2xl font-bold tracking-[0.15em] text-white tabular-nums">00:{pad(remainingSeconds)}</div>;
}

export function CvcRookieLottery({ roundNumber = 2 }: { roundNumber?: number }) {
  const { owner } = useCvcOwnerAuth();
  const isCommissioner = ["commissioner", "administrator"].includes(owner?.role ?? "");
  const utils = trpc.useUtils();
  const lottery = trpc.league.rookieLottery.useQuery({ roundNumber }, { refetchInterval: query => { const status = query.state.data?.status; if (status === "RUNNING") return 4_000; if (!query.state.data) return 8_000; return false; } });
  const [now, setNow] = useState(() => Date.now());
  const [abortReason, setAbortReason] = useState("");

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, []);

  const refresh = () => { void utils.league.rookieLottery.invalidate(); void utils.league.draftBoard.invalidate(); };

  // The lottery can also complete purely from polling elapsed time (nobody clicking a
  // button) -- the server-side write to draft_pick still happens in that case, but
  // nothing had ever told the Draft Board table to refetch and show it, so the page
  // could sit showing a stale, pre-lottery order until manually reloaded. Watches for
  // the transition into COMPLETE and invalidates draftBoard exactly once when it
  // happens, regardless of whether a mutation or plain polling caused it.
  const previousStatusRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const status = lottery.data?.status;
    if (status === "COMPLETE" && previousStatusRef.current !== "COMPLETE") void utils.league.draftBoard.invalidate();
    previousStatusRef.current = status;
  }, [lottery.data?.status, utils]);

  const start = trpc.league.startRookieLottery.useMutation({ onSuccess: refresh, onError: error => toast.error(error.message) });
  const pause = trpc.league.pauseRookieLottery.useMutation({ onSuccess: refresh, onError: error => toast.error(error.message) });
  const resume = trpc.league.resumeRookieLottery.useMutation({ onSuccess: refresh, onError: error => toast.error(error.message) });
  const abort = trpc.league.abortRookieLottery.useMutation({ onSuccess: () => { setAbortReason(""); refresh(); }, onError: error => toast.error(error.message) });

  const data = lottery.data;
  const latest = data?.reveals[data.reveals.length - 1];
  const nextPosition = data ? data.franchiseCount - data.revealedCount : null;
  const revealProgress = data ? `${data.revealedCount} / ${data.franchiseCount} revealed` : "";
  // Explicit sort by draft_position descending (pick 10 down to pick 1), rather than
  // relying on the reveals already arriving in that order from the server.
  const completedRows = useMemo(() => [...(data?.reveals ?? [])].sort((a, b) => b.draftPosition - a.draftPosition), [data?.reveals]);

  if (lottery.isLoading) return null;

  if (!data) {
    return <section className="mt-5 overflow-hidden rounded-3xl border border-white/10 bg-[#100d0a] text-white shadow-2xl">
      <div className="px-6 py-10 text-center sm:px-12">
        <Timer className="mx-auto h-9 w-9 text-[#e2b23d]" />
        <p className="mt-4 font-display text-sm font-bold uppercase tracking-[.22em] text-[#e2b23d]">Round {roundNumber} draft lottery</p>
        <h2 className="mt-2 font-display text-2xl font-extrabold uppercase">{isCommissioner ? "Not started yet" : "Coming soon"}</h2>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-stone-300">{isCommissioner ? `Shuffles all round ${roundNumber} picks with a server-side cryptographic draw, locked in with a commitment hash before anything is revealed. Positions reveal automatically every 20 seconds, in reverse — last pick first, first pick last.` : `The commissioner hasn't started the round ${roundNumber} lottery yet. Check back here once it's underway — positions reveal live, one every 20 seconds.`}</p>
        {isCommissioner ? <>
          <button type="button" disabled={start.isPending} onClick={() => { if (window.confirm(`Start the round ${roundNumber} lottery? The draw locks in immediately and can't be changed once started (only aborted).`)) start.mutate({ roundNumber }); }} className="mt-6 rounded-lg bg-[#e2b23d] px-5 py-2.5 text-xs font-black uppercase tracking-[0.1em] text-[#100d0a] disabled:opacity-50">{start.isPending ? "Starting…" : `Start round ${roundNumber} lottery`}</button>
          {start.error ? <p className="mt-2 text-sm text-red-300">{start.error.message}</p> : null}
        </> : null}
      </div>
    </section>;
  }

  return <section className="relative mt-5 overflow-hidden rounded-3xl border border-white/10 bg-[#100d0a] text-white shadow-2xl">
    <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:radial-gradient(circle_at_50%_-20%,rgba(226,178,61,.5),transparent_35%)]" />
    <div className="relative px-6 py-8 sm:px-10 sm:py-10">
      <header className="mx-auto max-w-3xl text-center">
        <div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-[#e2b23d]/40 bg-[#e2b23d]/10 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[.2em] text-[#e2b23d]"><Radio className="h-3 w-3 animate-pulse" />Live order reveal</div>
        <h2 className="mt-4 font-display text-3xl font-extrabold uppercase sm:text-4xl">Round {roundNumber} Lottery</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-stone-300">Positions reveal in reverse — pick {data.franchiseCount} first, pick 1 last.</p>
      </header>

      <div className="mx-auto mt-8 grid max-w-5xl gap-5 lg:grid-cols-[1fr_1.6fr_1fr]">
        <div className="order-2 rounded-2xl border border-white/10 bg-black/20 p-5 text-center lg:order-1">
          <p className="font-display text-[10px] font-bold uppercase tracking-[.2em] text-stone-400">Reveal pace</p>
          <p className="mt-2 font-display text-2xl font-extrabold">{data.revealIntervalSeconds} sec</p>
          <p className="mt-1 text-xs leading-5 text-stone-400">{revealProgress}</p>
        </div>

        <div className="relative order-1 overflow-hidden rounded-2xl border border-[#e2b23d]/30 bg-gradient-to-b from-[#3a2a0a] via-[#1c150d] to-[#0e0c09] px-6 py-8 text-center shadow-[0_20px_60px_rgba(0,0,0,.5)] lg:order-2">
          <div className="mx-auto flex w-fit items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.18em] text-[#e2b23d]"><Sparkles className="h-3 w-3" />{data.status === "RUNNING" ? `Next: Pick ${nextPosition}` : data.status === "PAUSED" ? "Lottery paused" : data.status === "ABORTED" ? "Lottery aborted" : "Official order complete"}</div>
          {data.status === "RUNNING" ? <div className="mt-5 flex justify-center"><Countdown lottery={data} now={now} /></div> : null}
          <p className="mt-5 font-display text-xs font-bold uppercase tracking-[.2em] text-stone-400">{latest ? `Pick ${latest.draftPosition}` : "First reveal incoming"}</p>
          <h3 className="mt-2 min-h-11 font-display text-3xl font-extrabold sm:text-4xl">{latest?.franchiseName ?? "Stand by"}</h3>
          {latest ? <p className="mt-4 text-[11px] font-bold uppercase tracking-[.14em] text-[#e2b23d]">Revealed at {new Date(latest.revealedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</p> : <p className="mt-4 text-sm text-stone-300">The full order is locked before any result is shown.</p>}
        </div>

        <div className="order-3 rounded-2xl border border-white/10 bg-black/20 p-5 text-center">
          <p className="font-display text-[10px] font-bold uppercase tracking-[.2em] text-stone-400">Draw integrity</p>
          <ShieldCheck className="mx-auto mt-2 h-6 w-6 text-[#e2b23d]" />
          <p className="mt-2 text-xs leading-5 text-stone-300">The complete order was locked before the first reveal.</p>
          <p className="mt-2 font-mono text-[9px] tracking-wider text-stone-500">{data.orderCommitment.slice(0, 18)}…</p>
        </div>
      </div>

      {isCommissioner && data.status !== "COMPLETE" && data.status !== "ABORTED" ? <div className="mx-auto mt-6 flex max-w-5xl flex-wrap items-center justify-center gap-3">
        {data.status === "RUNNING" ? <button type="button" disabled={pause.isPending} onClick={() => pause.mutate({ roundNumber })} className="rounded-lg border border-white/20 px-4 py-2 text-xs font-black uppercase tracking-[.1em] text-white disabled:opacity-50">{pause.isPending ? "Pausing…" : "Pause"}</button> : null}
        {data.status === "PAUSED" ? <button type="button" disabled={resume.isPending} onClick={() => resume.mutate({ roundNumber })} className="rounded-lg bg-[#e2b23d] px-4 py-2 text-xs font-black uppercase tracking-[.1em] text-[#100d0a] disabled:opacity-50">{resume.isPending ? "Resuming…" : "Resume"}</button> : null}
        <div className="flex items-center gap-2">
          <input value={abortReason} onChange={event => setAbortReason(event.target.value)} placeholder="Reason for aborting" className="rounded-md border border-white/20 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-stone-500" />
          <button type="button" disabled={abortReason.trim().length < 4 || abort.isPending} onClick={() => { if (window.confirm(`Abort the round ${roundNumber} lottery? This cannot be undone — you'll need to start a fresh draw.`)) abort.mutate({ roundNumber, reason: abortReason.trim() }); }} className="rounded-lg border border-red-400/40 px-4 py-2 text-xs font-black uppercase tracking-[.1em] text-red-300 disabled:opacity-50">{abort.isPending ? "Aborting…" : "Abort"}</button>
        </div>
      </div> : null}
      {data.status === "COMPLETE" ? <p className="mt-6 text-center text-sm font-semibold text-emerald-300">Round {roundNumber} order is set — the CVC Draft Board below reflects the final results.</p> : null}
      {data.status === "ABORTED" ? <p className="mt-6 text-center text-sm text-red-300">Aborted: {data.abortReason}</p> : null}

      <div className="mx-auto mt-8 max-w-5xl rounded-2xl border border-white/10 bg-black/25 p-5">
        <div className="flex items-center justify-between border-b border-white/10 pb-4"><h3 className="font-display text-lg font-extrabold uppercase">Positions revealed</h3><span className="flex items-center gap-2 text-xs text-stone-300"><Trophy className="h-3.5 w-3.5 text-[#e2b23d]" />Pick 1 is revealed last</span></div>
        {completedRows.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{completedRows.map(reveal => <div key={reveal.revealIndex} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[.035] p-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#e2b23d]/30 bg-[#e2b23d]/10 font-display text-sm font-extrabold text-[#e2b23d]">{reveal.draftPosition}</div><p className="truncate font-semibold text-white">{reveal.franchiseName}</p></div>)}</div> : <p className="py-6 text-center text-sm text-stone-400">The first pick will appear here shortly.</p>}
      </div>
    </div>
  </section>;
}
