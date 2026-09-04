import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { ChevronRight, Plus, Save, Scissors, Upload } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { toast } from "sonner";

type Module = "teams" | "owners" | "scoring" | "roster" | "schedule" | "rules" | "finance" | "protections" | "stats" | "auction";

const modules: { id: Module; label: string }[] = [
  { id: "teams", label: "Teams" },
  { id: "owners", label: "Owners & access" },
  { id: "scoring", label: "Scoring" },
  { id: "roster", label: "Roster slots" },
  { id: "schedule", label: "Schedule & playoffs" },
  { id: "rules", label: "Rules & content" },
  { id: "finance", label: "Finance" },
  { id: "protections", label: "Protection deadline" },
  { id: "stats", label: "Player stats sync" },
  { id: "auction", label: "Auction budgets" },
];

function Field({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) {
  return <label className="cvc-field"><span>{label}</span><input type={type} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder ?? `Enter ${label.toLowerCase()}`} /></label>;
}

function downloadTemplate(module: Exclude<Module, "protections" | "stats" | "auction">) {
  const templates: Record<Exclude<Module, "protections" | "stats" | "auction">, string> = {
    teams: "name,abbreviation,division_name,owner_display_name\nExample Franchise,EXF,Division One,Example Owner\n",
    owners: "display_name,email,role\nExample Owner,owner@example.com,owner\n",
    scoring: "category,stat_key,label,value,positions\nPassing,passing_yards,Passing yard,0.04,QB\n",
    roster: "code,label,positions,slot_group,minimum,maximum\nQB,Quarterback,QB,starter,1,1\n",
    schedule: "week_number,label,status,home_franchise_id,away_franchise_id,matchup_status\n1,Week 1,upcoming,FRANCHISE_UUID,FRANCHISE_UUID,upcoming\n",
    rules: "title,slug,version_label,content_markdown\nLeague Rules,league-rules,1.0,# Rules\n",
    finance: "entry_type,amount,status,memo\ndues,100,open,League dues\n",
  };
  const blob = new Blob([templates[module]], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `cvc-${module}-template.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function CommissionerPanel() {
  const [active, setActive] = useState<Module>("teams");
  const utils = trpc.useUtils();
  const [team, setTeam] = useState({ name: "", abbreviation: "", divisionName: "" });
  const [owner, setOwner] = useState({ displayName: "", email: "", role: "owner" });
  const [score, setScore] = useState({ category: "", statKey: "", label: "", value: "", positions: "" });
  const [slot, setSlot] = useState({ code: "", label: "", positions: "", group: "starter", minimum: "0", maximum: "1" });
  const [week, setWeek] = useState({ number: "", label: "", status: "upcoming" });
  const [matchup, setMatchup] = useState({ homeFranchiseId: "", awayFranchiseId: "", status: "upcoming" });
  const [rule, setRule] = useState({ title: "", slug: "", version: "1.0", content: "" });
  const [finance, setFinance] = useState({ type: "dues", amount: "", status: "open", memo: "" });
  const saveTeam = trpc.league.saveFranchise.useMutation({ onSuccess: data => { toast.success(`${data.name} added to CVC.`); setTeam({ name: "", abbreviation: "", divisionName: "" }); utils.league.overview.invalidate(); } });
  const saveOwner = trpc.league.saveOwner.useMutation({ onSuccess: () => { toast.success("CVC owner record saved."); setOwner({ displayName: "", email: "", role: "owner" }); } });
  const saveScore = trpc.league.saveScoringRule.useMutation({ onSuccess: () => { toast.success("Scoring rule saved."); setScore({ category: "", statKey: "", label: "", value: "", positions: "" }); } });
  const saveSlot = trpc.league.saveRosterSlot.useMutation({ onSuccess: () => { toast.success("Roster slot saved."); setSlot({ code: "", label: "", positions: "", group: "starter", minimum: "0", maximum: "1" }); } });
  const saveWeek = trpc.league.saveScheduleWeek.useMutation({ onSuccess: () => { toast.success("Schedule week saved."); setWeek({ number: "", label: "", status: "upcoming" }); utils.league.overview.invalidate(); } });
  const saveMatchup = trpc.league.saveMatchup.useMutation({ onSuccess: () => { toast.success("CVC matchup saved."); setMatchup({ homeFranchiseId: "", awayFranchiseId: "", status: "upcoming" }); utils.league.overview.invalidate(); } });
  const saveRule = trpc.league.saveRuleDocument.useMutation({ onSuccess: () => { toast.success("Rule document saved."); setRule({ title: "", slug: "", version: "1.0", content: "" }); } });
  const saveFinance = trpc.league.saveFinancialEntry.useMutation({ onSuccess: () => { toast.success("Financial entry saved."); setFinance({ type: "dues", amount: "", status: "open", memo: "" }); } });
  const overview = trpc.league.overview.useQuery();
  const description = useMemo(() => ({ teams: "Create CVC franchises, abbreviations, divisions, and identity records.", owners: "Register league members and grant owner, commissioner, or administrator access.", scoring: "Build CVC scoring one stat rule at a time; no calculation is hard-coded.", roster: "Define positions, eligibility, starters, bench, reserve, and taxi capacity.", schedule: "Create each league week, then add home/away matchups with CVC franchise selections.", rules: "Publish versioned commissioner-managed rules content without shipping code.", finance: "Record dues, payouts, credits, and other commissioner-controlled league entries.", protections: "At the protection deadline, flag every rostered player leaguewide whose contract expires this season and has no protection decision on file. Flagged players stay rostered until you process or exempt them below.", stats: "Cache season-total stats from Tank01 for display on Free Agents, and keep each player's current NFL team up to date after real-world trades or signings.", auction: "Set each franchise's starting CVC auction budget before auction night." })[active], [active]);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (active === "teams") saveTeam.mutate({ name: team.name, abbreviation: team.abbreviation, divisionName: team.divisionName || undefined });
    if (active === "owners") saveOwner.mutate({ displayName: owner.displayName, email: owner.email || undefined, role: owner.role as "owner" | "commissioner" | "administrator" });
    if (active === "scoring") saveScore.mutate({ category: score.category, statKey: score.statKey, label: score.label, value: Number(score.value), positions: score.positions.split(",").map(value => value.trim()).filter(Boolean) });
    if (active === "roster") saveSlot.mutate({ code: slot.code, label: slot.label, positions: slot.positions.split(",").map(value => value.trim()).filter(Boolean), slotGroup: slot.group as "starter" | "bench" | "reserve" | "injured_reserve" | "taxi", minimum: Number(slot.minimum), maximum: Number(slot.maximum) });
    if (active === "schedule") saveWeek.mutate({ weekNumber: Number(week.number), label: week.label, status: week.status as "upcoming" | "live" | "final" | "archived" });
    if (active === "rules") saveRule.mutate({ title: rule.title, slug: rule.slug, versionLabel: rule.version, contentMarkdown: rule.content });
    if (active === "finance") saveFinance.mutate({ entryType: finance.type as "dues" | "payout" | "penalty" | "credit" | "adjustment", amount: Number(finance.amount), status: finance.status as "open" | "paid" | "waived" | "void", memo: finance.memo || undefined });
  };
  const submitting = saveTeam.isPending || saveOwner.isPending || saveScore.isPending || saveSlot.isPending || saveWeek.isPending || saveMatchup.isPending || saveRule.isPending || saveFinance.isPending;

  return <div className="grid gap-6 xl:grid-cols-[0.38fr_1fr]"><section className="cvc-card"><div className="cvc-card-title">Setup modules</div><div className="cvc-card-stripe" /><div className="cvc-card-body"><div className="space-y-1">{modules.map(module => <button key={module.id} type="button" className={cn("cvc-config-link", active === module.id && "is-active")} onClick={() => setActive(module.id)}>{module.label}<ChevronRight size={15} /></button>)}</div><div className="mt-5 rounded-lg bg-cvc-tint p-3 text-xs leading-5 text-slate-500">Each form writes validated CVC settings through commissioner-only Supabase procedures and records an audit event.</div></div></section><section className="cvc-card"><div className="cvc-card-title"><span>Configure {active}</span><span className="text-[10px] font-bold uppercase tracking-[0.13em] text-cvc-accent">Live form</span></div><div className="cvc-card-stripe" /><div className="cvc-card-body"><p className="mb-6 text-sm leading-6 text-slate-600">{description}</p>{active === "protections" ? <PendingCutsModule /> : active === "stats" ? <SeasonStatsSyncModule /> : active === "auction" ? <AuctionBudgetModule /> : <form className="grid gap-4 sm:grid-cols-2" onSubmit={onSubmit}>{active === "teams" ? <><Field label="Franchise name" value={team.name} onChange={value => setTeam({ ...team, name: value })} /><Field label="Abbreviation" value={team.abbreviation} onChange={value => setTeam({ ...team, abbreviation: value })} /><Field label="Division" value={team.divisionName} onChange={value => setTeam({ ...team, divisionName: value })} /></> : null}{active === "owners" ? <><Field label="Display name" value={owner.displayName} onChange={value => setOwner({ ...owner, displayName: value })} /><Field label="Email" type="email" value={owner.email} onChange={value => setOwner({ ...owner, email: value })} /><label className="cvc-field"><span>Role</span><select value={owner.role} onChange={event => setOwner({ ...owner, role: event.target.value })}><option value="owner">Owner</option><option value="commissioner">Commissioner</option><option value="administrator">Administrator</option></select></label></> : null}{active === "scoring" ? <><Field label="Category" value={score.category} onChange={value => setScore({ ...score, category: value })} /><Field label="Stat key" value={score.statKey} onChange={value => setScore({ ...score, statKey: value })} /><Field label="Display label" value={score.label} onChange={value => setScore({ ...score, label: value })} /><Field label="Point value" type="number" value={score.value} onChange={value => setScore({ ...score, value })} /><Field label="Positions, comma separated" value={score.positions} onChange={value => setScore({ ...score, positions: value })} /></> : null}{active === "roster" ? <><Field label="Slot code" value={slot.code} onChange={value => setSlot({ ...slot, code: value.toUpperCase() })} /><Field label="Slot label" value={slot.label} onChange={value => setSlot({ ...slot, label: value })} /><Field label="Eligible positions" value={slot.positions} onChange={value => setSlot({ ...slot, positions: value })} /><label className="cvc-field"><span>Slot group</span><select value={slot.group} onChange={event => setSlot({ ...slot, group: event.target.value })}><option value="starter">Starter</option><option value="bench">Bench</option><option value="reserve">Reserve</option><option value="injured_reserve">Injured reserve</option><option value="taxi">Taxi</option></select></label><Field label="Minimum" type="number" value={slot.minimum} onChange={value => setSlot({ ...slot, minimum: value })} /><Field label="Maximum" type="number" value={slot.maximum} onChange={value => setSlot({ ...slot, maximum: value })} /></> : null}{active === "schedule" ? <><Field label="Week number" type="number" value={week.number} onChange={value => setWeek({ ...week, number: value })} /><Field label="Week label" value={week.label} onChange={value => setWeek({ ...week, label: value })} /><label className="cvc-field"><span>Week status</span><select value={week.status} onChange={event => setWeek({ ...week, status: event.target.value })}><option value="upcoming">Upcoming</option><option value="live">Live</option><option value="final">Final</option><option value="archived">Archived</option></select></label><div className="sm:col-span-2 mt-2 rounded-lg border border-dashed border-cvc-deep/20 bg-cvc-tint p-4"><p className="text-sm font-semibold text-cvc-deep">Add a matchup for this week</p><div className="mt-3 grid gap-4 sm:grid-cols-2"><label className="cvc-field"><span>Home franchise</span><select value={matchup.homeFranchiseId} onChange={event => setMatchup({ ...matchup, homeFranchiseId: event.target.value })}><option value="">Select franchise</option>{overview.data?.franchises.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><label className="cvc-field"><span>Away franchise</span><select value={matchup.awayFranchiseId} onChange={event => setMatchup({ ...matchup, awayFranchiseId: event.target.value })}><option value="">Select franchise</option>{overview.data?.franchises.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label></div><button type="button" className="cvc-button-compact mt-4" disabled={!week.number || !matchup.homeFranchiseId || !matchup.awayFranchiseId || saveMatchup.isPending} onClick={() => saveMatchup.mutate({ weekNumber: Number(week.number), homeFranchiseId: matchup.homeFranchiseId, awayFranchiseId: matchup.awayFranchiseId, resultState: matchup.status as "upcoming" | "live" | "final" | "corrected" })}><Plus size={14} /> Add matchup</button></div></> : null}{active === "rules" ? <><Field label="Title" value={rule.title} onChange={value => setRule({ ...rule, title: value })} /><Field label="Slug" value={rule.slug} onChange={value => setRule({ ...rule, slug: value })} /><Field label="Version" value={rule.version} onChange={value => setRule({ ...rule, version: value })} /><label className="cvc-field sm:col-span-2"><span>Rule content (Markdown)</span><textarea value={rule.content} onChange={event => setRule({ ...rule, content: event.target.value })} placeholder="Write the approved CVC rule language…" /></label></> : null}{active === "finance" ? <><label className="cvc-field"><span>Entry type</span><select value={finance.type} onChange={event => setFinance({ ...finance, type: event.target.value })}><option value="dues">Dues</option><option value="payout">Payout</option><option value="penalty">Penalty</option><option value="credit">Credit</option><option value="adjustment">Adjustment</option></select></label><Field label="Amount" type="number" value={finance.amount} onChange={value => setFinance({ ...finance, amount: value })} /><label className="cvc-field"><span>Status</span><select value={finance.status} onChange={event => setFinance({ ...finance, status: event.target.value })}><option value="open">Open</option><option value="paid">Paid</option><option value="waived">Waived</option><option value="void">Void</option></select></label><Field label="Memo" value={finance.memo} onChange={value => setFinance({ ...finance, memo: value })} /></> : null}<div className="sm:col-span-2 mt-2 flex flex-wrap gap-3"><button className="cvc-button-compact" disabled={submitting} type="submit"><Save size={14} /> {submitting ? "Saving…" : "Save configuration"}</button><label className="cvc-button-secondary cursor-pointer"><Upload size={14} /> Review CSV<input className="sr-only" type="file" accept=".csv" onChange={event => { if (event.target.files?.[0]) toast.info("CSV review is available; download the matching template for the expected columns."); }} /></label><button className="cvc-button-secondary" type="button" onClick={() => downloadTemplate(active)}><Plus size={14} /> Download template</button></div></form>}</div></section></div>;
}

function PendingCutsModule() {
  const utils = trpc.useUtils();
  const pendingCuts = trpc.league.pendingCuts.useQuery();
  const refresh = () => { void utils.league.pendingCuts.invalidate(); void utils.league.activity.invalidate(); void utils.league.freeAgents.invalidate(); void utils.league.overview.invalidate(); };
  const sweep = trpc.league.runAutoCutSweep.useMutation({
    onSuccess: data => {
      if (data.flaggedCount === 0) toast.info("No unprotected expiring contracts were found; nothing was flagged.");
      else toast.success(`Flagged ${data.flaggedCount} unprotected player${data.flaggedCount === 1 ? "" : "s"} with expiring contracts for review.`);
      refresh();
    },
  });
  const processCut = trpc.league.processPendingCut.useMutation({ onSuccess: refresh, onError: error => toast.error(error.message) });
  const exemptCut = trpc.league.exemptPendingCut.useMutation({ onSuccess: refresh, onError: error => toast.error(error.message) });
  const busy = processCut.isPending || exemptCut.isPending;
  const items = pendingCuts.data ?? [];

  const processAll = async () => {
    if (!items.length || !window.confirm(`Process all ${items.length} pending cuts? Each will be released and logged as a standard drop transaction.`)) return;
    for (const item of items) {
      try { await processCut.mutateAsync({ franchiseId: item.franchiseId, playerId: item.playerId }); } catch { /* surfaced via onError toast; continue with the rest */ }
    }
  };

  return <div className="grid gap-4">
    <button type="button" className="cvc-button-compact w-fit" disabled={sweep.isPending} onClick={() => { if (window.confirm("Run the protection deadline sweep now? Every rostered player leaguewide whose contract expires this season with no protection decision on file will be flagged for cut review below. No one is released yet.")) sweep.mutate(); }}><Scissors size={14} /> {sweep.isPending ? "Flagging…" : "Run protection deadline sweep"}</button>
    <div className="rounded-lg border border-dashed border-cvc-deep/20 bg-cvc-tint p-4">
      <div className="mb-3 flex items-center justify-between"><p className="text-sm font-semibold text-cvc-deep">Pending cuts</p><span className="text-xs font-bold uppercase tracking-[0.08em] text-slate-500">{items.length}</span></div>
      {pendingCuts.isLoading ? <p className="text-sm text-slate-500">Loading pending cuts…</p> : items.length ? <>
        <button type="button" className="cvc-button-secondary mb-3" disabled={busy} onClick={processAll}><Scissors size={14} /> Process all pending cuts</button>
        <div className="space-y-2">{items.map(item => <div key={`${item.franchiseId}-${item.playerId}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3"><div><p className="font-semibold text-cvc-deep">{item.playerName} <span className="font-normal text-slate-500">· {item.franchiseName}</span></p><p className="text-xs text-slate-500">{item.position ?? "—"} · {item.nflTeam ?? "FA"} · ${item.salary.toFixed(0)} · expires {item.expiresYear ?? "—"}</p></div><div className="flex gap-2"><button type="button" disabled={busy} className="rounded-md bg-cvc-deep px-3 py-1.5 text-xs font-bold uppercase tracking-[0.06em] text-white disabled:opacity-50" onClick={() => { if (window.confirm(`Process the cut for ${item.playerName}? This releases them and logs a drop transaction.`)) processCut.mutate({ franchiseId: item.franchiseId, playerId: item.playerId }); }}>Process cut</button><button type="button" disabled={busy} className="rounded-md border border-cvc-deep/20 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.06em] text-cvc-deep disabled:opacity-50" onClick={() => { if (window.confirm(`Exempt ${item.playerName} from this cut cycle? No transaction will be created and they remain rostered.`)) exemptCut.mutate({ franchiseId: item.franchiseId, playerId: item.playerId }); }}>Exempt</button></div></div>)}</div>
      </> : <p className="text-sm text-slate-500">No players are currently pending a cut decision.</p>}
    </div>
  </div>;
}

