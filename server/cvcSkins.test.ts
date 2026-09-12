import { describe, expect, it } from "vitest";
import { decideSkinOutcome, SKIN_THRESHOLD } from "./cvcSkins";

describe("decideSkinOutcome", () => {
  it("a unique score at or above 150 wins a normal week", () => {
    const scores = [{ franchiseId: "a", score: 155 }, { franchiseId: "b", score: 140 }];
    const decision = decideSkinOutcome(scores, false, []);
    expect(decision).toMatchObject({ status: "won", winnerFranchiseId: "a", winningScore: 155, tiebreakerUsed: false });
  });

  it("no team clearing 150 pushes, even with a unique high score", () => {
    const scores = [{ franchiseId: "a", score: 149.99 }, { franchiseId: "b", score: 120 }];
    const decision = decideSkinOutcome(scores, false, []);
    expect(decision).toMatchObject({ status: "pushed", winnerFranchiseId: null });
  });

  it("a tie at or above 150 pushes -- normal weeks never use the tiebreaker", () => {
    const scores = [{ franchiseId: "a", score: 160 }, { franchiseId: "b", score: 160 }];
    const decision = decideSkinOutcome(scores, false, []);
    expect(decision).toMatchObject({ status: "pushed", winnerFranchiseId: null, tiebreakerUsed: false });
  });

  it("exact-equality tie check: 160.00 vs 160.001 is NOT a tie (per the confirmed exact-equality rule)", () => {
    const scores = [{ franchiseId: "a", score: 160 }, { franchiseId: "b", score: 160.001 }];
    const decision = decideSkinOutcome(scores, false, []);
    expect(decision).toMatchObject({ status: "won", winnerFranchiseId: "b" });
  });

  it("the season's last week wins regardless of the 150 threshold", () => {
    const scores = [{ franchiseId: "a", score: 88 }, { franchiseId: "b", score: 70 }];
    const decision = decideSkinOutcome(scores, true, []);
    expect(decision).toMatchObject({ status: "won", winnerFranchiseId: "a", winningScore: 88, tiebreakerUsed: false });
  });

  it("a tie on the last week is broken by the highest-scoring individual player among the tied teams' active lineups", () => {
    const scores = [{ franchiseId: "a", score: 130 }, { franchiseId: "b", score: 130 }];
    const tiebreakerCandidates = [
      { franchiseId: "a", playerId: "p1", playerName: "Player One", points: 22.4 },
      { franchiseId: "b", playerId: "p2", playerName: "Player Two", points: 31.1 },
      { franchiseId: "a", playerId: "p3", playerName: "Player Three", points: 18.0 },
    ];
    const decision = decideSkinOutcome(scores, true, tiebreakerCandidates);
    expect(decision).toMatchObject({ status: "won", winnerFranchiseId: "b", tiebreakerUsed: true, tiebreakerPlayerId: "p2", tiebreakerPlayerName: "Player Two" });
  });

  it("SKIN_THRESHOLD is exported as 150, matching the confirmed rule", () => {
    expect(SKIN_THRESHOLD).toBe(150);
  });
});
