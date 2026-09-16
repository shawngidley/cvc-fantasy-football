import { runSeasonStatsCurrentRebuild } from "./scheduledHandlers";

// Same reasoning as vercelScheduledTank01.ts -- a standalone literal file so this cron
// path resolves to a real deployed function rather than depending on the generic
// Express rewrite. Bundled to api/scheduled/season-stats-current-rebuild.js.
export default async function handler(req: any, res: any) {
  return runSeasonStatsCurrentRebuild(req, res);
}
