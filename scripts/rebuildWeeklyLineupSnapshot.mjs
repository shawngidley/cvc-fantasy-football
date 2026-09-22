/**
 * Rebuilds a week's weekly_lineup_snapshot from the audit trail of what owners
 * actually did, rather than from whatever the roster happens to look like today.
 *
 * Why this exists: until 35c7372 the snapshot was captured once, on whichever sync
 * first picked up the week (often days before kickoff), and never revisited. Every
 * lineup change an owner made after that point was ignored by official scoring --
 * confirmed for Week 2, where Shepard's Pie benched Goff and started Lawrence three
 * days before kickoff and the snapshot kept Goff. The commissioner buttons cannot
 * repair this: forceRecomputeWeek freezes locked players that already have rows, and
 * resetWeekSnapshot rebuilds from the CURRENT roster, which loses anyone released
 * since and imports anyone added since.
 *
 * Reconstruction rules, all derived from data rather than assumption:
 *   - Every player starts UNSLOTTED. roster_assignment.assigned_slot_code is nullable
 *     with no default and neither auction nor waiver acquisition sets it, so the audit
 *     log is a complete record of slotting with no hidden initial state.
 *   - A player's slot for the week is the last lineup_slot_updated event for them
 *     strictly BEFORE their own team's kickoff. Events at or after kickoff are ignored:
 *     that is the lock the app itself enforces (setLineupSlot rejects them).
 *   - A player counts for a franchise if they were held at their own kickoff:
 *     acquired_at <= kickoff AND (released_at IS NULL OR released_at > kickoff).
 *     This restores players released later in the week -- a drop after kickoff cannot
 *     retroactively erase points already scored.
 *   - A bye (no game found for the team that week) leaves the player open all week, so
 *     their last event of any time before the week ends applies.
 *
 * audit_event.summary text is NOT trusted for player identity -- events written before
 * 2f9695d say "a player" because the Supabase relation came back in the other shape.
 * entity_id (the roster_assignment id) is used instead and resolves for every row.
 *
 * Dry run by default: prints a per-franchise diff and writes nothing. Pass --apply to
 * replace the week's snapshot rows. Re-score afterwards with forceRecomputeWeek(N).
 *
 *   node scripts/rebuildWeeklyLineupSnapshot.mjs --week 2
 *   node scripts/rebuildWeeklyLineupSnapshot.mjs --week 2 --apply
 *   node scripts/rebuildWeeklyLineupSnapshot.mjs --week 2 --overrides overrides.json
 *
 * overrides.json pins cases the log cannot settle on its own, e.g. a commissioner
 * reversal that cleared released_at and so erased the evidence a player was ever cut:
 *   { "The Twinsburg Tribe": { "Jacksonville Jaguars": null, "Detroit Lions": "DST" } }
 * null removes the player from the week entirely; a slot code forces that slot.
 */
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i === -1 ? null : args[i + 1]; };
const WEEK = Number(flag("week"));
const APPLY = args.includes("--apply");
const OVERRIDES_PATH = flag("overrides");

if (!Number.isInteger(WEEK) || WEEK < 1) { console.error("Usage: --week <n> [--apply] [--overrides file.json]"); process.exit(1); }

const url = process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const tankKey = process.env.TANK01_RAPIDAPI_KEY;
if (!url || !secret) { console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required."); process.exit(1); }
if (!tankKey) { console.error("TANK01_RAPIDAPI_KEY is required (kickoff times decide each player's lock)."); process.exit(1); }

const db = createClient(url, secret, { auth: { persistSession: false } });
const unwrap = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };
const normalizeTeam = (t) => String(t ?? "").trim().toUpperCase();

/** Eastern-time-correct kickoff, matching planningWeek.ts rather than
 * tank01ScoringSync's hardcoded UTC-4 (which is an hour off after the DST fall-back). */
