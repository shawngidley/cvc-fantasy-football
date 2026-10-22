import { calculateCvcFantasyPoints, type CvcScoringRule, type Tank01LiveStats } from "@shared/cvcScoring";
import { applyKickerEventsToKicking, getKickerEventsForPlayer, type KickerPlayEvent } from "@shared/espnKickerEvents";
import { normalizeTeam } from "./cvcScoringShared";
import type { CvcGameLogEntry, CvcSeasonStatRow } from "./playerCareerStats";

/** Same key the ESPN fetch uses: game date plus normalized home and away team. */
export function kickerGameKey(gameDate: string, home: string, away: string): string {
  return `${gameDate}|${normalizeTeam(home)}|${normalizeTeam(away)}`;
}

/** Tank01 game ids look like "20260913_TB@CIN" (away@home). */
export function parseGameId(gameId: string): { gameDate: string; away: string; home: string } | null {
  const [date, teams] = gameId.split("_");
  const [away, home] = (teams ?? "").split("@");
  return date && away && home ? { gameDate: date, away, home } : null;
}

/**
 * A kicker's Tank01 game log has the right FGM, FGA and XPM but no field goal yardage, and CVC
 * scores field goals per yard, so every row came out as extra points only. This adds each game's
 * made field goal yards from ESPN play by play, the same way official scoring does, and rescored
 * the game. Games ESPN has nothing for are left exactly as they were.
 */
export function applyEspnYardsToKickerGames(games: CvcGameLogEntry[], kickerName: string, rules: CvcScoringRule[], eventsByGame: Map<string, KickerPlayEvent[]>): CvcGameLogEntry[] {
  return games.map(game => {
    const ids = parseGameId(game.gameId);
    if (!ids) return game;
    const events = getKickerEventsForPlayer(eventsByGame.get(kickerGameKey(ids.gameDate, ids.home, ids.away)) ?? [], kickerName);
    if (!events.length) return game;
    const kicking = applyKickerEventsToKicking({ fgMade: game.fgMade, xpMade: game.xpMade, fgYds: 0 }, events);
    const stats = { Kicking: kicking } as unknown as Tank01LiveStats;
    return { ...game, cvcPts: calculateCvcFantasyPoints(stats, "K", rules) };
  });
}

/** Season rows for the Stats tab, summed from the same game log rows the Game Log tab shows. */
export function buildKickerSeasonRows(gamesByYear: Record<number, CvcGameLogEntry[]>, team?: string): CvcSeasonStatRow[] {
  const rows: CvcSeasonStatRow[] = [];
  for (const [yearKey, games] of Object.entries(gamesByYear)) {
    if (!games.length) continue;
    const sum = (pick: (game: CvcGameLogEntry) => number | undefined) => games.reduce((total, game) => total + (pick(game) ?? 0), 0);
    const fgMade = sum(game => game.fgMade);
    const fgAtt = sum(game => game.fgAtt);
    const cvcPts = Math.round(sum(game => game.cvcPts) * 100) / 100;
    rows.push({
      season: Number(yearKey), team, gp: games.length,
      fgMade, fgAtt, fgPct: fgAtt > 0 ? Math.round((fgMade / fgAtt) * 1000) / 10 : 0,
      xpMade: sum(game => game.xpMade), xpAtt: sum(game => game.xpAtt),
      cvcPts, cvcPtsPerGame: Math.round((cvcPts / games.length) * 100) / 100,
    });
  }
  return rows.sort((a, b) => b.season - a.season);
}
