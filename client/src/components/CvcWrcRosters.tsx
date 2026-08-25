// @ts-nocheck
import { trpc } from "@/lib/trpc";
import { useCvcOwnerAuth } from "@/hooks/useCvcOwnerAuth";
import { Link } from "wouter";
import { useState } from "react";
import { UsersRound } from "lucide-react";
import { TeamLogo } from "@/components/TeamLogo";

const posTone: Record<string, string> = { QB: "bg-violet-100 text-violet-800", RB: "bg-emerald-100 text-emerald-800", WR: "bg-sky-100 text-sky-800", TE: "bg-amber-100 text-amber-800", K: "bg-fuchsia-100 text-fuchsia-800", DST: "bg-slate-200 text-slate-700" };
const order: Record<string, number> = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DST: 5 };
const rightMarker: Record<string, string> = { franchise: "F", transition: "T", rookie_match: "R", waiver_match: "W", rookie_pick_match: "R" };

// Compact "F. Lastname" format for the narrow roster-card grid, so a long name never
// gets clipped mid-word by the column's truncation — e.g. "David Montgomery" -> "D. Montgomery".
function shortName(name: string | null | undefined) {
  if (!name) return "Player unavailable";
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

const KNOWN_SOURCE_MARKERS = new Set(["F", "T", "R", "W"]);

function contractLabel(item: any) {
  const year = item.contract?.expires_year;
  if (!year) return "—";
  // Any currently-active protection right (franchise/transition/rookie or waiver match)
  // takes priority over the raw source marker, since it reflects the player's current
  // status rather than how they were originally acquired.
  const activeRightMarker = item.rights?.map((right: any) => rightMarker[right.right_type]).find(Boolean);
  if (activeRightMarker) return `${year}-${activeRightMarker}`;
  // Otherwise fall back to the contract's own source marker — F (franchise), T
  // (transition), R (rookie draft), or W (waiver) — not just F as before, which is
  // why rookie-drafted players like Ashton Jeanty weren't showing "-R" here even
  // though their contract row was tagged correctly.
  const marker = (item.contract?.source_marker ?? "").trim().toUpperCase();
  return `${year}${KNOWN_SOURCE_MARKERS.has(marker) ? `-${marker}` : ""}`;
}

function RosterCard({ franchise, mine }: { franchise: any; mine?: boolean }) {
  const roster = trpc.league.franchiseRoster.useQuery({ franchiseId: franchise.id });
  const players = [...(roster.data?.players ?? [])].sort((a, b) => (order[a.player?.position ?? ""] ?? 99) - (order[b.player?.position ?? ""] ?? 99) || Number(b.contract?.salary ?? -1) - Number(a.contract?.salary ?? -1) || (a.player?.display_name ?? "").localeCompare(b.player?.display_name ?? ""));
  return <section className={mine ? "overflow-hidden rounded-xl bg-white shadow-xl ring-2 ring-cvc-accent" : "overflow-hidden rounded-xl bg-white shadow-xl"}>
    <div className="h-1.5 bg-cvc-accent" />
    <div className="flex items-center gap-3 px-4 pb-3 pt-4"><TeamLogo name={franchise.name} abbreviation={franchise.abbreviation} logoUrl={franchise.logo_url} size="md" className="rounded-lg border-cvc-deep/20"/><div className="min-w-0 flex-1"><p className="truncate font-display text-xl uppercase tracking-[.04em] text-cvc-deep">{franchise.name}</p><p className="mt-0.5 text-xs text-slate-500">{franchise.owner} · {players.length} players</p></div>{mine ? <span className="rounded bg-cvc-accent px-2 py-1 text-[9px] font-bold uppercase tracking-[.09em] text-cvc-deep">My team</span> : null}<Link href={`/lineup/${franchise.id}`} className="rounded bg-cvc-deep px-2 py-1.5 text-[9px] font-bold uppercase tracking-[.08em] text-white hover:bg-cvc-accent hover:text-cvc-deep">View lineup</Link></div>
    <div className="border-t border-slate-200">
      <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_2.25rem_3.75rem_4.5rem] gap-2 bg-slate-100 px-4 py-2 text-[9px] font-black uppercase tracking-[.08em] text-slate-500"><span>Pos</span><span>Player</span><span>NFL</span><span className="text-right">Salary</span><span className="text-right">Contract</span></div>
      {roster.isLoading ? <p className="px-4 py-8 text-center text-sm text-slate-400">Loading roster…</p> : players.length ? players.map((item, index) => <div className={index % 2 ? "grid grid-cols-[2.25rem_minmax(0,1fr)_2.25rem_3.75rem_4.5rem] items-center gap-2 bg-slate-50 px-4 py-2" : "grid grid-cols-[2.25rem_minmax(0,1fr)_2.25rem_3.75rem_4.5rem] items-center gap-2 bg-white px-4 py-2"} key={item.id}><span className={`rounded px-1.5 py-0.5 text-center text-[10px] font-bold ${posTone[item.player?.position] ?? "bg-slate-100 text-slate-700"}`}>{item.player?.position ?? "—"}</span><Link href={`/player/${item.player_id}`} className="min-w-0 truncate text-sm font-semibold text-cvc-deep hover:text-cvc-accent">{shortName(item.player?.display_name)}</Link><span className="text-xs font-semibold text-slate-500">{item.player?.nfl_team ?? "FA"}</span><span className="text-right text-[10px] font-bold text-cvc-deep">{item.contract ? `$${Number(item.contract.salary).toFixed(0)}` : "—"}</span><span className="text-right text-[10px] font-bold uppercase text-slate-600">{contractLabel(item)}</span></div>) : <p className="px-4 py-8 text-center text-sm text-slate-400">No active roster assignments.</p>}
    </div>
  </section>;
}

