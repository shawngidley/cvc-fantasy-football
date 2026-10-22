import { parseEspnKickerEvents, type KickerPlayEvent } from "@shared/espnKickerEvents";
import { kickerGameKey, parseGameId } from "./kickerGameLog";
import { mapWithConcurrencyLimit, normalizeTeam } from "./cvcScoringShared";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const DAY_MS = 24 * 60 * 60 * 1000;

// A finished game's play by play never changes, so it is kept for the life of the server
// process. A game from the last few days could still be in progress, so it is not.
const finishedGameEvents = new Map<string, KickerPlayEvent[]>();

function gameIsSettled(gameDate: string): boolean {
  const date = Date.UTC(Number(gameDate.slice(0, 4)), Number(gameDate.slice(4, 6)) - 1, Number(gameDate.slice(6, 8)));
  return Number.isFinite(date) && Date.now() - date > 3 * DAY_MS;
}

/** ESPN field goal and extra point events for a kicker's games, keyed by kickerGameKey.
 * Server side counterpart of what official scoring uses. A failed fetch just leaves that
 * game out of the map, so the caller falls back to the Tank01 numbers for it. */
export async function fetchEspnKickerEventsByGame(gameIds: string[]): Promise<Map<string, KickerPlayEvent[]>> {
  const result = new Map<string, KickerPlayEvent[]>();
  const games = gameIds.map(parseGameId).filter((game): game is NonNullable<ReturnType<typeof parseGameId>> => Boolean(game));
  const scoreboards = new Map<string, Promise<{ events?: Array<{ id?: string; competitions?: Array<{ competitors?: Array<{ homeAway?: string; team?: { abbreviation?: string } }> }> }> } | null>>();
  const scoreboardFor = (date: string) => {
    if (!scoreboards.has(date)) scoreboards.set(date, fetch(`${ESPN}/scoreboard?dates=${date}`).then(response => (response.ok ? response.json() : null)).catch(() => null));
    return scoreboards.get(date)!;
  };
  await mapWithConcurrencyLimit(games, 6, async game => {
    const key = kickerGameKey(game.gameDate, game.home, game.away);
    const cached = finishedGameEvents.get(key);
    if (cached) { result.set(key, cached); return; }
    try {
      const payload = await scoreboardFor(game.gameDate);
      const espnEvent = payload?.events?.find(candidate => {
        const competitors = candidate.competitions?.[0]?.competitors ?? [];
        const home = competitors.find(item => item.homeAway === "home")?.team?.abbreviation;
        const away = competitors.find(item => item.homeAway === "away")?.team?.abbreviation;
        return normalizeTeam(home ?? "") === normalizeTeam(game.home) && normalizeTeam(away ?? "") === normalizeTeam(game.away);
      });
      if (!espnEvent?.id) return;
      const summary = await fetch(`${ESPN}/summary?event=${espnEvent.id}`);
      if (!summary.ok) return;
      const events = parseEspnKickerEvents(await summary.json());
      result.set(key, events);
      if (gameIsSettled(game.gameDate)) finishedGameEvents.set(key, events);
    } catch { /* one game's ESPN fetch failing must not break the rest */ }
  });
  return result;
}
