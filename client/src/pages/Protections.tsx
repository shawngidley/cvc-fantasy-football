import { LeagueLayout } from "@/components/LeagueLayout";
import { trpc } from "@/lib/trpc";
import { ShieldCheck } from "lucide-react";

function rightLabel(rightType: string) {
  return rightType.replaceAll("_", " ");
}

export default function Protections() {
  const mine = trpc.league.myFranchise.useQuery();
  const access = trpc.league.access.useQuery();
  const utils = trpc.useUtils();
  const roster = trpc.league.franchiseRoster.useQuery(
    { franchiseId: mine.data?.id ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(mine.data?.id) },
  );
  const refresh = async () => {
    await Promise.all([utils.league.franchiseRoster.invalidate(), utils.league.activity.invalidate()]);
  };
  const cutPlayer = trpc.league.cutContractPlayer.useMutation({ onSuccess: refresh });
  const franchiseTag = trpc.league.assignFranchiseTag.useMutation({ onSuccess: refresh });
  const transitionTag = trpc.league.assignTransitionTag.useMutation({ onSuccess: refresh });
  const restrictedRight = trpc.league.assignRestrictedRight.useMutation({ onSuccess: refresh });

  const players = [...(roster.data?.players ?? [])].sort((a, b) => (a.player?.display_name ?? "").localeCompare(b.player?.display_name ?? ""));
  const busy = cutPlayer.isPending || franchiseTag.isPending || transitionTag.isPending || restrictedRight.isPending;
  const actionError = cutPlayer.error ?? franchiseTag.error ?? transitionTag.error ?? restrictedRight.error;
  const franchiseId = mine.data?.id;

  function confirmAction(message: string, action: () => void) {
    if (window.confirm(message)) action();
  }

  return (
    <LeagueLayout>
      <div className="mb-8">
        <div className="cvc-eyebrow"><ShieldCheck size={14} /> Owner rights</div>
        <h1 className="mt-2 font-display text-5xl uppercase leading-none tracking-[0.04em] text-white sm:text-6xl">Protections</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-cvc-muted">Review each imported contract and make an official CVC protection decision. All changes are recorded in the league audit history and immediately refresh roster, lineup, free-agent, and Auction Room eligibility.</p>
      </div>

      <section className="cvc-card">
        <div className="cvc-card-title"><span>{mine.data?.name ?? "My franchise"} · eligible decisions</span></div>
        <div className="cvc-card-stripe" />
        <div className="cvc-card-body">
          {mine.isLoading || roster.isLoading ? <p className="text-sm text-slate-600">Loading protection candidates…</p> : null}
          {roster.error ? <p className="text-sm font-medium text-red-700">{roster.error.message}</p> : null}
          {!mine.isLoading && !roster.isLoading && !roster.error && players.length ? (
            <div className="overflow-x-auto">
              <table className="cvc-table min-w-[1120px]">
                <thead><tr><th>Player</th><th>Pos.</th><th>Salary</th><th>Contract</th><th>Current right</th><th>Protection decision</th></tr></thead>
                <tbody>{players.map(item => {
                  const marker = (item.contract?.source_marker ?? "").toUpperCase();
                  const rightText = item.rights.length ? item.rights.map(right => rightLabel(right.right_type)).join(", ") : item.contract?.contract_status ?? item.roster_state;
                  const hasActiveRight = item.rights.length > 0;
                  const available = Boolean(item.contract) && !hasActiveRight && Boolean(franchiseId);
                  const taggedSalary = item.contract ? Number(item.contract.salary) + 1 : 0;
                  const needsTwoYearFranchiseTerm = taggedSalary < 10;
                  const playerName = item.player?.display_name ?? "this player";
                  return <tr key={item.id}>
                    <td className="font-semibold">{playerName}</td>
                    <td>{item.player?.position ?? "—"}</td>
                    <td>{item.contract ? `$${Number(item.contract.salary).toFixed(0)}` : "—"}</td>
                    <td>{item.contract?.source_marker ?? item.contract?.expires_year ?? "—"}</td>
                    <td className="capitalize">{rightText}</td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={!available || busy} onClick={() => confirmAction(`Release ${playerName}? This is final, carries no contract penalty, and makes the player an unrestricted free agent.`, () => cutPlayer.mutate({ franchiseId: franchiseId!, playerId: item.player_id }))} className="rounded border border-red-300 bg-red-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-red-800 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50">Cut · no penalty</button>
                        <button type="button" disabled={!available || !needsTwoYearFranchiseTerm || busy} onClick={() => confirmAction(`Assign a two-year franchise tag to ${playerName}? Salary increases by $1.`, () => franchiseTag.mutate({ franchiseId: franchiseId!, playerId: item.player_id, contractYears: 2 }))} className="rounded border border-cvc-gold/50 bg-cvc-gold/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-cvc-deep transition hover:bg-cvc-gold/20 disabled:cursor-not-allowed disabled:opacity-50">Franchise · 2 yr</button>
                        <button type="button" disabled={!available || needsTwoYearFranchiseTerm || busy} onClick={() => confirmAction(`Assign a three-year franchise tag to ${playerName}? Salary increases by $1.`, () => franchiseTag.mutate({ franchiseId: franchiseId!, playerId: item.player_id, contractYears: 3 }))} className="rounded border border-cvc-gold/50 bg-cvc-gold/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-cvc-deep transition hover:bg-cvc-gold/20 disabled:cursor-not-allowed disabled:opacity-50">Franchise · 3 yr</button>
                        <button type="button" disabled={!available || busy} onClick={() => confirmAction(`Assign a one-year transition tag to ${playerName}? Under-$10 contracts double; $10-and-over contracts add $10. This tag cannot be used again for this player.`, () => transitionTag.mutate({ franchiseId: franchiseId!, playerId: item.player_id }))} className="rounded border border-sky-300 bg-sky-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-sky-800 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50">Transition</button>
                        <button type="button" disabled={!available || !marker.includes("R") || busy} onClick={() => confirmAction(`Assign rookie matching rights to ${playerName}? CVC will pause the future auction award for a commissioner match decision.`, () => restrictedRight.mutate({ franchiseId: franchiseId!, playerId: item.player_id, rightType: "rookie_match" }))} className="rounded border border-violet-300 bg-violet-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-violet-800 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50">Rookie right</button>
                        <button type="button" disabled={!available || !marker.includes("W") || busy} onClick={() => confirmAction(access.data?.isCommissioner ? `Assign the franchise waiver matching right to ${playerName}? As commissioner, you are approving the legacy waiver eligibility if no qualifying acquisition record exists.` : `Assign the franchise waiver matching right to ${playerName}? Each franchise can hold one active waiver right this season and this player must have a recorded qualifying acquisition.`, () => restrictedRight.mutate({ franchiseId: franchiseId!, playerId: item.player_id, rightType: "waiver_match", waiverEligibilityOverride: Boolean(access.data?.isCommissioner) }))} className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50">Waiver right</button>
                      </div>
                    </td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          ) : null}
          {!mine.isLoading && !roster.isLoading && !roster.error && !players.length ? <p className="text-sm text-slate-600">No rostered players are available for protection review.</p> : null}
          {actionError ? <p className="mt-4 text-sm font-medium text-red-700">{actionError.message}</p> : null}
          <div className="mt-6 rounded-lg border border-dashed border-cvc-deep/20 bg-cvc-tint p-4 text-sm leading-6 text-slate-600"><strong className="text-cvc-deep">CVC protection rules:</strong> A franchise may designate one under-$10 and one $10-and-over franchise player. Franchise salary increases by $1, then the resulting tier determines the term: two years below $10 and three years at $10 or above. A transition player receives one final year—under-$10 contracts double and $10-and-over contracts add $10. Rookie and waiver rights require an expired qualifying contract; waiver rights also require a recorded CVC waiver or free-agent acquisition.</div>
        </div>
      </section>
    </LeagueLayout>
  );
}
