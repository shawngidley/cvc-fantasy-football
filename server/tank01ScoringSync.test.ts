import { correctionWindowClosed } from "./tank01ScoringSync";
import { describe, expect, it } from "vitest";

describe("CVC Tank01 finalizer correction window", () => {
  it("keeps provider results provisional before Friday 16:00 UTC", () => {
    expect(correctionWindowClosed(new Date("2026-08-21T15:59:59.000Z"))).toBe(false);
  });

  it("finalizes only when the Friday 16:00 UTC correction window has closed", () => {
    expect(correctionWindowClosed(new Date("2026-08-21T16:00:00.000Z"))).toBe(true);
  });

  it("does not finalize automatically on other weekdays", () => {
    expect(correctionWindowClosed(new Date("2026-08-22T18:00:00.000Z"))).toBe(false);
  });
});
