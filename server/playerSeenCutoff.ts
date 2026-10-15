/**
 * Players are hidden from the pool when they have dropped off the NFL's active lists.
 * Two syncs stamp player.last_seen_at (Tank01 active rosters and FantasyPros ROS rankings),
 * each with its own timestamp. Requiring last_seen_at to EQUAL the newest stamp meant only the
 * last sync's players counted, so anyone the other sync saw (a recently cut starter like
 * Travis Etienne Jr.) disappeared. Use a window behind the newest stamp instead.
 */
export const SEEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function seenCutoffIso(newestSeenAt: string | null | undefined): string | null {
  if (!newestSeenAt) return null;
  return new Date(new Date(newestSeenAt).getTime() - SEEN_WINDOW_MS).toISOString();
}

/** Mirror of the SQL filter (last_seen_at >= cutoff), for code that checks a single row. Fails open with no sync history. */
export function passesSeenFilter(lastSeenAt: string | null | undefined, newestSeenAt: string | null | undefined): boolean {
  const cutoff = seenCutoffIso(newestSeenAt);
  if (!cutoff) return true;
  return !!lastSeenAt && new Date(lastSeenAt).getTime() >= new Date(cutoff).getTime();
}
