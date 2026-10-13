import { describe, expect, it } from "vitest";
import { resolveEffectiveLineupForWeek } from "./plannedLineup";

// CVC's carry forward: a planned lineup row stays in effect for later weeks until the owner
// plans again. Planned rows are matched to the franchise's roster by player id, but CVC has
// real history of two player rows for one real person (James Cook, DeVonta Smith, Antonio
// Williams), so a row saved against one id can sit beside a roster row with a different id.
// These tests lock in the rule that the carried slot follows the PERSON, not just the id.

const asg = (id: string, playerId: string, slot: string | null = "BENCH") => ({ id, player_id: playerId, franchise_id: "f1", assigned_slot_code: slot });
const roster = [
  { id: "new-allen", display_name: "Josh Allen", position: "QB", nfl_team: "BUF" },
  { id: "new-cook", display_name: "James Cook", position: "RB", nfl_team: "BUF" },
  { id: "new-dal", display_name: "Cowboys D/ST", position: "DST", nfl_team: "DAL" },
  { id: "new-kupp", display_name: "Cooper Kupp", position: "WR", nfl_team: "SEA" },
];
const current = [asg("a1", "new-allen", "BENCH"), asg("a2", "new-cook", "BENCH"), asg("a3", "new-dal", "BENCH"), asg("a4", "new-kupp", "BENCH")];

describe("resolveEffectiveLineupForWeek: carry forward with stale player ids", () => {
  it("carries a planned slot saved under an old id onto the roster row for the same person (name match)", () => {
    const planned = [{ week_number: 3, player_id: "old-allen", slot_code: "QB", display_name: "Josh Allen", position: "QB", nfl_team: "BUF" }];
    const result = resolveEffectiveLineupForWeek(5, current, planned, roster);
    expect(result.get("new-allen")).toBe("QB");
  });

  it("matches across a generational suffix difference (James Cook vs James Cook III)", () => {
    const planned = [{ week_number: 3, player_id: "old-cook", slot_code: "FLEX", display_name: "James Cook III", position: "RB", nfl_team: "BUF" }];
    const result = resolveEffectiveLineupForWeek(6, current, planned, roster);
    expect(result.get("new-cook")).toBe("FLEX");
  });

  it("matches a team defense that is named differently from the roster's DST row", () => {
    const planned = [{ week_number: 3, player_id: "old-dal", slot_code: "DST", display_name: "Dallas Cowboys", position: "DST", nfl_team: "DAL" }];
    const result = resolveEffectiveLineupForWeek(5, current, planned, roster);
    expect(result.get("new-dal")).toBe("DST");
  });

  it("drops a planned row for a player who genuinely left the roster, and does not disturb anyone else", () => {
    const planned = [
      { week_number: 3, player_id: "old-gone", slot_code: "WR", display_name: "Rashee Rice", position: "WR", nfl_team: "KC" },
      { week_number: 3, player_id: "old-allen", slot_code: "QB", display_name: "Josh Allen", position: "QB", nfl_team: "BUF" },
    ];
    const result = resolveEffectiveLineupForWeek(5, current, planned, roster);
    expect(result.size).toBe(4); // the departed player never becomes a lineup entry
    expect(result.has("old-gone")).toBe(false);
    expect(result.get("new-allen")).toBe("QB");
    expect(result.get("new-kupp")).toBe("BENCH"); // untouched
  });

  it("does not match two different real players who share a name but not a position", () => {
    const planned = [{ week_number: 3, player_id: "other-allen", slot_code: "WR", display_name: "Josh Allen", position: "LB", nfl_team: "JAX" }];
    const result = resolveEffectiveLineupForWeek(5, current, planned, roster);
    expect(result.get("new-allen")).toBe("BENCH");
  });

  it("keeps carrying a stale id match forward through later weeks until a newer plan overrides it", () => {
    const planned = [
      { week_number: 3, player_id: "old-allen", slot_code: "QB", display_name: "Josh Allen", position: "QB", nfl_team: "BUF" },
      { week_number: 6, player_id: "old-allen", slot_code: "BENCH", display_name: "Josh Allen", position: "QB", nfl_team: "BUF" },
    ];
    expect(resolveEffectiveLineupForWeek(5, current, planned, roster).get("new-allen")).toBe("QB");
    expect(resolveEffectiveLineupForWeek(8, current, planned, roster).get("new-allen")).toBe("BENCH");
  });

  it("an exact id match still wins over a name match for the same week", () => {
    const planned = [
      { week_number: 3, player_id: "old-allen", slot_code: "FLEX", display_name: "Josh Allen", position: "QB", nfl_team: "BUF" },
      { week_number: 3, player_id: "new-allen", slot_code: "QB", display_name: "Josh Allen", position: "QB", nfl_team: "BUF" },
    ];
    expect(resolveEffectiveLineupForWeek(5, current, planned, roster).get("new-allen")).toBe("QB");
  });

  it("callers that pass no roster argument behave exactly as before (exact id only)", () => {
    const planned = [{ week_number: 3, player_id: "old-allen", slot_code: "QB", display_name: "Josh Allen", position: "QB", nfl_team: "BUF" }];
    expect(resolveEffectiveLineupForWeek(5, current, planned).get("new-allen")).toBe("BENCH");
  });
});
