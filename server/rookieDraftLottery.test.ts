import { describe, expect, it } from "vitest";
import { lotteryCommitment, revealedLotteryCount, reverseLotteryPositions, secureShuffle } from "./rookieDraftLottery";

describe("secureShuffle", () => {
  it("returns every input item exactly once, in some order", () => {
    const items = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const shuffled = secureShuffle(items);
    expect(shuffled).toHaveLength(items.length);
    expect([...shuffled].sort()).toEqual([...items].sort());
  });

  it("does not mutate the input array", () => {
    const items = ["a", "b", "c"];
    const original = [...items];
    secureShuffle(items);
    expect(items).toEqual(original);
  });
});

describe("lotteryCommitment", () => {
  it("is deterministic for the same order", () => {
    const order = ["f1", "f2", "f3"];
    expect(lotteryCommitment(order)).toBe(lotteryCommitment(order));
  });

  it("changes if the order changes", () => {
    expect(lotteryCommitment(["f1", "f2"])).not.toBe(lotteryCommitment(["f2", "f1"]));
  });
});

describe("revealedLotteryCount", () => {
  it("returns the stored count unchanged when not RUNNING", () => {
    const count = revealedLotteryCount({ franchiseCount: 10, revealIntervalSeconds: 20, revealedCount: 4, elapsedMsBeforePause: 0, startedAt: null, status: "PAUSED" });
    expect(count).toBe(4);
  });

  it("computes newly-due reveals from elapsed time while RUNNING", () => {
    const startedAt = new Date(Date.now() - 45_000).toISOString(); // 45s elapsed, interval 20s -> 2 due
    const count = revealedLotteryCount({ franchiseCount: 10, revealIntervalSeconds: 20, revealedCount: 0, elapsedMsBeforePause: 0, startedAt, status: "RUNNING" });
    expect(count).toBe(2);
  });

  it("never goes backwards below the already-persisted revealedCount", () => {
    const startedAt = new Date().toISOString(); // ~0s elapsed
    const count = revealedLotteryCount({ franchiseCount: 10, revealIntervalSeconds: 20, revealedCount: 5, elapsedMsBeforePause: 0, startedAt, status: "RUNNING" });
    expect(count).toBe(5);
  });

  it("caps at franchiseCount even with excessive elapsed time", () => {
    const startedAt = new Date(Date.now() - 1_000_000).toISOString();
    const count = revealedLotteryCount({ franchiseCount: 10, revealIntervalSeconds: 20, revealedCount: 0, elapsedMsBeforePause: 0, startedAt, status: "RUNNING" });
    expect(count).toBe(10);
  });
});

describe("reverseLotteryPositions", () => {
  it("reveals draft_position N first (revealIndex 1) and draft_position 1 last", () => {
    const order = ["f0", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9"];
    const positions = reverseLotteryPositions(order, order.length);
    expect(positions[0]).toEqual({ revealIndex: 1, draftPosition: 10, franchiseId: "f0" });
    expect(positions[positions.length - 1]).toEqual({ revealIndex: 10, draftPosition: 1, franchiseId: "f9" });
  });

  it("only returns as many positions as have been revealed", () => {
    const order = ["f0", "f1", "f2"];
    expect(reverseLotteryPositions(order, 1)).toHaveLength(1);
    expect(reverseLotteryPositions(order, 0)).toHaveLength(0);
  });
});
