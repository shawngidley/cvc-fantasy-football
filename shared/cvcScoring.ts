export type CvcScoringRule = {
  stat_key: string;
  value: number | string;
  applies_to_positions?: string[] | null;
};

export type Tank01LiveStats = {
  Passing?: Record<string, string | number | undefined>;
  Rushing?: Record<string, string | number | undefined>;
  Receiving?: Record<string, string | number | undefined>;
  Kicking?: Record<string, string | number | undefined>;
  Defense?: Record<string, string | number | undefined>;
};

export type CvcScoringLineItem = { label: string; points: number };

const numeric = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
};

const ruleValue = (rules: CvcScoringRule[], statKey: string, position: string): number => {
  const rule = rules.find(candidate => candidate.stat_key === statKey && (!candidate.applies_to_positions?.length || candidate.applies_to_positions.includes(position)));
  return rule ? numeric(rule.value) : 0;
};

/** Builds the same per-category point contributions calculateCvcFantasyPoints sums
 * into a single total, but keeps each one as its own labeled line item -- powers the
 * points-breakdown popup (tap a player's point total to see it broken down by fantasy
 * stat, similar to FanTrax's version of this). Only includes items that actually
 * contributed points, same convention already used for the DST stat chips on Live
 * Scoring (nothing shown for a stat that didn't happen). calculateCvcFantasyPoints
 * below is defined in terms of this function's output, specifically so the total and
 * the breakdown can never drift apart from each other. */
export function calculateCvcFantasyPointsBreakdown(stats: Tank01LiveStats | null | undefined, position: string, rules: CvcScoringRule[]): CvcScoringLineItem[] {
  if (!stats) return []; // defends against a caller (or a stale cache with an incompatible shape) passing no stats at all, rather than crashing on stats.Passing
  const passing = stats.Passing ?? {};
  const rushing = stats.Rushing ?? {};
  const receiving = stats.Receiving ?? {};
  const kicking = stats.Kicking ?? {};
  const defense = stats.Defense ?? {};

  const items: CvcScoringLineItem[] = [];
  const add = (label: string, points: number) => { if (points !== 0) items.push({ label, points }); };

  const passYds = numeric(passing.passYds);
  add(`${passYds} passing yds`, passYds * ruleValue(rules, "passing_yards", position));
  const passTD = numeric(passing.passTD);
  add(`${passTD} passing TD${passTD === 1 ? "" : "s"}`, passTD * ruleValue(rules, "passing_touchdown", position));
  const int = numeric(passing.int);
  add(`${int} INT thrown`, int * ruleValue(rules, "interception", position));
  // Threshold is 300+ (commissioner call, Sept 2026). Verified directly against the
  // live scoring_rule data (via the public scoringRules endpoint) that the DB row's
  // stat_key is actually "passing_300_bonus", not "passing_350_bonus" -- an earlier
  // version of this fix assumed the old key name for backward compatibility without
  // checking, which meant ruleValue() found no match, returned 0, and add() (which
  // only pushes non-zero points) silently dropped the bonus line entirely. That's
  // exactly the bug this stat_key value fixes.
  if (passYds >= 300) add("300+ passing yd bonus", ruleValue(rules, "passing_300_bonus", position));

  const rushYds = numeric(rushing.rushYds);
  add(`${rushYds} rushing yds`, rushYds * ruleValue(rules, "rushing_yards", position));
  const rushTD = numeric(rushing.rushTD);
  add(`${rushTD} rushing TD${rushTD === 1 ? "" : "s"}`, rushTD * ruleValue(rules, "rushing_touchdown", position));
  if (rushYds >= 100) add("100+ rushing yd bonus", ruleValue(rules, "rushing_100_bonus", position));

  const recYds = numeric(receiving.recYds);
  add(`${recYds} receiving yds`, recYds * ruleValue(rules, "receiving_yards", position));
  const recTD = numeric(receiving.recTD);
  add(`${recTD} receiving TD${recTD === 1 ? "" : "s"}`, recTD * ruleValue(rules, "receiving_touchdown", position));
  const receptions = numeric(receiving.receptions);
  add(`${receptions} reception${receptions === 1 ? "" : "s"}`, receptions * ruleValue(rules, "reception", position));
  if (recYds >= 100) add("100+ receiving yd bonus", ruleValue(rules, "receiving_100_bonus", position));

  const xpMade = numeric(kicking.xpMade);
  add(`${xpMade} extra point${xpMade === 1 ? "" : "s"} made`, xpMade * ruleValue(rules, "extra_point", position));
  const fgYds = numeric(kicking.fgYds ?? kicking.kickYards);
  add(`${fgYds} field goal yds`, fgYds * ruleValue(rules, "field_goal_yard", position));

  if (position === "DST") {
    const fumblesRecovered = numeric(defense.fumblesRecovered);
    add(`${fumblesRecovered} fumble recover${fumblesRecovered === 1 ? "y" : "ies"}`, fumblesRecovered * ruleValue(rules, "fumble_recovery", position));
    const dInt = numeric(defense.defensiveInterceptions);
    add(`${dInt} interception${dInt === 1 ? "" : "s"}`, dInt * ruleValue(rules, "defensive_interception", position));
    const sacks = numeric(defense.sacks);
    add(`${sacks} sack${sacks === 1 ? "" : "s"}`, sacks * ruleValue(rules, "sack", position));
    const defTD = numeric(defense.defensiveOrSpecialTeamsTds ?? defense.defTD);
    add(`${defTD} defensive TD${defTD === 1 ? "" : "s"}`, defTD * ruleValue(rules, "defensive_touchdown", position));
    const safeties = numeric(defense.safeties);
    add(`${safeties} safet${safeties === 1 ? "y" : "ies"}`, safeties * ruleValue(rules, "safety", position));
    const pointsAllowed = numeric(defense.ptsAgainst ?? defense.ptsAllowed);
    if (pointsAllowed === 0) add("0 points allowed", ruleValue(rules, "points_allowed_0", position));
    else if (pointsAllowed <= 6) add(`${pointsAllowed} points allowed (1-6)`, ruleValue(rules, "points_allowed_1_6", position));
    else if (pointsAllowed <= 13) add(`${pointsAllowed} points allowed (7-13)`, ruleValue(rules, "points_allowed_7_13", position));
    else if (pointsAllowed <= 20) add(`${pointsAllowed} points allowed (14-20)`, ruleValue(rules, "points_allowed_14_20", position));
  }

  return items;
}

/** Converts a Tank01 player or D/ST stat object with CVC's supplied scoring configuration. */
export function calculateCvcFantasyPoints(stats: Tank01LiveStats | null | undefined, position: string, rules: CvcScoringRule[]): number {
  const points = calculateCvcFantasyPointsBreakdown(stats, position, rules).reduce((total, item) => total + item.points, 0);
  return Math.round(points * 100) / 100;
}
