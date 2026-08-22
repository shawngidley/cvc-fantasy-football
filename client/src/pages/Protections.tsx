import { LeagueLayout } from "@/components/LeagueLayout";
import { trpc } from "@/lib/trpc";
import { ShieldCheck } from "lucide-react";

export default function Protections() {
  const mine = trpc.league.myFranchise.useQuery();
  const roster = trpc.league.franchiseRoster.useQuery(
    { franchiseId: mine.data?.id ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(mine.data?.id) },
  );

  return <LeagueLayout><div className="mb-8"><div className="cvc-eyebrow"><ShieldCheck size={14} /> Owner rights</div><h1 className="mt-2 font-display text-5xl uppercase leading-none tracking-[0.04em] text-white sm:text-6xl">Protections</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-cvc-muted">Select and review franchise, transition, rookie, and waiver rights for your CVC roster. Finalized rights control roster retention, lineup eligibility, free-agent availability, and auction matching rights.</p></div><section className="cvc-card"><div className="cvc-card-title"><span>{mine.data?.name ?? "My franchise"} · eligible decisions</span></div><div className="cvc-card-stripe" /><div className="cvc-card-body">{mine.isLoading || roster.isLoading ? <p className="text-sm text-slate-600">Loading protection candidates…</p> : roster.data?.players?.length ? <div className="overflow-x-auto"><table className="cvc-table"><thead><tr><th>Player</th><th>Position</th><th>Current status</th><th>Protection decision</th></tr></thead><tbody>{roster.data.players.map(item => <tr key={item.id}><td className="font-semibold">{item.player?.display_name ?? "Player unavailable"}</td><td>{item.player?.position ?? "—"}</td><td>{item.roster_state}</td><td><span className="cvc-pill upcoming">Decision pending</span></td></tr>)}</tbody></table></div> : <p className="text-sm text-slate-600">No rostered players are available for protection review.</p>}<div className="mt-6 rounded-lg border border-dashed border-cvc-deep/20 bg-cvc-tint p-4 text-sm leading-6 text-slate-600"><strong className="text-cvc-deep">Protection rules:</strong> CVC will enforce one under-$10 and one over-$10 franchise designation, transition eligibility, rookie matching rights, and the single waiver matching right after the commissioner enables the season’s protection window.</div></div></section></LeagueLayout>;
}
