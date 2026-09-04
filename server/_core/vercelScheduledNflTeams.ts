import { runNflTeamAssignmentSync } from "./scheduledHandlers";

// Same reasoning as vercelScheduledTank01.ts -- a standalone literal file so this cron
// path resolves to a real deployed function rather than depending on the generic
// Express rewrite. Bundled to api/scheduled/nfl-team-assignment-sync.js.
export default async function handler(req: any, res: any) {
  return runNflTeamAssignmentSync(req, res);
}
