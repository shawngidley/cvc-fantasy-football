import { describe, expect, it } from "vitest";
import { describeLossReason, nextClaimPriority, rankBidPeriodCandidates, resolveWaiverAssignments, selectFreeAgentCandidates, sortByWorstRecordFirst, type FranchiseStanding, type WaiverCandidateBid } from "./waiverRules";

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

describe("rankBidPeriodCandidates (exposes the FULL bidder ranking for a player, not just the top amount -- needed so a rejected top bid can cascade to the next-highest bidder instead of the player going unclaimed)", () => {
  it("orders strictly by amount, highest first", () => {
    const bids = [
      { franchise_id: "a", amount: 5 },
      { franchise_id: "b", amount: 15 },
      { franchise_id: "c", amount: 10 },
    ];
    const ranked = rankBidPeriodCandidates(bids, new Map());
    expect(ranked.map(bid => bid.franchise_id)).toEqual(["b", "c", "a"]);
  });

  it("breaks a tied amount by worst record first, then continues with the rest of the ranking", () => {
    const bids = [
      { franchise_id: "a", amount: 10 },
      { franchise_id: "b", amount: 10 },
      { franchise_id: "c", amount: 5 },
    ];
    const standings = new Map<string, FranchiseStanding>([
      ["a", { franchiseId: "a", wins: 5, losses: 0, pointsFor: 100 }],
      ["b", { franchiseId: "b", wins: 1, losses: 4, pointsFor: 100 }],
    ]);
    const ranked = rankBidPeriodCandidates(bids, standings);
    expect(ranked.map(bid => bid.franchise_id)).toEqual(["b", "a", "c"]);
  });
});