function SeasonStatsSyncModule() {
  const utils = trpc.useUtils();
  const sync = trpc.league.syncSeasonStats.useMutation({
    onSuccess: data => {
      if (data.status === "skipped") { toast.error(data.reason ?? "Season stats sync is unavailable."); return; }
      const errorNote = data.updated === 0 && data.sampleError ? ` Sample error: ${data.sampleError}` : "";
      if (data.updated === 0 && data.attempted > 0) toast.error(`Synced 0 of ${data.attempted} players — something's likely wrong (rate limit, timeout, or API issue), not just unmatched names.${errorNote}`);
      else toast.success(`Synced ${data.updated} of ${data.attempted} players${data.notFound ? ` (${data.notFound} not found on Tank01)` : ""}${data.teamsUpdated ? ` — ${data.teamsUpdated} moved to a new NFL team` : ""}.${data.remaining ? ` ${data.remaining} still pending — click again to continue.` : " All players are up to date."}${errorNote}`);
    },
    onError: error => toast.error(error.message),
  });
  // Runs the same batch mutation repeatedly (client-side loop, no new endpoint needed)
  // until nothing remains, instead of requiring a manual click per batch of 40 -- with
  // a large player pool (600+ after tonight's cleanup) that could mean ~15 clicks.
  // Shows one running progress line instead of a toast per batch to avoid spamming 15
  // separate notifications.
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [autoProgress, setAutoProgress] = useState<{ totalUpdated: number; totalAttempted: number } | null>(null);
  const syncAll = async () => {
    setAutoSyncing(true);
    let totalUpdated = 0; let totalAttempted = 0;
    try {
      // Safety cap: stops after 60 batches (2400 players) even if something keeps
      // reporting remaining > 0, so a bug elsewhere can't loop this forever.
      for (let i = 0; i < 60; i += 1) {
        const result = await sync.mutateAsync({});
        if (result.status === "skipped") { toast.error(result.reason ?? "Season stats sync is unavailable."); break; }
        totalUpdated += result.updated; totalAttempted += result.attempted;
        setAutoProgress({ totalUpdated, totalAttempted });
        if (!result.remaining) { toast.success(`All players are up to date — synced ${totalUpdated} total.`); break; }
      }
    } finally {
      setAutoSyncing(false);
      await utils.league.freeAgents.invalidate();
    }
  };
  const [rookieResult, setRookieResult] = useState<null | { countByPosition: Record<string, number>; matchedInDb: number; notYetSynced: number; flaggedNow: number; clearedStale: number; errors: Record<string, string>; samplePlayers?: Record<string, unknown> }>(null);
  const [activeResult, setActiveResult] = useState<null | { teamsProcessed: number; totalRosterPlayers: number; matchedByStoredId: number; matchedByNameNewlyLinked: number; matchedDst: number; errors: Record<string, string>; sampleRosterPlayer?: unknown }>(null);
  const syncPlayers = trpc.league.syncFantasyProsPlayers.useMutation({
    onSuccess: data => toast.success(`Synced ${data.totalReceived} players from FantasyPros (${data.inserted} new, ${data.enriched} updated).`),
    onError: error => toast.error(error.message),
  });
  const [nflTeamResult, setNflTeamResult] = useState<null | { rosterRowsFetched: number; matchedPlayers: number; updated: number; updatedPlayers: { displayName: string; from: string | null; to: string }[] }>(null);
  const syncNflTeams = trpc.league.syncNflTeamAssignments.useMutation({
    onSuccess: async data => {
      setNflTeamResult(data);
      await Promise.all([utils.league.freeAgents.invalidate(), utils.league.allPlayers.invalidate()]);
      toast.success(`Corrected ${data.updated} player NFL team assignment${data.updated === 1 ? "" : "s"} from nflverse's current roster data (${data.matchedPlayers} players matched).`);
    },
    onError: error => toast.error(error.message),
  });
  const [waiverResult, setWaiverResult] = useState<null | { resolved: boolean; message?: string; periodLabel?: string; playersContested?: number; awarded?: { playerName: string; franchiseName: string; amount: number; droppedPlayerName: string | null }[]; skipped?: { playerName: string; franchiseName: string; reason: string }[]; nextPeriodLabel?: string | null }>(null);
  const runWaiverResolution = trpc.league.runWaiverResolution.useMutation({
    onSuccess: async data => {
      setWaiverResult(data);
      await Promise.all([utils.league.freeAgents.invalidate(), utils.league.allPlayers.invalidate(), utils.league.waiverBidQueue.invalidate()]);
      toast.success(data.resolved ? `Resolved ${data.periodLabel}: ${data.awarded?.length ?? 0} player(s) awarded.` : (data.message ?? "No period was due yet."));
    },
    onError: error => toast.error(error.message),
  });
  const [waiverTerminationResult, setWaiverTerminationResult] = useState<null | { terminated: { playerName: string; franchiseName: string }[] }>(null);
  const terminateWaiverContracts = trpc.league.terminateExpiredWaiverContracts.useMutation({
    onSuccess: async data => {
      setWaiverTerminationResult(data);
      await Promise.all([utils.league.freeAgents.invalidate(), utils.league.allPlayers.invalidate()]);
      toast.success(`Terminated ${data.terminated.length} waiver-acquired contract(s) at season's end.`);
    },
    onError: error => toast.error(error.message),
  });
  const syncActive = trpc.league.syncTank01ActiveRoster.useMutation({
    onSuccess: async data => {
      setActiveResult(data);
      await Promise.all([utils.auction.eligiblePlayers.invalidate(), utils.league.freeAgents.invalidate()]);
      const errorNote = Object.keys(data.errors).length ? ` (errors for: ${Object.keys(data.errors).join(", ")})` : "";
      toast.success(`Confirmed ${data.matchedByStoredId + data.matchedByNameNewlyLinked} rostered players + ${data.matchedDst} defenses as active, from ${data.teamsProcessed} teams (${data.matchedByNameNewlyLinked} newly linked to a permanent Tank01 ID).${errorNote} Retired/departed players will now fall out of Free Agents and the auction pool.`);
    },
    onError: error => toast.error(error.message),
  });
  const syncRookies = trpc.league.syncFantasyProsRookies.useMutation({
    onSuccess: data => {
      setRookieResult(data);
      void utils.league.eligibleRookies.invalidate();
      const errorNote = Object.keys(data.errors).length ? ` (errors for: ${Object.keys(data.errors).join(", ")})` : "";
      if (data.flaggedNow === 0 && data.matchedInDb === 0) toast.error(`No rookies matched — the FantasyPros ranking type guess may be wrong${errorNote}. See the breakdown below.`);
      else toast.success(`Flagged ${data.flaggedNow} new rookies, cleared ${data.clearedStale} stale flags.${errorNote}`);
    },
    onError: error => toast.error(error.message),
  });
  return <div className="grid gap-4">
    <div className="rounded-lg border border-dashed border-cvc-deep/20 bg-cvc-tint p-4">
      <p className="text-sm font-semibold text-cvc-deep">Season stats sync</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">Pulls season-total stats from Tank01 for every rostered and free-agent CVC player (QB/RB/WR/TE/K/DST), caches them for display on Free Agents, and updates each player's current NFL team on their CVC record (skipped for D/ST, since that record is the team itself). Each click processes up to 40 players who haven't been synced in the last 12 hours — click repeatedly until "All players are up to date" if the pool is large.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3"><button type="button" className="cvc-button-compact" disabled={sync.isPending || autoSyncing} onClick={() => sync.mutate({})}><Save size={14} /> {sync.isPending && !autoSyncing ? "Syncing…" : "Sync next batch"}</button><button type="button" className="cvc-button-secondary" disabled={sync.isPending || autoSyncing} onClick={syncAll}>{autoSyncing ? "Syncing all…" : "Sync all players"}</button>{autoProgress ? <span className="text-xs text-slate-500">{autoProgress.totalUpdated} of {autoProgress.totalAttempted} synced so far{autoSyncing ? "…" : "."}</span> : null}</div>
    </div>
    <div className="rounded-lg border border-dashed border-cvc-deep/20 bg-cvc-tint p-4">
      <p className="text-sm font-semibold text-cvc-deep">FantasyPros players</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">Syncs the FantasyPros player list (names, positions, NFL teams). This is FantasyPros' full player database, not scoped to currently-active players — it does not affect who shows up in Free Agents or the auction pool. Use "Confirm active players" below for that.</p>
      <button type="button" className="cvc-button-compact mt-3" disabled={syncPlayers.isPending} onClick={() => syncPlayers.mutate()}><Save size={14} /> {syncPlayers.isPending ? "Syncing…" : "Sync FantasyPros players"}</button>
    </div>
    <div className="rounded-lg border border-dashed border-cvc-deep/20 bg-cvc-tint p-4">
      <p className="text-sm font-semibold text-cvc-deep">Confirm active players</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">Pulls every current 32-team NFL roster directly from Tank01 and marks every matched CVC player as confirmed active (all 32 defenses are always marked active too). A retired or departed player simply can't appear on a current team roster, so this is what keeps them out of Free Agents and the auction pool. Each player only needs to be matched by name once — after that, their Tank01 ID is stored permanently and every future run is an exact ID lookup, not a fuzzy name match. A player who drops off a later sync (no longer rostered anywhere) ages out of eligibility automatically. Run this periodically (weekly is plenty) to keep it accurate.</p>
      <button type="button" className="cvc-button-compact mt-3" disabled={syncActive.isPending} onClick={() => syncActive.mutate()}><Save size={14} /> {syncActive.isPending ? "Syncing…" : "Confirm active players"}</button>
      {activeResult ? <div className="mt-3 rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-600">
        <p><b className="text-cvc-deep">Teams processed:</b> {activeResult.teamsProcessed} · <b className="text-cvc-deep">Total rostered players seen:</b> {activeResult.totalRosterPlayers}</p>
        <p className="mt-1"><b className="text-cvc-deep">Matched by stored Tank01 ID:</b> {activeResult.matchedByStoredId} · <b className="text-cvc-deep">Newly matched by name and permanently linked:</b> {activeResult.matchedByNameNewlyLinked} · <b className="text-cvc-deep">Defenses confirmed:</b> {activeResult.matchedDst}</p>
        {Object.keys(activeResult.errors).length ? <p className="mt-1 text-red-700"><b>Team fetch errors:</b> {Object.entries(activeResult.errors).map(([team, message]) => `${team}: ${message}`).join("; ")}</p> : null}
        {activeResult.sampleRosterPlayer ? <details className="mt-2"><summary className="cursor-pointer text-cvc-deep">Raw sample roster player (for checking the name field)</summary><pre className="mt-1 max-h-64 overflow-auto rounded bg-slate-50 p-2 text-[10px]">{JSON.stringify(activeResult.sampleRosterPlayer, null, 2)}</pre></details> : null}
      </div> : null}
    </div>
    <div className="rounded-lg border border-dashed border-cvc-deep/20 bg-cvc-tint p-4">
      <p className="text-sm font-semibold text-cvc-deep">NFL team assignments</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">Pulls nflverse's current roster CSV and corrects any player whose CVC record shows a stale or wrong NFL team (trades, signings, or code-format mismatches like JAX vs. JAC). Matches by name + position, not name alone, so two different real players who happen to share a name are never confused. Safe to run any time; only writes when a player's actual team has changed.</p>
      <button type="button" className="cvc-button-compact mt-3" disabled={syncNflTeams.isPending} onClick={() => syncNflTeams.mutate()}><Save size={14} /> {syncNflTeams.isPending ? "Syncing…" : "Sync NFL team assignments"}</button>
      {nflTeamResult ? <div className="mt-3 rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-600">
        <p><b className="text-cvc-deep">Roster rows fetched:</b> {nflTeamResult.rosterRowsFetched} · <b className="text-cvc-deep">Players matched:</b> {nflTeamResult.matchedPlayers} · <b className="text-cvc-deep">Corrected:</b> {nflTeamResult.updated}</p>
        {nflTeamResult.updatedPlayers.length ? <ul className="mt-2 space-y-0.5">{nflTeamResult.updatedPlayers.map(item => <li key={item.displayName}>{item.displayName}: {item.from ?? "—"} → {item.to}</li>)}</ul> : null}
      </div> : null}
    </div>
    <div className="rounded-lg border border-dashed border-cvc-deep/20 bg-cvc-tint p-4">
      <p className="text-sm font-semibold text-cvc-deep">Waiver resolution</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">Runs automatically every Thursday and Sunday at 9:00am ET (highest bid wins each player; ties go to the worse-record team; awarded players join the roster at their bid as salary and can't be cut until the following resolution). This button re-runs the exact same engine on demand — safe to click any time, including outside the scheduled window; it only does anything if a waiver period is currently past its close time.</p>
      <button type="button" className="cvc-button-compact mt-3" disabled={runWaiverResolution.isPending} onClick={() => runWaiverResolution.mutate()}><Save size={14} /> {runWaiverResolution.isPending ? "Resolving…" : "Run waiver resolution now"}</button>
      {waiverResult ? <div className="mt-3 rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-600">
        {waiverResult.resolved ? <>
          <p><b className="text-cvc-deep">Resolved:</b> {waiverResult.periodLabel} · <b className="text-cvc-deep">Players contested:</b> {waiverResult.playersContested} · <b className="text-cvc-deep">Next period:</b> {waiverResult.nextPeriodLabel ?? "—"}</p>
          {waiverResult.awarded?.length ? <div className="mt-2"><p className="font-semibold text-cvc-deep">Awarded</p><ul className="mt-1 space-y-0.5">{waiverResult.awarded.map((item, index) => <li key={index}>{item.franchiseName} won {item.playerName} for ${item.amount}{item.droppedPlayerName ? ` (dropped ${item.droppedPlayerName})` : ""}</li>)}</ul></div> : null}
          {waiverResult.skipped?.length ? <div className="mt-2"><p className="font-semibold text-amber-700">Skipped</p><ul className="mt-1 space-y-0.5">{waiverResult.skipped.map((item, index) => <li key={index}>{item.franchiseName} on {item.playerName}: {item.reason}</li>)}</ul></div> : null}
        </> : <p>{waiverResult.message}</p>}
      </div> : null}
    </div>
    <div className="rounded-lg border border-dashed border-red-300 bg-red-50 p-4">
      <p className="text-sm font-semibold text-cvc-deep">End of season: terminate waiver contracts</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">Releases every remaining waiver-acquired ('W') contract that's reached its expiration this season, except for each franchise's one protected player (assigned via the "waiver right" option on the Protections page — run that per franchise first). This is the automatic "terminate the rest" half of the season-end waiver rule; run it once, after every owner has had a chance to make their one restricted-rights designation.</p>
      <button type="button" className="cvc-button-compact mt-3 bg-red-600 hover:bg-red-700" disabled={terminateWaiverContracts.isPending} onClick={() => { if (window.confirm("This releases every remaining waiver-acquired contract league-wide, except each franchise's one protected player. Are you sure everyone has made their designation?")) terminateWaiverContracts.mutate(); }}><Save size={14} /> {terminateWaiverContracts.isPending ? "Terminating…" : "Terminate expired waiver contracts"}</button>
      {waiverTerminationResult ? <div className="mt-3 rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-600">
        <p><b className="text-cvc-deep">Terminated:</b> {waiverTerminationResult.terminated.length}</p>
        {waiverTerminationResult.terminated.length ? <ul className="mt-2 space-y-0.5">{waiverTerminationResult.terminated.map((item, index) => <li key={index}>{item.franchiseName}: {item.playerName}</li>)}</ul> : null}
      </div> : null}
    </div>
    <div className="rounded-lg border border-dashed border-red-300 bg-red-50 p-4">
      <p className="text-sm font-semibold text-cvc-deep">Rookie flag sync <span className="font-normal text-red-700">— experimental, not recommended</span></p>
      <p className="mt-1 text-xs leading-5 text-slate-500">Attempts to flag rookies via FantasyPros' rookie-rankings endpoint using a guessed ranking-type parameter that's been confirmed to return incorrect results (it returned Josh Allen as a "rookie" QB in testing). The season's actual rookie flags were instead set correctly via a one-time manual match against FantasyPros' real rookie-rankings CSV export. Running this again would overwrite those correct flags with wrong data — only use it if you're deliberately re-attempting the API approach for a future season, not as routine maintenance.</p>
      <button type="button" className="cvc-button-compact mt-3 bg-red-600 hover:bg-red-700" disabled={syncRookies.isPending} onClick={() => { if (window.confirm("This will overwrite the currently-correct rookie flags with results from a guessed, previously-wrong API parameter. Are you sure?")) syncRookies.mutate(); }}><Save size={14} /> {syncRookies.isPending ? "Syncing…" : "Attempt rookie flag sync anyway"}</button>
      {rookieResult ? <div className="mt-3 rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-600">
        <p><b className="text-cvc-deep">Rookies found on FantasyPros by position:</b> {Object.entries(rookieResult.countByPosition).map(([pos, count]) => `${pos}: ${count}`).join(", ") || "none"}</p>
        <p className="mt-1"><b className="text-cvc-deep">Matched to a synced CVC player:</b> {rookieResult.matchedInDb} · <b className="text-cvc-deep">Not yet in CVC's player list:</b> {rookieResult.notYetSynced}</p>
        <p className="mt-1"><b className="text-cvc-deep">Newly flagged as rookie:</b> {rookieResult.flaggedNow} · <b className="text-cvc-deep">Stale flags cleared:</b> {rookieResult.clearedStale}</p>
        {Object.keys(rookieResult.errors).length ? <p className="mt-1 text-red-700"><b>Errors:</b> {Object.entries(rookieResult.errors).map(([pos, message]) => `${pos}: ${message}`).join("; ")}</p> : null}
        {rookieResult.samplePlayers ? <details className="mt-2"><summary className="cursor-pointer text-cvc-deep">Raw sample player per position (for checking a draft-year field)</summary><pre className="mt-1 max-h-64 overflow-auto rounded bg-slate-50 p-2 text-[10px]">{JSON.stringify(rookieResult.samplePlayers, null, 2)}</pre></details> : null}
      </div> : null}
    </div>
  </div>;
}

