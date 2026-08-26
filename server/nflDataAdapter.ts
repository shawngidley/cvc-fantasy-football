/**
 * Provider-neutral boundary for future NFL feeds. Provider-specific credentials,
 * payload mapping, and refresh scheduling belong behind this contract.
 */
import { fantasyProsCacheStatus, getFantasyProsPlayerSnapshot } from "./fantasyProsCache";
export type NFLAdapterStatus = {
  provider: string | null;
  configured: boolean;
  message: string;
};

export type ProviderPlayerUpdate = {
  provider: string;
  externalId: string;
  displayName: string;
  position: string | null;
  nflTeam: string | null;
  status: string;
  metadata: Record<string, unknown>;
};

export interface NFLDataAdapter {
  status(): Promise<NFLAdapterStatus>;
  normalizePlayer(input: ProviderPlayerUpdate): ProviderPlayerUpdate;
}

export type Tank01RosterPlayer = {
  playerID: string;
  longName?: string;
  pos?: string;
  teamAbv?: string;
  [key: string]: unknown;
};

export type Tank01Game = {
  gameID?: string;
  away?: string;
  home?: string;
  gameDate?: string;
  gameTime?: string;
  [key: string]: unknown;
};

export type Tank01BoxScore = {
  playerStats?: Record<string, Record<string, unknown>>;
  teamStats?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
};

class UnconfiguredNFLDataAdapter implements NFLDataAdapter {
  async status(): Promise<NFLAdapterStatus> {
    return { provider: null, configured: false, message: "No CVC NFL data provider has been configured." };
  }

  normalizePlayer(input: ProviderPlayerUpdate): ProviderPlayerUpdate {
    return input;
  }
}

export class Tank01NFLDataAdapter implements NFLDataAdapter {
  private readonly host = "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";

  constructor(private readonly apiKey: string) {}

  async status(): Promise<NFLAdapterStatus> {
    return { provider: "Tank01", configured: true, message: "Tank01 is connected server-side for CVC NFL team and roster data." };
  }

  normalizePlayer(input: ProviderPlayerUpdate): ProviderPlayerUpdate { return input; }

  private headers() {
    return { "x-rapidapi-host": this.host, "x-rapidapi-key": this.apiKey };
  }

  // All Tank01 calls below now use a 15s timeout, matching the pattern already used
  // for FantasyPros calls elsewhere -- none of them had one before, confirmed as the
  // cause of the "Sync all players" hang (getPlayerInfo). The same gap existed on
  // listGamesForWeek/getBoxScore, which the live scoring cron calls every 5 minutes
  // during games, and listTeams/listTeamRoster, which the active-roster sync calls --
  // any of these could have hung indefinitely the same way without ever throwing.
  async listTeams() {
    const response = await fetch(`https://${this.host}/getNFLTeams`, { headers: this.headers(), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Tank01 getNFLTeams failed with status ${response.status}`);
    return response.json() as Promise<{ body?: unknown[]; error?: string }>;
  }

  async listTeamRoster(teamAbv: string) {
    const response = await fetch(`https://${this.host}/getNFLTeamRoster?teamAbv=${encodeURIComponent(teamAbv)}`, { headers: this.headers(), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Tank01 getNFLTeamRoster failed with status ${response.status}`);
    const payload = await response.json() as { body?: { roster?: Tank01RosterPlayer[] }; error?: string };
    if (payload.error) throw new Error(`Tank01 getNFLTeamRoster returned ${payload.error}`);
    return payload.body?.roster ?? [];
  }

  async listGamesForWeek(week: number, season: number) {
    const params = new URLSearchParams({ week: String(week), season: String(season), seasonType: "Regular Season" });
    const response = await fetch(`https://${this.host}/getNFLGamesForWeek?${params.toString()}`, { headers: this.headers(), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Tank01 getNFLGamesForWeek failed with status ${response.status}`);
    const payload = await response.json() as { body?: Tank01Game[]; error?: string };
    if (payload.error) throw new Error(`Tank01 getNFLGamesForWeek returned ${payload.error}`);
    return payload.body ?? [];
  }

  async getBoxScore(gameId: string) {
    const response = await fetch(`https://${this.host}/getNFLBoxScore?gameID=${encodeURIComponent(gameId)}`, { headers: this.headers(), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Tank01 getNFLBoxScore failed with status ${response.status}`);
    const payload = await response.json() as { body?: Tank01BoxScore; error?: string };
    if (payload.error) throw new Error(`Tank01 getNFLBoxScore returned ${payload.error}`);
    return payload.body ?? {};
  }

  async getPlayerInfo(playerName: string) {
    // Timeout added: this call previously had none, unlike every other Tank01/
    // FantasyPros fetch in this codebase (which all use a 15s AbortSignal.timeout).
    // Without it, a single hanging Tank01 response never resolves OR rejects, so the
    // per-player try/catch in syncTank01SeasonStats never gets a chance to catch
    // anything -- it just blocks that whole concurrency chunk (and therefore the
    // batch, and therefore the "Sync all players" loop) forever. Confirmed live: the
    // auto-repeat sync got stuck partway through with no error and no progress.
    const response = await fetch(`https://${this.host}/getNFLPlayerInfo?playerName=${encodeURIComponent(playerName)}&getStats=true`, { headers: this.headers(), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Tank01 getNFLPlayerInfo failed with status ${response.status}`);
    const payload = await response.json() as { body?: Record<string, unknown> | Record<string, unknown>[]; error?: string };
    if (payload.error) throw new Error(`Tank01 getNFLPlayerInfo returned ${payload.error}`);
    return Array.isArray(payload.body) ? payload.body[0] ?? null : payload.body ?? null;
  }
}

export class FantasyProsNFLDataAdapter implements NFLDataAdapter {
  async status(): Promise<NFLAdapterStatus> {
    const cache = await fantasyProsCacheStatus();
    return { provider: "FantasyPros", configured: cache.configured, message: cache.fresh ? "FantasyPros CVC player data is available from the server-side cache." : "FantasyPros is configured; a commissioner refresh will populate or renew the CVC server-side cache." };
  }

  normalizePlayer(input: ProviderPlayerUpdate): ProviderPlayerUpdate { return input; }

  async listPlayerSnapshot() {
    return getFantasyProsPlayerSnapshot();
  }
}

let adapter: NFLDataAdapter = process.env.TANK01_RAPIDAPI_KEY
  ? new Tank01NFLDataAdapter(process.env.TANK01_RAPIDAPI_KEY)
  : new UnconfiguredNFLDataAdapter();

export function getNFLDataAdapter() { return adapter; }

export function getFantasyProsDataAdapter() {
  return process.env.FANTASYPROS_API_KEY ? new FantasyProsNFLDataAdapter() : null;
}

/** Used by a future server-only provider integration; never invoke this from the browser. */
export function registerNFLDataAdapter(nextAdapter: NFLDataAdapter) { adapter = nextAdapter; }