export function CvcWrcRosters() {
  const overview = trpc.league.overview.useQuery(); const { owner } = useCvcOwnerAuth(); const [division, setDivision] = useState("All");
  const franchises = overview.data?.franchises ?? [];
  const extraDivisions = Array.from(new Set(franchises.map(team => team.division_name).filter((name): name is string => Boolean(name && name !== "East" && name !== "West"))));
  const divisions = ["All", "East", "West", ...extraDivisions];
  const groups = division === "All" ? ["East", "West", ...divisions.filter(name => !["All", "East", "West"].includes(name))] : [division];
  return <div className="mx-auto max-w-[1440px]"><div className="mb-6"><div className="cvc-eyebrow"><UsersRound size={14} /> Franchise directory</div><h1 className="mt-2 font-display text-5xl uppercase leading-none tracking-[.04em] text-white sm:text-6xl">CVC Rosters</h1><p className="mt-3 text-sm text-cvc-muted">2026 Season · All CVC franchises and current active roster assignments.</p></div><div className="mb-6 flex flex-wrap gap-2">{divisions.map(item => <button key={item} onClick={() => setDivision(item)} className={division === item ? "rounded-full border-2 border-cvc-accent bg-cvc-accent px-4 py-2 font-display text-sm uppercase text-cvc-deep" : "rounded-full border-2 border-white/25 bg-black/25 px-4 py-2 font-display text-sm uppercase text-white hover:border-cvc-accent"}>{item === "All" ? "All divisions" : `${item} division`}</button>)}</div>{overview.isLoading ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-64 animate-pulse rounded-xl bg-white/10" />)}</div> : groups.map(group => { const teams = franchises.filter(team => team.division_name === group); return teams.length ? <section key={group} className="mb-8"><p className="mb-3 pl-1 font-display text-sm uppercase tracking-[.13em] text-cvc-accent">{group} division</p><div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{teams.map(team => <RosterCard key={team.id} franchise={team} mine={owner?.franchise?.id === team.id} />)}</div></section> : null; })}</div>;
}
