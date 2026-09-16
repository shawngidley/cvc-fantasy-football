import { getCvcPlayerCareerStats, toCvcSeasonStatsShape } from "./playerCareerStats";
import { getNFLDataAdapter, Tank01NFLDataAdapter } from "./nflDataAdapter";
import { supabase, unwrap } from "./supabase";

// DST is deliberately excluded: ESPN's athlete gamelog endpoint (what
// getCvcPlayerCareerStats reads) is for individual players, not team defenses -- a CVC
// "DST" player row represents a whole NFL team, which has no individual ESPN athlete
// ID to look up at all. This is a pre-existing gap (the Player Profile page's own
// historical stats tab has the same limitation), not something new here.
const ELIGIBLE_POSITIONS = ["QB", "RB", "WR", "TE", "K"];
const CONCURRENCY = 5;

type CvcPlayer = { id: string; display_name: string; position: string | null; metadata: Record<string, unknown> | null };

function extractEspnId(row: Record<string, unknown>): string | null {
  const raw = row.espnID ?? row.espnId;
  return raw !== undefined && raw !== null ? String(raw) : null;
}

export type HistoricalBackfillSummary = { status: "completed" | "in_progress"; attempted: number; updated: number; notFound: number; remaining: number };

/**
 * One-time-per-year backfill of cvc_season_stats_historical: for each eligible CVC
 * player, resolves their ESPN athlete ID via Tank01 (same lookup tank01SeasonStatsSync
 * already does for current-season stats -- prefers an exact ID lookup when a Tank01 ID
 * is already confirmed, falls back to a name search) and fetches that specific year's
 * stats from ESPN's gamelog. A past season's real stats never change once the season
 * is over, so once a player has a row for a given year, they're never re-attempted for
 * that same year -- unlike the current-season sync, there's no staleness concept here
 * at all. Batched the same way as the existing season-stats sync (limit players per
 * call), since this is commissioner-triggered from the same kind of "click until done"
 * button, not a scheduled job.
 */
export async function backfillHistoricalSeasonStats(year: number, limit = 40): Promise<HistoricalBackfillSummary> {
  const adapter = getNFLDataAdapter();
  if (!(adapter instanceof Tank01NFLDataAdapter)) throw new Error("Tank01 is not configured for the historical stats backfill.");

  const players = unwrap(await supabase.from("player").select("id, display_name, position, metadata").neq("provider", "placeholder").in("position", ELIGIBLE_POSITIONS).order("display_name")) as CvcPlayer[] ?? [];
  if (!players.length) return { status: "completed", attempted: 0, updated: 0, notFound: 0, remaining: 0 };

  const existing = unwrap(await supabase.from("cvc_season_stats_historical").select("player_id").eq("year", year)) ?? [];
  const alreadyBackfilled = new Set(existing.map(row => row.player_id));
  const pending = players.filter(player => !alreadyBackfilled.has(player.id));
  const batch = pending.slice(0, limit);

  const currentSeason = unwrap(await supabase.from("season").select("id").eq("is_current", true).limit(1).maybeSingle()) ?? unwrap(await supabase.from("season").select("id").order("year", { ascending: false }).limit(1).maybeSingle());
  const rules = currentSeason ? unwrap(await supabase.from("scoring_rule").select("stat_key, value, applies_to_positions").eq("season_id", currentSeason.id)) ?? [] : [];

  let updated = 0;
  let notFound = 0;
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const chunk = batch.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async player => {
      try {
        const tank01Id = player.metadata?.tank01_id ? String(player.metadata.tank01_id) : null;
        const byId = tank01Id ? await adapter.getPlayerInfoById(tank01Id).catch(() => null) : null;
        const infoRow = (byId ?? await adapter.getPlayerInfo(player.display_name).catch(() => null)) as Record<string, unknown> | null;
        const espnId = infoRow ? extractEspnId(infoRow) : null;
        if (!espnId) { notFound += 1; return; }
        const seasons = await getCvcPlayerCareerStats(espnId, player.position ?? "", rules, year, 1);
        const row = seasons.find(candidate => candidate.season === year);
        if (!row) { notFound += 1; return; }
        unwrap(await supabase.from("cvc_season_stats_historical").upsert({
          year, player_id: player.id,
          ...toCvcSeasonStatsShape(row),
          backfilled_at: new Date().toISOString(),
        }, { onConflict: "year,player_id" }).select("id").single());
        updated += 1;
      } catch {
        notFound += 1;
      }
    }));
  }

  return { status: pending.length > batch.length ? "in_progress" : "completed", attempted: batch.length, updated, notFound, remaining: pending.length - batch.length };
}
