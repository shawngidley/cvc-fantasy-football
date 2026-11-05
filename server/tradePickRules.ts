import { one } from "../shared/relation";

type PickDraft = { status?: string | null; season?: { year?: number | null } | { year?: number | null }[] | null };
export type TradePickRow = { draft?: PickDraft | PickDraft[] | null };

/** CVC trades may include this year's picks (until that draft completes) and next year's picks. */
export function checkTradePick(pick: TradePickRow, seasonYear: number): string | null {
  const draft = one(pick.draft);
  const pickYear = one(draft?.season)?.year;
  if (pickYear == null || (pickYear !== seasonYear && pickYear !== seasonYear + 1)) {
    return `Only ${seasonYear} and ${seasonYear + 1} CVC draft picks may be traded.`;
  }
  if (pickYear === seasonYear && draft?.status === "complete") {
    return `The ${seasonYear} CVC draft has already been completed, so its picks can no longer be traded.`;
  }
  return null;
}
