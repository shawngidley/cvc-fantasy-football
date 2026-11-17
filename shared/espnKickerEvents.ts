export type KickerPlayType = "fg" | "xp";
export type KickerPlayOutcome = "made" | "missed";

export type KickerPlayEvent = {
  playerName: string;
  type: KickerPlayType;
  outcome: KickerPlayOutcome;
  yards: number | null;
  text: string;
  /** Identifies the individual kick this event came from, so two real kicks whose
   * play text is byte-identical (Brandon Aubrey, two 52-yarders on 2026-11-15; Cade
   * York / C.Ryland 49 and 49 in LAR @ ARI) are never collapsed into one. ESPN's own
   * play id when the payload has one; otherwise the play text plus how many times
   * that exact text already appeared earlier in the same list ("text#0", "text#1").
   * Optional only so older test fixtures and hand-built events still compile --
   * parseEspnKickerEvents always sets it. */
  playKey?: string;
};

type EspnPlay = { id?: string | number; text?: string; type?: { text?: string } };

function normName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

function parseKickerName(raw: string): string {
  return raw.trim().replace(/\./g, ". ").replace(/\s+/g, " ");
}

/** Parses field-goal and extra-point events (with exact yardage for FGs) out of an
 * ESPN game summary's play-by-play text. Ported directly from WRC's proven
 * parseEspnKickerEvents -- same regex patterns, same play-source traversal
 * (root.plays plus every previous drive's plays).
 *
 * Deduping is by playKey ONLY. The old key included the play text, which dropped a
 * kicker's second field goal whenever it was the same distance as the first (ESPN
 * writes both plays with identical text). The same play can legitimately show up in
 * both root.plays and drives.previous, so that still has to count once: each list is
 * walked on its own with its own repeat counter, which gives the same play the same
 * playKey in both lists (its ESPN id, or "text#n"). Across the two lists the result
 * is therefore the LARGER per-list count, never the sum. */
export function parseEspnKickerEvents(summary: unknown): KickerPlayEvent[] {
  const root = summary as { drives?: { previous?: Array<{ plays?: EspnPlay[] }> }; plays?: EspnPlay[] };
  const playLists: EspnPlay[][] = [
    root.plays ?? [],
    (root.drives?.previous ?? []).flatMap(drive => drive.plays ?? []),
  ];
  const seen = new Set<string>();
  const events: KickerPlayEvent[] = [];

  for (const plays of playLists) {
    const repeatsByText = new Map<string, number>();
    for (const play of plays) {
      const text = play.text?.trim() ?? "";
      const type = play.type?.text?.toLowerCase() ?? "";
      const espnId = play.id === undefined || play.id === null || String(play.id).trim() === "" ? null : String(play.id).trim();
      const repeat = repeatsByText.get(text) ?? 0;
      repeatsByText.set(text, repeat + 1);
      const playKey = espnId ?? `${text}#${repeat}`;

      const fgMatch = text.match(/^(.+?)\s+(\d+)\s+yard field goal is\s+(good|no good|missed)/i);
      if (fgMatch && (type.includes("field goal") || /field goal/i.test(text))) {
        if (seen.has(playKey)) continue;
        seen.add(playKey);
        events.push({
          playerName: parseKickerName(fgMatch[1]),
          type: "fg",
          outcome: fgMatch[3].toLowerCase() === "good" ? "made" : "missed",
          yards: Number(fgMatch[2]),
          text,
          playKey,
        });
        continue;
      }
      const xpMatch = text.match(/^(.+?)\s+(?:extra point|pat)\s+is\s+(good|no good|missed)/i);
      if (xpMatch && (type.includes("extra point") || /extra point|\bpat\b/i.test(text))) {
        if (seen.has(playKey)) continue;
        seen.add(playKey);
        events.push({
          playerName: parseKickerName(xpMatch[1]),
          type: "xp",
          outcome: xpMatch[2].toLowerCase() === "good" ? "made" : "missed",
          yards: null,
          text,
          playKey,
        });
      }
    }
  }
  return events;
}

export function matchesKickerEvent(eventPlayerName: string, fullPlayerName: string): boolean {
  const event = normName(eventPlayerName);
  const full = normName(fullPlayerName);
  if (!event || !full) return false;
  if (event === full) return true;
  const fullParts = fullPlayerName.toLowerCase().replace(/\./g, "").split(/\s+/).filter(Boolean);
  const surname = fullParts[fullParts.length - 1] ?? "";
  return event.startsWith(fullParts[0]?.[0] ?? "") && event.endsWith(normName(surname));
}

