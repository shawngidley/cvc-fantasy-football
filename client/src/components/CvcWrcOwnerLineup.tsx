import { useMemo } from "react";
import { getCvcLivePoints, useCvcTank01LiveScores } from "@/hooks/useCvcTank01LiveScores";
import { trpc } from "@/lib/trpc";

const teamInitial = (name: string) => name.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
const normalizeTeam = (team: string | null | undefined) => ({ kan: "kc", tam: "tb", arz: "ari", jax: "jac", was: "wsh" }[(team ?? "").toLowerCase()] ?? (team ?? "").toLowerCase());

function statSummary(position: string | null | undefined, statLine: any) {
  if (!statLine) return "No game stats yet";
  const pass = statLine.Passing ?? {}; const rush = statLine.Rushing ?? {}; const rec = statLine.Receiving ?? {}; const kick = statLine.Kicking ?? {}; const def = statLine.Defense ?? {};
  const value = (input: unknown) => Number(input ?? 0);
  if (position === "QB") return `${value(pass.passYds)} PYD · ${value(pass.passTD)} PTD · ${value(pass.int)} INT · ${value(rush.rushYds)} RYD`;
  if (["RB", "WR", "TE"].includes(position ?? "")) return `${value(rush.rushYds)} RYD · ${value(rush.rushTD)} RTD · ${value(rec.receptions)} REC · ${value(rec.recYds)} YD · ${value(rec.recTD)} TD`;
  if (position === "K") return `${value(kick.fgYds ?? kick.kickYards)} FG YDS · ${value(kick.xpMade)} XP`;
  return `${value(def.sacks)} SACK · ${value(def.defensiveInterceptions)} INT · ${value(def.fumblesRecovered)} FR · ${value(def.ptsAgainst)} PA`;
}

