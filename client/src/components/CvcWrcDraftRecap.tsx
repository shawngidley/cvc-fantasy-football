import { Award, CheckCircle2, Trophy } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useCvcOwnerAuth } from "@/hooks/useCvcOwnerAuth";
import { DraftSubNav } from "@/components/DraftSubNav";

function RecordRookiePick({ openPicks }: { openPicks: { id: string; round_number: number; pick_number: number; currentFranchise: string; originalFranchise: string }[] }) {
  const utils = trpc.useUtils();
  const overview = trpc.league.overview.useQuery();
  const [draftPickId, setDraftPickId] = useState("");
  const [playerSearch, setPlayerSearch] = useState(""); const [playerId, setPlayerId] = useState(""); const [selectedPlayerLabel, setSelectedPlayerLabel] = useState(""); const [showSuggestions, setShowSuggestions] = useState(false);
  const [winningFranchiseId, setWinningFranchiseId] = useState("");
  const [salary, setSalary] = useState("1");
  const suggestions = trpc.league.eligibleRookies.useQuery({ search: playerSearch.trim() || undefined, limit: 8 }, { enabled: playerSearch.trim().length > 1 && !playerId });
  const record = trpc.league.recordDraftSelection.useMutation({
    onSuccess: async () => {
      toast.success("Rookie draft pick recorded.");
      setDraftPickId(""); setPlayerSearch(""); setPlayerId(""); setSelectedPlayerLabel(""); setWinningFranchiseId(""); setSalary("1");
      await Promise.all([utils.league.draftBoard.invalidate(), utils.league.freeAgents.invalidate(), utils.auction.eligiblePlayers.invalidate()]);
    },
    onError: error => toast.error(error.message),
  });
  const selectPlayer = (player: any) => { setPlayerId(player.id); setSelectedPlayerLabel(`${player.display_name} · ${player.position || "—"} · ${player.nfl_team || "FA"}`); setPlayerSearch(""); setShowSuggestions(false); };
  const clearPlayer = () => { setPlayerId(""); setSelectedPlayerLabel(""); setPlayerSearch(""); };
  return <section className="mt-5 overflow-hidden rounded-xl border border-white/10 bg-white text-cvc-deep shadow-[0_8px_24px_rgba(0,0,0,0.16)]">
    <div className="h-1 bg-[#e2b23d]"/>
    <header className="bg-[#123040] px-5 py-3 font-display text-xl uppercase tracking-[0.08em] text-white">Record a rookie pick</header>
    <div className="p-5">
      <p className="mb-4 text-xs text-slate-500">Nomination, bidding, and the matching-rights decision all happen live in the room. This just records who ends up with the player and at what price — the winning franchise can be the pick holder (if they matched) or the highest bidder (if they passed).</p>
      <div className="grid gap-4 lg:grid-cols-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.13em] text-slate-500">Pick</p>
          <select value={draftPickId} onChange={event => setDraftPickId(event.target.value)} className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
            <option value="">Choose pick</option>
            {openPicks.map(pick => <option key={pick.id} value={pick.id}>R{pick.round_number}.{String(pick.pick_number).padStart(2, "0")} — {pick.currentFranchise}{pick.originalFranchise !== pick.currentFranchise ? ` (${pick.originalFranchise})` : ""}</option>)}
          </select>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.13em] text-slate-500">Rookie player</p>
          <div className="relative mt-2">
            {playerId ? <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm"><span className="font-semibold text-cvc-deep">{selectedPlayerLabel}</span><button type="button" onClick={clearPlayer} className="text-xs font-bold uppercase tracking-[.06em] text-slate-500 hover:text-cvc-accent">Change</button></div> : <>
              <input value={playerSearch} onChange={event => { setPlayerSearch(event.target.value); setShowSuggestions(true); }} onFocus={() => setShowSuggestions(true)} placeholder="Search QB/RB/WR/TE/K rookies" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
              {showSuggestions && playerSearch.trim().length > 1 ? <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl">{suggestions.isLoading ? <p className="px-3 py-2 text-xs text-slate-400">Searching…</p> : suggestions.data?.length ? suggestions.data.map((player: any) => <button type="button" key={player.id} onClick={() => selectPlayer(player)} className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-50"><span className="font-semibold text-cvc-deep">{player.display_name}</span> <span className="text-xs text-slate-500">· {player.position || "—"} · {player.nfl_team || "FA"}</span></button>) : <p className="px-3 py-2 text-xs text-slate-400">No eligible rookies match.</p>}</div> : null}
            </>}
          </div>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.13em] text-slate-500">Winning franchise</p>
          <select value={winningFranchiseId} onChange={event => setWinningFranchiseId(event.target.value)} className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
            <option value="">Choose winning franchise</option>
            {overview.data?.franchises.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.13em] text-slate-500">Salary</p>
          <input value={salary} onChange={event => setSalary(event.target.value.replace(/\D/g, ""))} className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2 text-sm" inputMode="numeric" placeholder="Winning bid" />
        </div>
      </div>
      <button disabled={!draftPickId || !playerId || !winningFranchiseId || Number(salary) < 0 || record.isPending} onClick={() => record.mutate({ draftPickId, playerId, winningFranchiseId, salary: Number(salary) })} className="mt-4 rounded-lg bg-cvc-deep px-4 py-2.5 text-xs font-black uppercase tracking-[0.1em] text-white disabled:cursor-not-allowed disabled:opacity-50">{record.isPending ? "Recording…" : "Record rookie pick"}</button>
      {record.error ? <p className="mt-2 text-sm text-red-700">{record.error.message}</p> : null}
    </div>
  </section>;
}