describe("resolveWaiverAssignments (the cascade: an owner's own claims collide with their roster cap, budget, or stated max -- their PRIORITY decides which of their own claims survive, not bid amount or processing order, and anything bumped falls through to the next candidate for that player)", () => {
  function candidate(id: string, franchiseId: string, opts: Partial<WaiverCandidateBid> = {}): WaiverCandidateBid {
    return { id, franchiseId, cost: 10, priority: 1, maxPlayersDesired: 10, dropPlayerId: null, groupKey: "__all__", ...opts };
  }

  it("awards the single top candidate for each player when nothing collides", () => {
    const ranked = new Map([
      ["playerX", [candidate("bid1", "teamA"), candidate("bid2", "teamB")]],
    ]);
    const capacity = new Map([
      ["teamA", { rosterCount: 15, budget: 30 }],
      ["teamB", { rosterCount: 15, budget: 30 }],
    ]);
    const { winnerByPlayer, rejectionReasonByBid } = resolveWaiverAssignments(ranked, capacity, 22);
    expect(winnerByPlayer.get("playerX")).toBe("bid1");
    expect(rejectionReasonByBid.size).toBe(0);
  });

  it("no longer treats a full roster as a blocker -- an owner's OWN colliding claims all win now even past the roster cap (roster size is no longer a rejection reason)", () => {
    // Same franchise leads on two different players with only 1 nominal roster spot
    // left (would need 2 to fit both) -- both should win now.
    const ranked = new Map([
      ["playerX", [candidate("bidX", "teamA", { cost: 5, priority: 1 })]],
      ["playerY", [candidate("bidY", "teamA", { cost: 20, priority: 2 })]],
    ]);
    const capacity = new Map([["teamA", { rosterCount: 21, budget: 30 }]]); // "only" 1 spot left, need 2
    const { winnerByPlayer, rejectionReasonByBid } = resolveWaiverAssignments(ranked, capacity, 22);
    expect(winnerByPlayer.get("playerX")).toBe("bidX");
    expect(winnerByPlayer.get("playerY")).toBe("bidY"); // no longer bumped -- roster size never rejects
    expect(rejectionReasonByBid.size).toBe(0);
  });

  it("cascades a bumped claim to the next-highest outside bidder instead of leaving the player unclaimed", () => {
    // teamA would win both playerX (priority 1) and playerY (priority 2), but their
    // shared max_players_desired of 1 only allows one. playerY should fall through to
    // teamB, the next-best bidder on it.
    const ranked = new Map([
      ["playerX", [candidate("bidX", "teamA", { priority: 1, maxPlayersDesired: 1 })]],
      ["playerY", [candidate("bidY-teamA", "teamA", { priority: 2, maxPlayersDesired: 1 }), candidate("bidY-teamB", "teamB", { priority: 1 })]],
    ]);
    const capacity = new Map([
      ["teamA", { rosterCount: 15, budget: 30 }],
      ["teamB", { rosterCount: 15, budget: 30 }],
    ]);
    const { winnerByPlayer, rejectionReasonByBid } = resolveWaiverAssignments(ranked, capacity, 22);
    expect(winnerByPlayer.get("playerX")).toBe("bidX");
    expect(winnerByPlayer.get("playerY")).toBe("bidY-teamB"); // cascaded, not left unclaimed
    expect(rejectionReasonByBid.get("bidY-teamA")?.type).toBe("max_players_desired");
  });

  it("rejects a lower-priority claim once the season FAAB budget runs out, cheaper claims further down still get evaluated", () => {
    const ranked = new Map([
      ["playerX", [candidate("bidX", "teamA", { cost: 25, priority: 1 })]],
      ["playerY", [candidate("bidY", "teamA", { cost: 10, priority: 2 })]],
      ["playerZ", [candidate("bidZ", "teamA", { cost: 3, priority: 3 })]],
    ]);
    const capacity = new Map([["teamA", { rosterCount: 15, budget: 28 }]]); // affords X (25) then Z (3), not Y (10)
    const { winnerByPlayer, rejectionReasonByBid } = resolveWaiverAssignments(ranked, capacity, 22);
    expect(winnerByPlayer.get("playerX")).toBe("bidX");
    expect(winnerByPlayer.get("playerZ")).toBe("bidZ"); // cheaper, lower-priority claim still fits
    expect(winnerByPlayer.has("playerY")).toBe(false);
    expect(rejectionReasonByBid.get("bidY")).toEqual({ type: "budget", cost: 10, remaining: 3 });
  });

  it("stops a franchise's wins at their own stated max_players_desired, keeping the higher-priority ones", () => {
    const ranked = new Map([
      ["playerX", [candidate("bidX", "teamA", { priority: 1, maxPlayersDesired: 1 })]],
      ["playerY", [candidate("bidY", "teamA", { priority: 2, maxPlayersDesired: 1 })]],
    ]);
    const capacity = new Map([["teamA", { rosterCount: 15, budget: 30 }]]);
    const { winnerByPlayer, rejectionReasonByBid } = resolveWaiverAssignments(ranked, capacity, 22);
    expect(winnerByPlayer.get("playerX")).toBe("bidX");
    expect(winnerByPlayer.has("playerY")).toBe(false);
    expect(rejectionReasonByBid.get("bidY")).toEqual({ type: "max_players_desired", limit: 1 });
  });

  it("never rejects a claim for exceeding the roster cap -- roster size is no longer a rejection reason, even with no drop", () => {
    const ranked = new Map([["playerX", [candidate("bidX", "teamA")]]]);
    const capacity = new Map([["teamA", { rosterCount: 22, budget: 30 }]]); // already at the cap, no drop offered
    const { winnerByPlayer, rejectionReasonByBid } = resolveWaiverAssignments(ranked, capacity, 22);
    expect(winnerByPlayer.get("playerX")).toBe("bidX"); // wins despite pushing the roster to 23
    expect(rejectionReasonByBid.size).toBe(0);
  });

  it("claims in different groups get independent caps -- two separate groups of 1 both win instead of sharing one shared pool of 1 (groupKey is an arbitrary caller-defined string -- owner-defined custom groups, a default-pool sentinel, whatever the caller wants)", () => {
    const ranked = new Map([
      ["playerA", [candidate("bid-a1", "teamA", { priority: 1, maxPlayersDesired: 1, groupKey: "groupA" })]],
      ["playerB", [candidate("bid-b1", "teamA", { priority: 2, maxPlayersDesired: 1, groupKey: "groupB" })]],
    ]);
    const capacity = new Map([["teamA", { rosterCount: 15, budget: 30 }]]);
    const { winnerByPlayer, rejectionReasonByBid } = resolveWaiverAssignments(ranked, capacity, 22);
    expect(winnerByPlayer.get("playerA")).toBe("bid-a1");
    expect(winnerByPlayer.get("playerB")).toBe("bid-b1"); // independent pool, not bumped
    expect(rejectionReasonByBid.size).toBe(0);
  });

  it("a second claim in the SAME group still gets bumped by that group's cap", () => {
    const ranked = new Map([
      ["playerA", [candidate("bid-a1", "teamA", { priority: 1, maxPlayersDesired: 1, groupKey: "groupA" })]],
      ["playerA2", [candidate("bid-a2", "teamA", { priority: 2, maxPlayersDesired: 1, groupKey: "groupA" })]],
      ["playerB", [candidate("bid-b1", "teamA", { priority: 3, maxPlayersDesired: 1, groupKey: "groupB" })]],
    ]);
    const capacity = new Map([["teamA", { rosterCount: 15, budget: 30 }]]);
    const { winnerByPlayer, rejectionReasonByBid } = resolveWaiverAssignments(ranked, capacity, 22);
    expect(winnerByPlayer.get("playerA")).toBe("bid-a1"); // groupA: priority 1 kept
    expect(winnerByPlayer.has("playerA2")).toBe(false); // groupA: priority 2 bumped by the same group's cap
    expect(winnerByPlayer.get("playerB")).toBe("bid-b1"); // groupB: untouched, independent cap
    expect(rejectionReasonByBid.get("bid-a2")).toEqual({ type: "max_players_desired", limit: 1 });
  });

  it("roster cap and season budget stay shared even across different groups -- only max_players_desired is scoped", () => {
    const ranked = new Map([
      ["playerA", [candidate("bid-a1", "teamA", { priority: 1, cost: 20, maxPlayersDesired: 1, groupKey: "groupA" })]],
      ["playerB", [candidate("bid-b1", "teamA", { priority: 2, cost: 20, maxPlayersDesired: 1, groupKey: "groupB" })]],
    ]);
    const capacity = new Map([["teamA", { rosterCount: 15, budget: 30 }]]); // only enough budget for one $20 claim
    const { winnerByPlayer, rejectionReasonByBid } = resolveWaiverAssignments(ranked, capacity, 22);
    expect(winnerByPlayer.get("playerA")).toBe("bid-a1");
    expect(winnerByPlayer.has("playerB")).toBe(false); // independent max-players pool, but budget is still shared
    expect(rejectionReasonByBid.get("bid-b1")).toEqual({ type: "budget", cost: 20, remaining: 10 });
  });
});

