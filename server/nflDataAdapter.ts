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

  async listTeams() {
    const response = await fetch(`https://${this.host}/getNFLTeams`, { headers: this.headers() });
    if (!response.ok) throw new Error(`Tank01 getNFLTeams failed with status ${response.status}`);
    return response.json() as Promise<{ body?: unknown[]; error?: string }>;
  }

  async listTeamRoster(teamAbv: string) {
    const response = await fetch(`https://${this.host}/getNFLTeamRoster?teamAbv=${encodeURIComponent(teamAbv)}`, { headers: this.headers() });
    if (!response.ok) throw new Error(`Tank01 getNFLTeamRoster failed with status ${response.status}`);
    const payload = await response.json() as { body?: { roster?: Tank01RosterPlayer[] }; error?: string };
    if (payload.error) throw new Error(`Tank01 getNFLTeamRoster returned ${payload.error}`);
    return payload.body?.roster ?? [];
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
