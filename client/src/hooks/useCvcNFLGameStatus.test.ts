import { describe, expect, it } from "vitest";
import { minutesRemainingInGame, type NflGameStatus } from "./useCvcNFLGameStatus";

describe("minutesRemainingInGame", () => {
  it("returns the full 60 minutes for a game that hasn't started", () => {
    const status: NflGameStatus = { state: "pre", shortDetail: "9/13 - 1:00 PM EDT", period: 0, displayClock: "0:00" };
    expect(minutesRemainingInGame(status)).toBe(60);
  });

  it("returns the full 60 minutes when no status is available at all", () => {
    expect(minutesRemainingInGame(undefined)).toBe(60);
  });

  it("returns 0 for a finished game", () => {
    const status: NflGameStatus = { state: "post", shortDetail: "Final", period: 4, displayClock: "0:00" };
    expect(minutesRemainingInGame(status)).toBe(0);
  });

  it("computes remaining time correctly early in the 1st quarter", () => {
    const status: NflGameStatus = { state: "in", shortDetail: "12:00 - 1st Quarter", period: 1, displayClock: "12:00" };
    expect(minutesRemainingInGame(status)).toBe(57);
  });

  it("computes remaining time correctly midway through the 3rd quarter", () => {
    const status: NflGameStatus = { state: "in", shortDetail: "8:32 - 3rd Quarter", period: 3, displayClock: "8:32" };
    expect(minutesRemainingInGame(status)).toBeCloseTo(23.53, 1);
  });

  it("computes remaining time correctly late in the 4th quarter", () => {
    const status: NflGameStatus = { state: "in", shortDetail: "2:00 - 4th Quarter", period: 4, displayClock: "2:00" };
    expect(minutesRemainingInGame(status)).toBe(2);
  });

  it("treats overtime as just the current OT clock, with no fixed regulation time added on top", () => {
    const status: NflGameStatus = { state: "in", shortDetail: "7:15 - OT", period: 5, displayClock: "7:15" };
    expect(minutesRemainingInGame(status)).toBeCloseTo(7.25, 2);
  });
});
