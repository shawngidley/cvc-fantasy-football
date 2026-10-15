import { playerIdentityKey, type PlayerIdentityInput } from "../shared/playerIdentity";

export type BidPlayer = PlayerIdentityInput & { id: string; provider?: string | null };

/**
 * Two `player` rows for the same real player or defense must compete as ONE player.
 * Bids are grouped by identity and re-pointed at one representative row (a fantasypros row
 * if there is one, otherwise the lowest id), so a bid on each duplicate contests instead of
 * both winning. Bids whose identity is already on a roster are returned separately.
 */
export function remapBidsToCanonicalPlayers<T extends { player_id: string }>(bids: T[], players: BidPlayer[], rosteredKeys: Set<string>): { bids: T[]; alreadyRostered: T[] } {
  const playerById = new Map(players.map(player => [player.id, player]));
  const representativeByKey = new Map<string, BidPlayer>();
  for (const player of players) {
    const key = playerIdentityKey(player);
    const current = representativeByKey.get(key);
    const better = !current
      || (player.provider === "fantasypros" && current.provider !== "fantasypros")
      || (player.provider === current.provider && player.id < current.id);
    if (better) representativeByKey.set(key, player);
  }
  const kept: T[] = [];
  const alreadyRostered: T[] = [];
  for (const bid of bids) {
    const player = playerById.get(bid.player_id);
    if (!player) { kept.push(bid); continue; }
    const key = playerIdentityKey(player);
    if (rosteredKeys.has(key)) { alreadyRostered.push(bid); continue; }
    const representative = representativeByKey.get(key);
    kept.push(representative && representative.id !== bid.player_id ? { ...bid, player_id: representative.id } : bid);
  }
  return { bids: kept, alreadyRostered };
}
