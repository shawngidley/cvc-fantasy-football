/**
 * Special-teams return touchdowns per team, read from an ESPN game summary.
 *
 * Why this exists: Tank01's D/ST box-score block carries `defTD`, which only counts
 * touchdowns the defense itself scored (interception and fumble returns). A kickoff
 * return, punt return, blocked punt or blocked field goal returned for a score is
 * credited to the returner as a player and never reaches the D/ST line. CVC awards
 * those to D/ST (commissioner call, Nov 2026: every return touchdown counts), so this
 * fills the gap the same way field-goal distances are filled in from ESPN. Found the
 * hard way: Devin Walker's 86-yard kickoff return for Baltimore on 2026-11-22 scored 0
 * for the Ravens D/ST.
 *
 * Interception and fumble return touchdowns are deliberately NOT counted here. Tank01
 * already has them in `defTD`, and adding them again would double-score.
 */

export type EspnScoringPlay = {
  id?: string | number;
  type?: { text?: string; abbreviation?: string };
  text?: string;
  team?: { abbreviation?: string };
  scoringType?: { name?: string; displayName?: string };
};

/** A scoring play whose type (or, failing that, text) says it was a special-teams
 * return for a touchdown. */
export function isSpecialTeamsReturnTouchdown(play: EspnScoringPlay): boolean {
  const type = (play.type?.text ?? "").toLowerCase();
  const text = (play.text ?? "").toLowerCase();
  const isTouchdown = type.includes("touchdown") || /\btouchdown\b/.test(text);
  if (!isTouchdown) return false;
  const specialTeamsType = /kickoff return|kick return|punt return|blocked punt|blocked field goal|missed field goal return/;
  // Play text phrases it as an action ("returns the kickoff", "punt is BLOCKED"), so
  // the text fallback, used only when ESPN gave no type, matches those forms too.
  const specialTeamsText = /(kickoff|kick|punt)\s+return|returns? the (kickoff|kick|punt)|blocked (punt|field goal)|(punt|field goal)[^.]*\bblocked\b|missed field goal return/;
  return specialTeamsType.test(type) || (type === "" && specialTeamsText.test(text));
}

/** Counts special-teams return touchdowns per scoring team (ESPN abbreviation, as
 * given). The caller normalizes team codes to CVC's. */
export function parseEspnReturnTouchdowns(summary: unknown): Map<string, number> {
  const root = summary as { scoringPlays?: EspnScoringPlay[] };
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const play of root.scoringPlays ?? []) {
    if (!isSpecialTeamsReturnTouchdown(play)) continue;
    const team = (play.team?.abbreviation ?? "").trim().toUpperCase();
    if (!team) continue;
    const key = play.id !== undefined && play.id !== null && String(play.id) !== "" ? String(play.id) : `${team}|${play.text ?? ""}|${seen.size}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts.set(team, (counts.get(team) ?? 0) + 1);
  }
  return counts;
}

/** Adds ESPN's special-teams return touchdowns on top of Tank01's own defTD, keeping
 * the provider's original count in `defTDProvider` so re-applying on a later poll is
 * idempotent (the live hook re-runs this every refresh over stat lines it has kept
 * from earlier polls). */
export function applyReturnTouchdownsToDefense(existingDefense: Record<string, unknown>, returnTouchdowns: number): Record<string, unknown> {
  // A provider line that already carries a combined defense + special teams count
  // (the scorer reads defensiveOrSpecialTeamsTds first) needs nothing added.
  if (existingDefense.defensiveOrSpecialTeamsTds !== undefined && existingDefense.defensiveOrSpecialTeamsTds !== null) return existingDefense;
  const providerRaw = existingDefense.defTDProvider ?? existingDefense.defTD;
  const providerTd = Number.parseFloat(String(providerRaw ?? ""));
  const base = Number.isFinite(providerTd) ? providerTd : 0;
  return { ...existingDefense, defTDProvider: base, defTD: base + returnTouchdowns };
}
