import { useCvcOwnerAuth } from "@/hooks/useCvcOwnerAuth";
import { LockKeyhole } from "lucide-react";
import { Link } from "wouter";

export function ProtectedPage({ children, commissioner = false }: { children: React.ReactNode; commissioner?: boolean }) {
  const { owner, isAuthenticated, loading } = useCvcOwnerAuth();
  if (loading) return <div className="min-h-screen bg-cvc-ink p-8 text-sm text-cvc-muted">Checking secure CVC owner session…</div>;
  if (!isAuthenticated) return <div className="min-h-screen bg-cvc-ink p-4 sm:p-8"><div className="mx-auto mt-20 max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-cvc-tint text-cvc-accent"><LockKeyhole /></span><h1 className="mt-5 font-display text-4xl uppercase text-cvc-deep">Secure CVC area</h1><p className="mt-3 text-sm leading-6 text-slate-600">{commissioner ? "League configuration is restricted to CVC commissioners and administrators." : "Select your owner record and enter your CVC PIN to continue."}</p><Link href="/login" className="cvc-button mx-auto mt-6">Owner sign in</Link><Link href="/standings" className="mt-5 block text-xs font-bold uppercase tracking-[0.12em] text-cvc-deep/60">Return to standings</Link></div></div>;
  if (commissioner && !["commissioner", "administrator"].includes(owner?.role ?? "")) return <div className="min-h-screen bg-cvc-ink p-4 sm:p-8"><div className="mx-auto mt-20 max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-cvc-tint text-cvc-accent"><LockKeyhole /></span><h1 className="mt-5 font-display text-4xl uppercase text-cvc-deep">Commissioner only</h1><p className="mt-3 text-sm leading-6 text-slate-600">Your CVC owner record does not have commissioner or administrator access.</p><Link href={owner?.franchise ? "/lineup" : "/standings"} className="cvc-button mx-auto mt-6">Return to CVC</Link></div></div>;
  return <>{children}</>;
}