export function CvcWrcOwnerLineup() {
  const mine = trpc.league.myFranchise.useQuery();
  const roster = trpc.league.franchiseRoster.useQuery({ franchiseId: mine.data?.id ?? "00000000-0000-0000-0000-000000000000" }, { enabled: Boolean(mine.data?.id) });
  const board = trpc.league.liveScoringBoard.useQuery();
  const rules = trpc.league.scoringRules.useQuery();
  const slots = trpc.league.rosterSlots.useQuery();
  const live = useCvcTank01LiveScores(board.data?.week?.weekNumber, 2026, rules.data ?? []);
  const utils = trpc.useUtils();
  const updateSlot = trpc.league.setLineupSlot.useMutation({ onSuccess: () => { utils.league.franchiseRoster.invalidate(); utils.league.liveScoringBoard.invalidate(); } });
  const players = roster.data?.players ?? [];
  const starters = useMemo(() => players.filter(player => player.assigned_slot_code && !["BENCH", "BN", "IR", "TAXI"].includes(player.assigned_slot_code.toUpperCase())), [players]);
  const bench = useMemo(() => players.filter(player => !starters.some(starter => starter.id === player.id)), [players, starters]);
  const totalPoints = starters.reduce((total, assignment) => total + (assignment.player ? getCvcLivePoints(live.scores, assignment.player.display_name, assignment.player.position ?? "", assignment.player.nfl_team) ?? 0 : 0), 0);
  const lineup = [...starters, ...bench];

  if (mine.isLoading || roster.isLoading || board.isLoading || rules.isLoading || slots.isLoading) return <div className="cvc-card"><div className="cvc-card-title"><span>My lineup</span></div><div className="cvc-card-body text-sm text-slate-500">Loading your CVC roster, current week, and Tank01 game context…</div></div>;
  if (mine.error || !mine.data?.id) return <div className="cvc-card"><div className="cvc-card-title"><span>My lineup</span></div><div className="cvc-card-body text-sm text-slate-600">Sign in with a CVC owner account that has an assigned franchise to manage a lineup.</div></div>;
  if (roster.error || board.error || rules.error || slots.error) return <div className="cvc-card"><div className="cvc-card-title"><span>My lineup</span></div><div className="cvc-card-body text-sm text-red-700">{(roster.error ?? board.error ?? rules.error ?? slots.error)?.message}</div></div>;

  return <div className="space-y-5">
    <div className="rounded-xl border border-white/20 bg-black/25 px-4 py-3 text-sm font-bold uppercase tracking-[0.1em] text-cvc-accent">{mine.data.name} <span className="text-cvc-muted">(my team)</span></div>
    <div><div className="flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-xl bg-cvc-accent font-display text-xl text-cvc-deep">{teamInitial(mine.data.name)}</span><div><p className="font-display text-4xl uppercase tracking-[0.04em] text-white">My lineup</p><p className="mt-1 text-sm text-cvc-muted">{mine.data.name} · {board.data?.week?.label ?? "Current week"} · Players lock at NFL kickoff</p></div></div><div className="mt-5 flex flex-wrap gap-3"><span className="cvc-button-compact opacity-70">Tank01 lineup data</span><span className="cvc-button-secondary">Changes save instantly</span></div></div>
    <section className="rounded-2xl border border-cvc-accent/30 bg-[#062412] px-5 py-5 text-white shadow-xl"><div className="grid grid-cols-3 gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/60">Total points</p><p className="mt-1 font-display text-4xl text-cvc-accent">{totalPoints.toFixed(1)}</p></div><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/60">Starters</p><p className="mt-1 font-display text-4xl">{starters.length}</p></div><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/60">Live status</p><p className="mt-1 font-display text-2xl text-cvc-accent">{live.isPolling ? "LIVE" : "READY"}</p></div></div><p className="mt-5 text-center text-sm text-white/70">Tank01 updates active games every 30 seconds. Your submitted starters drive CVC Live Scoring.</p></section>
    <section className="overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/10"><div className="border-t-4 border-cvc-accent bg-[#062412] px-5 py-4 text-white"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-display text-2xl uppercase">CVC lineup · {players.length} players · {totalPoints.toFixed(1)} pts</h2><span className="text-xs font-bold uppercase tracking-[0.12em] text-white/60">Swipe table for full weekly detail</span></div></div><div className="overflow-x-auto"><table className="min-w-[900px] w-full border-collapse text-sm"><thead><tr className="bg-[#e7f0e8] text-[11px] font-bold uppercase tracking-[0.08em] text-[#1d4429]"><th className="px-3 py-3 text-left">Slot</th><th className="px-3 py-3 text-left">Player</th><th className="px-3 py-3">Opp</th><th className="px-3 py-3">Game</th><th className="px-3 py-3">Live pts</th><th className="px-3 py-3 text-left">Tank01 stats</th></tr></thead><tbody>{lineup.map(assignment => { const player = assignment.player; if (!player) return null; const currentSlot = assignment.assigned_slot_code ?? "BN"; const allowed = (slots.data ?? []).filter(slot => !slot.eligible_positions?.length || slot.eligible_positions.includes(player.position ?? "")); const livePoints = getCvcLivePoints(live.scores, player.display_name, player.position ?? "", player.nfl_team); const key = player.position === "DST" ? `dst:${normalizeTeam(player.nfl_team)}` : player.display_name.toLowerCase().replace(/[^a-z0-9]/g, ""); const matchup = live.nflMatchups[normalizeTeam(player.nfl_team)]; return <tr key={assignment.id} className="border-t border-slate-200 text-slate-700"><td className="px-3 py-3"><select value={assignment.assigned_slot_code ?? ""} onChange={event => event.target.value && updateSlot.mutate({ assignmentId: assignment.id, slotCode: event.target.value })} disabled={updateSlot.isPending} className="rounded bg-cvc-deep px-2 py-1 text-xs font-bold text-white"><option value="">BN</option>{allowed.map(slot => <option key={slot.id} value={slot.code}>{slot.code}</option>)}</select></td><td className="px-3 py-3"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-cvc-tint text-xs font-bold text-cvc-deep">{teamInitial(player.display_name)}</span><div><p className="font-display text-lg uppercase text-cvc-deep">{player.display_name}</p><p className="text-xs font-semibold text-slate-500">{player.position} · {player.nfl_team ?? "FA"}</p></div></div></td><td className="px-3 py-3 text-center font-semibold">{matchup ? `${matchup.isHome ? "vs" : "@"} ${matchup.opponent.toUpperCase()}` : "BYE"}</td><td className="px-3 py-3 text-center">{matchup?.gameTime ?? "—"}</td><td className="px-3 py-3 text-center font-display text-xl text-[#80651b]">{livePoints?.toFixed(1) ?? "0.0"}</td><td className="px-3 py-3 text-xs text-slate-600">{statSummary(player.position, live.statLines[key])}</td></tr>; })}</tbody></table></div></section>
    {updateSlot.error ? <p className="text-sm font-medium text-red-700">{updateSlot.error.message}</p> : null}
  </div>;
}
