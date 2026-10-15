/** CVC roster limits: $115 salary cap and at most 22 players. */
export const SALARY_CAP = 115;
export const MAX_ROSTER_PLAYERS = 22;

export type RosterWarning = { kind: "salary" | "roster"; message: string };
export type RosterComplianceInput = { contract?: { salary?: number | string | null } | null };

const money = (value: number) => `$${Number.isInteger(value) ? value : value.toFixed(2)}`;

/** Adds up contract salaries the same way the Rosters page does, then checks both limits. */
export function getRosterCompliance(players: RosterComplianceInput[] | null | undefined) {
  const list = players ?? [];
  const playerCount = list.length;
  const totalSalary = Math.round(list.reduce((sum, item) => sum + (item.contract?.salary != null ? Number(item.contract.salary) || 0 : 0), 0) * 100) / 100;
  const overCapBy = Math.max(0, Math.round((totalSalary - SALARY_CAP) * 100) / 100);
  const overRosterBy = Math.max(0, playerCount - MAX_ROSTER_PLAYERS);
  const warnings: RosterWarning[] = [];
  if (overCapBy > 0) warnings.push({ kind: "salary", message: `Over the $${SALARY_CAP} salary cap: ${money(totalSalary)} on the roster, ${money(overCapBy)} over.` });
  if (overRosterBy > 0) warnings.push({ kind: "roster", message: `Over the ${MAX_ROSTER_PLAYERS} player limit: ${playerCount} players, ${overRosterBy} too many.` });
  return { playerCount, totalSalary, overCapBy, overRosterBy, warnings };
}
