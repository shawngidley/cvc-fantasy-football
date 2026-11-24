import { describe, expect, it } from "vitest";
import { TRADE_DEADLINE, formatTradeDeadline, shouldShowTradeDeadlineBanner, tradeDeadlineCountdown, tradeDeadlinePassed } from "./tradeDeadline";

describe("CVC trade deadline: Wednesday Nov 25, 2026, 10:00 PM ET", () => {
  it("is stored as the right instant: 10:00 PM Eastern (EST, UTC-5) on Nov 25", () => {
    expect(TRADE_DEADLINE.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }))
      .toBe("Wednesday, November 25, 2026 at 10:00 PM");
    expect(formatTradeDeadline()).toBe("Wed, Nov 25, 10:00 PM ET");
  });

  it("is open right up to the instant and closed from the instant on", () => {
    expect(tradeDeadlinePassed(new Date("2026-11-26T02:59:59.999Z"))).toBe(false);
    expect(tradeDeadlinePassed(new Date("2026-11-26T03:00:00.000Z"))).toBe(true);
    expect(tradeDeadlinePassed(new Date("2026-11-24T13:40:00Z"))).toBe(false); // Tue 8:40am ET, when it was set
  });

  it("counts down in days, hours, minutes, seconds and reports zero once passed", () => {
    const countdown = tradeDeadlineCountdown(new Date("2026-11-24T13:40:00Z")); // 1 day, 13 h, 20 min ahead
    expect(countdown).toMatchObject({ days: 1, hours: 13, minutes: 20, seconds: 0, passed: false });
    expect(tradeDeadlineCountdown(new Date("2026-11-26T02:59:30Z"))).toMatchObject({ days: 0, hours: 0, minutes: 0, seconds: 30, passed: false });
    expect(tradeDeadlineCountdown(new Date("2026-12-01T00:00:00Z"))).toMatchObject({ msLeft: 0, days: 0, hours: 0, minutes: 0, seconds: 0, passed: true });
  });

  it("shows the banner before the deadline and for a week after, then hides it", () => {
    expect(shouldShowTradeDeadlineBanner(new Date("2026-11-24T13:40:00Z"))).toBe(true);
    expect(shouldShowTradeDeadlineBanner(new Date("2026-11-28T03:00:00Z"))).toBe(true);
    expect(shouldShowTradeDeadlineBanner(new Date("2026-12-04T00:00:00Z"))).toBe(false);
  });
});
