import { describe, expect, it } from "vitest";
import { normalizeFantasyProsPlayers, resolveMatchingPlayer } from "./fantasyProsSync";

describe("CVC FantasyPros player normalization", () => {
  it("maps a cached provider record into a stable CVC player identity without exposing payload-only fields", () => {
    const players = normalizeFantasyProsPlayers({ players: [{ player_id: 8000, player_name: "Arizona Cardinals", position_id: "DST", positions: ["DST"], team_id: "ARI", rank_ecr: 12, rank_adp: 31, sportsdata_player_id: "provider-guid" }] });

    expect(players).toEqual([{
      externalId: "8000",
      displayName: "Arizona Cardinals",
      position: "DST",
      nflTeam: "ARI",
      metadata: { fantasypros_id: "8000", sportsdata_player_id: "provider-guid", rank_ecr: 12, rank_adp: 31 },
    }]);
  });

  it("rejects incomplete provider records before they can enter the CVC player pool", () => {
    expect(normalizeFantasyProsPlayers({ players: [{ player_id: 91 }, { player_name: "Missing identifier" }] })).toEqual([]);
  });
});

describe("CVC FantasyPros player matching (regression: ~123 duplicate rows created by name+team mismatches)", () => {
  const player = (overrides: Partial<{ id: string; provider: string; external_id: string | null; display_name: string; position: string | null; nfl_team: string | null; metadata: Record<string, unknown> | null }>) => ({
    id: "id", provider: "cvc_workbook_2026", external_id: null, display_name: "", position: null, nfl_team: null, metadata: null, ...overrides,
  });

  it("matches an existing row by name+team when both agree", () => {
    const existing = [player({ id: "real", display_name: "Alvin Kamara", nfl_team: "NO" })];
    const match = resolveMatchingPlayer({ externalId: "16421", displayName: "Alvin Kamara", nflTeam: "NO" }, existing);
    expect(match?.id).toBe("real");
  });

  it("falls back to an unambiguous name-only match when the existing row's team is blank (the actual root cause)", () => {
    // Reproduces the real-world case: the original workbook import had no nfl_team yet
    // when the first FantasyPros sync ran, so name+team failed even though this is
    // clearly the same real player.
    const existing = [player({ id: "real", display_name: "Alvin Kamara", nfl_team: null })];
    const match = resolveMatchingPlayer({ externalId: "16421", displayName: "Alvin Kamara", nflTeam: "NO" }, existing);
    expect(match?.id).toBe("real");
  });

  it("never uses the name-only fallback when the name is ambiguous (two different real people)", () => {
    const existing = [
      player({ id: "wr-antonio-williams", display_name: "Antonio Williams", position: "WR", nfl_team: "WAS" }),
      player({ id: "rb-antonio-williams", display_name: "Antonio Williams", position: "RB", nfl_team: null }),
    ];
    const match = resolveMatchingPlayer({ externalId: "99999", displayName: "Antonio Williams", nflTeam: "SEA" }, existing);
    expect(match).toBeNull();
  });

  it("prefers an existing fantasypros_id match over name+team or name-only", () => {
    const existing = [
      player({ id: "wrong-name-match", display_name: "Sam Roush", nfl_team: "CHI" }),
      player({ id: "correct-id-match", provider: "fantasypros", external_id: "77777", display_name: "Someone Else", nfl_team: null }),
    ];
    const match = resolveMatchingPlayer({ externalId: "77777", displayName: "Sam Roush", nflTeam: "CHI" }, existing);
    expect(match?.id).toBe("correct-id-match");
  });
});
