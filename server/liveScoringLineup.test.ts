import { describe, expect, it } from "vitest";
import { activeLiveLineup, type LiveLineupAssignment } from "./liveScoringLineup";

const player = { id: "p1", display_name: "Starter", position: "QB", nfl_team: "BUF" };
const assignments: LiveLineupAssignment[] = [
  { id: "qb", franchise_id: "alpha", assigned_slot_code: "QB", player: [player] },
  { id: "flex", franchise_id: "alpha", assigned_slot_code: "FLEX", player },
  { id: "bench", franchise_id: "alpha", assigned_slot_code: "BENCH", player },
  { id: "other", franchise_id: "bravo", assigned_slot_code: "QB", player },
];

describe("CVC live scoring lineup transform", () => {
  it("supports either Supabase player relation shape", () => {
    expect(activeLiveLineup(assignments, "alpha").map(entry => entry.player.display_name)).toEqual(["Starter", "Starter"]);
  });

  it("excludes explicit bench rows and other franchises from submitted starters", () => {
    expect(activeLiveLineup(assignments, "alpha").map(entry => entry.slot)).toEqual(["QB", "FLEX"]);
  });
});
