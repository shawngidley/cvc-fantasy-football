import { useCvcOwnerAuth } from "@/hooks/useCvcOwnerAuth";
import { trpc } from "@/lib/trpc";
import { leagueMeta } from "@/lib/leagueData";
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";
import { Link, useLocation } from "wouter";

export default function Login() {
  const { owner, isAuthenticated, loading, logout, isSigningOut } = useCvcOwnerAuth();
  const owners = trpc.ownerAuth.owners.useQuery();
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const [ownerId, setOwnerId] = useState("");
  const [pin, setPin] = useState("");
  const signIn = trpc.ownerAuth.signIn.useMutation({
    onSuccess: async session => {
      await Promise.all([utils.ownerAuth.session.invalidate(), utils.league.access.invalidate(), utils.league.myFranchise.invalidate()]);
      setLocation(session.franchise ? "/lineup" : "/settings");
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ownerId || pin.length !== 4) return;
    signIn.mutate({ ownerId, pin });
  }

  return <div className="cvc-login-wrap">
    <div className="cvc-login-art" aria-hidden="true" />
    <section className="cvc-login-panel">
      <span className="cvc-eyebrow">Owner portal</span>
      <h1 className="mt-3 font-display text-5xl uppercase leading-[0.9] tracking-[0.035em] text-cvc-deep sm:text-6xl">Run your<br /><em className="font-normal text-cvc-accent">franchise.</em></h1>
      <p className="mt-5 max-w-md text-sm leading-6 text-slate-600">Select your CVC owner record and enter your four-digit PIN. Public league pages remain open to everyone.</p>
      <div className="mt-8 rounded-xl border border-cvc-deep/10 bg-cvc-tint p-4 text-sm text-slate-600"><div className="flex items-center gap-2 font-semibold text-cvc-deep"><ShieldCheck size={16} className="text-cvc-accent" /> CVC-controlled access</div><p className="mt-2 leading-5">Your session is stored securely by CVC. Owners can change their own PIN in Owner Settings after signing in.</p></div>
      {loading ? <p className="mt-8 text-sm text-slate-500">Checking CVC owner session…</p> : isAuthenticated && owner ? <div className="mt-8 flex flex-wrap gap-3"><Link href={owner.franchise ? "/lineup" : "/settings"} className="cvc-button">Open {owner.franchise ? "my lineup" : "commissioner settings"} <ArrowRight size={16} /></Link><button className="cvc-button-secondary" disabled={isSigningOut} onClick={() => logout()}>Sign out ({owner.displayName})</button></div> : <form className="mt-8 space-y-4" onSubmit={submit}><label className="block text-xs font-bold uppercase tracking-[0.12em] text-cvc-deep">Owner<select value={ownerId} onChange={event => setOwnerId(event.target.value)} className="mt-2 block w-full rounded-lg border border-cvc-deep/15 bg-white px-3 py-3 text-sm text-cvc-deep outline-none focus:border-cvc-accent" required><option value="">Choose your name</option>{owners.data?.map(item => <option key={item.id} value={item.id}>{item.displayName}{item.franchise ? ` · ${item.franchise.name}` : " · Administrator"}</option>)}</select></label><label className="block text-xs font-bold uppercase tracking-[0.12em] text-cvc-deep">Four-digit PIN<input value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))} type="password" inputMode="numeric" autoComplete="current-password" className="mt-2 block w-full rounded-lg border border-cvc-deep/15 bg-white px-3 py-3 text-lg tracking-[0.35em] text-cvc-deep outline-none focus:border-cvc-accent" placeholder="••••" required /></label>{signIn.error ? <p className="text-sm font-medium text-red-700">{signIn.error.message}</p> : null}<button type="submit" disabled={!ownerId || pin.length !== 4 || signIn.isPending} className="cvc-button w-full justify-center">{signIn.isPending ? "Signing in…" : <><LockKeyhole size={16} /> Sign in as owner</>}</button></form>}
      <Link href="/standings" className="mt-7 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-cvc-deep/65 hover:text-cvc-deep">Return to public league view <ArrowRight size={13} /></Link>
    </section>
    <aside className="cvc-login-copy"><span className="cvc-mark cvc-mark-large">CVC</span><p className="mt-8 max-w-sm font-display text-3xl uppercase leading-none tracking-[0.045em] text-white">{leagueMeta.name}</p><p className="mt-4 max-w-sm text-sm leading-6 text-white/70">A commissioner-managed league workspace built for real franchises, real rules, and real competition.</p></aside>
  </div>;
}
