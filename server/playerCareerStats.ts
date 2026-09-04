import { calculateCvcFantasyPoints, type CvcScoringRule, type Tank01LiveStats } from "@shared/cvcScoring";

const ESPN_GAMELOG = "https://site.api.espn.com/apis/common/v3/sports/football/nfl/athletes";

export type CvcSeasonStatRow = {
  season: number;
  team?: string;
  gp: number;
  passYds?: number; passTD?: number; passInt?: number; passAtt?: number; passCmp?: number; passCmpPct?: number;
  rushYds?: number; rushTD?: number; rushAtt?: number; rushAvg?: number;
  rec?: number; recYds?: number; recTD?: number; recTargets?: number; recAvg?: number;
  fgMade?: number; fgAtt?: number; fgPct?: number; xpMade?: number; xpAtt?: number;
  sacks?: number; defInt?: number; defTD?: number; fumblesRecovered?: number;
  cvcPts: number;
  cvcPtsPerGame: number;
};

/** ESPN's gamelog labels repeat across stat categories (e.g. "YDS" for both passing and
 * rushing); duplicates are disambiguated by occurrence order, matching WRC's proven
 * parsing approach exactly. */
function buildLabelMap(labels: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  const seen: Record<string, number> = {};
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const count = seen[label] ?? 0;
    seen[label] = count + 1;
    map[`${label}_${count}`] = i;
    if (count === 0) map[label] = i;
  }
  return map;
}

function sumGameStats(events: Array<{ stats?: string[] }>, labelMap: Record<string, number>): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const event of events) {
    const stats = event.stats ?? [];
    for (const [label, index] of Object.entries(labelMap)) {
      totals[label] = (totals[label] ?? 0) + (Number.parseFloat(stats[index] ?? "0") || 0);
    }
  }
  return totals;
}

function extractFromGamelog(totals: Record<string, number>, gp: number, labels: string[]): Partial<CvcSeasonStatRow> {
  const row: Partial<CvcSeasonStatRow> = { gp };
  const labelMap = buildLabelMap(labels);
  const totalAtLabelIndex = (targetIndex: number, label: string): number => {
    const occurrence = labels.slice(0, targetIndex).filter(previous => previous === label).length;
    return totals[`${label}_${occurrence}`] ?? totals[label] ?? 0;
  };
  const valueAfter = (anchor: string, label: string): number => {
    const anchorIndex = labelMap[anchor];
    if (anchorIndex === undefined) return 0;
    for (let index = anchorIndex + 1; index < labels.length; index += 1) {
      if (labels[index] === label) return totalAtLabelIndex(index, label);
    }
    return 0;
  };

  if ("CMP" in labelMap) {
    row.passCmp = totals.CMP ?? 0;
    row.passAtt = totals.ATT ?? 0;
    row.passYds = valueAfter("CMP", "YDS");
    row.passTD = valueAfter("CMP", "TD");
    row.passInt = totals.INT ?? 0;
    row.passCmpPct = row.passAtt > 0 ? Math.round((row.passCmp / row.passAtt) * 1000) / 10 : 0;
    row.rushAtt = totals.CAR ?? 0;
    row.rushYds = valueAfter("CAR", "YDS");
    row.rushTD = valueAfter("CAR", "TD");
    row.rushAvg = row.rushAtt > 0 ? Math.round((row.rushYds / row.rushAtt) * 10) / 10 : 0;
  }
  if ("CAR" in labelMap && !("CMP" in labelMap)) {
    row.rushAtt = totals.CAR ?? 0;
    row.rushYds = valueAfter("CAR", "YDS");
    row.rushTD = valueAfter("CAR", "TD");
    row.rushAvg = row.rushAtt > 0 ? Math.round((row.rushYds / row.rushAtt) * 10) / 10 : 0;
  }
  if ("REC" in labelMap) {
    row.rec = totals.REC ?? 0;
    row.recTargets = totals.TGTS ?? 0;
    row.recYds = valueAfter("REC", "YDS");
    row.recTD = valueAfter("REC", "TD");
    row.recAvg = row.rec > 0 ? Math.round((row.recYds / row.rec) * 10) / 10 : 0;
  }
  if ("FGM" in labelMap) {
    row.fgMade = totals.FGM ?? 0;
    row.fgAtt = totals.FGA ?? 0;
    row.fgPct = row.fgAtt > 0 ? Math.round((row.fgMade / row.fgAtt) * 1000) / 10 : 0;
    row.xpMade = totals.XPM ?? 0;
    row.xpAtt = totals.XPA ?? 0;
  }
  if ("SACK" in labelMap && !("CMP" in labelMap)) {
    row.sacks = totals.SACK ?? 0;
    row.defInt = totals.INT ?? 0;
    row.fumblesRecovered = totals.FR ?? 0;
    row.defTD = totals.TD ?? 0;
  }
  return row;
}

