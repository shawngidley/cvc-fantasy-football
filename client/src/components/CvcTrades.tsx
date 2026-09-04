import { useState } from "react";
import { ArrowLeftRight, Check, Inbox, Plus, Send, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCvcOwnerAuth } from "@/hooks/useCvcOwnerAuth";

function TradeStatus({ value }: { value: string }) {
  const tone = value === "accepted" || value === "processed" ? "bg-emerald-950 text-emerald-200" : value === "rejected" || value === "cancelled" ? "bg-rose-950 text-rose-200" : "bg-amber-100 text-amber-800";
  return <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${tone}`}>{value}</span>;
}

type RosterPlayer = { id: string; player: { id: string; display_name: string; position: string | null; nfl_team: string | null } | null };
type FranchisePick = { id: string; year: number | null; draftType: string; roundNumber: number; pickNumber: number };

function AssetChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-cvc-deep">{label}<button type="button" onClick={onRemove} className="text-cvc-deep/50 hover:text-cvc-deep"><X size={12} /></button></span>;
}

function pickLabel(pick: FranchisePick) {
  return `${pick.year ?? ""} ${pick.draftType === "rookie" ? "Rookie" : pick.draftType} Draft R${pick.roundNumber}.${String(pick.pickNumber).padStart(2, "0")}`.trim();
}

// Multi-select checklist of a franchise's roster + tradeable draft picks (this year's,
// only while undrafted, and next year's -- enforced server-side too). Both sides of a
// CVC trade can include any mix of players and picks; there's no FAAB asset type here,
// unlike WRC's model, which does trade FAAB budget.
function TradeSidePicker({ title, players, picks, selectedPlayerIds, selectedPickIds, onTogglePlayer, onTogglePick, disabled, emptyLabel }: {
  title: string;
  players: RosterPlayer[] | undefined;
  picks: FranchisePick[] | undefined;
  selectedPlayerIds: string[]; selectedPickIds: string[];
  onTogglePlayer: (id: string) => void; onTogglePick: (id: string) => void;
  disabled?: boolean;
  emptyLabel: string;
}) {
  const rosterPlayers = players?.filter((item): item is RosterPlayer & { player: NonNullable<RosterPlayer["player"]> } => Boolean(item.player)) ?? [];
  return <section className="rounded-2xl border border-white/10 bg-white p-5 text-cvc-deep">
    <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">{title}</p>
    <div className={`mt-4 max-h-64 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 p-2 ${disabled ? "opacity-40" : ""}`}>
      {rosterPlayers.map(item => <label key={item.id} className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-slate-50"><input type="checkbox" disabled={disabled} checked={selectedPlayerIds.includes(item.player.id)} onChange={() => onTogglePlayer(item.player.id)} />{item.player.display_name} <span className="text-xs text-slate-400">{item.player.position ?? "—"} · {item.player.nfl_team ?? "NFL"}</span></label>)}
      {picks?.map(pick => <label key={pick.id} className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-slate-50"><input type="checkbox" disabled={disabled} checked={selectedPickIds.includes(pick.id)} onChange={() => onTogglePick(pick.id)} />{pickLabel(pick)}</label>)}
      {!disabled && !rosterPlayers.length && !picks?.length ? <p className="px-2 py-2 text-xs text-slate-400">{emptyLabel}</p> : null}
    </div>
  </section>;
}

export function CvcTrades() {
  const auth = useCvcOwnerAuth();
  const mine = trpc.league.myFranchise.useQuery(undefined, { enabled: auth.isAuthenticated });
  const overview = trpc.league.overview.useQuery();
  const [tab, setTab] = useState<"propose" | "inbox">("propose");
  const [recipientId, setRecipientId] = useState("");
  const [offerPlayerIds, setOfferPlayerIds] = useState<string[]>([]);
  const [requestPlayerIds, setRequestPlayerIds] = useState<string[]>([]);
  const [offerPickIds, setOfferPickIds] = useState<string[]>([]);
  const [requestPickIds, setRequestPickIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const myRoster = trpc.league.franchiseRoster.useQuery({ franchiseId: mine.data?.id ?? "00000000-0000-0000-0000-000000000000" }, { enabled: Boolean(mine.data?.id) });
  const recipientRoster = trpc.league.franchiseRoster.useQuery({ franchiseId: recipientId || "00000000-0000-0000-0000-000000000000" }, { enabled: Boolean(recipientId) });
  const myPicks = trpc.league.franchisePicks.useQuery({ franchiseId: mine.data?.id ?? "00000000-0000-0000-0000-000000000000" }, { enabled: Boolean(mine.data?.id) });
  const recipientPicks = trpc.league.franchisePicks.useQuery({ franchiseId: recipientId || "00000000-0000-0000-0000-000000000000" }, { enabled: Boolean(recipientId) });
  const trades = trpc.league.myTrades.useQuery(undefined, { enabled: auth.isAuthenticated });
  const utils = trpc.useUtils();
  const refresh = async () => { await Promise.all([utils.league.myTrades.invalidate(), utils.league.franchiseRoster.invalidate(), utils.league.overview.invalidate(), utils.league.franchisePicks.invalidate()]); };
  const resetBuilder = () => { setRecipientId(""); setOfferPlayerIds([]); setRequestPlayerIds([]); setOfferPickIds([]); setRequestPickIds([]); setNote(""); };
  const propose = trpc.league.proposeTrade.useMutation({ onSuccess: async () => { resetBuilder(); await refresh(); } });
  const respond = trpc.league.respondToTrade.useMutation({ onSuccess: refresh });
  const recipient = overview.data?.franchises.find(franchise => franchise.id === recipientId);
  const toggle = (list: string[], setList: (value: string[]) => void, id: string) => setList(list.includes(id) ? list.filter(item => item !== id) : [...list, id]);
  const canSubmit = Boolean(recipientId) && (offerPlayerIds.length + offerPickIds.length > 0) && (requestPlayerIds.length + requestPickIds.length > 0);
  const myPlayerLabel = (id: string) => myRoster.data?.players.find(item => item.player?.id === id)?.player?.display_name ?? "Player";
  const recipientPlayerLabel = (id: string) => recipientRoster.data?.players.find(item => item.player?.id === id)?.player?.display_name ?? "Player";
  const myPickLabel = (id: string) => { const pick = myPicks.data?.find(item => item.id === id); return pick ? pickLabel(pick) : "Pick"; };
  const recipientPickLabel = (id: string) => { const pick = recipientPicks.data?.find(item => item.id === id); return pick ? pickLabel(pick) : "Pick"; };

  if (auth.loading) return <section className="min-h-screen bg-[#06121b] p-8 text-slate-300">Loading CVC Trade Desk…</section>;
  if (!auth.isAuthenticated) return <section className="min-h-screen bg-[#06121b] px-4 py-12 text-white"><div className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-white/5 p-8 text-center"><ArrowLeftRight className="mx-auto text-cvc-accent" size={36} /><h1 className="mt-4 font-display text-4xl uppercase">Trade Desk</h1><p className="mt-3 text-sm leading-6 text-slate-300">Sign in with your CVC owner selector and PIN to propose, accept, or review trades.</p><a href="/login" className="mt-6 inline-flex rounded-lg bg-cvc-accent px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-cvc-deep">Owner Sign In</a></div></section>;

  return <section className="min-h-screen bg-[#06121b] px-3 pb-14 pt-5 text-white sm:px-6"><div className="mx-auto max-w-6xl">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div><p className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-cvc-accent">League Office</p><h1 className="font-display text-5xl uppercase leading-none sm:text-6xl">Trade Desk</h1><p className="mt-3 text-sm text-slate-300">{mine.data?.name ?? "Your franchise"} · players and this year's (pre-draft) or next year's picks are validated at proposal and again at acceptance.</p></div>
      <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-right"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Open trade items</p><p className="mt-1 font-display text-3xl text-cvc-accent">{trades.data?.filter((trade: any) => trade.status === "proposed").length ?? 0}</p></div>
    </div>
    <div className="mb-6 flex gap-2 border-b border-white/10">
      <button onClick={() => setTab("propose")} className={`border-b-2 px-4 py-3 text-xs font-black uppercase tracking-[0.13em] ${tab === "propose" ? "border-cvc-accent text-cvc-accent" : "border-transparent text-slate-400"}`}><Plus size={14} className="mr-1 inline" /> Propose</button>
      <button onClick={() => setTab("inbox")} className={`border-b-2 px-4 py-3 text-xs font-black uppercase tracking-[0.13em] ${tab === "inbox" ? "border-cvc-accent text-cvc-accent" : "border-transparent text-slate-400"}`}><Inbox size={14} className="mr-1 inline" /> Trade Inbox</button>
    </div>

    {tab === "propose" ? <div className="grid gap-5 lg:grid-cols-[1fr_auto_1fr]">
      <TradeSidePicker title={`You send · ${mine.data?.name ?? ""}`} players={myRoster.data?.players} picks={myPicks.data} selectedPlayerIds={offerPlayerIds} selectedPickIds={offerPickIds} onTogglePlayer={id => toggle(offerPlayerIds, setOfferPlayerIds, id)} onTogglePick={id => toggle(offerPickIds, setOfferPickIds, id)} emptyLabel="No tradeable players or picks on your side right now." />
      <div className="flex items-center justify-center"><ArrowLeftRight className="rounded-full border border-cvc-accent/40 bg-cvc-accent/15 p-3 text-cvc-accent" size={54} /></div>
      <section className="rounded-2xl border border-white/10 bg-white p-5 text-cvc-deep">
        <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">You receive</p>
        <select value={recipientId} onChange={event => { setRecipientId(event.target.value); setRequestPlayerIds([]); setRequestPickIds([]); }} className="mt-4 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm"><option value="">Choose a CVC franchise</option>{overview.data?.franchises.filter(franchise => franchise.id !== mine.data?.id).map(franchise => <option key={franchise.id} value={franchise.id}>{franchise.name}</option>)}</select>
        <div className={`mt-3 max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 p-2 ${!recipientId ? "opacity-40" : ""}`}>
          {recipientRoster.data?.players.filter(item => item.player).map(item => <label key={item.id} className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-slate-50"><input type="checkbox" disabled={!recipientId} checked={requestPlayerIds.includes(item.player!.id)} onChange={() => toggle(requestPlayerIds, setRequestPlayerIds, item.player!.id)} />{item.player!.display_name} <span className="text-xs text-slate-400">{item.player!.position ?? "—"} · {item.player!.nfl_team ?? "NFL"}</span></label>)}
          {recipientPicks.data?.map(pick => <label key={pick.id} className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-slate-50"><input type="checkbox" disabled={!recipientId} checked={requestPickIds.includes(pick.id)} onChange={() => toggle(requestPickIds, setRequestPickIds, pick.id)} />{pickLabel(pick)}</label>)}
          {recipientId && !recipientRoster.data?.players.some(item => item.player) && !recipientPicks.data?.length ? <p className="px-2 py-2 text-xs text-slate-400">Nothing tradeable on {recipient?.name}'s side right now.</p> : null}
          {!recipientId ? <p className="px-2 py-2 text-xs text-slate-400">Choose a franchise above first.</p> : null}
        </div>
      </section>
      <section className="rounded-2xl border border-white/10 bg-[#10283a] p-5 text-white lg:col-span-3">
        {offerPlayerIds.length || offerPickIds.length || requestPlayerIds.length || requestPickIds.length ? <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {offerPlayerIds.map(id => <AssetChip key={id} label={myPlayerLabel(id)} onRemove={() => toggle(offerPlayerIds, setOfferPlayerIds, id)} />)}
          {offerPickIds.map(id => <AssetChip key={id} label={myPickLabel(id)} onRemove={() => toggle(offerPickIds, setOfferPickIds, id)} />)}
          <ArrowLeftRight size={13} className="mx-1 text-cvc-accent" />
          {requestPlayerIds.map(id => <AssetChip key={id} label={recipientPlayerLabel(id)} onRemove={() => toggle(requestPlayerIds, setRequestPlayerIds, id)} />)}
          {requestPickIds.map(id => <AssetChip key={id} label={recipientPickLabel(id)} onRemove={() => toggle(requestPickIds, setRequestPickIds, id)} />)}
        </div> : null}
        <label className="text-xs font-black uppercase tracking-[0.15em] text-cvc-accent">Optional note</label>
        <textarea value={note} onChange={event => setNote(event.target.value)} className="mt-3 min-h-24 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none" placeholder="Optional trade note" />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs leading-5 text-slate-300">The trade processes immediately once {recipient?.name ?? "the recipient"} accepts.</p>
          <button disabled={!canSubmit || propose.isPending} onClick={() => propose.mutate({ recipientFranchiseId: recipientId, offerPlayerIds, requestPlayerIds, offerPickIds, requestPickIds, note: note.trim() || undefined })} className="inline-flex items-center gap-2 rounded-lg bg-cvc-accent px-4 py-3 text-xs font-black uppercase tracking-[0.13em] text-cvc-deep disabled:opacity-40"><Send size={14} /> {propose.isPending ? "Submitting" : "Submit trade proposal"}</button>
        </div>
        {propose.error ? <p className="mt-3 text-sm text-rose-300">{propose.error.message}</p> : null}
      </section>
    </div> : <section className="space-y-3">
      {trades.isLoading ? <p className="text-slate-300">Loading CVC trade inbox…</p> : trades.data?.length ? trades.data.map((trade: any) => {
        const proposer = trade.proposer?.[0]; const recipientItem = trade.recipient?.[0];
        const isRecipient = recipientItem?.id === mine.data?.id; const isProposer = proposer?.id === mine.data?.id;
        const assetLabel = (asset: any) => {
          if (asset.player?.[0]) return asset.player[0].display_name;
          const pick = asset.pick?.[0];
          if (!pick) return null;
          const draft = pick.draft?.[0]; const year = draft?.season?.[0]?.year ?? "";
          return `${year} ${draft?.draft_type === "rookie" ? "Rookie" : draft?.draft_type ?? ""} Draft R${pick.round_number}.${String(pick.pick_number).padStart(2, "0")}`.trim();
        };
        const proposerAssets = (trade.assets ?? []).filter((asset: any) => asset.from_franchise_id === proposer?.id).map(assetLabel).filter(Boolean).join(", ");
        const recipientAssets = (trade.assets ?? []).filter((asset: any) => asset.from_franchise_id === recipientItem?.id).map(assetLabel).filter(Boolean).join(", ");
        return <article key={trade.id} className="rounded-2xl border border-white/10 bg-white p-5 text-cvc-deep">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="font-display text-2xl uppercase">{proposer?.name} <span className="text-cvc-accent">↔</span> {recipientItem?.name}</p>
              <p className="mt-2 text-sm text-slate-600"><b className="text-slate-700">{proposer?.name} sends:</b> {proposerAssets || "—"}</p>
              <p className="mt-1 text-sm text-slate-600"><b className="text-slate-700">{recipientItem?.name} sends:</b> {recipientAssets || "—"}</p>
              {trade.note ? <p className="mt-2 text-xs italic text-slate-500">"{trade.note}"</p> : null}
            </div>
            <TradeStatus value={trade.status} />
          </div>
          {trade.status === "proposed" && <div className="mt-4 flex flex-wrap gap-2">
            {isRecipient ? <><button onClick={() => respond.mutate({ tradeId: trade.id, response: "accepted" })} className="inline-flex items-center gap-1 rounded-lg bg-emerald-800 px-3 py-2 text-xs font-black uppercase text-white"><Check size={13} /> Accept</button><button onClick={() => respond.mutate({ tradeId: trade.id, response: "rejected" })} className="inline-flex items-center gap-1 rounded-lg bg-rose-800 px-3 py-2 text-xs font-black uppercase text-white"><X size={13} /> Reject</button></> : null}
            {isProposer ? <button onClick={() => respond.mutate({ tradeId: trade.id, response: "cancelled" })} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-black uppercase">Cancel</button> : null}
          </div>}
        </article>;
      }) : <div className="rounded-2xl border border-dashed border-white/20 p-8 text-center text-slate-300">No CVC trade proposals are currently open.</div>}
    </section>}
  </div></section>;
}
