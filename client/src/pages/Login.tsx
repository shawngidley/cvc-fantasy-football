import { useAuth } from "@/_core/hooks/useAuth";
import { leagueMeta } from "@/lib/leagueData";
import { startLogin } from "@/const";
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { Link } from "wouter";

export default function Login() {
  const { isAuthenticated, loading, user, logout } = useAuth();

  return (
    <div className="cvc-login-wrap">
      <div className="cvc-login-art" aria-hidden="true" />
      <section className="cvc-login-panel">
        <span className="cvc-eyebrow">Owner portal</span>
        <h1 className="mt-3 font-display text-5xl uppercase leading-[0.9] tracking-[0.035em] text-cvc-deep sm:text-6xl">Run your<br /><em className="font-normal text-cvc-accent">franchise.</em></h1>
        <p className="mt-5 max-w-md text-sm leading-6 text-slate-600">Lineup changes, league settings, and commissioner administration use secure owner access. Public league pages remain open to everyone.</p>
        <div className="mt-8 rounded-xl border border-cvc-deep/10 bg-cvc-tint p-4 text-sm text-slate-600">
          <div className="flex items-center gap-2 font-semibold text-cvc-deep"><ShieldCheck size={16} className="text-cvc-accent" /> CVC access framework</div>
          <p className="mt-2 leading-5">Owner roles and franchise membership will be configured in the commissioner console when CVC league details are available.</p>
        </div>
        {loading ? <p className="mt-8 text-sm text-slate-500">Checking owner session…</p> : isAuthenticated ? (
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/lineup" className="cvc-button">Open my lineup <ArrowRight size={16} /></Link>
            <button className="cvc-button-secondary" onClick={logout}>Sign out {user?.name ? `(${user.name})` : ""}</button>
          </div>
        ) : (
          <button className="cvc-button mt-8" onClick={() => startLogin()}><LockKeyhole size={16} /> Sign in as an owner</button>
        )}
        <Link href="/standings" className="mt-7 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-cvc-deep/65 hover:text-cvc-deep">Return to public league view <ArrowRight size={13} /></Link>
      </section>
      <aside className="cvc-login-copy">
        <span className="cvc-mark cvc-mark-large">CVC</span>
        <p className="mt-8 max-w-sm font-display text-3xl uppercase leading-none tracking-[0.045em] text-white">{leagueMeta.name}</p>
        <p className="mt-4 max-w-sm text-sm leading-6 text-white/70">A configurable, commissioner-managed league workspace built for real franchises, real rules, and real competition.</p>
      </aside>
    </div>
  );
}
