import { useEffect, useRef, useState } from "react";

export interface NflGameStatus {
  state: "pre" | "in" | "post";
  shortDetail: string; // e.g. "9/13 - 1:00 PM EDT", "8:32 - 3rd Quarter", "Final"
  period: number;
  displayClock: string;
}
export type NflGameStatusMap = Record<string, NflGameStatus>;

/** Minutes remaining in a single game's clock. Regulation is 4 quarters of 15 minutes
 * (60 total): pre-game the full 60 is still "remaining", post-game none is, and live
 * it's whatever's left in the current quarter plus any full quarters still ahead.
 * Overtime (period >= 5) doesn't have a fixed, known-in-advance length, so this treats
 * it as "whatever's showing on the OT clock right now." Ported directly from WRC's
 * proven minutesRemainingInGame. */
export function minutesRemainingInGame(status: NflGameStatus | undefined): number {
  if (!status) return 60; // no status yet (e.g. bye week or not fetched) -- treat as not-yet-started
  if (status.state === "post") return 0;
  if (status.state === "pre") return 60;

  const [minStr, secStr] = status.displayClock.split(":");
  const clockMinutes = (Number(minStr) || 0) + (Number(secStr) || 0) / 60;

  if (status.period >= 5) return clockMinutes; // overtime -- no fixed regulation length to add on top of
  const fullQuartersRemaining = Math.max(0, 4 - status.period);
  return fullQuartersRemaining * 15 + clockMinutes;
}

const POLL_INTERVAL_MS = 30_000;
const TEAM_CODE_ALIASES: Record<string, string> = { KAN: "KC", TAM: "TB", ARZ: "ARI", AZ: "ARI", JAX: "JAC", WAS: "WSH", WSN: "WSH", OAK: "LV", LA: "LAR" };
function normalizeAbv(abv: string): string {
  return TEAM_CODE_ALIASES[abv?.toUpperCase()] ?? abv?.toUpperCase();
}

/** Same approach as WRC's useNFLGameStatus: derives the set of game dates for the week
 * directly from the already-fetched Tank01 matchup map (via each entry's gameDate)
 * rather than guessing a date range, then polls ESPN's scoreboard for each of those
 * dates for live per-team status. */
export function useCvcNFLGameStatus(gameDates: string[]): { gameStatus: NflGameStatusMap; loading: boolean } {
  const [gameStatus, setGameStatus] = useState<NflGameStatusMap>({});
  const [loading, setLoading] = useState(true);
  const latestStatusRef = useRef<NflGameStatusMap>({});
  const gameDatesKey = Array.from(new Set(gameDates.filter(Boolean))).sort().join(",");

  useEffect(() => {
    const dates = gameDatesKey ? gameDatesKey.split(",") : [];
    if (!dates.length) { setLoading(false); return; }

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    async function fetchStatus() {
      try {
        const map: NflGameStatusMap = {};
        await Promise.all(dates.map(async date => {
          const res = await fetch(`/api/espn/scoreboard?dates=${date}`);
          if (!res.ok) return;
          const data = await res.json() as {
            events?: Array<{
              competitions?: Array<{
                competitors?: Array<{ team?: { abbreviation?: string } }>;
                status?: { type?: { state?: string; shortDetail?: string }; period?: number; displayClock?: string };
              }>;
            }>;
          };
          for (const event of data.events ?? []) {
            const competition = event.competitions?.[0];
            const status = competition?.status;
            if (!status?.type?.state) continue;
            for (const competitor of competition?.competitors ?? []) {
              const abv = normalizeAbv(competitor.team?.abbreviation ?? "");
              if (!abv) continue;
              map[abv] = { state: status.type.state as "pre" | "in" | "post", shortDetail: status.type.shortDetail ?? "", period: status.period ?? 0, displayClock: status.displayClock ?? "" };
            }
          }
        }));
        if (!cancelled) { latestStatusRef.current = map; setGameStatus(map); setLoading(false); }
      } catch { if (!cancelled) setLoading(false); }
    }

    fetchStatus();
    intervalId = setInterval(() => {
      const current = latestStatusRef.current;
      const stillActive = Object.keys(current).length === 0 || Object.values(current).some(g => g.state !== "post");
      if (stillActive) fetchStatus();
      else if (intervalId) clearInterval(intervalId);
    }, POLL_INTERVAL_MS);

    return () => { cancelled = true; if (intervalId) clearInterval(intervalId); };
  }, [gameDatesKey]);

  return { gameStatus, loading };
}
