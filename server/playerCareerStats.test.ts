import { describe, expect, it, vi, afterEach } from "vitest";
import { getCvcPlayerCareerStats } from "./playerCareerStats";

const QB_LABELS = ["CMP", "ATT", "YDS", "CMP%", "AVG", "TD", "INT", "LNG", "SACK", "RTG", "QBR", "CAR", "YDS", "AVG", "TD", "LNG"];
const RB_LABELS = ["CAR", "YDS", "AVG", "TD", "LNG", "REC", "TGTS", "YDS", "AVG", "TD", "LNG"];

const passRules = [
  { stat_key: "passing_yards", value: 0.04, applies_to_positions: ["QB"] },
  { stat_key: "passing_touchdown", value: 4, applies_to_positions: ["QB"] },
  { stat_key: "interception", value: -2, applies_to_positions: ["QB"] },
  { stat_key: "rushing_yards", value: 0.1, applies_to_positions: null },
  { stat_key: "rushing_touchdown", value: 6, applies_to_positions: null },
  { stat_key: "reception", value: 1, applies_to_positions: null },
  { stat_key: "receiving_yards", value: 0.1, applies_to_positions: null },
  { stat_key: "receiving_touchdown", value: 6, applies_to_positions: null },
];

function mockFetch(eventsByYear: Record<number, { stats: string[] }[]>, labels: string[]) {
  return vi.fn(async (url: string) => {
    const match = url.match(/season=(\d+)/);
    const year = match ? Number(match[1]) : 0;
    const events = eventsByYear[year];
    if (!events) return { ok: false } as Response;
    // Real ESPN shape: game events live nested under seasonTypes[].categories[].events[],
    // not a flat top-level `events` map (that field exists separately as eventId-keyed
    // metadata with no .stats array -- the bug this test suite exists to catch).
    return { ok: true, json: async () => ({ seasonTypes: [{ categories: [{ events }] }], labels }) } as Response;
  });
}

afterEach(() => { vi.restoreAllMocks(); });

describe("getCvcPlayerCareerStats", () => {
  it("correctly disambiguates duplicate YDS/TD labels between passing and rushing for a QB", async () => {
    // Two games: game 1 has 300 pass yds / 2 pass TD / 20 rush yds / 0 rush TD;
    // game 2 has 250 pass yds / 1 pass TD / 30 rush yds / 1 rush TD.
    const events = [
      { stats: ["25", "35", "300", "71.4", "8.6", "2", "0", "45", "1", "105.0", "60.0", "5", "20", "4.0", "0", "8"] },
      { stats: ["20", "30", "250", "66.7", "8.3", "1", "1", "40", "2", "95.0", "55.0", "4", "30", "7.5", "1", "12"] },
    ];
    global.fetch = mockFetch({ 2026: events }, QB_LABELS);
    const rows = await getCvcPlayerCareerStats("12345", "QB", passRules, 2026, 1);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.gp).toBe(2);
    expect(row.passYds).toBe(550); // 300 + 250, not conflated with rushing
    expect(row.passTD).toBe(3);
    expect(row.rushYds).toBe(50); // 20 + 30, correctly picked up the SECOND "YDS" occurrence
    expect(row.rushTD).toBe(1);
    expect(row.passInt).toBe(1);
  });

  it("correctly disambiguates duplicate YDS/TD labels between rushing and receiving for an RB", async () => {
    const events = [
      { stats: ["15", "80", "5.3", "1", "20", "3", "4", "25", "8.3", "0", "12"] },
    ];
    global.fetch = mockFetch({ 2026: events }, RB_LABELS);
    const rules = [
      { stat_key: "rushing_yards", value: 0.1, applies_to_positions: null },
      { stat_key: "rushing_touchdown", value: 6, applies_to_positions: null },
      { stat_key: "receiving_yards", value: 0.1, applies_to_positions: null },
      { stat_key: "reception", value: 1, applies_to_positions: null },
    ];
    const rows = await getCvcPlayerCareerStats("67890", "RB", rules, 2026, 1);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.rushYds).toBe(80);
    expect(row.rushTD).toBe(1);
    expect(row.recYds).toBe(25); // second YDS occurrence, not conflated with rushing's 80
    expect(row.rec).toBe(3);
  });

  it("does not confuse the flat top-level events metadata map (no .stats field) with the real nested seasonTypes events -- the exact bug found in production (GP counted correctly, every stat came back zero)", async () => {
    const realEvents = [{ stats: ["25", "35", "300", "71.4", "8.6", "2", "0", "45", "1", "105.0", "60.0", "5", "20", "4.0", "0", "8"] }];
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        // Flat metadata map: real shape ESPN returns, keyed by eventId, no .stats field.
        events: { event123: { id: "123", opponent: { abbreviation: "HOU" } }, event456: { id: "456", opponent: { abbreviation: "BUF" } } },
        seasonTypes: [{ categories: [{ events: realEvents }] }],
        labels: QB_LABELS,
      }),
    } as Response));
    const rows = await getCvcPlayerCareerStats("12345", "QB", passRules, 2026, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].gp).toBe(1); // from the real nested events, not the 2-entry flat metadata map
    expect(rows[0].passYds).toBe(300); // must not be 0
  });

  it("omits years with no data instead of returning a zeroed row", async () => {
    const events = [{ stats: ["10", "15", "100", "66.7", "6.7", "1", "0", "20", "0", "90.0", "50.0", "0", "0", "0", "0", "0"] }];
    global.fetch = mockFetch({ 2026: events }, QB_LABELS); // only 2026 has data
    const rows = await getCvcPlayerCareerStats("12345", "QB", passRules, 2026, 3); // requests 2026, 2025, 2024
    expect(rows).toHaveLength(1);
    expect(rows[0].season).toBe(2026);
  });

  it("computes CVC points from the supplied scoring rules, not a hardcoded formula", async () => {
    const events = [{ stats: ["20", "30", "300", "66.7", "10.0", "3", "1", "45", "0", "110.0", "65.0", "0", "0", "0", "0", "0"] }];
    global.fetch = mockFetch({ 2026: events }, QB_LABELS);
    const rows = await getCvcPlayerCareerStats("12345", "QB", passRules, 2026, 1);
    // 300 * 0.04 + 3 * 4 - 1 * 2 = 12 + 12 - 2 = 22
    expect(rows[0].cvcPts).toBeCloseTo(22, 1);
  });
});