function AuctionBudgetModule() {
  const overview = trpc.league.overview.useQuery();
  const utils = trpc.useUtils();
  const [franchiseId, setFranchiseId] = useState("");
  const [budget, setBudget] = useState("115");
  const save = trpc.auction.setBudget.useMutation({ onSuccess: () => { void utils.auction.board.invalidate(); setFranchiseId(""); toast.success("Budget saved."); }, onError: error => toast.error(error.message) });
  return <div className="grid gap-4">
    <div className="rounded-lg border border-dashed border-cvc-deep/20 bg-cvc-tint p-4">
      <p className="text-sm font-semibold text-cvc-deep">Set a franchise's starting budget</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_160px_auto]">
        <select className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm" value={franchiseId} onChange={e => setFranchiseId(e.target.value)}><option value="">Select franchise</option>{overview.data?.franchises.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select>
        <input className="rounded-md border border-slate-200 px-3 py-2 text-sm" type="number" min="0" max="115" value={budget} onChange={e => setBudget(e.target.value)} />
        <button className="cvc-button-compact" disabled={!franchiseId || save.isPending} onClick={() => save.mutate({ franchiseId, startingBudget: Number(budget) })}>Save budget</button>
      </div>
      <p className="mt-3 text-xs text-slate-500">Set each franchise's starting budget before auction night. CVC rejects budgets above $115.</p>
    </div>
  </div>;
}