function toCvcStatsShape(row: Partial<CvcSeasonStatRow>): Tank01LiveStats {
  return {
    Passing: { passYds: row.passYds ?? 0, passTD: row.passTD ?? 0, int: row.passInt ?? 0 },
    Rushing: { rushYds: row.rushYds ?? 0, rushTD: row.rushTD ?? 0 },
    Receiving: { recYds: row.recYds ?? 0, recTD: row.recTD ?? 0, receptions: row.rec ?? 0 },
    Kicking: { xpMade: row.xpMade ?? 0 },
    Defense: { sacks: row.sacks ?? 0, defensiveInterceptions: row.defInt ?? 0, defTD: row.defTD ?? 0, fumblesRecovered: row.fumblesRecovered ?? 0 },
  };
}

async function fetchOneSeason(espnId: string, year: number, position: string, rules: CvcScoringRule[]): Promise<CvcSeasonStatRow | null> {
  const response = await fetch(`${ESPN_GAMELOG}/${espnId}/gamelog?season=${year}`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) return null;
  const data = await response.json() as { events?: Record<string, { stats?: string[] }>; labels?: string[]; names?: string[]; season?: { year?: number } };
  const events = Object.values(data.events ?? {});
  const labels = data.labels ?? data.names ?? [];
  if (!events.length || !labels.length) return null;
  const totals = sumGameStats(events, buildLabelMap(labels));
  const extracted = extractFromGamelog(totals, events.length, labels);
  const cvcPts = calculateCvcFantasyPoints(toCvcStatsShape(extracted), position, rules);
  const gp = extracted.gp ?? 0;
  return { season: year, gp, ...extracted, cvcPts: Math.round(cvcPts * 100) / 100, cvcPtsPerGame: gp > 0 ? Math.round((cvcPts / gp) * 100) / 100 : 0 };
}

/** Fetches the last several years of season stats for one player from ESPN's public
 * gamelog API (no key required), computing CVC-specific fantasy points from the
 * season's actual scoring_rule rows rather than a hardcoded formula. Years with no
 * data (e.g. before the player entered the league) are simply omitted. */
export async function getCvcPlayerCareerStats(espnId: string, position: string, rules: CvcScoringRule[], currentYear: number, yearsBack = 5): Promise<CvcSeasonStatRow[]> {
  const years = Array.from({ length: yearsBack }, (_, index) => currentYear - index);
  const results = await Promise.all(years.map(year => fetchOneSeason(espnId, year, position, rules).catch(() => null)));
  return results.filter((row): row is CvcSeasonStatRow => row !== null).sort((a, b) => b.season - a.season);
}

export type CvcGameLogEntry = {
  gameId: string;
  gameDate: string; // "20260913"
  opponent: string;
  isHome: boolean;
  result?: string;
  passYds?: number; passTD?: number; passInt?: number; passCmp?: number; passAtt?: number;
  rushYds?: number; rushTD?: number; rushAtt?: number;
  rec?: number; recYds?: number; recTD?: number; targets?: number;
  fgMade?: number; fgAtt?: number; xpMade?: number; xpAtt?: number;
  sacks?: number; defInt?: number; defTD?: number; fumblesRecovered?: number;
  cvcPts: number;
};

