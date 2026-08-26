// @ts-nocheck
import { LeagueLayout } from "@/components/LeagueLayout";
import { DraftSubNav } from "@/components/DraftSubNav";
import { trpc } from "@/lib/trpc";
import { useCvcOwnerAuth } from "@/hooks/useCvcOwnerAuth";
import { bestMatch, parseSalaryFromTranscript, useSpeechRecognition } from "@/lib/voicePickUtils";
import { Gavel, Mic, PauseCircle, Search, ShieldCheck, Trophy, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";

const money = (value: number) => `$${value}`;
// Supabase's embedded-relation results can come back as either a single object or a
// one-element array depending on the relationship shape, and this file assumed array
// form everywhere (firstOf(team.franchise)?.name) — for a straightforward many-to-one
// relation like auction_team_state -> franchise, it's actually a plain object, so that
// access silently evaluated to undefined for every row (options rendered, just with no
// visible text). Normalizes either shape to a single object.
const firstOf = (value: any) => Array.isArray(value) ? value[0] : value;

function VoicePickRecorder({ teams }: { teams: any[] }) {
  const utils = trpc.useUtils();
  // Loads the full eligible pool once (no search filter) so voice matching can score
  // against every candidate locally, not just an alphabetically-truncated slice — the
  // previous 150-player cap meant anyone whose name fell later in the alphabet than
  // roughly the first 150 eligible players couldn't be voice-matched at all.
  const eligible = trpc.auction.eligiblePlayers.useQuery({ limit: 1000 });
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [parsedPlayerId, setParsedPlayerId] = useState("");
  const [parsedFranchiseId, setParsedFranchiseId] = useState("");
  const [parsedAmount, setParsedAmount] = useState("");

  const recognition = useMemo(() => useSpeechRecognition(), []);

  const record = trpc.auction.recordPick.useMutation({
    onSuccess: async () => {
      setTranscript(""); setParsedPlayerId(""); setParsedFranchiseId(""); setParsedAmount("");
      await Promise.all([utils.auction.board.invalidate(), utils.auction.eligiblePlayers.invalidate(), utils.league.freeAgents.invalidate(), utils.league.overview.invalidate()]);
    },
  });

  const parse = (text: string) => {
    const amount = parseSalaryFromTranscript(text);
    const playerMatch = bestMatch(text, eligible.data ?? [], (p: any) => p.display_name);
    const franchiseMatch = bestMatch(text, teams, (t: any) => firstOf(t.franchise)?.name ?? "");
    setParsedAmount(amount ? String(amount) : "");
    setParsedPlayerId(playerMatch ? playerMatch.item.id : "");
    setParsedFranchiseId(franchiseMatch ? franchiseMatch.item.franchise_id : "");
  };

  const startListening = () => {
    if (!recognition) return;
    recognition.onresult = (event: any) => { const text = event.results[0][0].transcript; setTranscript(text); parse(text); };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    setListening(true);
    recognition.start();
  };
  const stopListening = () => { recognition?.stop(); setListening(false); };
  const clear = () => { setTranscript(""); setParsedPlayerId(""); setParsedFranchiseId(""); setParsedAmount(""); };

  const selectedPlayer = eligible.data?.find((p: any) => p.id === parsedPlayerId);
  const selectedTeam = teams.find(t => t.franchise_id === parsedFranchiseId);

  if (!recognition) return <section className="cvc-card mb-6"><div className="cvc-card-title">Voice pick recorder</div><div className="cvc-card-stripe" /><div className="cvc-card-body"><p className="text-sm text-slate-600">Voice recording isn't supported in this browser. Try Chrome on desktop or Android.</p></div></section>;

  return <section className="cvc-card mb-6"><div className="cvc-card-title"><span>Voice pick recorder</span><span className="text-[10px] font-bold uppercase tracking-[.13em] text-cvc-accent">Beta</span></div><div className="cvc-card-stripe" /><div className="cvc-card-body">
    <p className="text-xs text-slate-500">For picks called live in the room. Say the player, winning franchise, and salary — e.g. "Ashton Jeanty, Miller Time, sixteen dollars." Review and correct the parsed result before confirming; nothing is recorded until you confirm.</p>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button type="button" onClick={listening ? stopListening : startListening} className={listening ? "cvc-button-compact bg-red-600 hover:bg-red-700" : "cvc-button-compact"}><Mic size={14} /> {listening ? "Listening… tap to stop" : "Tap to speak a pick"}</button>
      {transcript ? <p className="text-sm italic text-slate-600">Heard: "{transcript}"</p> : null}
    </div>
    {transcript ? <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <label className="cvc-field"><span>Player</span><select value={parsedPlayerId} onChange={event => setParsedPlayerId(event.target.value)} className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"><option value="">Not matched — choose manually</option>{eligible.data?.map((p: any) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label>
      <label className="cvc-field"><span>Winning franchise</span><select value={parsedFranchiseId} onChange={event => setParsedFranchiseId(event.target.value)} className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"><option value="">Not matched — choose manually</option>{teams.map(t => <option key={t.franchise_id} value={t.franchise_id}>{firstOf(t.franchise)?.name}</option>)}</select></label>
      <label className="cvc-field"><span>Salary</span><input value={parsedAmount} onChange={event => setParsedAmount(event.target.value.replace(/\D/g, ""))} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" inputMode="numeric" /></label>
    </div> : null}
    {transcript ? <div className="mt-4 flex flex-wrap items-center gap-3">
      <button type="button" disabled={!parsedPlayerId || !parsedFranchiseId || !parsedAmount || record.isPending} onClick={() => record.mutate({ playerId: parsedPlayerId, franchiseId: parsedFranchiseId, amount: Number(parsedAmount) })} className="cvc-button-compact disabled:cursor-not-allowed disabled:opacity-50">{record.isPending ? "Recording…" : `Confirm: ${selectedPlayer?.display_name ?? "?"} to ${firstOf(selectedTeam?.franchise)?.name ?? "?"} for $${parsedAmount || "?"}`}</button>
      <button type="button" onClick={clear} className="text-xs font-bold uppercase tracking-[.08em] text-slate-500">Clear</button>
    </div> : null}
    {record.error ? <p className="mt-2 text-sm text-red-700">{record.error.message}</p> : null}
  </div></section>;
}


function PlayerPool() {
  const [search, setSearch] = useState(""); const [position, setPosition] = useState("");
  const input = useMemo(() => ({ search: search.trim() || undefined, position: position || undefined, limit: 75 }), [position, search]);
  const players = trpc.auction.eligiblePlayers.useQuery(input);
  return <section id="auction-players" className="cvc-card mt-6 scroll-mt-36"><div className="cvc-card-title"><span>Eligible auction players</span><span className="text-[10px] font-bold uppercase tracking-[.13em] text-cvc-accent">Regular pool</span></div><div className="cvc-card-stripe" /><div className="cvc-card-body"><div className="mb-4 grid gap-3 sm:grid-cols-[1fr_170px]"><label className="relative"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search eligible player" className="w-full rounded-md border border-slate-200 py-2 pl-9 pr-3 text-sm" /></label><select value={position} onChange={event => setPosition(event.target.value)} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"><option value="">All positions</option>{["QB", "RB", "WR", "TE", "K", "DST"].map(item => <option key={item} value={item}>{item}</option>)}</select></div>{players.isLoading ? <p className="py-5 text-sm text-slate-500">Loading eligible players…</p> : players.data?.length ? <div className="overflow-x-auto"><table className="cvc-table min-w-[620px]"><thead><tr><th>Player</th><th>Pos</th><th>NFL team</th><th>Pool status</th></tr></thead><tbody>{players.data.map(player => <tr key={player.id}><td className="font-semibold"><Link href={`/player/${player.id}`} className="text-cvc-deep hover:text-cvc-accent">{player.display_name}</Link></td><td>{player.position || "—"}</td><td>{player.nfl_team || "FA"}</td><td><span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-emerald-700">Eligible</span></td></tr>)}</tbody></table></div> : <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-7 text-center text-sm text-slate-500">No regular-auction players match this filter.</p>}<p className="mt-4 text-xs text-slate-500">Unrostered non-rookies are eligible here. Rookie selections are handled in the separate rookie draft.</p></div></section>;
}

function CommissionerControls({ teams, recent }: { teams: any[]; recent: any[] }) {
  const utils = trpc.useUtils();
  const [playerSearch, setPlayerSearch] = useState(""); const [playerId, setPlayerId] = useState(""); const [selectedPlayerLabel, setSelectedPlayerLabel] = useState(""); const [showSuggestions, setShowSuggestions] = useState(false);
  const [winnerId, setWinnerId] = useState(""); const [amount, setAmount] = useState("1"); const [correctionId, setCorrectionId] = useState("");
  const suggestions = trpc.auction.eligiblePlayers.useQuery({ search: playerSearch.trim() || undefined, limit: 8 }, { enabled: playerSearch.trim().length > 1 && !playerId });
  const refresh = async () => Promise.all([utils.auction.board.invalidate(), utils.auction.eligiblePlayers.invalidate(), utils.league.freeAgents.invalidate(), utils.league.overview.invalidate()]);
  const record = trpc.auction.recordPick.useMutation({ onSuccess: async () => { setPlayerSearch(""); setPlayerId(""); setSelectedPlayerLabel(""); setWinnerId(""); setAmount("1"); await refresh(); } });
  const correct = trpc.auction.correctAward.useMutation({ onSuccess: async () => { setCorrectionId(""); await refresh(); } });
  const selectedTeam = teams.find(team => team.franchise_id === winnerId); const legalMax = selectedTeam ? Math.max(0, selectedTeam.starting_budget - selectedTeam.spent_budget - Math.max(0, 14 - selectedTeam.roster_count)) : null;
  const selectPlayer = (player: any) => { setPlayerId(player.id); setSelectedPlayerLabel(`${player.display_name} · ${player.position || "—"} · ${player.nfl_team || "FA"}`); setPlayerSearch(""); setShowSuggestions(false); };
  const clearPlayer = () => { setPlayerId(""); setSelectedPlayerLabel(""); setPlayerSearch(""); };
  return <section className="cvc-card mb-6"><div className="cvc-card-title">Record a pick</div><div className="cvc-card-stripe" /><div className="cvc-card-body"><p className="mb-4 text-xs text-slate-500">Nominations and bidding happen live in the room — this just records the result: who won, for how much.</p><div className="grid gap-6 lg:grid-cols-3"><div><p className="text-[10px] font-bold uppercase tracking-[.13em] text-slate-500">Player</p><div className="relative mt-3">{playerId ? <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm"><span className="font-semibold text-cvc-deep">{selectedPlayerLabel}</span><button type="button" onClick={clearPlayer} className="text-xs font-bold uppercase tracking-[.06em] text-slate-500 hover:text-cvc-accent">Change</button></div> : <><input value={playerSearch} onChange={event => { setPlayerSearch(event.target.value); setShowSuggestions(true); }} onFocus={() => setShowSuggestions(true)} placeholder="Search player name" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />{showSuggestions && playerSearch.trim().length > 1 ? <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl">{suggestions.isLoading ? <p className="px-3 py-2 text-xs text-slate-400">Searching…</p> : suggestions.data?.length ? suggestions.data.map((player: any) => <button type="button" key={player.id} onClick={() => selectPlayer(player)} className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-50"><span className="font-semibold text-cvc-deep">{player.display_name}</span> <span className="text-xs text-slate-500">· {player.position || "—"} · {player.nfl_team || "FA"}</span></button>) : <p className="px-3 py-2 text-xs text-slate-400">No eligible players match.</p>}</div> : null}</>}</div></div><div><p className="text-[10px] font-bold uppercase tracking-[.13em] text-slate-500">Franchise</p><div className="mt-3"><select value={winnerId} onChange={event => setWinnerId(event.target.value)} className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"><option value="">Choose winning franchise</option>{teams.map(team => <option key={team.franchise_id} value={team.franchise_id}>{firstOf(team.franchise)?.name}</option>)}</select><p className="mt-2 text-xs text-slate-500">{legalMax !== null ? `Maximum legal bid now: ${money(legalMax)}` : "Select a franchise to calculate its legal maximum."}</p></div></div><div><p className="text-[10px] font-bold uppercase tracking-[.13em] text-slate-500">Salary</p><div className="mt-3 space-y-3"><input value={amount} onChange={event => setAmount(event.target.value.replace(/\D/g, ""))} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" inputMode="numeric" placeholder="Winning bid" /><button disabled={!playerId || !winnerId || Number(amount) < 1 || record.isPending} onClick={() => record.mutate({ playerId, franchiseId: winnerId, amount: Number(amount) })} className="cvc-button-compact w-full disabled:cursor-not-allowed disabled:opacity-50">{record.isPending ? "Recording…" : "Record pick"}</button>{record.error ? <p className="text-sm text-red-700">{record.error.message}</p> : null}</div></div></div><div className="mt-6 border-t border-slate-200 pt-6"><p className="text-[10px] font-bold uppercase tracking-[.13em] text-slate-500">Correct a pick</p><div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]"><select value={correctionId} onChange={event => setCorrectionId(event.target.value)} className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"><option value="">Choose recent award</option>{recent.map(item => <option key={item.id} value={item.id}>{firstOf(item.player)?.display_name} · {firstOf(item.leader)?.name} · {money(item.high_bid || 0)}</option>)}</select><button disabled={!correctionId || correct.isPending} onClick={() => { if (window.confirm("Correct this auction award? The player will be released and budget restored.")) correct.mutate({ nominationId: correctionId }); }} className="cvc-button-secondary disabled:cursor-not-allowed disabled:opacity-50">{correct.isPending ? "Correcting…" : "Undo award"}</button></div>{correct.error ? <p className="mt-2 text-sm text-red-700">{correct.error.message}</p> : null}</div></div></section>;
}

export default function Auction({ controls: requestedControls = false }: { controls?: boolean }) {
  const { owner } = useCvcOwnerAuth();
  const controls = requestedControls || ["commissioner", "administrator"].includes(owner?.role ?? "");
  const board = trpc.auction.board.useQuery(); const data: any = board.data;
  if (board.isLoading) return <LeagueLayout><div className="cvc-card p-8 text-center text-slate-500">Loading CVC auction room…</div></LeagueLayout>;
  if (board.error || !data) return <LeagueLayout><div className="cvc-card p-8 text-center text-slate-500">Auction setup is not yet available. Configure the CVC auction draft first.</div></LeagueLayout>;
  const teams = data.states ?? []; const recent = data.recent ?? [];
  return <LeagueLayout><DraftSubNav current="board" /><div id="auction-board" className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><div className="cvc-eyebrow"><Gavel size={14} /> CVC Auction Draft</div><h1 className="mt-2 font-display text-5xl uppercase leading-none tracking-[.04em] text-white sm:text-6xl">Auction Room</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-cvc-muted">Nominations and bidding happen live in the room. The commissioner records each result here.</p></div>{controls ? <span className="cvc-button-compact"><PauseCircle size={14} /> Commissioner controls</span> : null}</div>{controls ? <><VoicePickRecorder teams={teams} /><CommissionerControls teams={teams} recent={recent} /></> : null}<section className="cvc-card mt-6"><div className="cvc-card-title"><span>Franchise budget board</span><span className="text-[10px] font-bold uppercase tracking-[.13em] text-cvc-accent">Live ledger</span></div><div className="cvc-card-stripe" /><div className="cvc-card-body"><div className="overflow-x-auto"><table className="cvc-table min-w-[740px]"><thead><tr><th>Franchise</th><th>Salary</th><th>Budget left</th><th>Max bid</th><th>Players</th></tr></thead><tbody>{teams.map(team => { const left = team.starting_budget - team.spent_budget; const maxBid = Math.max(0, left - Math.max(0, 14 - team.roster_count)); return <tr key={team.franchise_id}><td className="font-semibold">{firstOf(team.franchise)?.name}</td><td>{money(team.spent_budget)}</td><td>{money(left)}</td><td className="font-bold text-cvc-accent">{money(maxBid)}</td><td>{team.roster_count} / 22</td></tr>; })}</tbody></table></div>{!teams.length ? <p className="mt-4 text-sm text-slate-500">Commissioner budget setup (Commissioner Panel → Auction budgets) is required before this ledger can populate.</p> : null}</div></section><PlayerPool /><section className="cvc-card mt-6"><div className="cvc-card-title">Recent awards</div><div className="cvc-card-stripe" /><div className="cvc-card-body">{recent.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{recent.map(item => <div key={item.id} className="rounded-lg bg-cvc-tint p-4"><Trophy size={15} className="text-cvc-accent" /><p className="mt-3 font-semibold text-cvc-deep">{item.player_id ? <Link href={`/player/${item.player_id}`} className="text-cvc-deep hover:text-cvc-accent">{firstOf(item.player)?.display_name}</Link> : firstOf(item.player)?.display_name}</p><p className="mt-1 text-xs text-slate-500">{firstOf(item.leader)?.name} · {money(item.high_bid || 0)}</p></div>)}</div> : <p className="text-sm text-slate-600">Awards will appear here as the commissioner records them.</p>}</div></section></LeagueLayout>;
}
