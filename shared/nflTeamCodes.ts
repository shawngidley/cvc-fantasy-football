/**
 * Canonical NFL team code normalization for CVC. Different data providers use
 * different abbreviation conventions for the same team; this maps every
 * known variant to CVC's canonical code so a mismatch (e.g. nflverse's
 * roster CSV using "JAX" and "LA" while CVC's player table uses "JAC" and
 * "LAR") never causes a wrong or missing bye week, team logo, or roster
 * match.
 *
 * CVC's canonical choices (confirmed against the actual player table and
 * matching WRC's own convention): JAC (not JAX), WSH (not WAS), LAR (not LA).
 */
const TEAM_CODE_ALIASES: Record<string, string> = {
  JAX: "JAC",
  KAN: "KC",
  TAM: "TB",
  ARZ: "ARI",
  WAS: "WSH",
  WSN: "WSH",
  OAK: "LV",
  LA: "LAR", // nflverse's roster CSV uses "LA" for the Rams; unambiguous since
             // the Chargers are always "LAC" there, never "LA".
};

export function normalizeNFLTeamCode(team: string | null | undefined): string {
  const code = (team ?? "").trim().toUpperCase();
  return TEAM_CODE_ALIASES[code] ?? code;
}
