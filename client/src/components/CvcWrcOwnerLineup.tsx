import { useEffect, useMemo, useState } from "react";
import { calculateCvcFantasyPoints, type CvcScoringRule, type Tank01LiveStats } from "@shared/cvcScoring";
import { getCvcLivePoints, useCvcTank01LiveScores } from "@/hooks/useCvcTank01LiveScores";
import { trpc } from "@/lib/trpc";
import { groupCvcLineup, type CvcLineupAssignment, type CvcLineupGroup, type CvcLineupPlayer } from "@/lib/cvcLineupGrouping";

const profileCache = new Map<string, { value: Tank01Profile | null; expiresAt: number }>();
const PROFILE_TTL_MS = 12 * 60 * 60 * 1000;
const profileKey = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const normalizeTeam = (team: string | null | undefined) => ({ kan: "kc", tam: "tb", arz: "ari", jax: "jac", was: "wsh" }[(team ?? "").toLowerCase()] ?? (team ?? "").toLowerCase());
const teamInitial = (name: string) => name.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
const isDst = (position: string | null | undefined) => ["DST", "DEF"].includes((position ?? "").toUpperCase());

type Tank01Profile = { espnHeadshot?: string; age?: string; stats?: Tank01LiveStats & { gamesPlayed?: string | number } };

function useCvcTank01LineupProfiles(players: CvcLineupPlayer[]) {
  const signature = players.map(player => player.display_name.trim()).sort().join("|");
  const [profiles, setProfiles] = useState<Record<string, Tank01Profile | null>>({});

  useEffect(() => {
    let active = true;
    const names = Array.from(new Set(players.filter(player => !isDst(player.position)).map(player => player.display_name.trim()).filter(Boolean))).slice(0, 22);
    const load = async () => {
      const next: Record<string, Tank01Profile | null> = {};
      for (const name of names) {
        const key = profileKey(name);
        const cached = profileCache.get(key);
        if (cached && cached.expiresAt > Date.now()) { next[key] = cached.value; continue; }
        try {
          const response = await fetch(`/api/tank01/getNFLPlayerInfo?playerName=${encodeURIComponent(name)}&getStats=true`);
          const payload = await response.json() as { body?: Tank01Profile[] };
          const value = payload.body?.[0] ?? null;
          profileCache.set(key, { value, expiresAt: Date.now() + PROFILE_TTL_MS });
          next[key] = value;
        } catch { profileCache.set(key, { value: null, expiresAt: Date.now() + 10 * 60 * 1000 }); next[key] = null; }
        if (active) setProfiles(current => ({ ...current, ...next }));
      }
      if (active) setProfiles(current => ({ ...current, ...next }));
    };
    if (names.length) void load(); else setProfiles({});
    return () => { active = false; };
  }, [signature]);

  return profiles;
}

