import { describe, expect, it } from "vitest";
import { remapBidsToCanonicalPlayers } from "./waiverDuplicates";
import { playerIdentityKey } from "../shared/playerIdentity";

// Real case, Oct 15 2026: the Chiefs defense exists as two player rows. The Legends bid on the
// workbook row, the Devices on the fantasypros row, each was "uncontested", and both won.
const kcWorkbook = { id: "35febdaf", display_name: "Kansas City Chiefs", position: "DST", nfl_team: "KC", provider: "cvc_workbook_2026" };
const kcFantasyPros = { id: "ce4ed3fa", display_name: "Kansas City Chiefs", position: "DST", nfl_team: "KC", provider: "fantasypros" };
const nyg = { id: "d03bb5c8", display_name: "New York Giants", position: "DST", nfl_team: "NYG", provider: "fantasypros" };

describe("remapBidsToCanonicalPlayers", () => {
  it("makes bids on two rows for the same defense compete for one player", () => {
    const bids = [{ id: "legends-kc", player_id: "35febdaf" }, { id: "devices-kc", player_id: "ce4ed3fa" }];
    const result = remapBidsToCanonicalPlayers(bids, [kcWorkbook, kcFantasyPros], new Set());
    expect(new Set(result.bids.map(b => b.player_id)).size).toBe(1);
    expect(result.bids.map(b => b.player_id)[0]).toBe("ce4ed3fa"); // the fantasypros row wins as representative
    expect(result.bids.map(b => b.id)).toEqual(["legends-kc", "devices-kc"]);
  });
  it("leaves bids on different players alone", () => {
    const bids = [{ id: "a", player_id: "35febdaf" }, { id: "b", player_id: "d03bb5c8" }];
    const result = remapBidsToCanonicalPlayers(bids, [kcWorkbook, nyg], new Set());
    expect(result.bids.map(b => b.player_id)).toEqual(["35febdaf", "d03bb5c8"]);
  });
  it("retires a bid when any row for that defense is already rostered", () => {
    const bids = [{ id: "legends-kc", player_id: "35febdaf" }];
    const result = remapBidsToCanonicalPlayers(bids, [kcWorkbook, kcFantasyPros], new Set([playerIdentityKey(kcFantasyPros)]));
    expect(result.bids).toEqual([]);
    expect(result.alreadyRostered.map(b => b.id)).toEqual(["legends-kc"]);
  });
  it("treats two rows for one person as the same player (suffix and position safe)", () => {
    const a = { id: "1", display_name: "Travis Etienne Jr.", position: "RB", nfl_team: "NO", provider: "cvc_workbook_2026" };
    const b = { id: "2", display_name: "Travis Etienne", position: "RB", nfl_team: "JAX", provider: "fantasypros" };
    const lb = { id: "3", display_name: "Travis Etienne", position: "LB", nfl_team: "JAX", provider: "fantasypros" };
    expect(playerIdentityKey(a)).toBe(playerIdentityKey(b));
    expect(playerIdentityKey(a)).not.toBe(playerIdentityKey(lb));
  });
});
