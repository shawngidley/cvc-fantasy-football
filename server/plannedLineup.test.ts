import { describe, expect, it } from "vitest";
import { resolveEffectiveLineupForWeek } from "./plannedLineup";

describe("resolveEffectiveLineupForWeek", () => {
  it("falls back to the current roster_assignment slot when no planned rows exist at all -- the 'week 1 is the default for every following week' baseline", () => {
    const current = [{ id: "a1", player_id: "p1", franchise_id: "f1", assigned_slot_code: "QB" }];
    const result = resolveEffectiveLineupForWeek(5, current, []);
    expect(result.get("p1")).toBe("QB");
  });

  it("uses the planned row for the target week when one exists exactly for it", () => {
    const current = [{ id: "a1", player_id: "p1", franchise_id: "f1", assigned_slot_code: "QB" }];
    const planned = [{ week_number: 5, player_id: "p1", slot_code: "BENCH" }];
    const result = resolveEffectiveLineupForWeek(5, current, planned);
    expect(result.get("p1")).toBe("BENCH");
  });

  it("carries a planned change at an EARLIER week forward to a later week with no row of its own -- the core 'carries over until changed' requirement", () => {
    const current = [{ id: "a1", player_id: "p1", franchise_id: "f1", assigned_slot_code: "QB" }];
    const planned = [{ week_number: 3, player_id: "p1", slot_code: "BENCH" }]; // explicit change at week 3
    const result = resolveEffectiveLineupForWeek(7, current, planned); // week 7 has no row of its own
    expect(result.get("p1")).toBe("BENCH"); // still carries the week-3 change, not the original baseline
  });

  it("uses the MOST RECENT planned week at or before the target, not the earliest or the baseline", () => {
    const current = [{ id: "a1", player_id: "p1", franchise_id: "f1", assigned_slot_code: "QB" }];
    const planned = [
      { week_number: 2, player_id: "p1", slot_code: "BENCH" },
      { week_number: 4, player_id: "p1", slot_code: "FLEX" },
    ];
    const result = resolveEffectiveLineupForWeek(6, current, planned);
    expect(result.get("p1")).toBe("FLEX"); // week 4's change is more recent than week 2's
  });

  it("ignores a planned row for a week AFTER the target -- a future re-plan shouldn't leak backward", () => {
    const current = [{ id: "a1", player_id: "p1", franchise_id: "f1", assigned_slot_code: "QB" }];
    const planned = [{ week_number: 8, player_id: "p1", slot_code: "BENCH" }];
    const result = resolveEffectiveLineupForWeek(5, current, planned); // week 5, planned row is for week 8
    expect(result.get("p1")).toBe("QB"); // still the baseline, week 8's plan doesn't apply yet
  });

  it("defaults a newly-rostered player (no planned rows, current slot is BENCH) to BENCH, with no special-casing needed for when they were acquired", () => {
    const current = [{ id: "a2", player_id: "p2", franchise_id: "f1", assigned_slot_code: "BENCH" }];
    const result = resolveEffectiveLineupForWeek(9, current, []);
    expect(result.get("p2")).toBe("BENCH");
  });

  it("resolves independently per player -- one player's planned change doesn't affect another's", () => {
    const current = [
      { id: "a1", player_id: "p1", franchise_id: "f1", assigned_slot_code: "QB" },
      { id: "a2", player_id: "p2", franchise_id: "f1", assigned_slot_code: "RB" },
    ];
    const planned = [{ week_number: 3, player_id: "p1", slot_code: "BENCH" }];
    const result = resolveEffectiveLineupForWeek(6, current, planned);
    expect(result.get("p1")).toBe("BENCH");
    expect(result.get("p2")).toBe("RB"); // untouched
  });

  it("falls back to BENCH if a player somehow has a null assigned_slot_code and no planned rows", () => {
    const current = [{ id: "a1", player_id: "p1", franchise_id: "f1", assigned_slot_code: null }];
    const result = resolveEffectiveLineupForWeek(5, current, []);
    expect(result.get("p1")).toBe("BENCH");
  });
});