function numberValue(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function sourceStat(record: Record<string, unknown> | undefined, keys: string[]) { for (const key of keys) { const value = record?.[key]; if (value !== undefined && value !== null && value !== "") return numberValue(value).toLocaleString(); } return "—"; }
function sourceNumber(record: Record<string, unknown> | undefined, keys: string[]) { for (const key of keys) { const value = record?.[key]; if (value !== undefined && value !== null && value !== "") return numberValue(value); } return null; }

function teamLogo(team: string | null | undefined) { return `https://a.espncdn.com/i/teamlogos/nfl/500/${normalizeTeam(team)}.png`; }

function PlayerIdentity({ player, profile }: { player: CvcLineupPlayer; profile: Tank01Profile | null | undefined }) {
  const [failed, setFailed] = useState(false);
  const source = isDst(player.position) ? teamLogo(player.nfl_team) : profile?.espnHeadshot;
  return <div className="flex min-w-[180px] items-center gap-2.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#edf3ef] text-[10px] font-black text-cvc-deep">{source && !failed ? <img src={source} alt={isDst(player.position) ? `${player.nfl_team ?? "NFL"} team logo` : ""} className={isDst(player.position) ? "h-8 w-8 object-contain" : "h-full w-full object-cover object-top"} onError={() => setFailed(true)} /> : teamInitial(player.display_name)}</span><span className="min-w-0"><span className="block truncate font-display text-lg uppercase leading-5 text-cvc-deep">{player.display_name}</span><span className="block text-[11px] font-bold text-slate-500">{isDst(player.position) ? "D/ST" : player.position ?? "—"} · {player.nfl_team ?? "FA"}</span></span></div>;
}

function matchupText(matchup: { opponent: string; isHome: boolean; gameTime: string } | undefined) {
  return matchup ? { opponent: `${matchup.isHome ? "vs" : "@"} ${matchup.opponent.toUpperCase()}`, time: matchup.gameTime || "—" } : { opponent: "BYE", time: "—" };
}

function seasonFantasy(profile: Tank01Profile | null | undefined, player: CvcLineupPlayer, rules: CvcScoringRule[]) {
  if (!profile?.stats) return { fpts: "—", fpg: "—", gp: "—" };
  const points = calculateCvcFantasyPoints(profile.stats, isDst(player.position) ? "DST" : player.position ?? "", rules);
  const gamesPlayed = sourceNumber(profile.stats as unknown as Record<string, unknown>, ["gamesPlayed"]);
  return { fpts: points.toFixed(1), fpg: gamesPlayed ? (points / gamesPlayed).toFixed(1) : "—", gp: gamesPlayed ? String(gamesPlayed) : "—" };
}

function SectionTable({ group, profiles, live, rules, slots, updateSlot }: { group: CvcLineupGroup; profiles: Record<string, Tank01Profile | null>; live: ReturnType<typeof useCvcTank01LiveScores>; rules: CvcScoringRule[]; slots: any[]; updateSlot: ReturnType<typeof trpc.league.setLineupSlot.useMutation> }) {
  const rows = [...group.starters, ...group.bench];
  const statHeaders = group.profile === "offense" ? ["PASS YDS", "PTD", "INT", "R ATT", "R YDS", "RTD", "TGT", "REC", "REC YDS", "REC TD"] : group.profile === "kicker" ? ["FGM", "FGA", "XPM", "XPA"] : ["SACK", "INT", "FR", "PA"];
  const renderStats = (player: CvcLineupPlayer, profile: Tank01Profile | null | undefined) => {
    const stats = profile?.stats ?? {};
    const passing = (stats.Passing ?? {}) as Record<string, unknown>; const rushing = (stats.Rushing ?? {}) as Record<string, unknown>; const receiving = (stats.Receiving ?? {}) as Record<string, unknown>; const kicking = (stats.Kicking ?? {}) as Record<string, unknown>; const defense = (stats.Defense ?? {}) as Record<string, unknown>;
    const cells = group.profile === "offense" ? [sourceStat(passing, ["passYds"]), sourceStat(passing, ["passTD"]), sourceStat(passing, ["int"]), sourceStat(rushing, ["carries", "rushAtt"]), sourceStat(rushing, ["rushYds"]), sourceStat(rushing, ["rushTD"]), sourceStat(receiving, ["targets", "tgt"]), sourceStat(receiving, ["receptions", "rec"]), sourceStat(receiving, ["recYds"]), sourceStat(receiving, ["recTD"])] : group.profile === "kicker" ? [sourceStat(kicking, ["fgMade", "fieldGoalsMade"]), sourceStat(kicking, ["fgAtt", "fieldGoalsAttempted"]), sourceStat(kicking, ["xpMade"]), sourceStat(kicking, ["xpAtt"])] : [sourceStat(defense, ["sacks"]), sourceStat(defense, ["defensiveInterceptions", "interceptions"]), sourceStat(defense, ["fumblesRecovered"]), sourceStat(defense, ["ptsAgainst"])];
    return cells.map((value, index) => <td key={index} className="px-2 py-3 text-center text-xs tabular-nums text-slate-600">{value}</td>);
  };
  return <section className="overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/10"><div className="border-t-4 border-cvc-accent bg-[#062412] px-5 py-4 text-white"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-display text-2xl uppercase">{group.title} · {rows.length} players</h2><span className="text-xs font-bold uppercase tracking-[0.12em] text-white/60">Swipe table for full season detail</span></div><p className="mt-1 text-xs font-bold uppercase tracking-[0.1em] text-white/60">{group.starters.length} starters · {group.bench.length} bench</p></div><div className="overflow-x-auto"><table className="min-w-[1230px] w-full border-collapse text-sm"><thead><tr className="bg-[#dceade] text-[10px] font-black uppercase tracking-[0.06em] text-[#1d4429]"><th rowSpan={2} className="sticky left-0 z-20 border-b border-slate-200 bg-[#dceade] px-3 py-3 text-left">Slot</th><th rowSpan={2} className="sticky left-[76px] z-20 min-w-[225px] border-b border-slate-200 bg-[#dceade] px-3 py-3 text-left">Player</th><th colSpan={4} className="border-b border-slate-200 px-3 py-2 text-center">Weekly decision</th><th colSpan={3} className="border-b border-slate-200 px-3 py-2 text-center">Fantasy</th><th colSpan={statHeaders.length} className="border-b border-slate-200 px-3 py-2 text-center">{group.profile === "offense" ? "Season production" : group.profile === "kicker" ? "Kicking" : "Defense"}</th><th className="border-b border-slate-200 px-3 py-2 text-center">Season</th></tr><tr className="bg-[#edf4ee] text-[10px] font-black uppercase tracking-[0.06em] text-[#244d34]"><th className="px-2 py-2">Age</th><th className="px-2 py-2">Opp</th><th className="px-2 py-2">Game</th><th className="px-2 py-2">Status</th><th className="px-2 py-2">Live</th><th className="px-2 py-2">FPTS</th><th className="px-2 py-2">FP/G</th>{statHeaders.map(header => <th key={header} className="px-2 py-2">{header}</th>)}<th className="px-2 py-2">GP</th></tr></thead><tbody>{rows.map((assignment, index) => { const player = assignment.player!; const bench = index === group.starters.length && group.bench.length > 0; const profile = profiles[profileKey(player.display_name)]; const currentSlot = assignment.assigned_slot_code ?? "BN"; const allowed = slots.filter(slot => !slot.eligible_positions?.length || slot.eligible_positions.includes(player.position ?? "")); const key = isDst(player.position) ? `dst:${normalizeTeam(player.nfl_team)}` : profileKey(player.display_name); const livePoints = getCvcLivePoints(live.scores, player.display_name, isDst(player.position) ? "DST" : player.position ?? "", player.nfl_team); const matchup = matchupText(live.nflMatchups[normalizeTeam(player.nfl_team)]); const season = seasonFantasy(profile, player, rules); return <><tr key={`${assignment.id}-bench`} className={bench ? "border-y-2 border-[#d4b148] bg-[#f4eedc]" : "hidden"}><td colSpan={20} className="px-4 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-[#725e16]">Bench players</td></tr><tr key={assignment.id} className={`border-t border-slate-200 ${currentSlot.toUpperCase() === "BN" || !assignment.assigned_slot_code ? "bg-[#fffdf7]" : "bg-white"}`}><td className="sticky left-0 z-10 bg-inherit px-3 py-3"><select value={assignment.assigned_slot_code ?? ""} onChange={event => event.target.value && updateSlot.mutate({ assignmentId: assignment.id, slotCode: event.target.value })} disabled={updateSlot.isPending} className="w-[62px] rounded bg-cvc-deep px-2 py-1.5 text-xs font-bold text-white"><option value="">BN</option>{allowed.map(slot => <option key={slot.id} value={slot.code}>{slot.code}</option>)}</select></td><td className="sticky left-[76px] z-10 bg-inherit px-3 py-3"><PlayerIdentity player={player} profile={profile}/></td><td className="px-2 py-3 text-center text-xs font-semibold text-slate-600">{profile?.age ?? "—"}</td><td className="px-2 py-3 text-center text-xs font-bold text-cvc-deep">{matchup.opponent}</td><td className="px-2 py-3 text-center text-xs text-slate-600">{matchup.time}</td><td className="px-2 py-3 text-center text-xs font-bold text-slate-500">{player.status ?? "Active"}</td><td className="px-2 py-3 text-center font-display text-xl text-[#80651b]">{livePoints?.toFixed(1) ?? "0.0"}</td><td className="px-2 py-3 text-center text-xs font-bold text-[#244d34]">{season.fpts}</td><td className="px-2 py-3 text-center text-xs font-bold text-[#244d34]">{season.fpg}</td>{renderStats(player, profile)}<td className="px-2 py-3 text-center text-xs font-bold text-slate-600">{season.gp}</td></tr></>; })}</tbody></table></div></section>;
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
  const players = (roster.data?.players ?? []) as CvcLineupAssignment[];
  const groups = useMemo(() => groupCvcLineup(players), [players]);
  const starterCount = groups.reduce((count, group) => count + group.starters.length, 0);
  const totalPoints = groups.flatMap(group => group.starters).reduce((total, assignment) => total + (assignment.player ? getCvcLivePoints(live.scores, assignment.player.display_name, isDst(assignment.player.position) ? "DST" : assignment.player.position ?? "", assignment.player.nfl_team) ?? 0 : 0), 0);
  const profiles = useCvcTank01LineupProfiles(players.flatMap(assignment => assignment.player ? [assignment.player] : []));

  if (mine.isLoading || roster.isLoading || board.isLoading || rules.isLoading || slots.isLoading) return <div className="cvc-card"><div className="cvc-card-title"><span>My lineup</span></div><div className="cvc-card-body text-sm text-slate-500">Loading your CVC roster, current week, and Tank01 game context…</div></div>;
  if (mine.error || !mine.data?.id) return <div className="cvc-card"><div className="cvc-card-title"><span>My lineup</span></div><div className="cvc-card-body text-sm text-slate-600">Sign in with a CVC owner account that has an assigned franchise to manage a lineup.</div></div>;
  if (roster.error || board.error || rules.error || slots.error) return <div className="cvc-card"><div className="cvc-card-title"><span>My lineup</span></div><div className="cvc-card-body text-sm text-red-700">{(roster.error ?? board.error ?? rules.error ?? slots.error)?.message}</div></div>;

  return <div className="space-y-5"><div className="rounded-xl border border-white/20 bg-black/25 px-4 py-3 text-sm font-bold uppercase tracking-[0.1em] text-cvc-accent">{mine.data.name} <span className="text-cvc-muted">(my team)</span></div><div><div className="flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-xl bg-cvc-accent font-display text-xl text-cvc-deep">{teamInitial(mine.data.name)}</span><div><p className="font-display text-4xl uppercase tracking-[0.04em] text-white">My lineup</p><p className="mt-1 text-sm text-cvc-muted">{mine.data.name} · {board.data?.week?.label ?? "Current week"} · Players lock at NFL kickoff</p></div></div><div className="mt-5 flex flex-wrap gap-3"><span className="cvc-button-compact opacity-70">Tank01 lineup data</span><span className="cvc-button-secondary">Changes save instantly</span></div></div><section className="rounded-2xl border border-cvc-accent/30 bg-[#062412] px-5 py-5 text-white shadow-xl"><div className="grid grid-cols-3 gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/60">Total points</p><p className="mt-1 font-display text-4xl text-cvc-accent">{totalPoints.toFixed(1)}</p></div><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/60">Starters</p><p className="mt-1 font-display text-4xl">{starterCount}</p></div><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/60">Live status</p><p className="mt-1 font-display text-2xl text-cvc-accent">{live.isPolling ? "LIVE" : "READY"}</p></div></div><p className="mt-5 text-center text-sm text-white/70">Tank01 updates active games every 30 seconds. Player portraits and season context load from the server-only Tank01 provider path.</p></section>{groups.length ? groups.map(group => <SectionTable key={group.key} group={group} profiles={profiles} live={live} rules={rules.data ?? []} slots={slots.data ?? []} updateSlot={updateSlot}/>) : <section className="rounded-2xl bg-white p-8 text-center text-sm text-slate-600">No active CVC roster assignments are available for this franchise.</section>}{starterCount === 0 && players.length ? <p className="rounded-xl border border-amber-300/30 bg-amber-50 px-4 py-3 text-sm text-amber-950">No starter slots are assigned yet. Choose a position in each player’s slot control to move them from the bench into the submitted CVC lineup.</p> : null}{updateSlot.error ? <p className="text-sm font-medium text-red-700">{updateSlot.error.message}</p> : null}</div>;
}