const num = (value: unknown): number => { const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? "0")); return Number.isFinite(parsed) ? parsed : 0; };

/** Parses one player's Tank01 getNFLGamesForPlayer response (keyed by gameID, e.g.
 * "20260913_BUF@HOU" -- away@home) into per-game rows with CVC fantasy points. Filters
 * to regular-season games only (month >= 9), matching WRC's same convention. */
export function parseCvcGameLog(body: Record<string, unknown>, teamAbv: string, position: string, rules: CvcScoringRule[]): CvcGameLogEntry[] {
  return Object.entries(body)
    .filter(([gameId]) => {
      const dateStr = gameId.split("_")[0] ?? "";
      const month = Number.parseInt(dateStr.slice(4, 6), 10);
      return month >= 9;
    })
    .map(([gameId, raw]) => {
      const row = raw as Record<string, unknown>;
      const parts = gameId.split("_");
      const dateStr = parts[0] ?? "";
      const [awayTeam, homeTeam] = (parts[1] ?? "").split("@");
      const team = (row.teamAbv as string) ?? teamAbv;
      const isHome = team === homeTeam;
      const opponent = isHome ? awayTeam : homeTeam;

      const passing = (row.Passing as Record<string, unknown>) ?? {};
      const rushing = (row.Rushing as Record<string, unknown>) ?? {};
      const receiving = (row.Receiving as Record<string, unknown>) ?? {};
      const kicking = (row.Kicking as Record<string, unknown>) ?? {};
      const defense = (row.Defense as Record<string, unknown>) ?? {};

      let result: string | undefined;
      if (typeof row.gameResult === "string") result = row.gameResult;
      else if (row.homePts !== undefined && row.awayPts !== undefined) {
        const homePts = num(row.homePts); const awayPts = num(row.awayPts);
        const myPts = isHome ? homePts : awayPts; const oppPts = isHome ? awayPts : homePts;
        result = `${myPts > oppPts ? "W" : myPts < oppPts ? "L" : "T"} ${myPts}-${oppPts}`;
      }

      const stats: Tank01LiveStats = {
        Passing: { passYds: num(passing.passYds), passTD: num(passing.passTD), int: num(passing.int) },
        Rushing: { rushYds: num(rushing.rushYds), rushTD: num(rushing.rushTD) },
        Receiving: { recYds: num(receiving.recYds), recTD: num(receiving.recTD), receptions: num(receiving.receptions) },
        Kicking: { xpMade: num(kicking.xpMade) },
        Defense: { sacks: num(defense.sacks), defensiveInterceptions: num(defense.defensiveInterceptions), defTD: num(defense.defTD), fumblesRecovered: num(defense.fumblesRecovered) },
      };

      return {
        gameId, gameDate: dateStr, opponent, isHome, result,
        passYds: num(passing.passYds), passTD: num(passing.passTD), passInt: num(passing.int), passCmp: num(passing.passCompletions), passAtt: num(passing.passAttempts),
        rushYds: num(rushing.rushYds), rushTD: num(rushing.rushTD), rushAtt: num(rushing.carries),
        rec: num(receiving.receptions), recYds: num(receiving.recYds), recTD: num(receiving.recTD), targets: num(receiving.targets),
        fgMade: num(kicking.fgMade), fgAtt: num(kicking.fgAttempts), xpMade: num(kicking.xpMade), xpAtt: num(kicking.xpAttempts),
        sacks: num(defense.sacks), defInt: num(defense.defensiveInterceptions), defTD: num(defense.defTD), fumblesRecovered: num(defense.fumblesRecovered),
        cvcPts: calculateCvcFantasyPoints(stats, position, rules),
      };
    })
    .sort((a, b) => a.gameDate.localeCompare(b.gameDate));
}