export function CvcWrcDraftRecap() {
  const { owner } = useCvcOwnerAuth();
  const isCommissioner = ["commissioner", "administrator"].includes(owner?.role ?? "");
  const board = trpc.league.draftBoard.useQuery();
  const utils = trpc.useUtils();
  const isComplete = board.data?.status === "complete";
  const markComplete = trpc.league.saveDraft.useMutation({
    onSuccess: async () => { toast.success("Rookie draft marked complete — undrafted rookies are now auction-eligible."); await Promise.all([utils.league.draftBoard.invalidate(), utils.auction.eligiblePlayers.invalidate()]); },
    onError: error => toast.error(error.message),
  });
  const picks = (board.data?.picks ?? []).filter(pick => pick.currentFranchise !== "Unknown" && !/placeholder|lottery/i.test(pick.notes ?? ""));
  const recorded = picks.filter(pick => pick.pick_status !== "open");
  if (board.isLoading) return <><DraftSubNav current="rookie" /><section className="mx-auto max-w-5xl pb-10"><div className="rounded-xl border border-white/10 bg-white/5 p-7 text-center text-sm text-white/70">Loading CVC Draft Recap…</div></section></>;
  return <><DraftSubNav current="rookie" /><section className="mx-auto max-w-5xl pb-10"><header className="px-1 pt-2"><p className="text-xs font-black uppercase tracking-[0.16em] text-[#e2b23d]">CVC draft center</p><h1 className="mt-2 font-display text-5xl uppercase text-white">Rookie Draft</h1><p className="mt-2 text-sm text-white/70">CVC rookie-draft selections and pick ownership, published as entries are recorded.</p></header>{isCommissioner && board.data ? <div className={isComplete ? "mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-5 py-4" : "mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e2b23d]/40 bg-[#e2b23d]/10 px-5 py-4"}><div className="flex items-center gap-3">{isComplete ? <CheckCircle2 size={20} className="text-emerald-400" /> : <Award size={20} className="text-[#e2b23d]" />}<div><p className={isComplete ? "font-display text-lg uppercase text-emerald-300" : "font-display text-lg uppercase text-[#e2b23d]"}>{isComplete ? "Rookie draft complete" : "Rookie draft in progress"}</p><p className="text-xs text-white/60">{isComplete ? "Undrafted rookies are auction-eligible." : "Undrafted rookies stay blocked from the regular auction until this is marked complete."}</p></div></div>{!isComplete ? <button type="button" disabled={markComplete.isPending} onClick={() => { if (window.confirm("Mark the rookie draft complete? Undrafted rookies immediately become eligible for the regular CVC auction.")) markComplete.mutate({ label: board.data.label, draftType: "rookie", status: "complete", lotteryEnabled: board.data.lottery_enabled, pickTimerSeconds: board.data.pick_timer_seconds }); }} className="rounded-lg bg-[#e2b23d] px-4 py-2 text-xs font-black uppercase tracking-[0.1em] text-cvc-deep disabled:opacity-50">{markComplete.isPending ? "Saving…" : "Mark rookie draft complete"}</button> : null}</div> : null}{isCommissioner ? <RecordRookiePick openPicks={picks.filter(pick => pick.pick_status === "open")} /> : null}{!picks.length ? <EmptyRecap/> : <><div className="mt-6 grid gap-4 sm:grid-cols-3"><Metric label="Configured picks" value={String(picks.length)} icon={<Award size={18}/>}/><Metric label="Selections recorded" value={String(recorded.length)} icon={<Trophy size={18}/>}/><Metric label="Draft status" value={board.data?.status?.replaceAll("_", " ") ?? "setup"} icon={<Award size={18}/>}/></div><section className="mt-6 overflow-hidden rounded-xl border border-white/10 bg-white text-cvc-deep shadow-[0_8px_24px_rgba(0,0,0,0.16)]"><div className="h-1 bg-[#e2b23d]"/><header className="bg-[#123040] px-5 py-3 font-display text-xl uppercase tracking-[0.08em] text-white">CVC Draft Board</header><div className="overflow-x-auto"><table className="min-w-[660px] w-full text-left text-sm"><thead className="border-b border-slate-200 bg-slate-50 text-xs font-black uppercase tracking-[0.08em] text-slate-500"><tr><th className="px-5 py-3">Pick</th><th className="px-5 py-3">Franchise</th><th className="px-5 py-3">Selection status</th><th className="px-5 py-3">CVC note</th></tr></thead><tbody>{picks.map(pick => <tr className="border-b border-slate-100 last:border-0" key={pick.id}><td className="px-5 py-4"><span className="rounded bg-[#edf5e7] px-2 py-1 font-display text-sm text-cvc-deep">R{pick.round_number}.{String(pick.pick_number).padStart(2, "0")}</span></td><td className="px-5 py-4 font-semibold">{pick.currentFranchise}{pick.originalFranchise !== "Unknown" && pick.originalFranchise !== pick.currentFranchise ? <span className="ml-1.5 font-normal text-slate-400">({pick.originalFranchise})</span> : null}</td><td className="px-5 py-4"><span className={pick.pick_status === "open" ? "font-semibold text-slate-400" : "font-semibold text-emerald-700"}>{pick.pick_status === "open" ? "Awaiting selection" : "Selection recorded"}</span></td><td className="px-5 py-4 text-slate-500">{pick.notes ?? (pick.is_protected ? "Protected CVC pick" : "CVC rookie-draft pick")}</td></tr>)}</tbody></table></div></section><p className="mt-4 text-center text-xs text-white/50">Player-by-player recap details will appear only after CVC rookie selections are officially recorded.</p></>}</section></>;
}

function EmptyRecap() { return <section className="mt-6 overflow-hidden rounded-xl border border-white/10 bg-white text-center text-cvc-deep shadow-[0_8px_24px_rgba(0,0,0,0.16)]"><div className="h-1 bg-[#e2b23d]"/><div className="px-7 py-12"><Trophy className="mx-auto text-[#dcae37]" size={48}/><h2 className="mt-4 font-display text-3xl uppercase">Draft Recap Not Yet Available</h2><p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-500">CVC rookie-draft picks have not been configured or recorded. This recap will remain empty until commissioner-approved selections exist.</p></div></section>; }
function Metric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) { return <section className="rounded-xl border border-white/10 bg-white px-5 py-4 text-cvc-deep shadow-[0_8px_24px_rgba(0,0,0,0.12)]"><div className="flex items-center gap-2 text-[#b9821c]">{icon}<span className="text-xs font-black uppercase tracking-[0.1em]">{label}</span></div><p className="mt-2 font-display text-3xl uppercase">{value}</p></section>; }
