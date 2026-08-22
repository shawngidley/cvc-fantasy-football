import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { LockKeyhole } from "lucide-react";
import { Link } from "wouter";

export function ProtectedPage({ children, commissioner = false }: { children: React.ReactNode; commissioner?: boolean }) {
  const { isAuthenticated, loading } = useAuth();
  const access = trpc.league.access.useQuery(undefined, { enabled: isAuthenticated });
  if (loading) return <div className="min-h-screen bg-cvc-ink p-8 text-sm text-cvc-muted">Checking secure CVC session…</div>;
  if (!isAuthenticated) return <div className="min-h-screen bg-cvc-ink p-4 sm:p-8"><div className="mx-auto mt-20 max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-cvc-tint text-cvc-accent"><LockKeyhole /></span><h1 className="mt-5 font-display text-4xl uppercase text-cvc-deep">Secure CVC area</h1><p className="mt-3 text-sm leading-6 text-slate-600">{commissioner ? "League configuration is restricted to commissioners and administrators." : "Owner sign-in is required before you can make lineup changes."}</p><button className="cvc-button mx-auto mt-6" onClick={() => startLogin()}>Sign in to continue</button><Link href="/standings" className="mt-5 block text-xs font-bold uppercase tracking-[0.12em] text-cvc-deep/60">Return to standings</Link></div></div>;
  if (commissioner && access.isLoading) return <div className="min-h-screen bg-cvc-ink p-8 text-sm text-cvc-muted">Checking CVC commissioner access…</div>;
  if (commissioner && !access.data?.isCommissioner) return <div className="min-h-screen bg-cvc-ink p-4 sm:p-8"><div className="mx-auto mt-20 max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-cvc-tint text-cvc-accent"><LockKeyhole /></span><h1 className="mt-5 font-display text-4xl uppercase text-cvc-deep">Commissioner only</h1><p className="mt-3 text-sm leading-6 text-slate-600">Your current account is signed in but is not yet assigned a CVC commissioner or administrator role. The league setup process will map approved owners to their CVC roles.</p><Link href="/lineup" className="cvc-button mx-auto mt-6">Open owner workspace</Link></div></div>;
  return <>{children}</>;
}
