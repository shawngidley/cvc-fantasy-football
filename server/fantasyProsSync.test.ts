import { describe, expect, it } from "vitest";
import { normalizeFantasyProsPlayers } from "./fantasyProsSync";

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
