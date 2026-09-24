import { computeNextResolutionTime } from "./waiverResolutionTiming";

/**
 * The 48-hour waiver hold on a newly cut player, matching WRC's timing.
 *
 * A cut player can be bid on immediately, but a winning BID-PERIOD bid is not
 * awarded until the first waiver resolution (Thursday 9am ET or Sunday 9am ET)
 * that falls at least 48 hours after the cut. During that hold the player also
 * cannot be taken in the Sunday free-pickup period at all. The hold is enforced
 * at RESOLUTION time for bid-period bids, not bid time -- a held bid stays
 * pending and is carried into the next bid period. Free-period claims are
 * blocked at submit time instead (see submitFaabBid), since a confirmed
 * free-period claim is now awarded immediately rather than at a resolution.
 *
 * Examples (both matching WRC):
 *  - Cut Thursday 9am ET -> awarded Sunday 9am ET (the Thursday award is at the
 *    cut moment; 48h clears Saturday; next award is Sunday).
 *  - Cut Sunday 9am ET -> awarded the following Thursday (48h clears Tuesday).
 *  - Cut Wednesday afternoon -> 48h clears Friday, so awarded Sunday.
 */
export const WAIVER_HOLD_MS = 48 * 60 * 60 * 1000;

function toDate(value: Date | string): Date {
  return typeof value === "string" ? new Date(value) : value;
}

/** Has a player cut at `droppedAt` cleared the 48-hour hold as of `now`? A null
 * droppedAt (never cut, or a never-rostered free agent) is always cleared. Used
 * both by the bid-period resolver (award-time gate) and the free-period submit
 * gate. */
export function hasClearedWaiverHold(droppedAt: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!droppedAt) return true;
  return now.getTime() >= toDate(droppedAt).getTime() + WAIVER_HOLD_MS;
}

/** When a winning BID-PERIOD bid on a player cut at `droppedAt` would be
 * awarded: the first waiver resolution (Thu/Sun 9am ET) at least 48 hours after
 * the cut. For a player not recently cut, just the next resolution. `now`
 * guards a stale past cut so the answer is never in the past. Not meaningful
 * for a free-period claim, which is awarded immediately on confirm rather than
 * at a scheduled resolution -- see awardFreeAgentClaimNow. */
export function getWaiverAwardDate(droppedAt: Date | string | null | undefined, now: Date = new Date()): Date {
  const clearedAt = droppedAt ? new Date(toDate(droppedAt).getTime() + WAIVER_HOLD_MS) : now;
  const from = clearedAt.getTime() > now.getTime() ? clearedAt : now;
  // computeNextResolutionTime returns the first Thu/Sun 9am ET strictly AFTER its
  // argument; step back 1ms so a `from` that lands exactly on a resolution counts
  // as that resolution rather than skipping to the next one.
  return computeNextResolutionTime(new Date(from.getTime() - 1));
}
