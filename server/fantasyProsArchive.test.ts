import { describe, expect, it } from "vitest";
import { fantasyProsArchiveKey, isEligibleFantasyProsNews, mergeFantasyProsNews } from "./fantasyProsArchive";
import type { FantasyProsNewsItem } from "./fantasyProsNews";

function item(overrides: Partial<FantasyProsNewsItem> = {}): FantasyProsNewsItem {
  return {
    id: 1, playerId: 100, playerName: "Sean Tucker", team: "TB", position: "RB",
    title: "Sean Tucker (hamstring) inactive for Week 1", description: "desc", impact: "impact",
    author: "Author", published: "2026-09-13T15:55:28.000Z", link: "https://example.com",
    ...overrides,
  };
}

describe("isEligibleFantasyProsNews", () => {
  it("is eligible with a name, title, and an eligible position", () => {
    expect(isEligibleFantasyProsNews(item())).toBe(true);
  });

  it("is not eligible with no position", () => {
    expect(isEligibleFantasyProsNews(item({ position: undefined }))).toBe(false);
  });

  it("is not eligible for a non-fantasy-relevant position (e.g. a lineman)", () => {
    expect(isEligibleFantasyProsNews(item({ position: "OT" }))).toBe(false);
  });

  it("is not eligible with no playerName", () => {
    expect(isEligibleFantasyProsNews(item({ playerName: "" }))).toBe(false);
  });
});

describe("fantasyProsArchiveKey", () => {
  it("is stable for the same item", () => {
    const a = fantasyProsArchiveKey(item());
    const b = fantasyProsArchiveKey(item());
    expect(a).toBe(b);
  });

  it("differs for a genuinely different item", () => {
    const a = fantasyProsArchiveKey(item());
    const b = fantasyProsArchiveKey(item({ id: 2, title: "Different title" }));
    expect(a).not.toBe(b);
  });

  it("falls back to a composite key when id is missing/zero", () => {
    const a = fantasyProsArchiveKey(item({ id: 0 }));
    const b = fantasyProsArchiveKey(item({ id: 0, title: "A different title entirely" }));
    expect(a).not.toBe(b);
  });
});

describe("mergeFantasyProsNews", () => {
  it("dedupes an item present in both current and archived, preferring the current (live) version", () => {
    const live = item({ description: "fresher description from live feed" });
    const archived = item({ description: "older description from archive" });
    const merged = mergeFantasyProsNews([live], [archived]);
    expect(merged).toHaveLength(1);
    expect(merged[0].description).toBe("fresher description from live feed");
  });

  it("keeps archive-only items not present in the current live feed", () => {
    const live = item({ id: 1 });
    const archivedOnly = item({ id: 2, title: "An older story that fell off the live window" });
    const merged = mergeFantasyProsNews([live], [archivedOnly]);
    expect(merged).toHaveLength(2);
  });

  it("sorts merged results newest-first by published date", () => {
    const older = item({ id: 1, published: "2026-09-01T00:00:00.000Z" });
    const newer = item({ id: 2, published: "2026-09-13T00:00:00.000Z" });
    const merged = mergeFantasyProsNews([older], [newer]);
    expect(merged.map(entry => entry.id)).toEqual([2, 1]);
  });
});
