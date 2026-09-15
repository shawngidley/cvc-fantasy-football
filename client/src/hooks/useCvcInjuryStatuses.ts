import { trpc } from "@/lib/trpc";
import { normalizePlayerName } from "@shared/playerNameMatch";

export type CvcInjuryStatus = { shortStatus: string | null; headline: string };
export type CvcInjuryItem = { playerName: string; shortStatus: string | null; headline: string };

/** Pure mapping logic, split out from the hook below so it's testable without needing
 * to render a React component or mock a tRPC query. */
export function buildInjuryStatusMap(items: CvcInjuryItem[]): Map<string, CvcInjuryStatus> {
  const byName = new Map<string, CvcInjuryStatus>();
  for (const item of items) {
    if (!item.playerName) continue;
    byName.set(normalizePlayerName(item.playerName), { shortStatus: item.shortStatus, headline: item.headline });
  }
  return byName;
}

/** Builds a display-name -> injury status lookup from the same FantasyPros injury data
 * already powering the Injury Report panel, for use as a compact badge on player cards
 * elsewhere (Lineup, Live Scoring) rather than only in the dedicated report. Backed by
 * the same tRPC query, so this doesn't add a second network fetch beyond whatever the
 * Injury Report panel (if also mounted) already triggers -- React Query dedupes
 * identical queries automatically. */
export function useCvcInjuryStatuses() {
  const { data } = trpc.league.fantasyProsInjuries.useQuery();
  return buildInjuryStatusMap(data?.items ?? []);
}
