import { useEffect, useMemo, useState } from "react";
import { Newspaper, RefreshCw, ShieldAlert } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCvcOwnerAuth } from "@/hooks/useCvcOwnerAuth";

type TankNews = { title?: string; link?: string; image?: string; playerIDs?: string[] };
const CACHE_KEY = "cvc_tank01_news_v1";
const TTL_MS = 15 * 60_000;

function looksLikeInjury(text: string) {
  return /injur|questionable|doubtful| ruled out|out for|ir |surgery|concussion|hamstring|ankle|knee|illness/i.test(text);
}

export function CvcWrcPlayerNews() {
  const auth = useCvcOwnerAuth();
  const mine = trpc.league.myFranchise.useQuery(undefined, { enabled: auth.isAuthenticated });
  const roster = trpc.league.franchiseRoster.useQuery({ franchiseId: mine.data?.id ?? "00000000-0000-0000-0000-000000000000" }, { enabled: Boolean(mine.data?.id) });
  const [items, setItems] = useState<TankNews[]>([]);
  const [loading, setLoading] = useState(true);
  const [myTeamOnly, setMyTeamOnly] = useState(false);
  const [position, setPosition] = useState("ALL");
  const [error, setError] = useState("");
  const load = async (force = false) => {
    setLoading(true); setError("");
    try {
      if (!force) {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) { const parsed = JSON.parse(cached) as { ts: number; data: TankNews[] }; if (Date.now() - parsed.ts < TTL_MS) { setItems(parsed.data); setLoading(false); return; } }
      }
      const response = await fetch("/api/tank01/getNFLNews?recentNews=true");
      if (!response.ok) throw new Error("Tank01 news is unavailable");
      const payload = await response.json() as { body?: TankNews[] };
      const fresh = Array.isArray(payload.body) ? payload.body.filter(item => item.title) : [];
      setItems(fresh); sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: fresh }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Tank01 news is unavailable"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const rosterPlayers = roster.data?.players.map(row => row.player).filter(Boolean) ?? [];
  const shown = useMemo(() => items.filter(item => {
    const headline = item.title ?? "";
    const relevant = !myTeamOnly || rosterPlayers.some(player => headline.toLowerCase().includes(player!.display_name.toLowerCase()));
    const player = rosterPlayers.find(candidate => headline.toLowerCase().includes(candidate!.display_name.toLowerCase()));
    const positional = position === "ALL" || player?.position === position;
    return relevant && positional;
  }), [items, myTeamOnly, position, rosterPlayers]);
  const positions = ["ALL", "QB", "RB", "WR", "TE", "K", "DST"];
  return <section className="min-h-screen bg-[#06121b] px-3 pb-14 pt-5 text-white sm:px-6"><div className="mx-auto max-w-4xl"><div className="mb-6 flex flex-wrap items-end justify-between gap-3"><div><p className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-cvc-accent">Player Wire</p><h1 className="font-display text-5xl uppercase leading-none sm:text-6xl">News</h1><p className="mt-3 text-sm text-slate-300">Tank01 NFL updates with your CVC roster context.</p></div><div className="flex gap-2"><button onClick={() => setMyTeamOnly(value => !value)} disabled={!auth.isAuthenticated} className={`rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.1em] disabled:opacity-40 ${myTeamOnly ? "border-cvc-accent bg-cvc-accent text-cvc-deep" : "border-white/20 bg-white/5 text-white"}`}>{myTeamOnly ? "✓ My Team" : "My Team"}</button><button onClick={() => void load(true)} className="rounded-full border border-white/20 bg-white/5 p-2.5 text-cvc-accent" aria-label="Refresh news"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></button></div></div>
    <div className="mb-4 flex flex-wrap gap-2">{positions.map(value => <button key={value} onClick={() => setPosition(value)} className={`rounded-full border px-3 py-1.5 text-xs font-black ${position === value ? "border-cvc-accent bg-cvc-accent text-cvc-deep" : "border-white/20 bg-white/5 text-slate-200"}`}>{value}</button>)}</div>
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white text-cvc-deep"><div className="border-b-4 border-cvc-accent px-5 py-4"><div className="flex items-center gap-2"><Newspaper size={17} className="text-cvc-accent"/><span className="text-xs font-black uppercase tracking-[0.16em]">NFL Player News</span><span className="ml-auto text-xs text-slate-500">{loading ? "Loading…" : `${shown.length} updates`}</span></div></div>{error ? <div className="p-8 text-center"><ShieldAlert className="mx-auto text-amber-600"/><p className="mt-3 font-semibold">{error}</p><button onClick={() => void load(true)} className="mt-4 rounded-lg bg-cvc-deep px-3 py-2 text-xs font-black uppercase text-white">Try again</button></div> : loading ? <div className="p-10 text-center text-slate-500">Loading Tank01 player news…</div> : shown.length ? <div>{shown.map((item, index) => { const linked = rosterPlayers.find(player => item.title?.toLowerCase().includes(player!.display_name.toLowerCase())); const injury = looksLikeInjury(item.title ?? ""); return <article key={`${item.title}-${index}`} className="border-b border-slate-200 p-5 last:border-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded px-2 py-1 text-[10px] font-black uppercase ${injury ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-slate-600"}`}>{injury ? "Injury watch" : "Tank01"}</span>{linked ? <span className="rounded bg-cvc-accent/20 px-2 py-1 text-[10px] font-black uppercase text-cvc-deep">{linked!.display_name} · {linked!.position}</span> : null}</div><h2 className="mt-3 text-lg font-black leading-snug">{item.title}</h2><div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-500"><span>{linked?.nfl_team ?? "NFL"}</span>{item.link ? <a className="font-black uppercase tracking-[0.1em] text-cvc-deep underline" href={item.link} target="_blank" rel="noreferrer">Read source</a> : null}</div></article>; })}</div> : <div className="p-10 text-center text-slate-500">No player news matches this CVC filter.</div>}</div></div></section>;
}
