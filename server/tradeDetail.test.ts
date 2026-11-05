import { describe, expect, it } from "vitest";
import { buildTradeDetail } from "./tradeDetail";

describe("buildTradeDetail", () => {
  const trade = {
    id: "t1", proposer_franchise_id: "A", recipient_franchise_id: "B",
    proposer: { name: "Dresser Drawer Devices" }, recipient: [{ name: "Xavier Musketeers" }],
    assets: [
      { from_franchise_id: "A", player: { display_name: "Joe Burrow", position: "QB", nfl_team: "CIN" }, pick: null },
      { from_franchise_id: "A", player: null, pick: { round_number: 1, pick_number: 6, draft: { draft_type: "rookie", season: { year: 2027 } } } },
      { from_franchise_id: "B", player: { display_name: "Quinshon Judkins", position: "RB", nfl_team: "CLE" }, pick: null },
      { from_franchise_id: "B", player: null, pick: [{ round_number: 1, pick_number: 5, draft: [{ draft_type: "rookie", season: [{ year: 2027 }] }] }][0] },
    ],
  };
  it("lists what each side sends, for either relation shape", () => {
    expect(buildTradeDetail(trade)).toEqual({ sides: [
      { franchise: "Dresser Drawer Devices", sends: ["Joe Burrow (QB, CIN)", "2027 Rookie Draft R1.06"] },
      { franchise: "Xavier Musketeers", sends: ["Quinshon Judkins (RB, CLE)", "2027 Rookie Draft R1.05"] },
    ] });
  });
  it("falls back to a placeholder name and empty lists", () => {
    expect(buildTradeDetail({ id: "t2", proposer_franchise_id: "A", recipient_franchise_id: "B", assets: [] })).toEqual({ sides: [
      { franchise: "CVC franchise", sends: [] }, { franchise: "CVC franchise", sends: [] },
    ] });
  });
});
