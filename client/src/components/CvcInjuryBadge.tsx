import { useState } from "react";
import type { CvcInjuryStatus } from "@/hooks/useCvcInjuryStatuses";

// Color-coded by rough severity so an owner can tell at a glance without needing to
// tap -- the tap-to-reveal detail below is for players who want the specifics, not a
// prerequisite for spotting who needs a look.
const SEVERITY_CLASSES: Record<string, string> = {
  O: "border-rose-300 bg-rose-100 text-rose-700",
  IR: "border-rose-300 bg-rose-100 text-rose-700",
  PUP: "border-rose-300 bg-rose-100 text-rose-700",
  NA: "border-rose-300 bg-rose-100 text-rose-700",
  D: "border-orange-300 bg-orange-100 text-orange-700",
  Q: "border-amber-300 bg-amber-100 text-amber-700",
};
const DEFAULT_CLASSES = "border-amber-300 bg-amber-100 text-amber-700";

/** A small, tap-to-reveal injury status badge for a player card -- deliberately not
 * built on the app's existing Radix Tooltip (client/src/components/ui/tooltip.tsx),
 * which is hover-based and only used so far on desktop-oriented chrome (the sidebar, a
 * component showcase), not anywhere on the mobile-first player-facing pages this needs
 * to work on. Tap toggles a small inline popover with the full status text; tap again
 * (or tap the badge again) closes it. */
export function CvcInjuryBadge({ status, align = "left" }: { status: CvcInjuryStatus; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  if (!status.shortStatus) return null;
  const colorClasses = SEVERITY_CLASSES[status.shortStatus.toUpperCase()] ?? DEFAULT_CLASSES;
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={event => { event.stopPropagation(); setOpen(current => !current); }}
        className={`inline-flex items-center justify-center rounded border px-1 py-0.5 text-[8px] font-bold leading-none sm:text-[9px] ${colorClasses}`}
        aria-label={`Injury status: ${status.headline}`}
      >
        {status.shortStatus}
      </button>
      {open ? (
        <span
          className={`absolute top-full z-10 mt-1 whitespace-nowrap rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 shadow-md ${align === "right" ? "right-0" : "left-0"}`}
        >
          {status.headline}
        </span>
      ) : null}
    </span>
  );
}
