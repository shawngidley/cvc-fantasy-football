import { LeagueLayout } from "@/components/LeagueLayout";
import { ArrowLeft, MapPinOff } from "lucide-react";
import { Link } from "wouter";

export default function NotFound() {
  return <LeagueLayout><section className="mx-auto flex min-h-[56vh] max-w-xl flex-col items-center justify-center text-center"><span className="flex h-16 w-16 items-center justify-center rounded-full border border-cvc-accent/50 bg-white/5 text-cvc-accent"><MapPinOff size={26} /></span><span className="cvc-eyebrow mt-6">Route not found</span><h1 className="mt-3 font-display text-6xl uppercase leading-none tracking-[0.04em] text-white">Off the<br /><em className="font-normal text-cvc-accent">field.</em></h1><p className="mt-4 max-w-sm text-sm leading-6 text-cvc-muted">This CVC route is not on the current league map. Return to standings to continue exploring the league foundation.</p><Link href="/standings" className="cvc-button mt-7"><ArrowLeft size={16} /> Return to standings</Link></section></LeagueLayout>;
}
