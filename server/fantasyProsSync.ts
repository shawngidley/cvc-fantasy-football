import { supabase, unwrap } from "./supabase";
import type { FantasyProsSnapshot } from "./fantasyProsCache";

type FantasyProsPlayer = {
  player_id?: number | string;
  player_name?: string;
  position_id?: string;
  positions?: string[];
  team_id?: string;
  rank_ecr?: number;
  rank_adp?: number;
  sportsdata_player_id?: string;
};

type CvcPlayer = { id: string; provider: string; external_id: string | null; display_name: string; position: string | null; nfl_team: string | null; metadata: Record<string, unknown> | null };

export type FantasyProsSyncSummary = { source: FantasyProsSnapshot["source"]; fetchedAt: string; totalReceived: number; inserted: number; enriched: number; skipped: number };

const canonical = (value: string | null | undefined) => (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export function normalizeFantasyProsPlayers(payload: unknown) {
  const players = Array.isArray((payload as { players?: unknown[] })?.players) ? (payload as { players: unknown[] }).players : [];
  return players.flatMap(entry => {
    const player = entry as FantasyProsPlayer;
    const externalId = player.player_id ? String(player.player_id) : "";
    const displayName = player.player_name?.trim() ?? "";
    if (!externalId || !displayName) return [];
    return [{
      externalId,
      displayName,
      position: player.position_id ?? player.positions?.[0] ?? null,
      nflTeam: player.team_id?.trim() || null,
      metadata: { fantasypros_id: externalId, sportsdata_player_id: player.sportsdata_player_id ?? null, rank_ecr: player.rank_ecr ?? null, rank_adp: player.rank_adp ?? null },
    }];
  });
}

export async function syncFantasyProsSnapshot(snapshot: FantasyProsSnapshot): Promise<FantasyProsSyncSummary> {
  const normalized = normalizeFantasyProsPlayers(snapshot.payload);
  const existing = unwrap(await supabase.from("player").select("id, provider, external_id, display_name, position, nfl_team, metadata").limit(5000)) as CvcPlayer[];
  const byFantasyProsId = new Map(existing.filter(player => player.provider === "fantasypros" && player.external_id).map(player => [player.external_id!, player]));
  const byNameAndTeam = new Map(existing.map(player => [`${canonical(player.display_name)}|${canonical(player.nfl_team)}`, player]));
  const inserts: { provider: string; external_id: string; display_name: string; position: string | null; nfl_team: string | null; status: string; metadata: Record<string, unknown> }[] = [];
  const enrichments: { id: string; position: string | null; nfl_team: string | null; metadata: Record<string, unknown> }[] = [];
  let skipped = 0;

  for (const player of normalized) {
    const providerRecord = byFantasyProsId.get(player.externalId);
    const matchingCvcRecord = byNameAndTeam.get(`${canonical(player.displayName)}|${canonical(player.nflTeam)}`);
    const target = providerRecord ?? matchingCvcRecord;
    if (target) {
      const priorMetadata = target.metadata ?? {};
      const alreadyCurrent = priorMetadata.fantasypros_id === player.externalId && target.position === player.position && target.nfl_team === player.nflTeam;
      if (alreadyCurrent) { skipped += 1; continue; }
      enrichments.push({ id: target.id, position: player.position ?? target.position, nfl_team: player.nflTeam ?? target.nfl_team, metadata: { ...priorMetadata, ...player.metadata } });
      continue;
    }
    inserts.push({ provider: "fantasypros", external_id: player.externalId, display_name: player.displayName, position: player.position, nfl_team: player.nflTeam, status: "active", metadata: player.metadata });
  }

  for (let index = 0; index < inserts.length; index += 250) {
    unwrap(await supabase.from("player").upsert(inserts.slice(index, index + 250), { onConflict: "provider,external_id" }).select("id"));
  }
  for (const enrichment of enrichments) {
    unwrap(await supabase.from("player").update({ position: enrichment.position, nfl_team: enrichment.nfl_team, metadata: enrichment.metadata, updated_at: new Date().toISOString() }).eq("id", enrichment.id).select("id").single());
  }
  return { source: snapshot.source, fetchedAt: snapshot.fetchedAt, totalReceived: normalized.length, inserted: inserts.length, enriched: enrichments.length, skipped };
}

export type FantasyProsActiveSyncSummary = { countByPosition: Record<string, number>; matchedInDb: number; notYetSynced: number; touched: number; errors: Record<string, string> };

/** Sets player.last_seen_at for players confirmed present in FantasyPros' current
 * ROS rankings (see getFantasyProsActivePlayerIds) -- the actual "still active" signal,
 * unlike the broad /players endpoint. Matches on metadata.fantasypros_id, same as the
 * rookie flag sync, for the same reason (provider/external_id columns are only set for
 * freshly-inserted players, not ones matched by name+team during enrichment). Does NOT
 * touch anyone not in this run: a player who drops off a later ROS ranking simply keeps
 * their old last_seen_at and ages out of the eligibility filter relative to newer ones. */
export async function syncFantasyProsActiveFlags(idsByPosition: Record<string, string[]>, errors: Record<string, string>): Promise<FantasyProsActiveSyncSummary> {
  const activeExternalIds = new Set(Object.values(idsByPosition).flat());
  const countByPosition = Object.fromEntries(Object.entries(idsByPosition).map(([position, ids]) => [position, ids.length]));
  const existing = unwrap(await supabase.from("player").select("id, metadata").limit(5000)) as { id: string; metadata: Record<string, unknown> | null }[];
  const matchedIds = existing.filter(player => player.metadata?.fantasypros_id && activeExternalIds.has(String(player.metadata.fantasypros_id))).map(player => player.id);
  const matchedExternalIds = new Set(existing.filter(player => player.metadata?.fantasypros_id && activeExternalIds.has(String(player.metadata.fantasypros_id))).map(player => String(player.metadata!.fantasypros_id)));
  const now = new Date().toISOString();
  for (let index = 0; index < matchedIds.length; index += 500) {
    unwrap(await supabase.from("player").update({ last_seen_at: now }).in("id", matchedIds.slice(index, index + 500)).select("id"));
  }
  return { countByPosition, matchedInDb: matchedIds.length, notYetSynced: activeExternalIds.size - matchedExternalIds.size, touched: matchedIds.length, errors };
}

export type FantasyProsRookieSyncSummary = { countByPosition: Record<string, number>; matchedInDb: number; notYetSynced: number; flaggedNow: number; clearedStale: number; errors: Record<string, string> };

/** Applies FantasyPros' rookie-rankings result (see getFantasyProsRookiePlayerIds) to
 * player.metadata.is_rookie. Matches by fantasypros_id already stored from the regular
 * player sync -- run syncFantasyProsSnapshot first if players haven't been synced yet,
 * or a rookie with no CVC player record yet simply won't have anything to match against
 * (counted as notYetSynced below, not silently dropped). */
export async function syncFantasyProsRookieFlags(idsByPosition: Record<string, string[]>, errors: Record<string, string>): Promise<FantasyProsRookieSyncSummary> {
  const rookieExternalIds = new Set(Object.values(idsByPosition).flat());
  const countByPosition = Object.fromEntries(Object.entries(idsByPosition).map(([position, ids]) => [position, ids.length]));
  // Match on metadata.fantasypros_id, not the external_id/provider columns: those are
  // only set for players FRESHLY INSERTED by this sync. A player who already existed
  // (e.g. from the original CSV import) and got matched by name+team instead only ever
  // has metadata enriched with fantasypros_id -- their provider/external_id columns
  // stay whatever they originally were. Filtering by provider='fantasypros' missed
  // exactly that majority case (confirmed: only 50 of 744 matched on the first run).
  const existing = unwrap(await supabase.from("player").select("id, metadata").limit(5000)) as { id: string; metadata: Record<string, unknown> | null }[];
  const existingByFantasyProsId = new Map(existing.filter(player => player.metadata?.fantasypros_id).map(player => [String(player.metadata!.fantasypros_id), player]));
  const matchedInDb = Array.from(rookieExternalIds).filter(id => existingByFantasyProsId.has(id)).length;
  let flaggedNow = 0; let clearedStale = 0;
  for (const player of existing) {
    const fantasyProsId = player.metadata?.fantasypros_id ? String(player.metadata.fantasypros_id) : null;
    const isRookieNow = Boolean(fantasyProsId && rookieExternalIds.has(fantasyProsId));
    const wasRookie = Boolean((player.metadata as { is_rookie?: boolean } | null)?.is_rookie);
    if (isRookieNow === wasRookie) continue;
    unwrap(await supabase.from("player").update({ metadata: { ...(player.metadata ?? {}), is_rookie: isRookieNow }, updated_at: new Date().toISOString() }).eq("id", player.id).select("id").single());
    if (isRookieNow) flaggedNow += 1; else clearedStale += 1;
  }
  return { countByPosition, matchedInDb, notYetSynced: rookieExternalIds.size - matchedInDb, flaggedNow, clearedStale, errors };
}
