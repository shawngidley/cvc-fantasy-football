export type Franchise = {
  id: string;
  name: string;
  abbreviation: string;
  division: string;
  owner: string;
  record: string;
  pointsFor: number;
  streak: string;
  color: string;
};

export type Matchup = {
  week: number;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  state: "Live" | "Final" | "Upcoming";
};

export const leagueMeta = {
  name: "CVC Fantasy Football",
  season: "2026",
  stage: "Foundation mode",
  announcement: "CVC is ready for league setup — teams, rules, scoring, and schedule can be configured without code.",
};

export const franchises: Franchise[] = [
  { id: "atlas", name: "Atlas Aces", abbreviation: "ATA", division: "Capital", owner: "Commissioner Placeholder", record: "8–2", pointsFor: 1284.6, streak: "W4", color: "#30d5c8" },
  { id: "harbor", name: "Harbor Hounds", abbreviation: "HBH", division: "Capital", owner: "Owner Placeholder", record: "7–3", pointsFor: 1217.8, streak: "W2", color: "#ffb454" },
  { id: "summit", name: "Summit Wolves", abbreviation: "SMW", division: "Capital", owner: "Owner Placeholder", record: "6–4", pointsFor: 1198.2, streak: "L1", color: "#8ca3ff" },
  { id: "metro", name: "Metro Monarchs", abbreviation: "MMO", division: "Harbor", owner: "Owner Placeholder", record: "6–4", pointsFor: 1176.1, streak: "W1", color: "#e68ad0" },
  { id: "ridge", name: "Ridge Runners", abbreviation: "RDR", division: "Harbor", owner: "Owner Placeholder", record: "5–5", pointsFor: 1138.7, streak: "L2", color: "#a4d26f" },
  { id: "north", name: "Northside Knights", abbreviation: "NSK", division: "Harbor", owner: "Owner Placeholder", record: "4–6", pointsFor: 1086.9, streak: "W1", color: "#ff8f8f" },
];

export const matchups: Matchup[] = [
  { week: 10, home: "Atlas Aces", away: "Harbor Hounds", homeScore: 132.4, awayScore: 128.9, state: "Final" },
  { week: 10, home: "Summit Wolves", away: "Metro Monarchs", homeScore: 96.8, awayScore: 103.6, state: "Final" },
  { week: 11, home: "Ridge Runners", away: "Northside Knights", homeScore: 74.2, awayScore: 69.1, state: "Live" },
  { week: 11, home: "Atlas Aces", away: "Metro Monarchs", homeScore: 0, awayScore: 0, state: "Upcoming" },
];

export const transactionFeed = [
  { type: "Waiver award", detail: "Atlas Aces added QB Placeholder", time: "Today · 10:00 AM", badge: "FAAB" },
  { type: "Trade accepted", detail: "Harbor Hounds ↔ Summit Wolves", time: "Yesterday · 8:34 PM", badge: "Trade" },
  { type: "Commissioner note", detail: "Week 11 stat corrections window closes Tuesday", time: "Mon · 6:12 PM", badge: "League" },
  { type: "Lineup move", detail: "Metro Monarchs moved RB Placeholder to IR", time: "Mon · 4:47 PM", badge: "Roster" },
];

export const rosterPreview = [
  { slot: "QB", player: "Quarterback Placeholder", team: "NFL", projection: "21.4", status: "Active" },
  { slot: "RB", player: "Running Back Placeholder", team: "NFL", projection: "17.8", status: "Active" },
  { slot: "WR", player: "Wide Receiver Placeholder", team: "NFL", projection: "16.2", status: "Active" },
  { slot: "TE", player: "Tight End Placeholder", team: "NFL", projection: "10.6", status: "Active" },
  { slot: "FLEX", player: "Flex Placeholder", team: "NFL", projection: "13.1", status: "Questionable" },
  { slot: "BENCH", player: "Bench Placeholder", team: "NFL", projection: "9.8", status: "Bench" },
];

export const draftPreview = [
  { pick: "1.01", franchise: "Northside Knights", player: "Open selection", note: "Lottery order" },
  { pick: "1.02", franchise: "Ridge Runners", player: "Open selection", note: "Original pick" },
  { pick: "1.03", franchise: "Metro Monarchs", player: "Open selection", note: "Traded pick" },
  { pick: "1.04", franchise: "Summit Wolves", player: "Open selection", note: "Original pick" },
];

export const domainSeedStatus = [
  "league", "season", "franchise", "owner", "roster_slot", "scoring_rule", "schedule_week", "matchup", "player", "roster_assignment", "transaction", "draft", "draft_pick", "waiver_period", "faab_bid", "rule_document", "league_financial_entry",
];

export const setupAreas = [
  { title: "Teams & owners", detail: "Create franchises, divisions, and owner access.", icon: "01" },
  { title: "Scoring & rosters", detail: "Define positions, starters, and scoring values.", icon: "02" },
  { title: "Schedule & playoffs", detail: "Load weeks, matchups, seeding, and tiebreakers.", icon: "03" },
  { title: "Rules & finance", detail: "Publish rules, dues, payouts, and policy documents.", icon: "04" },
];
