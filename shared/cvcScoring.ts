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

const numeric = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
};

const ruleValue = (rules: CvcScoringRule[], statKey: string, position: string): number => {
  const rule = rules.find(candidate => candidate.stat_key === statKey && (!candidate.applies_to_positions?.length || candidate.applies_to_positions.includes(position)));
  return rule ? numeric(rule.value) : 0;
};

/** Converts a Tank01 player or D/ST stat object with CVC's supplied scoring configuration. */
export function calculateCvcFantasyPoints(stats: Tank01LiveStats, position: string, rules: CvcScoringRule[]): number {
  const passing = stats.Passing ?? {};
  const rushing = stats.Rushing ?? {};
  const receiving = stats.Receiving ?? {};
  const kicking = stats.Kicking ?? {};
  const defense = stats.Defense ?? {};

  let points = 0;
  points += numeric(passing.passYds) * ruleValue(rules, "passing_yards", position);
  points += numeric(passing.passTD) * ruleValue(rules, "passing_touchdown", position);
  points += numeric(passing.int) * ruleValue(rules, "interception", position);
  points += numeric(rushing.rushYds) * ruleValue(rules, "rushing_yards", position);
  points += numeric(rushing.rushTD) * ruleValue(rules, "rushing_touchdown", position);
  points += numeric(receiving.recYds) * ruleValue(rules, "receiving_yards", position);
  points += numeric(receiving.recTD) * ruleValue(rules, "receiving_touchdown", position);
  points += numeric(receiving.receptions) * ruleValue(rules, "reception", position);
  points += numeric(kicking.xpMade) * ruleValue(rules, "extra_point", position);
  points += numeric(kicking.fgYds ?? kicking.kickYards) * ruleValue(rules, "field_goal_yard", position);

  if (position === "DST") {
    points += numeric(defense.fumblesRecovered) * ruleValue(rules, "fumble_recovery", position);
    points += numeric(defense.defensiveInterceptions) * ruleValue(rules, "defensive_interception", position);
    points += numeric(defense.sacks) * ruleValue(rules, "sack", position);
    points += numeric(defense.defensiveOrSpecialTeamsTds ?? defense.defTD) * ruleValue(rules, "defensive_touchdown", position);
    points += numeric(defense.safeties) * ruleValue(rules, "safety", position);
    const pointsAllowed = numeric(defense.ptsAgainst);
    if (pointsAllowed === 0) points += ruleValue(rules, "points_allowed_0", position);
    else if (pointsAllowed <= 6) points += ruleValue(rules, "points_allowed_1_6", position);
    else if (pointsAllowed <= 13) points += ruleValue(rules, "points_allowed_7_13", position);
    else if (pointsAllowed <= 20) points += ruleValue(rules, "points_allowed_14_20", position);
  }

  return Math.round(points * 100) / 100;
}
