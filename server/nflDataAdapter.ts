/**
 * Provider-neutral boundary for future NFL feeds. Provider-specific credentials,
 * payload mapping, and refresh scheduling belong behind this contract.
 */
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

class UnconfiguredNFLDataAdapter implements NFLDataAdapter {
  async status(): Promise<NFLAdapterStatus> {
    return { provider: null, configured: false, message: "No CVC NFL data provider has been configured." };
  }

  normalizePlayer(input: ProviderPlayerUpdate): ProviderPlayerUpdate {
    return input;
  }
}

let adapter: NFLDataAdapter = new UnconfiguredNFLDataAdapter();

export function getNFLDataAdapter() { return adapter; }

/** Used by a future server-only provider integration; never invoke this from the browser. */
export function registerNFLDataAdapter(nextAdapter: NFLDataAdapter) { adapter = nextAdapter; }
