import { ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { useCvcOwnerAuth } from "@/hooks/useCvcOwnerAuth";

type DraftSubNavTab = "board" | "rookie" | "players" | "protections";

/** Same four destinations, rendered on all three pages so the commissioner (or anyone)
 * can jump between them without going back through the header dropdown. "Auction board"
 * and "Auction players" are two sections of the SAME /auction page, so when we're
 * already there they're plain same-page anchor links (native browser scroll-to-anchor);
 * from any other page they're full cross-page links to /auction with the hash attached. */
export function DraftSubNav({ current }: { current: DraftSubNavTab }) {
  const { owner } = useCvcOwnerAuth();
  const controls = ["commissioner", "administrator"].includes(owner?.role ?? "");
  const onAuctionPage = current === "board" || current === "players";
  const tabClass = (active: boolean) => active ? "border-b-[3px] border-cvc-accent px-4 py-3 font-display text-sm uppercase tracking-[0.08em] text-cvc-accent" : "border-b-[3px] border-transparent px-4 py-3 font-display text-sm uppercase tracking-[0.08em] text-white/60 hover:text-white";
  return <div className="sticky top-[60px] z-30 -mx-4 mb-7 overflow-x-auto border-b-2 border-white/10 bg-cvc-deep/95 px-4 backdrop-blur sm:-mx-6 sm:px-6"><div className="mx-auto flex w-max min-w-full max-w-[1440px] items-center">
    {onAuctionPage ? <a href="#auction-board" className={tabClass(current === "board")}>Auction board</a> : <Link href="/auction#auction-board" className={tabClass(false)}>Auction board</Link>}
    <Link href="/draft-recap" className={tabClass(current === "rookie")}>Rookie draft</Link>
    {onAuctionPage ? <a href="#auction-players" className={tabClass(current === "players")}>Auction players</a> : <Link href="/auction#auction-players" className={tabClass(false)}>Auction players</Link>}
    <Link href="/protections" className={tabClass(current === "protections")}>Protections</Link>
    {controls ? <span className="ml-3 inline-flex items-center gap-2 rounded-full border border-cvc-accent/50 bg-cvc-accent/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-cvc-accent"><ShieldCheck size={12} /> Commissioner console</span> : null}
  </div></div>;
}
