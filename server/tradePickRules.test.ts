import { describe, expect, it } from "vitest";
import { checkTradePick } from "./tradePickRules";

describe("checkTradePick", () => {
  it("allows next year's pick when Supabase returns single objects (the real shape)", () => {
    expect(checkTradePick({ draft: { status: "scheduled", season: { year: 2027 } } }, 2026)).toBeNull();
  });
  it("allows next year's pick when the relations come back as arrays", () => {
    expect(checkTradePick({ draft: [{ status: "scheduled", season: [{ year: 2027 }] }] }, 2026)).toBeNull();
  });
  it("allows this year's pick until its draft completes", () => {
    expect(checkTradePick({ draft: { status: "scheduled", season: { year: 2026 } } }, 2026)).toBeNull();
    expect(checkTradePick({ draft: { status: "complete", season: { year: 2026 } } }, 2026)).toMatch(/already been completed/);
  });
  it("refuses picks two or more years out and picks with no year", () => {
    expect(checkTradePick({ draft: { status: "scheduled", season: { year: 2028 } } }, 2026)).toMatch(/Only 2026 and 2027/);
    expect(checkTradePick({ draft: null }, 2026)).toMatch(/Only 2026 and 2027/);
  });
});
