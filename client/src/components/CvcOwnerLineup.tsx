import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useCvcOwnerAuth } from "@/hooks/useCvcOwnerAuth";
import { shortenTeamName } from "@/lib/nflSchedule";
import { computeKickoffUtc, useCvcTank01LiveScores } from "@/hooks/useCvcTank01LiveScores";
import { getCvcProjectedPoints, useCvcNFLProjections, type CvcProjectionMap } from "@/hooks/useCvcNFLProjections";
import { useCvcTank01PlayerProfiles, profileKey, type Tank01Profile } from "@/hooks/useCvcTank01PlayerProfiles";
import { trpc } from "@/lib/trpc";
import { groupCvcLineup, type CvcLineupAssignment, type CvcLineupGroup, type CvcLineupPlayer } from "@/lib/cvcLineupGrouping";
import { TeamLogo } from "@/components/TeamLogo";

const normalizeTeam = (team: string | null | undefined) => ({ kan: "kc", tam: "tb", arz: "ari", jax: "jac", was: "wsh" }[(team ?? "").toLowerCase()] ?? (team ?? "").toLowerCase());
const teamInitial = (name: string) => name.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
const isDst = (position: string | null | undefined) => ["DST", "DEF"].includes((position ?? "").toUpperCase());




function teamLogo(team: string | null | undefined) { return `https://a.espncdn.com/i/teamlogos/nfl/500/${normalizeTeam(team)}.png`; }

/** "Joe Burrow" -> "J. Burrow", "D'Andre Swift" -> "D. Swift", "Marvin Harrison Jr." ->
 * "M. Harrison Jr." -- matches WRC's mobile lineup display (first initial + last name,
 * suffix kept), used here to keep names compact instead of running the full name at a
 * large size, which wraps/crowds this table on mobile. */
function abbreviateName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return fullName;
  const [first, ...rest] = parts;
  return `${first[0]}. ${rest.join(" ")}`;
}

function PlayerIdentity({ player, profile }: { player: CvcLineupPlayer; profile: Tank01Profile | null | undefined }) {
  const [failed, setFailed] = useState(false);
  const source = isDst(player.position) ? teamLogo(player.nfl_team) : profile?.espnHeadshot;
  const displayName = isDst(player.position) ? shortenTeamName(player.display_name, player.nfl_team) : abbreviateName(player.display_name);
  return <div className="flex items-center gap-2.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#edf3ef] text-[10px] font-black text-cvc-deep">{source && !failed ? <img src={source} alt={isDst(player.position) ? `${player.nfl_team ?? "NFL"} team logo` : ""} className={isDst(player.position) ? "h-8 w-8 object-contain" : "h-full w-full object-cover object-top"} onError={() => setFailed(true)} /> : teamInitial(player.display_name)}</span><span><Link href={`/player/${player.id}`} className="block whitespace-nowrap text-sm font-bold leading-5 text-cvc-deep hover:text-cvc-accent">{displayName}</Link><span className="block whitespace-nowrap text-[11px] font-bold text-slate-500">{isDst(player.position) ? "D/ST" : player.position ?? "—"} · {player.nfl_team ?? "FA"}</span></span></div>;
}

