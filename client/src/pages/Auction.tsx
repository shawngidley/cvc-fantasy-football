// @ts-nocheck
import { LeagueLayout } from "@/components/LeagueLayout";
import { trpc } from "@/lib/trpc";
import { useCvcOwnerAuth } from "@/hooks/useCvcOwnerAuth";
import { Gavel, Mic, PauseCircle, Search, ShieldCheck, Trophy, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";

const money = (value: number) => `$${value}`;

// Lightweight fuzzy match (no dependency added): exact/substring match scores highest,
// otherwise scores by the fraction of query tokens that appear in the candidate. Good
// enough for matching a spoken player or franchise name against a short known list —
// not meant for large free-text search.
function scoreMatch(query: string, candidate: string): number {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const q = normalize(query); const c = normalize(candidate);
  if (!q || !c) return 0;
  if (c === q) return 100;
  if (c.includes(q) || q.includes(c)) return 80;
  const qTokens = q.split(/\s+/); const cTokens = c.split(/\s+/);
  const overlap = qTokens.filter(token => cTokens.some(candidateToken => candidateToken === token || candidateToken.startsWith(token) || token.startsWith(candidateToken))).length;
  return (overlap / Math.max(qTokens.length, cTokens.length)) * 60;
}

function bestMatch(query, items, getLabel) {
  let best = null;
  for (const item of items) {
    const score = scoreMatch(query, getLabel(item));
    if (!best || score > best.score) best = { item, score };
  }
  return best && best.score > 30 ? best : null;
}

// Chrome's speech recognition already converts spoken numbers to digits in most cases
// ("sixteen dollars" -> "16 dollars"), so a plain digit regex covers the common case.
function parseSalaryFromTranscript(transcript: string): number | null {
  const match = transcript.match(/\$?\s*(\d+)\s*(dollars?)?/i);
  return match ? Number(match[1]) : null;
}

function VoicePickRecorder({ teams }: { teams: any[] }) {
  const utils = trpc.useUtils();
  const eligible = trpc.auction.eligiblePlayers.useQuery({ limit: 150 });
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [parsedPlayerId, setParsedPlayerId] = useState("");
  const [parsedFranchiseId, setParsedFranchiseId] = useState("");
  const [parsedAmount, setParsedAmount] = useState("");

  const recognition = useMemo(() => {
    if (typeof window === "undefined") return null;
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return null;
    const instance = new SpeechRecognitionCtor();
    instance.lang = "en-US";
    instance.interimResults = false;
    instance.maxAlternatives = 1;
    return instance;
  }, []);

  const record = trpc.auction.recordVoicePick.useMutation({
    onSuccess: async () => {
      setTranscript(""); setParsedPlayerId(""); setParsedFranchiseId(""); setParsedAmount("");
      await Promise.all([utils.auction.board.invalidate(), utils.auction.eligiblePlayers.invalidate(), utils.league.freeAgents.invalidate(), utils.league.overview.invalidate()]);
    },
  });

  const parse = (text: string) => {
    const amount = parseSalaryFromTranscript(text);
    const playerMatch = bestMatch(text, eligible.data ?? [], (p: any) => p.display_name);
    const franchiseMatch = bestMatch(text, teams, (t: any) => t.franchise?.[0]?.name ?? "");
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
      <label className="cvc-field"><span>Winning franchise</span><select value={parsedFranchiseId} onChange={event => setParsedFranchiseId(event.target.value)} className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"><option value="">Not matched — choose manually</option>{teams.map(t => <option key={t.franchise_id} value={t.franchise_id}>{t.franchise?.[0]?.name}</option>)}</select></label>
      <label className="cvc-field"><span>Salary</span><input value={parsedAmount} onChange={event => setParsedAmount(event.target.value.replace(/\D/g, ""))} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" inputMode="numeric" /></label>
    </div> : null}
    {transcript ? <div className="mt-4 flex flex-wrap items-center gap-3">
      <button type="button" disabled={!parsedPlayerId || !parsedFranchiseId || !parsedAmount || record.isPending} onClick={() => record.mutate({ playerId: parsedPlayerId, franchiseId: parsedFranchiseId, amount: Number(parsedAmount) })} className="cvc-button-compact disabled:cursor-not-allowed disabled:opacity-50">{record.isPending ? "Recording…" : `Confirm: ${selectedPlayer?.display_name ?? "?"} to ${selectedTeam?.franchise?.[0]?.name ?? "?"} for $${parsedAmount || "?"}`}</button>
      <button type="button" onClick={clear} className="text-xs font-bold uppercase tracking-[.08em] text-slate-500">Clear</button>
    </div> : null}
    {record.error ? <p className="mt-2 text-sm text-red-700">{record.error.message}</p> : null}
  </div></section>;
}

function AuctionTabs({ controls }: { controls: boolean }) {
  return <div className="sticky top-[60px] z-30 -mx-4 mb-7 overflow-x-auto border-b-2 border-white/10 bg-cvc-deep/95 px-4 backdrop-blur sm:-mx-6 sm:px-6"><div className="mx-auto flex w-max min-w-full max-w-[1440px] items-center"><a href="#auction-board" className="border-b-[3px] border-cvc-accent px-4 py-3 font-display text-sm uppercase tracking-[0.08em] text-cvc-accent">Auction board</a><a href="#auction-players" className="border-b-[3px] border-transparent px-4 py-3 font-display text-sm uppercase tracking-[0.08em] text-white/60 hover:text-white">Auction players</a><Link href="/protections" className="border-b-[3px] border-transparent px-4 py-3 font-display text-sm uppercase tracking-[0.08em] text-white/60 hover:text-white">Protections</Link><Link href="/draft" className="border-b-[3px] border-transparent px-4 py-3 font-display text-sm uppercase tracking-[0.08em] text-white/60 hover:text-white">Rookie draft</Link>{controls ? <span className="ml-3 inline-flex items-center gap-2 rounded-full border border-cvc-accent/50 bg-cvc-accent/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-cvc-accent"><ShieldCheck size={12} /> Commissioner console</span> : null}</div></div>;
}

function BudgetSetup() {
  const overview = trpc.league.overview.useQuery(); const utils = trpc.useUtils();
  const [franchiseId, setFranchiseId] = useState(""); const [budget, setBudget] = useState("115");
  const save = trpc.auction.setBudget.useMutation({ onSuccess: () => { utils.auction.board.invalidate(); setFranchiseId(""); } });
  return <section className="cvc-card mb-6"><div className="cvc-card-title">Commissioner budget setup</div><div className="cvc-card-stripe" /><div className="cvc-card-body"><div className="grid gap-3 sm:grid-cols-[1fr_160px_auto]"><select className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm" value={franchiseId} onChange={e => setFranchiseId(e.target.value)}><option value="">Select franchise</option>{overview.data?.franchises.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select><input className="rounded-md border border-slate-200 px-3 py-2 text-sm" type="number" min="0" max="115" value={budget} onChange={e => setBudget(e.target.value)} /><button className="cvc-button-compact" disabled={!franchiseId || save.isPending} onClick={() => save.mutate({ franchiseId, startingBudget: Number(budget) })}>Save budget</button></div><p className="mt-3 text-xs text-slate-500">Set each franchise’s starting budget before auction night. CVC rejects budgets above $115.</p>{save.error ? <p className="mt-2 text-sm font-medium text-red-700">{save.error.message}</p> : null}</div></section>;
}

function PlayerPool() {
  const [search, setSearch] = useState(""); const [position, setPosition] = useState("");
  const input = useMemo(() => ({ search: search.trim() || undefined, position: position || undefined, limit: 75 }), [position, search]);
  const players = trpc.auction.eligiblePlayers.useQuery(input);
  return <section id="auction-players" className="cvc-card mt-6 scroll-mt-36"><div className="cvc-card-title"><span>Eligible auction players</span><span className="text-[10px] font-bold uppercase tracking-[.13em] text-cvc-accent">Regular pool</span></div><div className="cvc-card-stripe" /><div className="cvc-card-body"><div className="mb-4 grid gap-3 sm:grid-cols-[1fr_170px]"><label className="relative"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search eligible player" className="w-full rounded-md border border-slate-200 py-2 pl-9 pr-3 text-sm" /></label><select value={position} onChange={event => setPosition(event.target.value)} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"><option value="">All positions</option>{["QB", "RB", "WR", "TE", "K", "DST"].map(item => <option key={item} value={item}>{item}</option>)}</select></div>{players.isLoading ? <p className="py-5 text-sm text-slate-500">Loading eligible players…</p> : players.data?.length ? <div className="overflow-x-auto"><table className="cvc-table min-w-[620px]"><thead><tr><th>Player</th><th>Pos</th><th>NFL team</th><th>Pool status</th></tr></thead><tbody>{players.data.map(player => <tr key={player.id}><td className="font-semibold"><Link href={`/player/${player.id}`} className="text-cvc-deep hover:text-cvc-accent">{player.display_name}</Link></td><td>{player.position || "—"}</td><td>{player.nfl_team || "FA"}</td><td><span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-emerald-700">Eligible</span></td></tr>)}</tbody></table></div> : <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-7 text-center text-sm text-slate-500">No regular-auction players match this filter.</p>}<p className="mt-4 text-xs text-slate-500">Unrostered non-rookies are eligible here. Rookie selections are handled in the separate rookie draft.</p></div></section>;
}

function CommissionerControls({ active, teams, recent }: { active: any; teams: any[]; recent: any[] }) {
  const utils = trpc.useUtils(); const [playerSearch, setPlayerSearch] = useState(""); const [playerPosition, setPlayerPosition] = useState(""); const [playerId, setPlayerId] = useState(""); const [winnerId, setWinnerId] = useState(""); const [amount, setAmount] = useState("1"); const [correctionId, setCorrectionId] = useState(""); const [reason, setReason] = useState("");
  const eligible = trpc.auction.eligiblePlayers.useQuery({ search: playerSearch.trim() || undefined, position: playerPosition || undefined, limit: 75 });
  const refresh = async () => Promise.all([utils.auction.board.invalidate(), utils.auction.eligiblePlayers.invalidate(), utils.league.freeAgents.invalidate(), utils.league.overview.invalidate()]);
  const nominate = trpc.auction.nominate.useMutation({ onSuccess: async () => { setPlayerId(""); await refresh(); } }); const award = trpc.auction.award.useMutation({ onSuccess: async () => { setWinnerId(""); setAmount("1"); await refresh(); } }); const correct = trpc.auction.correctAward.useMutation({ onSuccess: async () => { setCorrectionId(""); setReason(""); await refresh(); } });
  const selectedTeam = teams.find(team => team.franchise_id === winnerId); const legalMax = selectedTeam ? Math.max(0, selectedTeam.starting_budget - selectedTeam.spent_budget - Math.max(0, 14 - selectedTeam.roster_count)) : null;
  return <section className="cvc-card mb-6"><div className="cvc-card-title">Auction night console</div><div className="cvc-card-stripe" /><div className="cvc-card-body"><div className="grid gap-6 xl:grid-cols-3"><div><p className="text-[10px] font-bold uppercase tracking-[.13em] text-slate-500">1. Nominate player</p><div className="mt-3 space-y-3"><input value={playerSearch} onChange={event => setPlayerSearch(event.target.value)} placeholder="Search player name" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" /><select value={playerPosition} onChange={event => setPlayerPosition(event.target.value)} className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"><option value="">All positions</option>{["QB", "RB", "WR", "TE", "K", "DST"].map(item => <option key={item} value={item}>{item}</option>)}</select><select value={playerId} onChange={event => setPlayerId(event.target.value)} className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"><option value="">{eligible.isLoading ? "Searching eligible players…" : "Choose eligible player"}</option>{eligible.data?.map(player => <option key={player.id} value={player.id}>{player.display_name} · {player.position || "—"} · {player.nfl_team || "FA"}</option>)}</select><button disabled={Boolean(active) || !playerId || nominate.isPending} onClick={() => nominate.mutate({ playerId })} className="cvc-button-compact disabled:cursor-not-allowed disabled:opacity-50">{nominate.isPending ? "Starting…" : active ? "Resolve active player" : "Start nomination"}</button>{nominate.error ? <p className="text-sm text-red-700">{nominate.error.message}</p> : null}</div></div><div><p className="text-[10px] font-bold uppercase tracking-[.13em] text-slate-500">2. Call the sale</p><div className="mt-3 space-y-3"><select value={winnerId} onChange={event => setWinnerId(event.target.value)} disabled={!active} className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"><option value="">Choose winning franchise</option>{teams.map(team => <option key={team.franchise_id} value={team.franchise_id}>{team.franchise?.[0]?.name}</option>)}</select><input value={amount} onChange={event => setAmount(event.target.value.replace(/\D/g, ""))} disabled={!active} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" inputMode="numeric" placeholder="Winning bid" /> <p className="text-xs text-slate-500">{legalMax !== null ? `Maximum legal bid now: ${money(legalMax)}` : "Select a franchise to calculate its legal maximum."}</p><button disabled={!active || !winnerId || Number(amount) < 1 || award.isPending} onClick={() => award.mutate({ franchiseId: winnerId, amount: Number(amount) })} className="cvc-button-compact disabled:cursor-not-allowed disabled:opacity-50">{award.isPending ? "Awarding…" : "Record award"}</button>{award.error ? <p className="text-sm text-red-700">{award.error.message}</p> : null}</div></div><div><p className="text-[10px] font-bold uppercase tracking-[.13em] text-slate-500">3. Correct award</p><div className="mt-3 space-y-3"><select value={correctionId} onChange={event => setCorrectionId(event.target.value)} className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"><option value="">Choose recent award</option>{recent.map(item => <option key={item.id} value={item.id}>{item.player?.[0]?.display_name} · {item.leader?.[0]?.name} · {money(item.high_bid || 0)}</option>)}</select><input value={reason} onChange={event => setReason(event.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" placeholder="Correction reason" maxLength={280} /><button disabled={!correctionId || reason.trim().length < 3 || correct.isPending} onClick={() => { if (window.confirm("Correct this auction award? The player will be released and budget restored.")) correct.mutate({ nominationId: correctionId, reason }); }} className="cvc-button-secondary disabled:cursor-not-allowed disabled:opacity-50">{correct.isPending ? "Correcting…" : "Undo award"}</button>{correct.error ? <p className="text-sm text-red-700">{correct.error.message}</p> : null}</div></div></div></div></section>;
}

export default function Auction({ controls: requestedControls = false }: { controls?: boolean }) {
  const { owner } = useCvcOwnerAuth();
  const controls = requestedControls || ["commissioner", "administrator"].includes(owner?.role ?? "");
  const board = trpc.auction.board.useQuery(); const data: any = board.data;
  if (board.isLoading) return <LeagueLayout><div className="cvc-card p-8 text-center text-slate-500">Loading CVC auction room…</div></LeagueLayout>;
  if (board.error || !data) return <LeagueLayout><div className="cvc-card p-8 text-center text-slate-500">Auction setup is not yet available. Configure the CVC auction draft first.</div></LeagueLayout>;
  const active = data.active; const teams = data.states ?? []; const recent = data.recent ?? [];
  return <LeagueLayout><AuctionTabs controls={controls} /><div id="auction-board" className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><div className="cvc-eyebrow"><Gavel size={14} /> CVC Auction Draft</div><h1 className="mt-2 font-display text-5xl uppercase leading-none tracking-[.04em] text-white sm:text-6xl">Auction Room</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-cvc-muted">The public board follows the live nomination. The commissioner calls every sale in the room.</p></div>{controls ? <span className="cvc-button-compact"><PauseCircle size={14} /> Commissioner controls</span> : null}</div>{controls ? <><BudgetSetup /><VoicePickRecorder teams={teams} /><CommissionerControls active={active} teams={teams} recent={recent} /></> : null}<div className="grid gap-6 xl:grid-cols-[1.25fr_.75fr]"><section className="cvc-card"><div className="cvc-card-title">Now on the board</div><div className="cvc-card-stripe" /><div className="cvc-card-body">{active ? <div className="rounded-xl bg-cvc-tint p-7"><p className="font-display text-4xl uppercase text-cvc-deep">{active.player_id ? <Link href={`/player/${active.player_id}`} className="text-cvc-deep hover:text-cvc-accent">{active.player?.[0]?.display_name}</Link> : active.player?.[0]?.display_name}</p><p className="mt-2 text-sm text-slate-500">{active.player?.[0]?.position} · {active.player?.[0]?.nfl_team}</p><p className="mt-6 font-display text-5xl text-cvc-accent">{money(active.high_bid || 1)}</p><p className="mt-2 text-sm text-slate-600">Leading: {active.leader?.[0]?.name || "No bid recorded"}</p></div> : <div className="rounded-xl border border-dashed border-cvc-deep/20 bg-cvc-tint p-8 text-center text-sm text-slate-600">No active nomination. The commissioner will open the next player when ready.</div>}</div></section><section className="cvc-card"><div className="cvc-card-title">Auction rules</div><div className="cvc-card-stripe" /><div className="cvc-card-body space-y-4 text-sm text-slate-600"><p><b className="text-cvc-deep">Minimum bid:</b> $1</p><p><b className="text-cvc-deep">Budget cap:</b> $115</p><p><b className="text-cvc-deep">Roster range:</b> 15–22 players</p><p><b className="text-cvc-deep">Close:</b> commissioner calls the sale</p><p><b className="text-cvc-deep">Pool:</b> unrostered non-rookies</p></div></section></div><section className="cvc-card mt-6"><div className="cvc-card-title"><span>Franchise budget board</span><span className="text-[10px] font-bold uppercase tracking-[.13em] text-cvc-accent">Live ledger</span></div><div className="cvc-card-stripe" /><div className="cvc-card-body"><div className="overflow-x-auto"><table className="cvc-table min-w-[660px]"><thead><tr><th>Franchise</th><th>Budget left</th><th>Protected reserve</th><th>Bid now</th><th>Players</th></tr></thead><tbody>{teams.map(team => { const left = team.starting_budget - team.spent_budget; const reserve = Math.max(0, 15 - team.roster_count); const maxBid = Math.max(0, left - Math.max(0, 14 - team.roster_count)); return <tr key={team.franchise_id}><td className="font-semibold">{team.franchise?.[0]?.name}</td><td>{money(left)}</td><td>{money(reserve)}</td><td className="font-bold text-cvc-accent">{money(maxBid)}</td><td>{team.roster_count} / 22</td></tr>; })}</tbody></table></div>{!teams.length ? <p className="mt-4 text-sm text-slate-500">Commissioner budget setup is required before this ledger can populate.</p> : null}</div></section><PlayerPool /><section className="cvc-card mt-6"><div className="cvc-card-title">Recent awards</div><div className="cvc-card-stripe" /><div className="cvc-card-body">{recent.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{recent.map(item => <div key={item.id} className="rounded-lg bg-cvc-tint p-4"><Trophy size={15} className="text-cvc-accent" /><p className="mt-3 font-semibold text-cvc-deep">{item.player_id ? <Link href={`/player/${item.player_id}`} className="text-cvc-deep hover:text-cvc-accent">{item.player?.[0]?.display_name}</Link> : item.player?.[0]?.display_name}</p><p className="mt-1 text-xs text-slate-500">{item.leader?.[0]?.name} · {money(item.high_bid || 0)}</p></div>)}</div> : <p className="text-sm text-slate-600">Awards will appear here as the commissioner records them.</p>}</div></section></LeagueLayout>;
}
