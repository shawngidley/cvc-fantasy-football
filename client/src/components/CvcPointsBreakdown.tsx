import { useState } from "react";
import { calculateCvcFantasyPointsBreakdown, type CvcScoringRule, type Tank01LiveStats } from "@shared/cvcScoring";

/** Makes a player's point total tappable -- tap opens a small popover breaking the
 * total down by fantasy stat (e.g. "285 passing yds -- 14.3 pts", "2 passing TDs --
 * 8.0 pts"), similar to FanTrax's version of this feature that prompted the request.
 * Renders the total itself unchanged (via children) when there's no live stat line
 * yet (pre-kickoff) or nothing to break down, so it degrades to a plain, non-
 * interactive number rather than an empty or misleading tappable target. */
export function CvcPointsBreakdown({
  stats,
  position,
  rules,
  align = "left",
  children,
}: {
  stats: Tank01LiveStats | null;
  position: string;
  rules: CvcScoringRule[];
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const items = stats ? calculateCvcFantasyPointsBreakdown(stats, position, rules) : [];
  if (!items.length) return <>{children}</>;
  return (
    <span className="relative inline-block">
      <button type="button" onClick={() => setOpen(current => !current)} className="cursor-pointer underline decoration-dotted decoration-slate-300 underline-offset-4">
        {children}
      </button>
      {open ? (
        <span className={`absolute top-full z-20 mt-1 w-max min-w-[180px] max-w-[240px] rounded-lg border border-slate-200 bg-white p-2 text-left shadow-lg ${align === "right" ? "right-0" : "left-0"}`}>
          {items.map((item, index) => (
            <span key={index} className="flex items-center justify-between gap-3 py-0.5 text-[11px]">
              <span className="text-slate-600">{item.label}</span>
              <span className="font-bold text-cvc-deep">{item.points > 0 ? "+" : ""}{item.points.toFixed(1)}</span>
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
}
