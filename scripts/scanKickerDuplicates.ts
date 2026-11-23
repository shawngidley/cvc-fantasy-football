/**
 * Read-only audit: which finalized weeks this season were scored with a kicker's
 * second identical field goal dropped (the ESPN text-dedupe bug fixed in
 * shared/espnKickerEvents.ts), who started that kicker, and whether fixing it
 * would flip any head-to-head result or weekly skin.
 *
 * It changes nothing. It never writes to Supabase.
 *
 * Run from the repo root with the same env the server uses (SUPABASE_URL,
 * SUPABASE_SECRET_KEY) and a network that can reach site.api.espn.com:
 *
 *   pnpm tsx scripts/scanKickerDuplicates.ts
 *
 * Optional: pass week numbers to limit the scan, e.g.
 *
 *   pnpm tsx scripts/scanKickerDuplicates.ts 3 5 9
 */
import { supabase, unwrap } from "../server/supabase";
import { applyKickerEventsToKicking, getKickerEventsForPlayer, parseEspnKickerEvents, type KickerPlayEvent } from "../shared/espnKickerEvents";
import { calculateCvcFantasyPoints, type CvcScoringRule } from "../shared/cvcScoring";
import { normalizeTeam } from "../server/cvcScoringShared";
import { SKIN_THRESHOLD } from "../server/cvcSkins";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";

/** The parser exactly as it was before the fix: dedupe keyed on the play text, which
 * is what collapsed two same-distance kicks into one. Kept here, not imported, so this
 * script keeps telling the truth about the old behavior even after the shared module
 * moves on. */
function parseEspnKickerEventsOLD(summary: unknown): KickerPlayEvent[] {
  const root = summary as { drives?: { previous?: Array<{ plays?: { text?: string; type?: { text?: string } }[] }> }; plays?: { text?: string; type?: { text?: string } }[] };
  const plays = [...(root.plays ?? []), ...((root.drives?.previous ?? []).flatMap(drive => drive.plays ?? []))];
  const seen = new Set<string>();
  const events: KickerPlayEvent[] = [];
  const name = (raw: string) => raw.trim().replace(/\./g, ". ").replace(/\s+/g, " ");
  for (const play of plays) {
    const text = play.text?.trim() ?? "";
    const type = play.type?.text?.toLowerCase() ?? "";
    const fg = text.match(/^(.+?)\s+(\d+)\s+yard field goal is\s+(good|no good|missed)/i);
    if (fg && (type.includes("field goal") || /field goal/i.test(text))) {
      const event: KickerPlayEvent = { playerName: name(fg[1]), type: "fg", outcome: fg[3].toLowerCase() === "good" ? "made" : "missed", yards: Number(fg[2]), text };
      const key = `${event.playerName}|${event.type}|${event.outcome}|${event.yards}|${text}`;
      if (!seen.has(key)) { seen.add(key); events.push(event); }
      continue;
    }
    const xp = text.match(/^(.+?)\s+(?:extra point|pat)\s+is\s+(good|no good|missed)/i);
    if (xp && (type.includes("extra point") || /extra point|\bpat\b/i.test(text))) {
      const event: KickerPlayEvent = { playerName: name(xp[1]), type: "xp", outcome: xp[2].toLowerCase() === "good" ? "made" : "missed", yards: null, text };
      const key = `${event.playerName}|${event.type}|${event.outcome}|${text}`;
      if (!seen.has(key)) { seen.add(key); events.push(event); }
    }
  }
  return events;
}

type Starter = { franchiseId: string; franchiseName: string; playerId: string; name: string; team: string };
type Diff = { week: number; kicker: string; team: string; owner: string; franchiseId: string; oldPts: number; newPts: number; delta: number; oldKicks: string; newKicks: string };

