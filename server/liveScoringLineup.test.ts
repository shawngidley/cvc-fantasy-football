import { describe, expect, it } from "vitest";
import { franchiseLiveLineup, type LiveLineupAssignment } from "./liveScoringLineup";

const player = { id: "p1", display_name: "Starter", position: "QB", nfl_team: "BUF" };
const benchPlayer = { id: "p2", display_name: "Bench Guy", position: "RB", nfl_team: "MIA" };
const assignments: LiveLineupAssignment[] = [
  { id: "qb", franchise_id: "alpha", assigned_slot_code: "QB", player: [player] },
  { id: "flex", franchise_id: "alpha", assigned_slot_code: "FLEX", player },
  { id: "bench", franchise_id: "alpha", assigned_slot_code: "BENCH", player: benchPlayer },
  // The exact real-world case that motivated this fix: a bench player stored with a
  // null assigned_slot_code (never explicitly slotted), not the literal string
  // "BENCH". Previously excluded entirely by the caller's own query filter before
  // this function ever saw it; now included, same as any other bench-coded row.
  { id: "unslotted", franchise_id: "alpha", assigned_slot_code: null, player: benchPlayer },
  { id: "other", franchise_id: "bravo", assigned_slot_code: "QB", player },
];

describe("franchiseLiveLineup", () => {
  it("supports either Supabase player relation shape", () => {
    expect(franchiseLiveLineup(assignments, "alpha").map(entry => entry.player.display_name)).toEqual(["Starter", "Starter", "Bench Guy", "Bench Guy"]);
  });

  it("includes bench rows (both explicitly BENCH-coded and null-coded) alongside starters, excluding only other franchises", () => {
    expect(franchiseLiveLineup(assignments, "alpha").map(entry => entry.slot)).toEqual(["QB", "FLEX", "BENCH", null]);
  });

  it("excludes assignments with no linked player", () => {
    const withMissingPlayer: LiveLineupAssignment[] = [{ id: "x", franchise_id: "alpha", assigned_slot_code: "QB", player: null }];
    expect(franchiseLiveLineup(withMissingPlayer, "alpha")).toEqual([]);
  });
});
