import { calculateCvcFantasyPoints, type CvcScoringRule, type Tank01LiveStats } from "@shared/cvcScoring";
import { normalize, normalizeTeam, type SnapshotRow } from "./cvcScoringShared";
import { supabase, unwrap } from "./supabase";

export const SKIN_BASE_AMOUNT = 20;
export const SKIN_THRESHOLD = 150;

export type SkinDecision = {
  status: "won" | "pushed";
  winnerFranchiseId: string | null;
  winningScore: number;
  tiebreakerUsed: boolean;
  tiebreakerPlayerId: string | null;
  tiebreakerPlayerName: string | null;
};

/**
 * Pure decision logic, no DB access -- given each franchise's already-computed weekly
 * score and (for a last-week tie) a list of tiebreaker candidates, decides the skin
 * outcome. Kept separate from resolveSkinForWeek's Supabase reads/writes so this can be
 * tested directly.
 *
 * Weeks before the season's last: highest score wins only if it's >=150 AND unique.
 * A tie at/above 150, or the max under 150 (tied or not), pushes -- no winner, pot
 * carries to next week.
 *
 * The season's last week: highest score wins regardless of the 150 threshold. A tie is
 * broken by the highest-scoring individual player in an active (non-bench) lineup slot,
 * among ONLY the tied franchises' rosters that week -- not a full 3+-way tiebreaker
 * beyond that (not required per the confirmed rule).
 */
export function decideSkinOutcome(
  scores: { franchiseId: string; score: number }[],
  isLastWeek: boolean,
  tiebreakerCandidates: { franchiseId: string; playerId: string | null; playerName: string; points: number }[],
): SkinDecision {
  const maxScore = Math.max(...scores.map(s => s.score));
  const topFranchises = scores.filter(s => s.score === maxScore).map(s => s.franchiseId);

  if (!isLastWeek) {
    if (maxScore >= SKIN_THRESHOLD && topFranchises.length === 1) {
      return { status: "won", winnerFranchiseId: topFranchises[0], winningScore: maxScore, tiebreakerUsed: false, tiebreakerPlayerId: null, tiebreakerPlayerName: null };
    }
    return { status: "pushed", winnerFranchiseId: null, winningScore: maxScore, tiebreakerUsed: false, tiebreakerPlayerId: null, tiebreakerPlayerName: null };
  }

  if (topFranchises.length === 1) {
    return { status: "won", winnerFranchiseId: topFranchises[0], winningScore: maxScore, tiebreakerUsed: false, tiebreakerPlayerId: null, tiebreakerPlayerName: null };
  }

  let best: { franchiseId: string; playerId: string | null; playerName: string; points: number } | null = null;
  for (const candidate of tiebreakerCandidates) {
    if (!best || candidate.points > best.points) best = candidate;
  }
  return {
    status: "won",
    winnerFranchiseId: best?.franchiseId ?? null,
    winningScore: maxScore,
    tiebreakerUsed: true,
    tiebreakerPlayerId: best?.playerId ?? null,
    tiebreakerPlayerName: best?.playerName ?? null,
  };
}

/**
 * Resolves (or re-resolves, if it's still "pending") the skin for a finalized CVC week.
 * Idempotent: a week already resolved as "won" or "pushed" is left alone -- this only
 * ever runs once a week transitions to final, and finalization itself doesn't repeat
 * for an already-final week.
 */
export async function resolveSkinForWeek(params: {
  seasonId: string;
  weekNumber: number;
  isLastWeek: boolean;
  matchups: { home_franchise_id: string; away_franchise_id: string }[];
  franchiseTotals: Map<string, number>;
  snapshots: SnapshotRow[];
  statLines: Map<string, Tank01LiveStats>;
  rules: CvcScoringRule[];
}): Promise<void> {
  const { seasonId, weekNumber, isLastWeek, matchups, franchiseTotals, snapshots, statLines, rules } = params;

  const existing = unwrap(await supabase.from("cvc_skin").select("id, status").eq("season_id", seasonId).eq("week_number", weekNumber).maybeSingle());
  if (existing && existing.status !== "pending") return;

  const priorSkin = unwrap(await supabase.from("cvc_skin").select("pot_amount, status").eq("season_id", seasonId).lt("week_number", weekNumber).order("week_number", { ascending: false }).limit(1).maybeSingle());
  const potAmount = priorSkin?.status === "pushed" ? Number(priorSkin.pot_amount) + SKIN_BASE_AMOUNT : SKIN_BASE_AMOUNT;

  const franchiseIds = Array.from(new Set(matchups.flatMap(m => [m.home_franchise_id, m.away_franchise_id])));
  const scores = franchiseIds.map(id => ({ franchiseId: id, score: Math.round((franchiseTotals.get(id) ?? 0) * 100) / 100 }));

  const maxScore = Math.max(...scores.map(s => s.score));
  const topFranchises = new Set(scores.filter(s => s.score === maxScore).map(s => s.franchiseId));
  const tiebreakerCandidates: { franchiseId: string; playerId: string | null; playerName: string; points: number }[] = [];
  if (isLastWeek && topFranchises.size > 1) {
    for (const entry of snapshots) {
      if (entry.slot_code?.toUpperCase() === "BENCH") continue;
      if (!topFranchises.has(entry.franchise_id)) continue;
      const player = Array.isArray(entry.player) ? entry.player[0] : entry.player;
      if (!player) continue;
      const position = player.position === "DEF" ? "DST" : player.position ?? "";
      const key = position === "DST" ? `dst:${normalizeTeam(player.nfl_team ?? "")}` : normalize(player.display_name);
      const statLine = statLines.get(key);
      const points = statLine ? calculateCvcFantasyPoints(statLine, position, rules) : 0;
      tiebreakerCandidates.push({ franchiseId: entry.franchise_id, playerId: player.id ?? null, playerName: player.display_name, points });
    }
  }

  const decision = decideSkinOutcome(scores, isLastWeek, tiebreakerCandidates);
  const payload = {
    season_id: seasonId, week_number: weekNumber, pot_amount: potAmount, status: decision.status,
    winner_franchise_id: decision.winnerFranchiseId, winning_score: decision.winningScore,
    tiebreaker_used: decision.tiebreakerUsed, tiebreaker_player_id: decision.tiebreakerPlayerId, tiebreaker_player_name: decision.tiebreakerPlayerName,
    resolved_at: new Date().toISOString(),
  };
  if (existing) unwrap(await supabase.from("cvc_skin").update(payload).eq("id", existing.id).select("id").single());
  else unwrap(await supabase.from("cvc_skin").insert(payload).select("id").single());
}