async function espnJson(url: string): Promise<any | null> {
  try {
    const response = await fetch(url);
    return response.ok ? response.json() : null;
  } catch (error) {
    console.warn(`ESPN fetch failed (${url}): ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function madeFgList(events: KickerPlayEvent[]): string {
  return events.filter(e => e.type === "fg" && e.outcome === "made").map(e => e.yards).join(", ") || "none";
}

async function main() {
  const onlyWeeks = new Set(process.argv.slice(2).map(Number).filter(Number.isFinite));
  // Pick the season the way the app does (getCurrentLeagueAndSeason in
  // server/routers/league.ts): the row flagged is_current. Highest `year` is WRONG --
  // a future season row exists to hold next year's tradeable rookie picks (2027 at the
  // time of writing) and it has no weeks, no rosters and no snapshots, so ordering by
  // year silently scanned an empty season and reported that nothing was affected.
  const league = unwrap(await supabase.from("league").select("id").eq("slug", "cvc-auction-football").single());
  if (!league) throw new Error("CVC league not found.");
  const season = unwrap(await supabase.from("season").select("id, year").eq("league_id", league.id).eq("is_current", true).limit(1).maybeSingle())
    ?? unwrap(await supabase.from("season").select("id, year").eq("league_id", league.id).order("year", { ascending: false }).limit(1).maybeSingle());
  if (!season) throw new Error("No season found.");
  console.log(`Scanning CVC season ${season.year} (${season.id})`);
  const rules = (unwrap(await supabase.from("scoring_rule").select("stat_key, value, applies_to_positions").eq("season_id", season.id)) ?? []) as CvcScoringRule[];
  const weeks = (unwrap(await supabase.from("schedule_week").select("id, week_number, label").eq("season_id", season.id).eq("status", "final").order("week_number")) ?? []).filter(w => !onlyWeeks.size || onlyWeeks.has(w.week_number));
  const lastWeekNumber = Math.max(...((unwrap(await supabase.from("schedule_week").select("week_number").eq("season_id", season.id)) ?? []).map(w => w.week_number)));

  const diffs: Diff[] = [];
  const flips: string[] = [];

  for (const week of weeks) {
    const snapshots = unwrap(await supabase.from("weekly_lineup_snapshot").select("franchise_id, slot_code, franchise:franchise_id(name), player:player_id(id, display_name, position, nfl_team)").eq("schedule_week_id", week.id)) ?? [];
    const starters: Starter[] = [];
    for (const row of snapshots as any[]) {
      const player = Array.isArray(row.player) ? row.player[0] : row.player;
      const franchise = Array.isArray(row.franchise) ? row.franchise[0] : row.franchise;
      if (!player || player.position !== "K" || String(row.slot_code ?? "").toUpperCase() === "BENCH") continue;
      starters.push({ franchiseId: row.franchise_id, franchiseName: franchise?.name ?? row.franchise_id, playerId: player.id, name: player.display_name, team: normalizeTeam(player.nfl_team ?? "") });
    }
    if (!starters.length) { console.log(`${week.label}: no kickers started`); continue; }

    const scoreboard = await espnJson(`${ESPN}/scoreboard?dates=${season.year}&seasontype=2&week=${week.week_number}`);
    const games: { id: string; teams: string[] }[] = (scoreboard?.events ?? []).map((event: any) => ({
      id: String(event.id),
      teams: (event.competitions?.[0]?.competitors ?? []).map((c: any) => normalizeTeam(c.team?.abbreviation ?? "")),
    }));

    // Only fetch the games a started kicker actually played in.
    const neededTeams = new Set(starters.map(s => s.team));
    const oldEvents: KickerPlayEvent[] = [];
    const newEvents: KickerPlayEvent[] = [];
    for (const game of games.filter(g => g.teams.some(t => neededTeams.has(t)))) {
      const summary = await espnJson(`${ESPN}/summary?event=${game.id}`);
      if (!summary) { console.warn(`${week.label}: ESPN summary ${game.id} unavailable`); continue; }
      oldEvents.push(...parseEspnKickerEventsOLD(summary));
      newEvents.push(...parseEspnKickerEvents(summary));
    }

    // Per-franchise score deltas this week, so the flip check below can use them.
    const deltaByFranchise = new Map<string, number>();
    for (const starter of starters) {
      // Tank01's own fgMade/xpMade aren't stored per week in a reusable form; what
      // matters for the delta is fgYds, which both parsers produce from the same ESPN
      // payload. xpMade is held constant (the fix does not touch extra points).
      const stored = unwrap(await supabase.from("cvc_player_weekly_stat").select("fg_made, xp_made").eq("schedule_week_id", week.id).eq("player_id", starter.playerId).maybeSingle());
      const base = { fgMade: Number(stored?.fg_made ?? 0), xpMade: Number(stored?.xp_made ?? 0) };
      const oldMine = getKickerEventsForPlayer(oldEvents, starter.name);
      const newMine = getKickerEventsForPlayer(newEvents, starter.name);
      const oldPts = calculateCvcFantasyPoints({ Kicking: applyKickerEventsToKicking(base, oldMine) } as any, "K", rules);
      const newPts = calculateCvcFantasyPoints({ Kicking: applyKickerEventsToKicking(base, newMine) } as any, "K", rules);
      const delta = Math.round((newPts - oldPts) * 100) / 100;
      if (delta !== 0) {
        diffs.push({ week: week.week_number, kicker: starter.name, team: starter.team, owner: starter.franchiseName, franchiseId: starter.franchiseId, oldPts, newPts, delta, oldKicks: madeFgList(oldMine), newKicks: madeFgList(newMine) });
        deltaByFranchise.set(starter.franchiseId, (deltaByFranchise.get(starter.franchiseId) ?? 0) + delta);
      }
    }
    if (!deltaByFranchise.size) continue;

    // Head-to-head flips.
    const matchups = unwrap(await supabase.from("matchup").select("home_franchise_id, away_franchise_id, home_score, away_score, home:home_franchise_id(name), away:away_franchise_id(name)").eq("schedule_week_id", week.id)) ?? [];
    const scoreNow = new Map<string, number>();
    for (const m of matchups as any[]) {
      const home = Number(m.home_score ?? 0), away = Number(m.away_score ?? 0);
      const homeNew = home + (deltaByFranchise.get(m.home_franchise_id) ?? 0);
      const awayNew = away + (deltaByFranchise.get(m.away_franchise_id) ?? 0);
      scoreNow.set(m.home_franchise_id, homeNew); scoreNow.set(m.away_franchise_id, awayNew);
      const sign = (a: number, b: number) => Math.sign(Math.round((a - b) * 100));
      if (sign(home, away) !== sign(homeNew, awayNew)) {
        const n = (x: any) => (Array.isArray(x) ? x[0] : x)?.name;
        flips.push(`${week.label} HEAD-TO-HEAD FLIPS: ${n(m.home)} ${home.toFixed(2)} vs ${n(m.away)} ${away.toFixed(2)} becomes ${homeNew.toFixed(2)} vs ${awayNew.toFixed(2)}`);
      }
    }

    // Skin flips (CVC has no median result; the weekly skin is the other thing a
    // score change can move). Mirrors decideSkinOutcome's rule, minus last-week ties.
    const skin = unwrap(await supabase.from("cvc_skin").select("status, winner_franchise_id").eq("season_id", season.id).eq("week_number", week.week_number).maybeSingle());
    if (skin) {
      const scores = Array.from(scoreNow.entries());
      const max = Math.max(...scores.map(([, s]) => s));
      const top = scores.filter(([, s]) => s === max).map(([id]) => id);
      const isLast = week.week_number === lastWeekNumber;
      const newStatus = top.length === 1 && (isLast || max >= SKIN_THRESHOLD) ? "won" : "pushed";
      const newWinner = newStatus === "won" ? top[0] : null;
      if (newStatus !== skin.status || newWinner !== (skin.winner_franchise_id ?? null)) {
        flips.push(`${week.label} SKIN CHANGES: was ${skin.status}${skin.winner_franchise_id ? ` (winner ${skin.winner_franchise_id})` : ""}, would be ${newStatus}${newWinner ? ` (winner ${newWinner})` : ""}`);
      }
    }
  }

  console.log("\n=== Kickers whose points change under the fixed parser ===");
  if (!diffs.length) console.log("None. Every finalized week scores identically.");
  for (const d of diffs) {
    console.log(`Week ${d.week}  ${d.kicker} (${d.team})  started by ${d.owner}: ${d.oldPts.toFixed(2)} -> ${d.newPts.toFixed(2)}  (${d.delta > 0 ? "+" : ""}${d.delta.toFixed(2)})   made FGs old [${d.oldKicks}] new [${d.newKicks}]`);
  }
  console.log("\n=== Results that would flip ===");
  if (!flips.length) console.log("None. No head-to-head result or weekly skin changes.");
  for (const line of flips) console.log(line);
  console.log("\nNothing was written. Finalized scores and standings are unchanged.");
}

main().catch(error => { console.error(error); process.exit(1); });
