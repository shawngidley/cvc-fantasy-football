export type KickerPlayType = "fg" | "xp";
export type KickerPlayOutcome = "made" | "missed";

export type KickerPlayEvent = {
  playerName: string;
  type: KickerPlayType;
  outcome: KickerPlayOutcome;
  yards: number | null;
  text: string;
};

type EspnPlay = { text?: string; type?: { text?: string } };

function normName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

function parseKickerName(raw: string): string {
  return raw.trim().replace(/\./g, ". ").replace(/\s+/g, " ");
}

/** Parses field-goal and extra-point events (with exact yardage for FGs) out of an
 * ESPN game summary's play-by-play text. Ported directly from WRC's proven
 * parseEspnKickerEvents -- same regex patterns, same play-source traversal
 * (root.plays plus every previous drive's plays). */
export function parseEspnKickerEvents(summary: unknown): KickerPlayEvent[] {
  const root = summary as { drives?: { previous?: Array<{ plays?: EspnPlay[] }> }; plays?: EspnPlay[] };
  const plays = [
    ...(root.plays ?? []),
    ...((root.drives?.previous ?? []).flatMap(drive => drive.plays ?? [])),
  ];
  const seen = new Set<string>();
  const events: KickerPlayEvent[] = [];

  for (const play of plays) {
    const text = play.text?.trim() ?? "";
    const type = play.type?.text?.toLowerCase() ?? "";
    const fgMatch = text.match(/^(.+?)\s+(\d+)\s+yard field goal is\s+(good|no good|missed)/i);
    if (fgMatch && (type.includes("field goal") || /field goal/i.test(text))) {
      const event: KickerPlayEvent = {
        playerName: parseKickerName(fgMatch[1]),
        type: "fg",
        outcome: fgMatch[3].toLowerCase() === "good" ? "made" : "missed",
        yards: Number(fgMatch[2]),
        text,
      };
      const key = `${event.playerName}|${event.type}|${event.outcome}|${event.yards}|${text}`;
      if (!seen.has(key)) { seen.add(key); events.push(event); }
      continue;
    }
    const xpMatch = text.match(/^(.+?)\s+(?:extra point|pat)\s+is\s+(good|no good|missed)/i);
    if (xpMatch && (type.includes("extra point") || /extra point|\bpat\b/i.test(text))) {
      const event: KickerPlayEvent = {
        playerName: parseKickerName(xpMatch[1]),
        type: "xp",
        outcome: xpMatch[2].toLowerCase() === "good" ? "made" : "missed",
        yards: null,
        text,
      };
      const key = `${event.playerName}|${event.type}|${event.outcome}|${text}`;
      if (!seen.has(key)) { seen.add(key); events.push(event); }
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
