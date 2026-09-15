import { describe, expect, it } from "vitest";
import { buildInjuryStatusMap } from "./useCvcInjuryStatuses";

describe("buildInjuryStatusMap", () => {
  it("maps a player's normalized display name to their short status and headline", () => {
    const map = buildInjuryStatusMap([
      { playerName: "Ja'Marr Chase", shortStatus: "Q", headline: "Questionable · Ankle" },
    ]);
    expect(map.get("jamarrchase")).toEqual({ shortStatus: "Q", headline: "Questionable · Ankle" });
  });

  it("normalizes suffix mismatches the same way live scoring does (Tank01's James Cook III vs a roster's James Cook)", () => {
    const map = buildInjuryStatusMap([
      { playerName: "James Cook III", shortStatus: "D", headline: "Doubtful · Hamstring" },
    ]);
    // A roster listing "James Cook" (no suffix) should still find this entry.
    expect(map.get("jamescook")).toEqual({ shortStatus: "D", headline: "Doubtful · Hamstring" });
  });

  it("skips items with no player name", () => {
    const map = buildInjuryStatusMap([{ playerName: "", shortStatus: "O", headline: "Out" }]);
    expect(map.size).toBe(0);
  });

  it("returns an empty map for no items", () => {
    expect(buildInjuryStatusMap([]).size).toBe(0);
  });

  it("carries a null shortStatus through unchanged (e.g. an unrecognized status code from the source)", () => {
    const map = buildInjuryStatusMap([{ playerName: "Some Player", shortStatus: null, headline: "Injury update" }]);
    expect(map.get("someplayer")?.shortStatus).toBeNull();
  });
});
