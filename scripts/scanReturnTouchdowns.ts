/**
 * Read-only audit: which finalized weeks this season had a special-teams return
 * touchdown (kickoff return, punt return, blocked punt, blocked field goal) that
 * CVC's D/ST scoring missed, who started that D/ST, the point change, and whether
 * crediting it would flip any head-to-head result or weekly skin.
 *
 * It changes nothing. It never writes to Supabase.
 *
 * Run from the repo root with the server's env (SUPABASE_URL, SUPABASE_SECRET_KEY)
 * on a network that can reach site.api.espn.com:
 *
 *   pnpm tsx scripts/scanReturnTouchdowns.ts
 *
 * Optional week numbers limit the scan:  pnpm tsx scripts/scanReturnTouchdowns.ts 3 7
 */
import { supabase, unwrap } from "../server/supabase";
import { parseEspnReturnTouchdowns } from "../shared/espnReturnTouchdowns";
import { normalizeTeam } from "../server/cvcScoringShared";
import { SKIN_THRESHOLD } from "../server/cvcSkins";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";

type Diff = { week: number; team: string; owner: string; franchiseId: string; count: number; delta: number; plays: string[] };

async function espnJson(url: string): Promise<any | null> {
  try {
    const response = await fetch(url);
    return response.ok ? response.json() : null;
  } catch (error) {
    console.warn(`ESPN fetch failed (${url}): ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function main() {
  const onlyWeeks = new Set(process.argv.slice(2).map(Number).filter(Number.isFinite));
  const season = unwrap(await supabase.from("season").select("id, year").order("year", { ascending: false }).limit(1).single());
  if (!season) throw new Error("No season found.");
  const rules = unwrap(await supabase.from("scoring_rule").select("stat_key, value, applies_to_positions").eq("season_id", season.id)) ?? [];
  const tdRule = rules.find(rule => rule.stat_key === "defensive_touchdown" && (!rule.applies_to_positions?.length || rule.applies_to_positions.includes("DST")));
  const pointsPerTd = Number(tdRule?.value ?? 6);
  const weeks = (unwrap(await supabase.from("schedule_week").select("id, week_number, label").eq("season_id", season.id).eq("status", "final").order("week_number")) ?? []).filter(w => !onlyWeeks.size || onlyWeeks.has(w.week_number));
  const lastWeekNumber = Math.max(...((unwrap(await supabase.from("schedule_week").select("week_number").eq("season_id", season.id)) ?? []).map(w => w.week_number)));

  const diffs: Diff[] = [];
  const flips: string[] = [];

  for (const week of weeks) {
    const snapshots = unwrap(await supabase.from("weekly_lineup_snapshot").select("franchise_id, slot_code, franchise:franchise_id(name), player:player_id(id, display_name, position, nfl_team)").eq("schedule_week_id", week.id)) ?? [];
    const startersByTeam = new Map<string, { franchiseId: string; franchiseName: string; label: string }>();
    for (const row of snapshots as any[]) {
      const player = Array.isArray(row.player) ? row.player[0] : row.player;
      const franchise = Array.isArray(row.franchise) ? row.franchise[0] : row.franchise;
      const position = player?.position === "DEF" ? "DST" : player?.position;
      if (!player || position !== "DST" || String(row.slot_code ?? "").toUpperCase() === "BENCH") continue;
      startersByTeam.set(normalizeTeam(player.nfl_team ?? ""), { franchiseId: row.franchise_id, franchiseName: franchise?.name ?? row.franchise_id, label: player.display_name });
    }
    if (!startersByTeam.size) { console.log(`${week.label}: no D/ST started`); continue; }

    const scoreboard = await espnJson(`${ESPN}/scoreboard?dates=${season.year}&seasontype=2&week=${week.week_number}`);
    const games: { id: string; teams: string[] }[] = (scoreboard?.events ?? []).map((event: any) => ({
      id: String(event.id),
      teams: (event.competitions?.[0]?.competitors ?? []).map((c: any) => normalizeTeam(c.team?.abbreviation ?? "")),
    }));

    const deltaByFranchise = new Map<string, number>();
    for (const game of games.filter(g => g.teams.some(t => startersByTeam.has(t)))) {
      const summary = await espnJson(`${ESPN}/summary?event=${game.id}`);
      if (!summary) { console.warn(`${week.label}: ESPN summary ${game.id} unavailable`); continue; }
      for (const [espnTeam, count] of Array.from(parseEspnReturnTouchdowns(summary))) {
        const team = normalizeTeam(espnTeam);
        const starter = startersByTeam.get(team);
        if (!starter || !count) continue;
        const plays = (summary.scoringPlays ?? []).filter((p: any) => String(p.team?.abbreviation ?? "").toUpperCase() === espnTeam && /return|blocked/i.test(p.type?.text ?? "") && /touchdown/i.test(p.type?.text ?? "")).map((p: any) => `${p.type?.text}: ${p.text}`);
        const delta = count * pointsPerTd;
        diffs.push({ week: week.week_number, team: team.toUpperCase(), owner: starter.franchiseName, franchiseId: starter.franchiseId, count, delta, plays });
        deltaByFranchise.set(starter.franchiseId, (deltaByFranchise.get(starter.franchiseId) ?? 0) + delta);
      }
    }
    if (!deltaByFranchise.size) continue;

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

  console.log("\n=== Started D/STs with an uncredited special-teams return touchdown ===");
  if (!diffs.length) console.log("None. No finalized week is affected.");
  for (const d of diffs) {
    console.log(`Week ${d.week}  ${d.team} D/ST  started by ${d.owner}: +${d.delta.toFixed(2)} (${d.count} return TD${d.count === 1 ? "" : "s"})`);
    for (const play of d.plays) console.log(`    ${play}`);
  }
  console.log("\n=== Results that would flip ===");
  if (!flips.length) console.log("None. No head-to-head result or weekly skin changes.");
  for (const line of flips) console.log(line);
  console.log("\nNothing was written. Finalized scores and standings are unchanged.");
}

main().catch(error => { console.error(error); process.exit(1); });
