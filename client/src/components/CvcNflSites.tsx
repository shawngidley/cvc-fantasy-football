import { ExternalLink, Newspaper, ShieldCheck } from "lucide-react";

const groups = [
  { title: "Official NFL", sites: [
    ["NFL.com", "https://www.nfl.com", "Official NFL scores, news, standings, and schedule."],
    ["NFL Network", "https://www.nfl.com/network", "NFL Network coverage, programming, and schedule."],
    ["NFL RedZone", "https://www.nfl.com/redzone", "Official RedZone channel information."],
  ] },
  { title: "Fantasy & Stats", sites: [
    ["ESPN Fantasy", "https://www.espn.com/fantasy/football/", "Fantasy football tools, analysis, and league coverage."],
    ["Pro Football Reference", "https://www.pro-football-reference.com", "NFL statistics, player history, and game data."],
    ["FantasyPros", "https://www.fantasypros.com", "Rankings, projections, and waiver-wire analysis."],
    ["RotoWire", "https://www.rotowire.com/football/", "Injury reports, depth charts, and player news."],
    ["4for4", "https://www.4for4.com", "Fantasy football analytics and weekly tools."],
  ] },
  { title: "News & Analysis", sites: [
    ["The Athletic NFL", "https://theathletic.com/nfl/", "In-depth NFL reporting and analysis."],
    ["PFF", "https://www.pff.com", "Player grades, advanced analytics, and NFL research."],
    ["Next Gen Stats", "https://nextgenstats.nfl.com", "Official NFL advanced tracking statistics."],
  ] },
];

export function CvcNflSites() {
  return <section className="mx-auto max-w-5xl pb-10"><header className="px-1 pt-2"><p className="text-xs font-black uppercase tracking-[0.16em] text-cvc-accent">Reference desk</p><h1 className="mt-2 font-display text-5xl uppercase text-white">NFL Sites</h1><p className="mt-2 text-sm text-white/70">Useful NFL news, statistics, fantasy, and CVC league resources.</p></header><div className="mt-6 space-y-5">{groups.map(group => <section className="overflow-hidden rounded-xl border border-white/10 bg-white text-cvc-deep shadow-[0_8px_24px_rgba(0,0,0,0.16)]" key={group.title}><div className="h-1 bg-[#dcae37]"/><header className="bg-[#123040] px-5 py-3 font-display text-xl uppercase tracking-[0.08em] text-white">{group.title}</header>{group.sites.map(([name, url, detail], index) => <a key={name} href={url} target="_blank" rel="noopener noreferrer" className={index === group.sites.length - 1 ? "flex items-center gap-3 px-5 py-4 hover:bg-[#f4faef]" : "flex items-center gap-3 border-b border-slate-200 px-5 py-4 hover:bg-[#f4faef]"}><ExternalLink size={16} className="shrink-0 text-cvc-accent"/><span className="min-w-0 flex-1"><span className="block font-semibold">{name}</span><span className="mt-0.5 block text-xs text-slate-500">{detail}</span></span><span className="hidden text-xs text-slate-400 sm:block">{url.replace("https://", "").replace("www.", "")}</span></a>)}</section>)}<section className="overflow-hidden rounded-xl border border-white/10 bg-white text-cvc-deep shadow-[0_8px_24px_rgba(0,0,0,0.16)]"><div className="h-1 bg-[#dcae37]"/><header className="bg-[#123040] px-5 py-3 font-display text-xl uppercase tracking-[0.08em] text-white">CVC League Tools</header><a href="/news" className="flex items-center gap-3 border-b border-slate-200 px-5 py-4 hover:bg-[#f4faef]"><Newspaper size={16} className="shrink-0 text-cvc-accent"/><span><span className="block font-semibold">CVC Player News</span><span className="mt-0.5 block text-xs text-slate-500">Server-proxied Tank01 player-news feed with CVC roster context.</span></span></a><a href="/rules" className="flex items-center gap-3 px-5 py-4 hover:bg-[#f4faef]"><ShieldCheck size={16} className="shrink-0 text-cvc-accent"/><span><span className="block font-semibold">CVC Rules & Policies</span><span className="mt-0.5 block text-xs text-slate-500">CVC roster, scoring, auction, rights, and transaction policies.</span></span></a></section></div></section>;
}
