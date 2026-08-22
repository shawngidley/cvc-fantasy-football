import { useCvcOwnerAuth } from "@/hooks/useCvcOwnerAuth";
import { leagueMeta } from "@/lib/leagueData";
import { cn } from "@/lib/utils";
import { TeamLogo } from "@/components/TeamLogo";
import { ChevronDown, Menu, Settings, ShieldCheck, UserRound, X } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";

type NavLink = { href: string; label: string; live?: boolean };
const primaryLinks: NavLink[] = [
  { href: "/standings", label: "Standings" }, { href: "/live", label: "Live", live: true }, { href: "/lineup", label: "Lineup" }, { href: "/rosters", label: "Rosters" }, { href: "/free-agents", label: "Free agents" }, { href: "/transactions", label: "Transactions" }, { href: "/results", label: "Schedule" }, { href: "/news", label: "News" }, { href: "/trades", label: "Trades" }, { href: "/draft", label: "Draft" },
];
const draftLinks: NavLink[] = [{ href: "/draft", label: "Draft order" }, { href: "/draft-lottery", label: "Draft lottery" }, { href: "/draft-recap", label: "Draft recap" }, { href: "/protections", label: "Protections" }];
const leagueLinks: NavLink[] = [{ href: "/rules", label: "Rules" }, { href: "/money", label: "Money" }, { href: "/history", label: "History" }, { href: "/playoffs", label: "Playoffs" }, { href: "/owner-settings", label: "Owner settings" }, { href: "/nfl-sites", label: "NFL sites" }];

function DrawerGroup({ label, links, location, onNavigate }: { label: string; links: NavLink[]; location: string; onNavigate: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const active = links.some(link => location === link.href);
  return <div className="border-b border-white/10"><button onClick={() => setExpanded(value => !value)} className={cn("flex w-full items-center justify-between py-3 font-display text-lg uppercase tracking-[0.08em]", active ? "text-cvc-accent" : "text-white/85")}>{label}<ChevronDown size={17} className={cn("transition-transform", expanded && "rotate-180")} /></button>{expanded ? <div className="border-t border-white/5 pl-4">{links.map(link => <Link key={link.href} href={link.href} onClick={onNavigate} className="block border-b border-white/5 py-2.5 font-display text-sm uppercase tracking-[0.08em] text-white/65">{link.label}</Link>)}</div> : null}</div>;
}

export function LeagueLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { owner } = useCvcOwnerAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [leagueOpen, setLeagueOpen] = useState(false);
  const teamName = owner?.franchise?.name;
  const leagueActive = leagueLinks.some(link => location === link.href);
  const tickerText = `CVC FANTASY FOOTBALL ${leagueMeta.season}  •  TANK01 LIVE SCORING  •  OWNER LINEUPS LOCK AT NFL KICKOFF`;

  return <div className="min-h-screen bg-cvc-ink text-foreground"><div className="cvc-stadium-layer" aria-hidden="true" />
    <header className="cvc-nav"><div className="mx-auto flex h-[60px] max-w-[1440px] items-center gap-4 px-4 sm:px-6">
      <Link href="/standings" className="flex shrink-0 items-center gap-2.5"><img src="/manus-storage/cvc-header-crest_5a1114ba.png" alt="CVC Fantasy Football crest" className="h-9 w-9 object-contain" /><span className="font-display text-base uppercase tracking-[0.08em] text-white sm:text-lg">Fantasy Football</span></Link>
      <nav className="hidden min-w-0 flex-1 items-center justify-center lg:flex" aria-label="Primary league navigation">{primaryLinks.map(link => <Link key={link.href} href={link.href} className={cn("cvc-nav-link", location === link.href && "is-active")}><span className={cn(link.live && "inline-flex items-center gap-1.5")}>{link.live ? <i className="h-1.5 w-1.5 rounded-full bg-red-500" /> : null}{link.label}</span></Link>)}<div className="relative"><button onClick={() => setLeagueOpen(value => !value)} className={cn("cvc-nav-link inline-flex items-center gap-1", leagueActive && "is-active")}>League<ChevronDown size={12} className={cn("transition-transform", leagueOpen && "rotate-180")} /></button>{leagueOpen ? <div className="absolute right-0 top-9 z-50 min-w-32 overflow-hidden rounded-lg border border-cvc-accent/40 bg-cvc-deep shadow-2xl">{leagueLinks.map(link => <Link key={link.href} href={link.href} onClick={() => setLeagueOpen(false)} className="block px-3 py-2 font-display text-xs uppercase tracking-[0.08em] text-white/80 hover:bg-white/10 hover:text-cvc-accent">{link.label}</Link>)}</div> : null}</div></nav>
      <div className="ml-auto flex items-center gap-3">{teamName ? <div className="hidden items-center gap-2 sm:flex"><TeamLogo name={teamName} abbreviation={owner?.franchise?.abbreviation} logoUrl={owner?.franchise?.logo_url} size="xs" className="border-cvc-accent/60"/><span className="font-display text-sm uppercase tracking-[0.06em] text-cvc-accent">{teamName}</span><Link href="/owner-settings" title="Owner settings" className="text-white/60 hover:text-cvc-accent"><Settings size={18} /></Link></div> : <Link href="/login" className="cvc-owner-link"><UserRound size={15} /><span className="hidden sm:inline">Owner sign in</span></Link>}<button className="cvc-menu-button" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu size={22} /></button></div>
    </div></header>
    <div className="cvc-ticker" role="status"><div className="cvc-ticker-track"><span><ShieldCheck size={13} /> {tickerText}</span><span><ShieldCheck size={13} /> {tickerText}</span></div></div>
    {mobileOpen ? <><div className="fixed inset-0 z-[998] bg-black/60" onClick={() => setMobileOpen(false)} /><aside className="fixed right-0 top-0 z-[999] h-full w-[min(86vw,340px)] overflow-y-auto border-l border-cvc-accent/30 bg-cvc-deep px-6 py-6 shadow-2xl"><div className="mb-7 flex items-center justify-between"><p className="font-display text-xl uppercase tracking-[0.08em] text-cvc-accent">CVC menu</p><button onClick={() => setMobileOpen(false)} aria-label="Close menu" className="text-white"><X size={28} /></button></div>{primaryLinks.map(link => <Link key={link.href} href={link.href} onClick={() => setMobileOpen(false)} className={cn("flex items-center gap-2 border-b border-white/10 py-3 font-display text-lg uppercase tracking-[0.08em]", location === link.href ? "text-cvc-accent" : "text-white/85")}>{link.live ? <i className="h-2 w-2 rounded-full bg-red-500" /> : null}{link.label}</Link>)}<DrawerGroup label="Draft" links={draftLinks} location={location} onNavigate={() => setMobileOpen(false)} /><DrawerGroup label="League" links={leagueLinks} location={location} onNavigate={() => setMobileOpen(false)} /></aside></> : null}
    <main className="relative z-10 mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:py-10">{children}</main><footer className="relative z-10 border-t border-white/10 bg-cvc-deep/80 py-6 text-center text-xs text-cvc-muted backdrop-blur"><span className="font-semibold uppercase tracking-[0.18em] text-white">CVC Fantasy Football</span><span className="mx-2 text-white/20">/</span>{leagueMeta.season}</footer>
  </div>;
}