export function getKickerEventsForPlayer(events: KickerPlayEvent[], fullPlayerName: string): KickerPlayEvent[] {
  return events.filter(event => matchesKickerEvent(event.playerName, fullPlayerName));
}

/** Sums the exact yardage of every MADE field goal for a kicker's events -- this is
 * what replaces the unreliable/missing Kicking.fgYds from Tank01's live box score.
 * CVC's own calculateCvcFantasyPoints already reads Kicking.fgYds and applies CVC's
 * configured field_goal_yard rule, so overriding just this one raw field (rather than
 * porting WRC's own hardcoded scoring formula) lets CVC's real scoring rules do the
 * rest correctly, including anything CVC configures differently from WRC. */
export function sumMadeFieldGoalYards(events: KickerPlayEvent[]): number {
  return events.filter(event => event.type === "fg" && event.outcome === "made").reduce((total, event) => total + (event.yards ?? 0), 0);
}

/** Counts made extra points from events, for the same reason as sumMadeFieldGoalYards
 * -- lets CVC's own xpMade-based scoring rule apply normally when ESPN data is used
 * as the source instead of Tank01's xpMade count. */
export function countMadeExtraPoints(events: KickerPlayEvent[]): number {
  return events.filter(event => event.type === "xp" && event.outcome === "made").length;
}

/** Builds a kicker's Kicking stats from Tank01's box score plus ESPN play by play.
 * Field goal yardage comes from ESPN, because Tank01 does not reliably send Kicking.fgYds and
 * the scoring rule is per yard. Extra points are a flat value with no distance, so Tank01's
 * own xpMade is trusted. ESPN's play text does not always match the parser (a made XP can be
 * silently missing, which is how WRC under-scored Eddy Pineiro), so ESPN only RAISES the
 * count, never lowers it. */
export function applyKickerEventsToKicking(existingKicking: Record<string, unknown>, playerEvents: KickerPlayEvent[]): Record<string, unknown> {
  const hasFgEvents = playerEvents.some(event => event.type === "fg");
  const hasXpEvents = playerEvents.some(event => event.type === "xp");
  const next: Record<string, unknown> = { ...existingKicking };
  if (hasFgEvents) next.fgYds = sumMadeFieldGoalYards(playerEvents);
  if (hasXpEvents) {
    const tank01Xp = Number.parseFloat(String(existingKicking.xpMade ?? ""));
    const espnXp = countMadeExtraPoints(playerEvents);
    next.xpMade = Number.isFinite(tank01Xp) ? Math.max(tank01Xp, espnXp) : espnXp;
  }
  return next;
}

/** Formats a single kick event for display -- distance and outcome only, no attached
 * point value (unlike WRC's formatKickerEvent, which bakes in WRC's own hardcoded
 * scoring formula). CVC's actual point value for a made kick depends on its own
 * configured field_goal_yard rule, which this shared parsing module has no business
 * assuming. */
export function formatKickerEvent(event: KickerPlayEvent): string {
  if (event.type === "xp") return event.outcome === "made" ? "XP made" : "XP missed";
  const distance = `${event.yards ?? "?"} yd`;
  return event.outcome === "made" ? `${distance} FG made` : `${distance} FG missed`;
}

/** Groups multiple made-FG events into a single display chip listing all their
 * yardages together (e.g. "47, 40 yd FG made") instead of a separate "X yd FG made"
 * chip per kick -- ported from WRC's same grouping, minus the hardcoded point value
 * WRC bakes into its chip text (see formatKickerEvent above for why CVC leaves that to
 * its own configured scoring rules). XP events and missed FGs stay as individual
 * chips, one each, same as before -- unlike WRC, CVC doesn't drop long misses from
 * display, since that omission was specific to WRC's own scoring formula (a 50+ yard
 * miss costing no points there), not a general display convention. */
export function groupKickerEventsForDisplay(events: KickerPlayEvent[]): { key: string; text: string; outcome: "made" | "missed" }[] {
  const madeFGs = events.filter(event => event.type === "fg" && event.outcome === "made");
  const others = events.filter(event => !(event.type === "fg" && event.outcome === "made"));

  const chips: { key: string; text: string; outcome: "made" | "missed" }[] = others.map((event, index) => ({
    key: `${event.text}-${index}`,
    text: formatKickerEvent(event),
    outcome: event.outcome,
  }));

  if (madeFGs.length > 0) {
    const yardages = madeFGs.map(event => event.yards ?? 0);
    chips.push({
      key: "made-fgs-combined",
      text: `${yardages.join(", ")} yd FG made`,
      outcome: "made",
    });
  }

  return chips;
}
