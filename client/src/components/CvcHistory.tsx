import { useMemo, useState } from "react";
import { Archive, CalendarClock, DatabaseZap, Flag, Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc";

const tableHeaders = ["Year", "Owner", "Champion"];

// Commissioner-provided CVC championship history (2000-2025), newest first. Years with a
// full standings/playoff archive imported (see trpc.league.seasonHistory) render that
// archive below when selected; this table itself stays the single source for the
// champion list regardless of which years have a deeper archive yet.
const champions = [
  { year: 2025, owner: "Scott Mackar", team: "Xavier Musketeers" },
  { year: 2024, owner: "Scott Mackar", team: "Xavier Musketeers" },
  { year: 2023, owner: "David Sutton", team: "Shepard's Pie" },
  { year: 2022, owner: "Justin Brock", team: "DS Warteaters" },
  { year: 2021, owner: "Jonas Pattie", team: "The Super Snuffleupagus" },
  { year: 2020, owner: "Jamie Yane", team: "The Four Horsemen" },
  { year: 2019, owner: "Justin Brock", team: "DS Warteaters" },
  { year: 2018, owner: "Shawn Gidley", team: "Vipers" },
  { year: 2017, owner: "Shawn Gidley", team: "Vipers" },
  { year: 2016, owner: "Shawn Gidley", team: "Vipers" },
  { year: 2015, owner: "David Sotka", team: "Legends" },
  { year: 2014, owner: "Brian Brickman", team: "Dresser Drawer Devices" },
  { year: 2013, owner: "David Sutton", team: "Shepard's Pie" },
  { year: 2012, owner: "Jonas Pattie", team: "The Super Snuffleupagus" },
  { year: 2011, owner: "Justin Brock", team: "DS Warteaters" },
  { year: 2010, owner: "David Sotka", team: "Legends" },
  { year: 2009, owner: "Bill Krause", team: "Pimp Mack Daddies" },
  { year: 2008, owner: "Justin Brock", team: "DS Warteaters" },
  { year: 2007, owner: "Scott Nelson", team: "Miller Time" },
  { year: 2006, owner: "Brian Brickman", team: "Dresser Drawer Devices" },
  { year: 2005, owner: "Scott Nelson", team: "Miller Time" },
  { year: 2004, owner: "Dan Osicki", team: "Pulsating Polish Peckers" },
  { year: 2003, owner: "Jonas Pattie", team: "The Super Snuffleupagus" },
  { year: 2002, owner: "Scott Nelson", team: "Miller Time" },
  { year: 2001, owner: "Shawn Gidley", team: "Vipers" },
  { year: 2000, owner: "Dan Osicki", team: "Pulsating Polish Peckers" },
] as const;

type SeasonHistory = {
  id: string;
  year: number;
  standings: { division_name: string; owner_name: string; team_name: string; wins: number; losses: number; games_back: string | null; points_for: number | null; points_against: number | null; division_wins: number | null; division_losses: number | null; clinched: string | null }[];
  playoffGames: { round_label: string; owner_a_name: string; score_a: number; owner_b_name: string; score_b: number; winner_owner_name: string }[];
};

export function CvcHistory() {
  const historyQuery = trpc.league.seasonHistory.useQuery();
  const seasons = (historyQuery.data?.seasons ?? []) as SeasonHistory[];
  const allTime = (historyQuery.data?.allTime ?? []) as { ownerName: string; wins: number; losses: number; titles: number; winPct: number }[];
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const activeSeason = useMemo(() => seasons.find(season => season.year === (selectedYear ?? seasons[0]?.year)) ?? null, [seasons, selectedYear]);

  return <section className="min-h-screen bg-[#06121b] px-3 pb-14 pt-6 text-white sm:px-6">
    <div className="mx-auto max-w-5xl">
      <div className="mb-7">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-cvc-accent">League archive</p>
        <h1 className="mt-2 font-display text-5xl uppercase">Franchise History</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-300">CVC champions, season standings, playoff results, and all-time franchise records.</p>
      </div>
      <ChampionsCard/>
      <section className="mb-5 flex flex-wrap gap-2" aria-label="Historical season selector">
        {seasons.length ? seasons.map(season => <button key={season.year} onClick={() => setSelectedYear(season.year)} className={`rounded-lg border px-4 py-2 font-display text-sm uppercase tracking-[0.08em] ${activeSeason?.year === season.year ? "border-cvc-accent bg-cvc-accent text-cvc-deep" : "border-white/15 bg-white/10 text-white/80 hover:bg-white/20"}`}>{season.year}</button>)
          : <button disabled className="rounded-lg border border-white/15 bg-white/10 px-4 py-2 font-display text-sm uppercase tracking-[0.08em] text-white/60">No historical seasons imported</button>}
      </section>
      <div className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-white text-cvc-deep">
          <div className="h-1.5 bg-cvc-accent"/>
          <header className="border-b border-slate-200 px-5 py-4">
            <h2 className="font-display text-2xl uppercase">Season Standings{activeSeason ? ` — ${activeSeason.year}` : ""}</h2>
            <p className="mt-1 text-xs text-slate-500">Division records, games back, and points as recorded for that season.</p>
          </header>
          {activeSeason ? <StandingsTable season={activeSeason}/> : <EmptyArchive icon={Archive} title="CVC standings archive not imported" detail="Commissioner-approved historical division results are required before this table can show records or playoff berths."/>}
        </section>
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-white text-cvc-deep">
          <div className="h-1.5 bg-cvc-accent"/>
          <header className="flex items-center gap-2 border-b border-slate-200 px-5 py-4"><Flag size={18} className="text-cvc-accent"/><h2 className="font-display text-2xl uppercase">Playoff Results</h2></header>
          {activeSeason ? <PlayoffTable season={activeSeason}/> : <EmptyArchive icon={CalendarClock} title="No CVC playoff archive yet" detail="Wild card, divisional, and championship results will be listed by season after approved historical playoffs are recorded."/>}
        </section>
      </div>
      <section className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-white text-cvc-deep">
        <div className="h-1.5 bg-cvc-accent"/>
        <header className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-display text-2xl uppercase">All-Time Franchise Records</h2>
          <p className="mt-1 text-xs text-slate-500">Win-loss totals, winning percentage, and titles are calculated only from imported CVC seasons.</p>
        </header>
        {allTime.length ? <AllTimeTable rows={allTime}/> : <EmptyArchive icon={DatabaseZap} title="No CVC all-time totals to calculate" detail="Import at least one verified historical season to establish CVC all-time records. No WRC historical data is shown or assumed here."/>}
      </section>
      <p className="mt-5 text-center text-xs text-slate-400">{seasons.length ? `${seasons.length} historical season${seasons.length === 1 ? "" : "s"} imported so far; the rest of the archive fills in as more are approved.` : "Historical archive is intentionally empty until CVC records are approved and imported."}</p>
    </div>
  </section>;
}

function StandingsTable({ season }: { season: SeasonHistory }) {
  const divisions = Array.from(new Set(season.standings.map(row => row.division_name)));
  return <div className="overflow-x-auto p-4">
    {divisions.map(division => <div key={division} className="mb-5 last:mb-0">
      <h3 className="mb-2 font-display text-sm uppercase tracking-[0.1em] text-cvc-accent">{division}</h3>
      <table className="min-w-[560px] w-full text-left text-sm">
        <thead className="bg-[#123040] text-xs font-black uppercase tracking-[0.08em] text-white"><tr>{["Owner", "Team", "W", "L", "GB", "PF", "PA", ""].map(header => <th className="px-3 py-2" key={header}>{header}</th>)}</tr></thead>
        <tbody>{season.standings.filter(row => row.division_name === division).map(row => <tr className="border-b border-slate-100 last:border-0 even:bg-slate-50" key={`${row.owner_name}-${row.team_name}`}>
          <td className="px-3 py-2 font-semibold">{row.owner_name}</td>
          <td className="px-3 py-2">{row.team_name}</td>
          <td className="px-3 py-2">{row.wins}</td>
          <td className="px-3 py-2">{row.losses}</td>
          <td className="px-3 py-2">{row.games_back}</td>
          <td className="px-3 py-2">{row.points_for}</td>
          <td className="px-3 py-2">{row.points_against}</td>
          <td className="px-3 py-2 text-xs font-bold uppercase text-cvc-accent">{row.clinched === "division" ? "Division" : row.clinched === "playoff" ? "Playoff" : ""}</td>
        </tr>)}</tbody>
      </table>
    </div>)}
  </div>;
}

function PlayoffTable({ season }: { season: SeasonHistory }) {
  const rounds = Array.from(new Set(season.playoffGames.map(game => game.round_label)));
  return <div className="p-4">
    {rounds.map(round => <div key={round} className="mb-4 last:mb-0">
      <h3 className="mb-1.5 font-display text-sm uppercase tracking-[0.1em] text-cvc-accent">{round}</h3>
      {season.playoffGames.filter(game => game.round_label === round).map((game, index) => <p key={index} className="text-sm">
        <span className={game.winner_owner_name === game.owner_a_name ? "font-bold" : ""}>{game.owner_a_name} {game.score_a}</span>
        {" vs. "}
        <span className={game.winner_owner_name === game.owner_b_name ? "font-bold" : ""}>{game.owner_b_name} {game.score_b}</span>
      </p>)}
    </div>)}
  </div>;
}

function AllTimeTable({ rows }: { rows: { ownerName: string; wins: number; losses: number; titles: number; winPct: number }[] }) {
  return <div className="overflow-x-auto"><table className="min-w-[480px] w-full text-left text-sm">
    <thead className="bg-[#123040] text-xs font-black uppercase tracking-[0.08em] text-white"><tr>{["Owner", "W", "L", "Win%", "Titles"].map(header => <th className="px-5 py-3" key={header}>{header}</th>)}</tr></thead>
    <tbody>{rows.map(row => <tr className="border-b border-slate-100 last:border-0 even:bg-slate-50" key={row.ownerName}>
      <td className="px-5 py-2.5 font-semibold">{row.ownerName}</td>
      <td className="px-5 py-2.5">{row.wins}</td>
      <td className="px-5 py-2.5">{row.losses}</td>
      <td className="px-5 py-2.5">{(row.winPct * 100).toFixed(1)}%</td>
      <td className="px-5 py-2.5">{row.titles || ""}</td>
    </tr>)}</tbody>
  </table></div>;
}

function ChampionsCard() { return <section className="mb-5 overflow-hidden rounded-2xl border border-white/10 bg-white text-cvc-deep"><div className="flex items-center gap-2 bg-gradient-to-r from-amber-300 to-yellow-500 px-5 py-3"><Trophy size={17}/><h2 className="font-display text-xl uppercase tracking-[0.08em]">CVC Champions</h2></div><div className="overflow-x-auto"><table className="min-w-[480px] w-full text-left text-sm"><thead className="bg-[#123040] text-xs font-black uppercase tracking-[0.08em] text-white"><tr>{tableHeaders.map(header => <th className="px-5 py-3" key={header}>{header}</th>)}</tr></thead><tbody>{champions.map(row => <tr className="border-b border-slate-100 last:border-0 even:bg-slate-50" key={row.year}><td className="px-5 py-2.5 font-display text-base text-cvc-deep">{row.year}</td><td className="px-5 py-2.5">{row.owner}</td><td className="px-5 py-2.5 font-semibold">{row.team}</td></tr>)}</tbody></table></div></section>; }

function EmptyArchive({ icon: Icon, title, detail }: { icon: typeof Archive; title: string; detail: string }) { return <div className="flex min-h-52 flex-col items-center justify-center px-7 py-8 text-center"><span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[#e9f5ee] text-cvc-accent"><Icon size={21}/></span><h3 className="font-display text-xl uppercase">{title}</h3><p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{detail}</p></div>; }
