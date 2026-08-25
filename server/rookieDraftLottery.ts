import { createHash, randomInt } from "node:crypto";

export const LOTTERY_REVEAL_INTERVAL_SECONDS = 20;

/** Cryptographically-strong Fisher-Yates shuffle — same approach already used and
 * confirmed sound for the WRC draft lottery, and for 36 Football's inaugural draft
 * lottery this is adapted from. Uses node:crypto.randomInt, not Math.random. */
export function secureShuffle<T>(items: readonly T[]): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const replacement = randomInt(index + 1);
    [shuffled[index], shuffled[replacement]] = [shuffled[replacement]!, shuffled[index]!];
  }
  return shuffled;
}

/** A SHA-256 hash of the full drawn order, computed and stored the instant the lottery
 * starts — proves the order was locked before the first reveal, without exposing the
 * order itself (which stays server-side until each position's reveal time arrives). */
export function lotteryCommitment(order: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(order)).digest("hex");
}

/** How many positions SHOULD be revealed right now, given elapsed running time — not
 * client-driven, so a fast/slow clock or a page refresh can't change the pace. Never
 * returns fewer than the already-persisted revealedCount (reveals are one-directional). */
export function revealedLotteryCount(params: { franchiseCount: number; revealIntervalSeconds: number; revealedCount: number; elapsedMsBeforePause: number; startedAt: string | null; status: string; now?: number }): number {
  const { franchiseCount, revealIntervalSeconds, revealedCount, elapsedMsBeforePause, startedAt, status, now = Date.now() } = params;
  if (status !== "RUNNING" || !startedAt) return revealedCount;
  const elapsedMs = elapsedMsBeforePause + Math.max(0, now - new Date(startedAt).getTime());
  return Math.min(franchiseCount, Math.max(revealedCount, Math.floor(elapsedMs / (revealIntervalSeconds * 1000))));
}

/** Reveals go in REVERSE draft order: the worst/last pick (draft_position = N) is
 * revealed first (revealIndex 1), building up to the top pick (draft_position = 1)
 * revealed last (revealIndex N). franchiseOrder[0] is the franchise assigned to the
 * first reveal (draft_position N), franchiseOrder[N-1] gets draft_position 1. */
export function reverseLotteryPositions(franchiseOrder: readonly string[], revealedCount: number) {
  const count = franchiseOrder.length;
  return Array.from({ length: Math.min(count, revealedCount) }, (_, index) => ({
    revealIndex: index + 1,
    draftPosition: count - index,
    franchiseId: franchiseOrder[index]!,
  }));
}
