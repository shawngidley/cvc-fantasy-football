import { describe, expect, it } from "vitest";
import { selectFreeAgentCandidates, sortByWorstRecordFirst, type FranchiseStanding } from "./waiverRules";

describe("selectFreeAgentCandidates (fix for a real gap: free-period claims were being auto-awarded exactly like bid-period FAAB claims, but per commissioner they must not be -- the claiming owner has to explicitly confirm their own claim first, and anything never confirmed by close time is dropped entirely, no award)", () => {
  it("excludes an unconfirmed claim from the candidate pool entirely -- it can never win", () => {
    const bids = [
      { franchise_id: "a", confirmed_at: null }, // never confirmed by its owner
      { franchise_id: "b", confirmed_at: "2026-09-16T12:00:00Z" },
    ];
    const priority = new Map([["a", 1], ["b", 2]]); // a has better (lower) priority than b
    const { orderedCandidateFranchiseIds } = selectFreeAgentCandidates(bids, priority);
    // Despite "a" having better priority, it's unconfirmed and must not appear at all --
    // "b" (confirmed) is the only real candidate, even though its priority is worse.
    expect(orderedCandidateFranchiseIds).toEqual(["b"]);
  });

  it("orders confirmed candidates by waiver priority, lower number first", () => {
    const bids = [
      { franchise_id: "a", confirmed_at: "2026-09-16T12:00:00Z" },
      { franchise_id: "b", confirmed_at: "2026-09-16T12:00:00Z" },
      { franchise_id: "c", confirmed_at: "2026-09-16T12:00:00Z" },
    ];
    const priority = new Map([["a", 3], ["b", 1], ["c", 2]]);
    const { orderedCandidateFranchiseIds } = selectFreeAgentCandidates(bids, priority);
    expect(orderedCandidateFranchiseIds).toEqual(["b", "c", "a"]);
  });

  it("returns an empty candidate list when nobody confirmed their claim -- the player goes unawarded", () => {
    const bids = [
      { franchise_id: "a", confirmed_at: null },
      { franchise_id: "b", confirmed_at: null },
    ];
    const { orderedCandidateFranchiseIds, bidByFranchise } = selectFreeAgentCandidates(bids, new Map());
    expect(orderedCandidateFranchiseIds).toEqual([]);
    expect(bidByFranchise.size).toBe(0);
  });

  it("treats a franchise with no waiver_priority assigned as lowest priority (goes last)", () => {
    const bids = [
      { franchise_id: "a", confirmed_at: "2026-09-16T12:00:00Z" },
      { franchise_id: "b", confirmed_at: "2026-09-16T12:00:00Z" },
    ];
    const priority = new Map([["a", 1]]); // "b" has no entry at all
    const { orderedCandidateFranchiseIds } = selectFreeAgentCandidates(bids, priority);
    expect(orderedCandidateFranchiseIds).toEqual(["a", "b"]);
  });

  it("bidByFranchise only contains confirmed bids, keyed by franchise id", () => {
    const confirmedBid = { franchise_id: "a", confirmed_at: "2026-09-16T12:00:00Z" };
    const bids = [confirmedBid, { franchise_id: "b", confirmed_at: null }];
    const { bidByFranchise } = selectFreeAgentCandidates(bids, new Map());
    expect(bidByFranchise.get("a")).toBe(confirmedBid);
    expect(bidByFranchise.has("b")).toBe(false);
  });
});

describe("sortByWorstRecordFirst (confirmed: fewest wins first, then fewest points-for as the secondary tiebreak, matching 'if bidders have the same record the team with less points scored gets the player')", () => {
  it("sorts by fewest wins first", () => {
    const standings = new Map<string, FranchiseStanding>([
      ["a", { franchiseId: "a", wins: 3, losses: 2, pointsFor: 100 }],
      ["b", { franchiseId: "b", wins: 1, losses: 4, pointsFor: 100 }],
    ]);
    expect(sortByWorstRecordFirst(["a", "b"], standings)).toEqual(["b", "a"]);
  });

  it("breaks a tied record by fewest points-for", () => {
    const standings = new Map<string, FranchiseStanding>([
      ["a", { franchiseId: "a", wins: 2, losses: 2, pointsFor: 150 }],
      ["b", { franchiseId: "b", wins: 2, losses: 2, pointsFor: 120 }],
    ]);
    expect(sortByWorstRecordFirst(["a", "b"], standings)).toEqual(["b", "a"]);
  });
});
