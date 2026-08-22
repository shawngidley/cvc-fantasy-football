import { useCvcOwnerAuth } from "@/hooks/useCvcOwnerAuth";
import { leagueMeta } from "@/lib/leagueData";
import { cn } from "@/lib/utils";
import { Menu, ShieldCheck, UserRound } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";

const primaryLinks = [
  { href: "/standings", label: "Standings" },
  { href: "/live", label: "Live" },
  { href: "/rosters", label: "Rosters" },
  { href: "/results", label: "Results" },
  { href: "/draft", label: "Draft" },
  { href: "/transactions", label: "Moves" },
  { href: "/playoffs", label: "Playoffs" },
  { href: "/rules", label: "Rules" },
];

const moreLinks = [
  { href: "/rundown", label: "Rundown" },
  { href: "/news", label: "Player news" },
  { href: "/trades", label: "Trades" },
  { href: "/free-agents", label: "Free agents" },
  { href: "/history", label: "History" },
  { href: "/money", label: "League finance" },
  { href: "/owner-settings", label: "Owner settings" },
  { href: "/nfl-sites", label: "NFL sites" },
];

export function LeagueLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { owner } = useCvcOwnerAuth();
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-cvc-ink text-foreground">
      <div className="cvc-stadium-layer" aria-hidden="true" />
      <header className="cvc-nav">
        <div className="mx-auto flex h-[72px] max-w-[1440px] items-center gap-4 px-4 sm:px-6">
          <Link href="/standings" className="flex shrink-0 items-center gap-3 text-left">
            <span className="cvc-mark">CVC</span>
            <span className="hidden leading-none sm:block">
              <strong className="block font-display text-lg tracking-[0.12em] text-white">CVC</strong>
              <small className="mt-1 block text-[9px] font-bold uppercase tracking-[0.24em] text-cvc-muted">Fantasy Football</small>
            </span>
          </Link>

          <nav className="hidden min-w-0 flex-1 items-center justify-center gap-1 lg:flex" aria-label="Primary league navigation">
            {primaryLinks.map(link => (
              <Link key={link.href} href={link.href} className={cn("cvc-nav-link", location === link.href && "is-active")}>
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Link href={owner ? (owner.franchise ? "/lineup" : "/settings") : "/login"} className="cvc-owner-link">
              <UserRound size={15} />
              <span className="hidden sm:inline">{owner ? (owner.franchise ? "My lineup" : "Commissioner") : "Owner sign in"}</span>
            </Link>
            <button className="cvc-menu-button lg:hidden" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-label="Toggle league menu">
              <Menu size={20} />
            </button>
          </div>
        </div>

        {open ? (
          <div className="border-t border-white/10 bg-cvc-deep/95 px-4 py-4 backdrop-blur-xl lg:hidden">
            <div className="grid grid-cols-2 gap-1">
              {[...primaryLinks, ...moreLinks, { href: "/settings", label: "Commissioner" }].map(link => (
                <Link key={link.href} href={link.href} onClick={() => setOpen(false)} className={cn("cvc-mobile-link", location === link.href && "is-active")}>
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </header>

      <div className="cvc-ticker" role="status">
        <div className="cvc-ticker-track">
          <span><ShieldCheck size={13} /> {leagueMeta.announcement}</span>
          <span><ShieldCheck size={13} /> {leagueMeta.announcement}</span>
        </div>
      </div>

      <main className="relative z-10 mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:py-10">{children}</main>
      <footer className="relative z-10 border-t border-white/10 bg-cvc-deep/80 py-6 text-center text-xs text-cvc-muted backdrop-blur">
        <span className="font-semibold uppercase tracking-[0.18em] text-white">CVC Fantasy Football</span>
        <span className="mx-2 text-white/20">/</span>
        Configurable league foundation · {leagueMeta.season}
      </footer>
    </div>
  );
}
