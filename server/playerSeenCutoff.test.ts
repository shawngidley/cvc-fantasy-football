import { describe, expect, it } from "vitest";
import { passesSeenFilter, seenCutoffIso } from "./playerSeenCutoff";

// Real values from production: the Tank01 sync stamped Travis Etienne Jr. at 20:48 and the
// FantasyPros sync stamped everyone it matched at 21:06 the same day. The old filter required
// last_seen_at to EQUAL the newest stamp, so Etienne (and anyone only Tank01 saw) vanished
// from the free agent pool even though he had just been cut.
const NEWEST = "2026-08-26T21:06:33.90362+00:00";
const TANK01_ONLY = "2026-08-26T20:48:23.08+00:00";

describe("seen filter", () => {
  it("keeps a player stamped by the other sync a few minutes earlier", () => {
    expect(passesSeenFilter(TANK01_ONLY, NEWEST)).toBe(true);
  });
  it("keeps the player stamped by the newest sync", () => {
    expect(passesSeenFilter(NEWEST, NEWEST)).toBe(true);
  });
  it("still drops a player not seen in weeks", () => {
    expect(passesSeenFilter("2026-07-01T00:00:00+00:00", NEWEST)).toBe(false);
  });
  it("drops a player who was never seen", () => {
    expect(passesSeenFilter(null, NEWEST)).toBe(false);
  });
  it("fails open when no sync has ever run", () => {
    expect(passesSeenFilter(null, null)).toBe(true);
    expect(seenCutoffIso(null)).toBeNull();
  });
  it("cutoff is earlier than the newest stamp", () => {
    expect(new Date(seenCutoffIso(NEWEST)!).getTime()).toBeLessThan(new Date(NEWEST).getTime());
  });
});
