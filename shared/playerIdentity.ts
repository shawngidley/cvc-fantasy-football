import { normalizePlayerName } from "./playerNameMatch";

export type PlayerIdentityInput = { display_name: string; position?: string | null; nfl_team?: string | null };

const TEAM_ALIASES: Record<string, string> = { kan: "kc", tam: "tb", arz: "ari", jax: "jac", was: "wsh", lvr: "lv" };
const normTeam = (v?: string | null) => (v ? (TEAM_ALIASES[v.toLowerCase()] ?? v.toLowerCase()) : "");
const normPos = (v?: string | null) => {
  const p = (v ?? "").toUpperCase();
  return p === "DEF" || p === "DE" || p === "D/ST" ? "DST" : p === "KI" || p === "PK" ? "K" : p;
};

/**
 * One key per real person or team defense, however many `player` rows exist for them.
 * CVC has two rows for the same Chiefs defense (cvc_workbook_2026 and fantasypros), so a team
 * defense is keyed by NFL team; everyone else by normalized name plus position.
 */
export function playerIdentityKey(player: PlayerIdentityInput): string {
  const position = normPos(player.position);
  if (position === "DST" && player.nfl_team) return `dst:${normTeam(player.nfl_team)}`;
  return `${normalizePlayerName(player.display_name)}|${position}`;
}
