type NewsIdentity = { playerId: number | null; playerName: string; team: string; position?: string };
type RankIdentity = { playerId: number; name: string; team: string; position: string };

/** Enriches generic-news player metadata using FantasyPros' own player IDs. The raw
 * /nfl/news response has no player_name/name field at all -- only player_id -- so this
 * fills in playerName/team/position by matching that ID against FantasyPros' own
 * ranks data (which does have a reliable playerId -> name/team/position mapping),
 * rather than trying to parse the name out of the title text. */
export function attachFantasyProsPlayerNames<T extends NewsIdentity>(items: T[], ranks: RankIdentity[]): T[] {
  const ranksById = new Map(ranks.filter(rank => rank.playerId && rank.name).map(rank => [rank.playerId, rank]));
  return items.map(item => {
    const rank = item.playerId == null ? undefined : ranksById.get(item.playerId);
    if (!rank) return item;
    return {
      ...item,
      playerName: item.playerName || rank.name,
      team: item.team || rank.team,
      position: item.position || rank.position,
    };
  });
}
