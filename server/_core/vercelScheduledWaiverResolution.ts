import { runWaiverResolution } from "./scheduledHandlers";

// Same reasoning as vercelScheduledTank01.ts / vercelScheduledNflTeams.ts -- a
// standalone literal file so this cron path resolves to a real deployed function
// rather than depending on the generic Express rewrite. Bundled to
// api/scheduled/waiver-resolution.js. Runs every 15 minutes (see vercel.json); the
// actual Thursday/Sunday 9am Eastern deadline is enforced inside
// resolveOpenWaiverPeriod itself, not by the cron schedule (Vercel cron is UTC-only and
// can't natively express a DST-aware "9am Eastern" year-round).
export default async function handler(req: any, res: any) {
  return runWaiverResolution(req, res);
}
