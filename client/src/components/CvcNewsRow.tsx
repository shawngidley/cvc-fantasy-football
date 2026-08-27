import { useEffect, useState } from "react";
import { Link } from "wouter";

export type CvcNewsItem = {
  playerName: string;
  pos: string;
  nflTeam: string;
  headline: string;
  description?: string;
  published: string;
  url?: string;
  isInjury?: boolean;
  source: "Tank01" | "FantasyPros";
  playerId?: string | null;
};

// Same per-row lazy headshot fetch + module-level cache pattern already used in
// CvcWrcPlayerProfile.tsx, CvcWrcOwnerLineup.tsx, and Protections.tsx -- kept
// consistent with those rather than introducing a shared hook none of them use.
const headshotCache = new Map<string, string | null>();
function useHeadshot(playerName: string, pos: string) {
  const [url, setUrl] = useState<string | null>(headshotCache.get(playerName) ?? null);
  useEffect(() => {
    if (pos === "DST") return;
    if (headshotCache.has(playerName)) { setUrl(headshotCache.get(playerName) ?? null); return; }
    let cancelled = false;
    fetch(`/api/tank01/getNFLPlayerInfo?playerName=${encodeURIComponent(playerName)}&getStats=false`)
      .then(response => (response.ok ? response.json() : null) as Promise<{ body?: { espnHeadshot?: string }[] } | null>)
      .then(payload => { const headshot = payload?.body?.[0]?.espnHeadshot ?? null; headshotCache.set(playerName, headshot); if (!cancelled) setUrl(headshot); })
      .catch(() => { headshotCache.set(playerName, null); if (!cancelled) setUrl(null); });
    return () => { cancelled = true; };
  }, [playerName, pos]);
  return url;
}

function formatDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const now = new Date();
  return `${months[date.getMonth()]} ${date.getDate()}${date.getFullYear() === now.getFullYear() ? "" : ` '${String(date.getFullYear()).slice(2)}`}`;
}

export function CvcNewsRow({ item, isFirst = false }: { item: CvcNewsItem; isFirst?: boolean }) {
  const [headshotFailed, setHeadshotFailed] = useState(false);
  const headshotUrl = useHeadshot(item.playerName, item.pos);
  const initials = item.playerName.split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join("").toUpperCase();

  return (
    <details className={`group ${isFirst ? "" : "border-t border-slate-200"}`}>
      <summary className="flex cursor-pointer list-none items-start gap-3 px-5 py-3 hover:bg-slate-50">
        <span className="w-11 shrink-0 pt-0.5 text-[11px] font-semibold text-slate-500">{formatDate(item.published)}</span>
        <span className="h-9 w-9 shrink-0 overflow-hidden rounded-full border border-slate-200 bg-slate-100">
          {headshotUrl && !headshotFailed ? (
            <img src={headshotUrl} alt="" className="h-full w-full object-cover object-top" onError={() => setHeadshotFailed(true)} />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[11px] font-black text-slate-500">{initials || "—"}</span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] font-black text-cvc-deep">{item.playerName}</span>
            {item.isInjury ? <span className="text-[11px]" aria-label="Injury watch">🚩</span> : null}
            <span className="text-[11px] font-semibold text-slate-500">{item.pos} · {item.nflTeam || "FA"}</span>
            <span className={`text-[10px] font-black uppercase tracking-[0.06em] ${item.source === "FantasyPros" ? "text-amber-700" : "text-slate-500"}`}>{item.source === "FantasyPros" ? "FP" : item.source}</span>
          </span>
          <span className="mt-0.5 block truncate text-[12px] text-cvc-deep underline decoration-slate-300">{item.headline}</span>
        </span>
        <span aria-hidden="true" className="mt-1 shrink-0 text-slate-400 transition group-open:rotate-180">⌄</span>
      </summary>
      <div className="mx-5 mb-3 ml-[4.75rem] mt-[-0.15rem] text-[12px] leading-relaxed text-slate-600">
        {item.description || "No written summary is available from this news source for this headline."}
        {item.url ? (
          <a href={item.url} target="_blank" rel="noreferrer" className="mt-1.5 block text-[11px] font-black uppercase tracking-[0.04em] text-cvc-deep">Read full article →</a>
        ) : item.playerId ? (
          <Link href={`/player/${item.playerId}`} className="mt-1.5 block text-[11px] font-black uppercase tracking-[0.04em] text-cvc-deep">Open player card →</Link>
        ) : null}
      </div>
    </details>
  );
}