describe("the Oct 8 Doubs case: one limit shared by ungrouped claims, all at the same priority and amount", () => {
  const candidate = (id: string, franchiseId: string, opts: Partial<WaiverCandidateBid> = {}): WaiverCandidateBid => ({ id, franchiseId, cost: 2, priority: 1, maxPlayersDesired: 1, dropPlayerId: null, groupKey: "__default__", ...opts });
  const capacity = new Map([["legends", { rosterCount: 15, budget: 30 }], ["devices", { rosterCount: 15, budget: 30 }]]);

  it("same priority and amount: the EARLIER submitted claim is kept, not whichever id sorts first", () => {
    // Legends tie-break winner on both players. Brissett's id sorts before Doubs' id, which
    // is what used to decide it. Doubs was submitted first here, so Doubs must win.
    const ranked = new Map([
      ["brissett", [candidate("92d4-brissett", "legends", { submittedAt: "2026-10-07T20:05:00Z" })]],
      ["doubs", [candidate("a685-doubs", "legends", { submittedAt: "2026-10-07T20:01:00Z" }), candidate("b68e-doubs", "devices")]],
    ]);
    const { winnerByPlayer, rejectionReasonByBid } = resolveWaiverAssignments(ranked, capacity, 22);
    expect(winnerByPlayer.get("doubs")).toBe("a685-doubs");
    expect(winnerByPlayer.has("brissett")).toBe(false);
    expect(rejectionReasonByBid.get("92d4-brissett")).toEqual({ type: "max_players_desired", limit: 1 });
  });

  it("an explicit rank still beats submission time", () => {
    const ranked = new Map([
      ["brissett", [candidate("92d4-brissett", "legends", { priority: 1, submittedAt: "2026-10-07T20:05:00Z" })]],
      ["doubs", [candidate("a685-doubs", "legends", { priority: 2, submittedAt: "2026-10-07T20:01:00Z" }), candidate("b68e-doubs", "devices")]],
    ]);
    const { winnerByPlayer } = resolveWaiverAssignments(ranked, capacity, 22);
    expect(winnerByPlayer.get("brissett")).toBe("92d4-brissett");
    expect(winnerByPlayer.get("doubs")).toBe("b68e-doubs"); // Legends ranked Brissett first, so Doubs falls to the next bidder
  });

  it("legacy claims with no submittedAt still resolve the same way as before (id order)", () => {
    const ranked = new Map([
      ["brissett", [candidate("92d4-brissett", "legends")]],
      ["doubs", [candidate("a685-doubs", "legends"), candidate("b68e-doubs", "devices")]],
    ]);
    const { winnerByPlayer } = resolveWaiverAssignments(ranked, capacity, 22);
    expect(winnerByPlayer.get("brissett")).toBe("92d4-brissett");
  });
});