function kickoffUtcMs(gameDate, gameTime) {
  if (!gameDate || !gameTime || gameDate.length < 8) return null;
  const t = String(gameTime).match(/(\d+):(\d+)([ap])/i);
  if (!t) return null;
  let hour = Number(t[1]);
  if (t[3].toLowerCase() === "p" && hour !== 12) hour += 12;
  if (t[3].toLowerCase() === "a" && hour === 12) hour = 0;
  const y = Number(gameDate.slice(0, 4)), m = Number(gameDate.slice(4, 6)), d = Number(gameDate.slice(6, 8));
  // Determine the Eastern UTC offset for that instant by probing both candidates.
  for (const offset of [4, 5]) {
    const guess = Date.UTC(y, m - 1, d, hour + offset, Number(t[2]), 0);
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).formatToParts(new Date(guess));
    if (Number(parts.find((p) => p.type === "hour").value) % 24 === hour % 24) return guess;
  }
  return Date.UTC(y, m - 1, d, hour + 4, Number(t[2]), 0);
}

async function tankGames(week, seasonYear) {
  const res = await fetch(`https://tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com/getNFLGamesForWeek?week=${week}&seasonType=Regular%20Season&season=${seasonYear}`, {
    headers: { "x-rapidapi-key": tankKey, "x-rapidapi-host": "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com" },
  });
  if (!res.ok) throw new Error(`Tank01 schedule request failed (${res.status})`);
  return (await res.json()).body ?? [];
}

const league = unwrap(await db.from("league").select("id").eq("slug", "cvc-auction-football").single());
const season = unwrap(await db.from("season").select("id, year").eq("league_id", league.id).eq("is_current", true).maybeSingle())
  ?? unwrap(await db.from("season").select("id, year").eq("league_id", league.id).order("year", { ascending: false }).limit(1).single());
const weekRow = unwrap(await db.from("schedule_week").select("id, week_number, label").eq("season_id", season.id).eq("week_number", WEEK).single());

const games = await tankGames(WEEK, season.year);
const kickoffByTeam = new Map();
for (const g of games) {
  const ms = kickoffUtcMs(g.gameDate, g.gameTime);
  if (ms === null) continue;
  for (const side of [g.away, g.home]) if (side) kickoffByTeam.set(normalizeTeam(side), ms);
}
const weekEndMs = kickoffByTeam.size ? Math.max(...kickoffByTeam.values()) + 6 * 3600 * 1000 : Date.now();

// Slot labels drifted mid-season ("Running Back 1"/"Running Back 2" -> "Running Back"),
// so map by label with the trailing index stripped, and keep the live codes as truth.
const slots = unwrap(await db.from("roster_slot").select("code, label").eq("season_id", season.id));
// Trailing punctuation comes off BEFORE the slot index, or "Running Back 1." never
// matches the index pattern (the period sits between the digit and the end) and the
// label silently fails to resolve -- which dropped 33 real events on the first run.
const normalizeLabel = (label) => String(label).trim().toLowerCase().replace(/[.\s]+$/, "").replace(/\s+\d+$/, "");
const slotByLabel = new Map();
for (const s of slots) slotByLabel.set(normalizeLabel(s.label), s.code);
slotByLabel.set("bench", "BENCH");
const codeForLabel = (label) => slotByLabel.get(normalizeLabel(label)) ?? null;

const franchises = unwrap(await db.from("franchise").select("id, name").eq("league_id", league.id).eq("is_active", true));
const franchiseName = new Map(franchises.map((f) => [f.id, f.name]));

const assignments = unwrap(await db.from("roster_assignment")
  .select("id, franchise_id, player_id, acquired_at, released_at, player:player_id(display_name, nfl_team)")
  .eq("season_id", season.id));
const assignmentById = new Map(assignments.map((a) => [a.id, a]));

const events = unwrap(await db.from("audit_event")
  .select("entity_id, summary, created_at")
  .eq("season_id", season.id).eq("action", "lineup_slot_updated").order("created_at"));

const overrides = OVERRIDES_PATH ? JSON.parse(await readFile(OVERRIDES_PATH, "utf8")) : {};

// Replay: last slot event strictly before each player's own kickoff wins.
const unmapped = [];
const slotFor = new Map(); // `${franchise_id}:${player_id}` -> code
for (const ev of events) {
  const a = assignmentById.get(ev.entity_id);
  if (!a) continue;
  const player = Array.isArray(a.player) ? a.player[0] : a.player;
  const lock = kickoffByTeam.get(normalizeTeam(player?.nfl_team)) ?? weekEndMs;
  if (new Date(ev.created_at).getTime() >= lock) continue; // locked: change came too late
  const label = String(ev.summary).replace(/^.*\bto\s+/i, "");
  const code = codeForLabel(label);
  if (!code) { unmapped.push(`${label} @ ${ev.created_at}`); continue; }
  slotFor.set(`${a.franchise_id}:${a.player_id}`, code);
}