function matchupText(matchup: { opponent: string; isHome: boolean; gameTime: string; gameDate?: string } | undefined) {
  if (!matchup) return { opponent: "BYE", time: "—" };
  const time = matchup.gameTime || "—";
  // Same day-of-week format as WRC and the Free Agents page's formatGameTimeWithDay:
  // "Sun 1:00p" instead of just "1:00p" -- Tank01's live matchup data doesn't include
  // the day name directly, only the raw gameDate, so it's derived here the same way.
  const withDay = matchup.gameDate && matchup.gameDate.length >= 8 && time !== "—"
    ? `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${matchup.gameDate.slice(0, 4)}-${matchup.gameDate.slice(4, 6)}-${matchup.gameDate.slice(6, 8)}T12:00:00`).getDay()]} ${time}`
    : time;
  return { opponent: `${matchup.isHome ? "vs" : "@"} ${matchup.opponent.toUpperCase()}`, time: withDay };
}

function seasonFantasy(player: CvcLineupPlayer) {
  const stats = player.seasonStats;
  if (!stats) return { fpts: "—", fpg: "—", gp: "—" };
  const gp = stats.games_played;
  return { fpts: stats.fantasy_points != null ? stats.fantasy_points.toFixed(1) : "—", fpg: stats.fantasy_points_per_game != null ? stats.fantasy_points_per_game.toFixed(1) : "—", gp: gp != null ? String(gp) : "—" };
}

function SectionTable({ group, profiles, live, projections, slots, pendingSlots, onStageSlot, canEdit, isCommissioner }: { group: CvcLineupGroup; profiles: Record<string, Tank01Profile | null>; live: ReturnType<typeof useCvcTank01LiveScores>; projections: CvcProjectionMap; slots: any[]; pendingSlots: Record<string, string>; onStageSlot: (assignmentId: string, slotCode: string) => void; canEdit: boolean; isCommissioner: boolean }) {
  const rows = [...group.starters, ...group.bench];
  const statHeaders = group.profile === "offense" ? ["PASS YDS", "PTD", "INT", "R ATT", "R YDS", "RTD", "TGT", "REC", "REC YDS", "REC TD"] : group.profile === "kicker" ? ["FGM", "XPM"] : ["SACK", "INT", "DEF TD"];
  // Reads directly from player.seasonStats -- the same reliable, already-computed
  // player_season_stat data (via attachSeasonStats) that Free Agents already uses
  // successfully, rather than a fresh client-side Tank01 fetch. A few raw Tank01 fields
  // (FG/XP attempts, fumbles recovered, points-against) have no column in that table at
  // all, so those columns were dropped rather than faked with a separate, less reliable
  // fetch just for a handful of extra numbers.
  const renderStats = (player: CvcLineupPlayer) => {
    const stats = player.seasonStats ?? {};
    const cells = group.profile === "offense" ? [stats.pass_yds, stats.pass_td, stats.pass_int, stats.rush_att, stats.rush_yds, stats.rush_td, stats.targets, stats.receptions, stats.rec_yds, stats.rec_td] : group.profile === "kicker" ? [stats.fg_made, stats.xp_made] : [stats.sacks, stats.def_int, stats.def_td];
    return cells.map((value, index) => <td key={index} className="px-2 py-3 text-center text-xs tabular-nums text-slate-600">{value != null ? value : "—"}</td>);
  };
  return <section className="overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/10"><div className="overflow-x-auto"><table className="w-full border-collapse text-sm"><thead><tr className="bg-[#dceade] text-[10px] font-black uppercase tracking-[0.06em] text-[#1d4429]"><th rowSpan={2} className="sticky left-0 z-20 border-b border-slate-200 bg-[#dceade] px-2 py-3 text-left">POS</th><th rowSpan={2} className="sticky left-[58px] z-20 whitespace-nowrap border-b border-slate-200 bg-[#dceade] px-3 py-3 text-left">Player</th><th colSpan={2} className="border-b border-slate-200 px-3 py-2 text-center">Weekly decision</th><th colSpan={3} className="border-b border-slate-200 px-3 py-2 text-center">Fantasy</th><th colSpan={statHeaders.length} className="border-b border-slate-200 px-3 py-2 text-center">{group.profile === "offense" ? "Season production" : group.profile === "kicker" ? "Kicking" : "Defense"}</th><th className="border-b border-slate-200 px-3 py-2 text-center">Season</th></tr><tr className="bg-[#edf4ee] text-[10px] font-black uppercase tracking-[0.06em] text-[#244d34]"><th className="px-2 py-2">Opp</th><th className="px-2 py-2">Game</th><th className="px-2 py-2">Proj</th><th className="px-2 py-2">FPTS</th><th className="px-2 py-2">FP/G</th>{statHeaders.map(header => <th key={header} className="px-2 py-2">{header}</th>)}<th className="px-2 py-2">GP</th></tr></thead><tbody>{rows.map((assignment, index) => { const player = assignment.player!; const bench = index === group.starters.length && group.bench.length > 0; const profile = profiles[profileKey(player.display_name)]; const storedSlot = assignment.assigned_slot_code || "BENCH"; const currentSlot = pendingSlots[assignment.id] ?? storedSlot; const isPending = assignment.id in pendingSlots; const allowed = slots.filter(slot => !slot.eligible_positions?.length || slot.eligible_positions.includes(player.position ?? "")); const key = isDst(player.position) ? `dst:${normalizeTeam(player.nfl_team)}` : profileKey(player.display_name); const projPoints = getCvcProjectedPoints(projections, player.display_name, isDst(player.position) ? "DST" : player.position, player.nfl_team); const matchup = matchupText(live.nflMatchups[normalizeTeam(player.nfl_team)]); const nflMatchup = live.nflMatchups[normalizeTeam(player.nfl_team)]; const gameKickoff = nflMatchup ? computeKickoffUtc(nflMatchup.gameDate, nflMatchup.gameTime) : null; const gameHasStarted = gameKickoff !== null && Date.now() >= gameKickoff; const season = seasonFantasy(player); return <><tr key={`${assignment.id}-bench`} className={bench ? "border-y-2 border-[#d4b148] bg-[#f4eedc]" : "hidden"}><td colSpan={20} className="px-4 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-[#725e16]">Bench players</td></tr><tr key={assignment.id} className={`border-t border-slate-200 ${isPending ? "bg-amber-50" : currentSlot === "BENCH" ? "bg-[#fffdf7]" : "bg-white"}`}><td className="sticky left-0 z-10 bg-inherit px-2 py-3">{canEdit && !(gameHasStarted && !isCommissioner) ? <select value={currentSlot} onChange={event => onStageSlot(assignment.id, event.target.value)} className="w-[48px] rounded bg-cvc-deep px-1 py-1.5 text-xs font-bold text-white">{allowed.map(slot => <option key={slot.id} value={slot.code}>{slot.code === "BENCH" ? "BN" : slot.code}</option>)}</select> : <span className={`inline-block w-[48px] rounded px-1 py-1.5 text-center text-xs font-bold ${gameHasStarted && !isCommissioner ? "bg-slate-200 text-slate-400" : "bg-slate-100 text-slate-500"}`} title={gameHasStarted && !isCommissioner ? "This player's game has started -- their slot is locked until next week" : undefined}>{currentSlot === "BENCH" ? "BN" : currentSlot}</span>}</td><td className="sticky left-[58px] z-10 whitespace-nowrap bg-inherit px-3 py-3"><PlayerIdentity player={player} profile={profile}/></td><td className="px-2 py-3 text-center text-xs font-bold text-cvc-deep">{matchup.opponent}</td><td className="px-2 py-3 text-center text-xs text-slate-600">{matchup.time}</td><td className="px-2 py-3 text-center font-display text-xl text-[#80651b]">{projPoints != null ? projPoints.toFixed(1) : "—"}</td><td className="px-2 py-3 text-center text-xs font-bold text-[#244d34]">{season.fpts}</td><td className="px-2 py-3 text-center text-xs font-bold text-[#244d34]">{season.fpg}</td>{renderStats(player)}<td className="px-2 py-3 text-center text-xs font-bold text-slate-600">{season.gp}</td></tr></>; })}</tbody></table></div></section>;
}

export function CvcOwnerLineup() {
  const { owner } = useCvcOwnerAuth();
  const [, params] = useRoute("/lineup/:franchiseId");
  const [, setLocation] = useLocation();
  const mine = trpc.league.myFranchise.useQuery();
  const overview = trpc.league.overview.useQuery();
  const isCommissioner = ["commissioner", "administrator"].includes(owner?.role ?? "");
  const routeFranchiseId = params?.franchiseId && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(params.franchiseId) ? params.franchiseId : null;
  const viewedFranchiseId = routeFranchiseId ?? mine.data?.id ?? "";
  const canEdit = Boolean(viewedFranchiseId) && (isCommissioner || viewedFranchiseId === mine.data?.id);
  const viewedFranchise = overview.data?.franchises.find(team => team.id === viewedFranchiseId);
  const roster = trpc.league.franchiseRoster.useQuery({ franchiseId: viewedFranchiseId || "00000000-0000-0000-0000-000000000000" }, { enabled: Boolean(viewedFranchiseId) });
  const board = trpc.league.liveScoringBoard.useQuery();
  const rules = trpc.league.scoringRules.useQuery();
  const slots = trpc.league.rosterSlots.useQuery();
  const live = useCvcTank01LiveScores(board.data?.week?.weekNumber, 2026, rules.data ?? []);
  const { projections } = useCvcNFLProjections(board.data?.week?.weekNumber, 2026, rules.data ?? []);
  const utils = trpc.useUtils();
  const updateSlot = trpc.league.setLineupSlot.useMutation();
  const players = (roster.data?.players ?? []) as CvcLineupAssignment[];
  const groups = useMemo(() => groupCvcLineup(players), [players]);
  const starterCount = groups.reduce((count, group) => count + group.starters.length, 0);
  const projectedTotal = groups.flatMap(group => group.starters).reduce((total, assignment) => total + (assignment.player ? getCvcProjectedPoints(projections, assignment.player.display_name, isDst(assignment.player.position) ? "DST" : assignment.player.position, assignment.player.nfl_team) ?? 0 : 0), 0);
  const profiles = useCvcTank01PlayerProfiles(players.flatMap(assignment => assignment.player ? [assignment.player] : []));

  // Staged edits: slot moves are held here (not sent to the server) until "Save Lineup"
  // is pressed, per the owners-must-save-explicitly requirement -- previously every
  // dropdown change saved instantly.
  const [pendingSlots, setPendingSlots] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => { setPendingSlots({}); setSaveError(null); }, [viewedFranchiseId]);
  const stageSlot = (assignmentId: string, slotCode: string) => setPendingSlots(current => ({ ...current, [assignmentId]: slotCode }));


  const saveLineup = async () => {
    setSaveError(null);
    const entries = Object.entries(pendingSlots);
    if (!entries.length) return;
    // Two-phase order matters for swaps (A -> BN, B -> the slot A just vacated): moves
    // TO bench go first to free up starter slots before moves that fill them, since the
    // server checks slot capacity against already-committed state one change at a time.
    const toBench = entries.filter(([, slotCode]) => slotCode === "BENCH");
    const fillSlot = entries.filter(([, slotCode]) => slotCode !== "BENCH");
    try {
      for (const [assignmentId, slotCode] of [...toBench, ...fillSlot]) {
        await updateSlot.mutateAsync({ assignmentId, slotCode });
      }
      setPendingSlots({});
      await Promise.all([utils.league.franchiseRoster.invalidate(), utils.league.liveScoringBoard.invalidate()]);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The CVC lineup could not be saved.");
    }
  };

  if (mine.isLoading || overview.isLoading || roster.isLoading || board.isLoading || rules.isLoading || slots.isLoading) return <div className="cvc-card"><div className="cvc-card-title"><span>Lineup</span></div><div className="cvc-card-body text-sm text-slate-500">Loading CVC roster, current week, and Tank01 game context…</div></div>;
  if (!viewedFranchiseId) return <div className="cvc-card"><div className="cvc-card-title"><span>Lineup</span></div><div className="cvc-card-body text-sm text-slate-600">Sign in with a CVC owner account, or choose a franchise, to view a lineup.</div></div>;
  if (roster.error || board.error || rules.error || slots.error) return <div className="cvc-card"><div className="cvc-card-title"><span>Lineup</span></div><div className="cvc-card-body text-sm text-red-700">{(roster.error ?? board.error ?? rules.error ?? slots.error)?.message}</div></div>;

  const displayName = viewedFranchise?.name ?? roster.data?.franchise.name ?? "Franchise";
  const isMine = viewedFranchiseId === mine.data?.id;
  const hasPending = Object.keys(pendingSlots).length > 0;

  return <div className="space-y-5">
    <div className="rounded-xl border border-white/20 bg-black/25 px-4 py-3"><label className="flex flex-wrap items-center gap-2 text-xs font-black uppercase tracking-[0.1em] text-cvc-accent">View lineup<select value={viewedFranchiseId} onChange={event => setLocation(mine.data?.id === event.target.value ? "/lineup" : `/lineup/${event.target.value}`)} className="rounded-md border border-white/20 bg-cvc-deep px-3 py-2 text-sm font-bold text-white">{mine.data ? <option value={mine.data.id}>{mine.data.name} (my team)</option> : null}{overview.data?.franchises.filter(team => team.id !== mine.data?.id).map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label></div>
    <div><div className="flex flex-wrap items-center gap-3"><TeamLogo name={displayName} abbreviation={viewedFranchise?.abbreviation} logoUrl={viewedFranchise?.logo_url} size="lg" className="rounded-xl border-cvc-accent/50"/><div><p className="font-display text-4xl uppercase tracking-[0.04em] text-white">{isMine ? "My lineup" : `${displayName} lineup`}</p><p className="mt-1 text-sm text-cvc-muted">{displayName} · {board.data?.week?.label ?? "Current week"} · Players lock at NFL kickoff</p></div><div className="ml-auto rounded-lg border border-cvc-accent/30 bg-black/25 px-4 py-2 text-right"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-cvc-muted">Projected</p><p className="font-display text-2xl text-cvc-accent">{projectedTotal.toFixed(1)}</p></div></div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {canEdit ? <button type="button" onClick={saveLineup} disabled={!hasPending || updateSlot.isPending} className="cvc-button-compact disabled:cursor-not-allowed disabled:opacity-40">{updateSlot.isPending ? "Saving…" : hasPending ? `Save lineup (${Object.keys(pendingSlots).length} change${Object.keys(pendingSlots).length === 1 ? "" : "s"})` : "Save lineup"}</button> : <span className="cvc-button-secondary opacity-70">View only — {isCommissioner ? "not your franchise" : "commissioner can edit any lineup"}</span>}
        {hasPending ? <span className="text-xs font-bold uppercase tracking-[0.08em] text-amber-300">Unsaved changes</span> : null}
      </div>
      {saveError ? <p className="mt-2 text-sm font-medium text-red-300">{saveError}</p> : null}
    </div>
    
    {groups.length ? groups.map(group => <SectionTable key={group.key} group={group} profiles={profiles} live={live} projections={projections} slots={slots.data ?? []} pendingSlots={pendingSlots} onStageSlot={stageSlot} canEdit={canEdit} isCommissioner={isCommissioner}/>) : <section className="rounded-2xl bg-white p-8 text-center text-sm text-slate-600">No active CVC roster assignments are available for this franchise.</section>}
    {canEdit && starterCount === 0 && players.length ? <p className="rounded-xl border border-amber-300/30 bg-amber-50 px-4 py-3 text-sm text-amber-950">No starter slots are assigned yet. Choose a position in each player’s slot control, then Save Lineup, to move them from the bench into the submitted CVC lineup.</p> : null}
  </div>;
}