describe("nextClaimPriority", () => {
  it("starts at 1 for an owner's first claim", () => expect(nextClaimPriority([])).toBe(1));
  it("goes one step behind the lowest ranked existing claim", () => expect(nextClaimPriority([1, 2, 3])).toBe(4));
  it("copes with legacy claims that all sit at rank 1", () => expect(nextClaimPriority([1, 1, 1])).toBe(2));
  it("never goes past the schema maximum of 99", () => expect(nextClaimPriority([99])).toBe(99));
});

describe("describeLossReason", () => {
  const base = { periodType: "bid" as const, bidAmount: 2, confirmed: true, groupLabel: null, wonInSamePool: [], winnerFranchiseName: null, winnerAmount: null };
  it("names the higher ranked players that used up a limit, in the default pool", () => {
    expect(describeLossReason({ ...base, rejection: { type: "max_players_desired", limit: 1 }, wonInSamePool: ["Jacoby Brissett"] }))
      .toBe("Your limit for your default pool was 1. Jacoby Brissett ranked higher, so this claim was skipped.");
  });
  it("names a custom group", () => {
    expect(describeLossReason({ ...base, rejection: { type: "max_players_desired", limit: 2 }, groupLabel: "Handcuffs", wonInSamePool: ["A", "B"] }))
      .toBe('Your limit for your "Handcuffs" group was 2. A and B ranked higher, so this claim was skipped.');
  });
  it("explains a budget rejection", () => {
    expect(describeLossReason({ ...base, rejection: { type: "budget", cost: 5, remaining: 3 } })).toBe("This would cost $5, but you had only $3 of FAAB left this season.");
  });
  it("says outbid when the winner paid more", () => {
    expect(describeLossReason({ ...base, winnerFranchiseName: "Shepard's Pie", winnerAmount: 4 })).toBe("Outbid. Shepard's Pie won this player for $4.");
  });
  it("explains the tiebreak when the winner paid the same", () => {
    expect(describeLossReason({ ...base, winnerFranchiseName: "Dresser Drawer Devices", winnerAmount: 2 }))
      .toBe("Tied at $2. Dresser Drawer Devices won on the tiebreak: worse record first, then fewer points scored.");
  });
  it("free period: unconfirmed and lower priority read differently", () => {
    expect(describeLossReason({ ...base, periodType: "free", confirmed: false })).toBe("You did not confirm this claim before the free agent period closed.");
    expect(describeLossReason({ ...base, periodType: "free" })).toBe("A team with higher waiver priority claimed this player.");
  });
});
