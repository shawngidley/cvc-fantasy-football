import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCvcOwnerAuth } from "@/hooks/useCvcOwnerAuth";
import { TeamLogo } from "@/components/TeamLogo";

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} · ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

export function CvcSuggestions() {
  const { owner, isAuthenticated } = useCvcOwnerAuth();
  const utils = trpc.useUtils();
  const list = trpc.league.listSuggestions.useQuery();
  const [message, setMessage] = useState("");
  const submit = trpc.league.submitSuggestion.useMutation({
    onSuccess: async () => { setMessage(""); await utils.league.listSuggestions.invalidate(); },
  });

  return <div className="mx-auto max-w-3xl">
    <div className="mb-6"><p className="cvc-eyebrow">League feedback</p><h1 className="mt-2 font-display text-5xl uppercase leading-none tracking-[0.03em] text-white sm:text-6xl">Suggestions</h1><p className="mt-3 max-w-xl text-sm leading-6 text-cvc-muted">Have an idea for the site, or something that could work better? Every owner can post a suggestion here — it's shared with your team name and the time you submitted it.</p></div>

    {isAuthenticated && owner?.franchise ? <section className="cvc-card mb-6"><div className="cvc-card-body">
      <label className="text-xs font-black uppercase tracking-[0.1em] text-cvc-muted">New suggestion</label>
      <textarea value={message} onChange={event => setMessage(event.target.value)} maxLength={2000} rows={4} placeholder="What should we add or fix?" className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-3 text-sm text-cvc-deep outline-none focus:border-cvc-accent" />
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-xs text-slate-400">{message.length}/2000</span>
        <button type="button" disabled={submit.isPending || !message.trim()} onClick={() => submit.mutate({ message: message.trim() })} className="cvc-button-compact disabled:cursor-not-allowed disabled:opacity-40"><MessageSquarePlus size={14} /> {submit.isPending ? "Posting…" : "Post suggestion"}</button>
      </div>
      {submit.error ? <p className="mt-2 text-sm text-red-600">{submit.error.message}</p> : null}
    </div></section> : !isAuthenticated ? <section className="cvc-card mb-6"><div className="cvc-card-body text-sm text-slate-600">Sign in with a CVC owner account to post a suggestion.</div></section> : null}

    <section className="cvc-card">
      <div className="cvc-card-title"><span>All suggestions</span><MessageSquarePlus size={16} /></div>
      {list.isLoading ? <div className="cvc-card-body text-sm text-slate-500">Loading suggestions…</div>
        : list.error ? <div className="cvc-card-body text-sm text-red-600">{list.error.message}</div>
        : !list.data?.length ? <div className="cvc-card-body text-sm text-slate-500">No suggestions yet — be the first to post one.</div>
        : <div>{list.data.map(item => <div key={item.id} className="flex gap-3 border-b border-slate-100 px-5 py-4 last:border-b-0">
            {item.franchiseName ? <TeamLogo name={item.franchiseName} logoUrl={item.franchiseLogoUrl} size="sm" className="mt-0.5 shrink-0 border-slate-200" /> : null}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"><span className="font-bold text-cvc-deep">{item.franchiseName ?? "CVC Owner"}</span>{item.ownerName ? <span className="text-xs text-slate-400">({item.ownerName})</span> : null}<span className="text-xs text-slate-400">· {formatTimestamp(item.createdAt)}</span></div>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.message}</p>
            </div>
          </div>)}</div>}
    </section>
  </div>;
}
