/**
 * CVC trade deadline (commissioner call, Nov 2026): Wednesday, November 25, 2026 at
 * 10:00 PM ET. A trade must be ACCEPTED by then. Proposals and acceptances after
 * this instant are refused server-side; the homepage and Trade desk count down to it.
 *
 * Stored as the exact UTC instant so there is no timezone arithmetic anywhere else:
 * 10:00 PM Eastern on Nov 25 is Eastern Standard Time (UTC-5), i.e. 03:00 UTC Nov 26.
 * To move the deadline for a future season, change this one line.
 */
export const TRADE_DEADLINE_UTC = "2026-11-26T03:00:00.000Z";
export const TRADE_DEADLINE = new Date(TRADE_DEADLINE_UTC);

/** How long the "deadline has passed" notice stays on the homepage before it goes away. */
const PASSED_NOTICE_DAYS = 7;

export function tradeDeadlinePassed(now: Date = new Date()): boolean {
  return now.getTime() >= TRADE_DEADLINE.getTime();
}

/** "Wed, Nov 25, 10:00 PM ET" */
export function formatTradeDeadline(): string {
  const text = TRADE_DEADLINE.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  return `${text} ET`;
}

export type TradeDeadlineCountdown = { msLeft: number; days: number; hours: number; minutes: number; seconds: number; passed: boolean };

export function tradeDeadlineCountdown(now: Date = new Date()): TradeDeadlineCountdown {
  const msLeft = Math.max(0, TRADE_DEADLINE.getTime() - now.getTime());
  const totalSeconds = Math.floor(msLeft / 1000);
  return {
    msLeft,
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3_600),
    minutes: Math.floor((totalSeconds % 3_600) / 60),
    seconds: totalSeconds % 60,
    passed: msLeft === 0,
  };
}

/** Whether the homepage should show anything about the deadline right now: the
 * countdown while it's ahead, a short "passed" notice for a week after, nothing later. */
export function shouldShowTradeDeadlineBanner(now: Date = new Date()): boolean {
  return now.getTime() < TRADE_DEADLINE.getTime() + PASSED_NOTICE_DAYS * 86_400_000;
}

export const TRADE_DEADLINE_PASSED_MESSAGE = `The CVC trade deadline (${formatTradeDeadline()}) has passed. Trades can no longer be proposed or accepted this season.`;