const rebuilt = [];
const heldAtKickoff = new Set();
for (const a of assignments) {
  const player = Array.isArray(a.player) ? a.player[0] : a.player;
  if (!player) continue;
  const lock = kickoffByTeam.get(normalizeTeam(player.nfl_team)) ?? weekEndMs;
  const acquired = a.acquired_at ? new Date(a.acquired_at).getTime() : 0;
  const released = a.released_at ? new Date(a.released_at).getTime() : Infinity;
  if (!(acquired <= lock && released > lock)) continue; // not held at their own kickoff
  heldAtKickoff.add(`${a.franchise_id}:${a.player_id}`);
  const code = slotFor.get(`${a.franchise_id}:${a.player_id}`);
  if (!code) continue; // never slotted -> not part of the week's lineup
  const ov = overrides[franchiseName.get(a.franchise_id)]?.[player.display_name];
  if (ov === null) continue;
  rebuilt.push({ season_id: season.id, schedule_week_id: weekRow.id, franchise_id: a.franchise_id, player_id: a.player_id, roster_assignment_id: a.id, slot_code: ov ?? code, _name: player.display_name });
}

const existing = unwrap(await db.from("weekly_lineup_snapshot")
  .select("franchise_id, player_id, slot_code, player:player_id(display_name)")
  .eq("schedule_week_id", weekRow.id));
const existingByKey = new Map(existing.map((r) => [`${r.franchise_id}:${r.player_id}`, r]));
const rebuiltByKey = new Map(rebuilt.map((r) => [`${r.franchise_id}:${r.player_id}`, r]));

console.log(`\n=== ${weekRow.label ?? `Week ${WEEK}`} — reconstructed from ${events.length} lineup events ===`);
console.log(`${APPLY ? "APPLY" : "DRY RUN"} — stored ${existing.length} rows, reconstructed ${rebuilt.length} rows\n`);
let diffs = 0;
for (const f of franchises) {
  const lines = [];
  for (const [key, r] of rebuiltByKey) {
    if (!key.startsWith(`${f.id}:`)) continue;
    const prior = existingByKey.get(key);
    if (!prior) lines.push(`  + ${r._name.padEnd(26)} ${r.slot_code}   (missing from stored snapshot)`);
    else if (prior.slot_code !== r.slot_code) lines.push(`  ~ ${r._name.padEnd(26)} ${prior.slot_code} -> ${r.slot_code}`);
  }
  for (const [key, r] of existingByKey) {
    if (!key.startsWith(`${f.id}:`) || rebuiltByKey.has(key)) continue;
    const p = Array.isArray(r.player) ? r.player[0] : r.player;
    const held = heldAtKickoff.has(key);
    lines.push(`  - ${String(p?.display_name ?? r.player_id).padEnd(26)} ${r.slot_code}   (${held ? "held, but no slot event before their kickoff" : "not on this roster at their kickoff"})`);
  }
  if (lines.length) { diffs += lines.length; console.log(`${f.name}`); console.log(lines.join("\n")); console.log(""); }
}
if (!diffs) console.log("No differences — the stored snapshot already matches the audit trail.\n");

if (unmapped.length) {
  console.error(`REFUSING TO APPLY: ${unmapped.length} lineup events had a slot label that did not resolve to a roster_slot code.`);
  console.error(`Every dropped event is a lineup change that would be silently missing from the rebuild:`);
  for (const u of unmapped.slice(0, 20)) console.error(`  ${u}`);
  if (unmapped.length > 20) console.error(`  ... and ${unmapped.length - 20} more`);
  process.exit(1);
}

if (APPLY) {
  unwrap(await db.from("weekly_lineup_snapshot").delete().eq("schedule_week_id", weekRow.id).select("id"));
  const payload = rebuilt.map(({ _name, ...row }) => row);
  for (let i = 0; i < payload.length; i += 200) unwrap(await db.from("weekly_lineup_snapshot").insert(payload.slice(i, i + 200)).select("id"));
  console.log(`Wrote ${payload.length} rows. Now run forceRecomputeWeek(${WEEK}) from the Commissioner panel to re-score.\n`);
} else {
  console.log(`Nothing written. Re-run with --apply to replace the week's snapshot.\n`);
}
