import { describe, expect, it } from "vitest";
import { resolveRosterPlayerForLineupEntry } from "./rosterPlayerResolution";

const teamA = [
  { id: "a-allen", display_name: "Josh Allen", position: "QB", nfl_team: "BUF" },
  { id: "a-dst", display_name: "Cowboys D/ST", position: "DST", nfl_team: "DAL" },
];

describe("resolveRosterPlayerForLineupEntry", () => {
  it("matches by exact id first", () => {
    expect(resolveRosterPlayerForLineupEntry({ player_id: "a-allen" }, teamA)?.id).toBe("a-allen");
  });
  it("matches by normalized name with a suffix difference", () => {
    expect(resolveRosterPlayerForLineupEntry({ player_id: "x", display_name: "Josh Allen Jr.", position: "QB" }, teamA)?.id).toBe("a-allen");
  });
  it("matches a DST by NFL team when names differ", () => {
    expect(resolveRosterPlayerForLineupEntry({ player_id: "x", display_name: "Dallas Cowboys", position: "DEF", nfl_team: "DAL" }, teamA)?.id).toBe("a-dst");
  });
  it("never matches a player who is only on another team's roster", () => {
    const teamB = [{ id: "b-kupp", display_name: "Cooper Kupp", position: "WR", nfl_team: "SEA" }];
    expect(resolveRosterPlayerForLineupEntry({ player_id: "x", display_name: "Josh Allen", position: "QB" }, teamB)).toBeNull();
    expect(resolveRosterPlayerForLineupEntry({ player_id: "x", display_name: "Dallas Cowboys", position: "DST", nfl_team: "DAL" }, teamB)).toBeNull();
  });
  it("does not let two entries claim the same roster player", () => {
    const claimed = new Set<string>();
    const first = resolveRosterPlayerForLineupEntry({ player_id: "x1", display_name: "Josh Allen", position: "QB" }, teamA, claimed);
    claimed.add(first!.id);
    expect(resolveRosterPlayerForLineupEntry({ player_id: "x2", display_name: "Josh Allen", position: "QB" }, teamA, claimed)).toBeNull();
  });
});
