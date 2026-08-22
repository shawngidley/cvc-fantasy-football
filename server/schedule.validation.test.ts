import { describe, expect, it } from "vitest";
import { matchupInputSchema } from "./routers/league";

describe("CVC schedule entry validation", () => {
  it("rejects a matchup that assigns one franchise to both home and away", async () => {
    const franchiseId = "11111111-1111-4111-8111-111111111111";

    const result = matchupInputSchema.safeParse({ weekNumber: 1, homeFranchiseId: franchiseId, awayFranchiseId: franchiseId, resultState: "upcoming" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("A franchise cannot play itself.");
  });
});
