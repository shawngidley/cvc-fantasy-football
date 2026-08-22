import { LeagueLayout } from "@/components/LeagueLayout";
import { useCvcOwnerAuth } from "@/hooks/useCvcOwnerAuth";
import { trpc } from "@/lib/trpc";
import { ChangeEvent, FormEvent, useState } from "react";
import { CheckCircle2, KeyRound, MonitorSmartphone, ShieldCheck, Upload, UsersRound } from "lucide-react";

function SettingsCard({ title, icon: Icon, children }: { title: string; icon: typeof ShieldCheck; children: React.ReactNode }) {
  return <section className="cvc-card"><div className="cvc-card-title"><span className="flex items-center gap-2"><Icon size={15} /> {title}</span></div><div className="cvc-card-stripe" /><div className="cvc-card-body">{children}</div></section>;
}

export default function OwnerSettings() {
  const { owner } = useCvcOwnerAuth();
  const utils = trpc.useUtils();
  const isCommissioner = ["commissioner", "administrator"].includes(owner?.role ?? "");
  const owners = trpc.ownerAuth.owners.useQuery(undefined, { enabled: isCommissioner });
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [resetOwnerId, setResetOwnerId] = useState("");
  const [logoNotice, setLogoNotice] = useState<string | null>(null);
  const changePin = trpc.ownerAuth.changePin.useMutation({ onSuccess: async () => { setCurrentPin(""); setNewPin(""); setConfirmPin(""); await utils.ownerAuth.session.invalidate(); } });
  const resetPin = trpc.ownerAuth.resetPin.useMutation({ onSuccess: () => setResetOwnerId("") });
  const uploadLogo = trpc.ownerAuth.uploadTeamLogo.useMutation({ onSuccess: async () => { setLogoNotice("Your CVC team logo is updated."); await utils.ownerAuth.session.invalidate(); } });
  const deviceReady = typeof window !== "undefined" && "credentials" in navigator;
  const pinFields: Array<{ label: string; value: string; setValue: (value: string) => void; autoComplete: "current-password" | "new-password" }> = [
    { label: "Current PIN", value: currentPin, setValue: setCurrentPin, autoComplete: "current-password" },
    { label: "New PIN", value: newPin, setValue: setNewPin, autoComplete: "new-password" },
    { label: "Confirm new PIN", value: confirmPin, setValue: setConfirmPin, autoComplete: "new-password" },
  ];

  function submitPinChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPin !== confirmPin) return;
    changePin.mutate({ currentPin, newPin });
  }

  function chooseLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setLogoNotice(null);
    if (!file) return;
    if (!(["image/png", "image/jpeg", "image/webp"] as string[]).includes(file.type) || file.size > 2 * 1024 * 1024) {
      setLogoNotice("Choose a PNG, JPG, or WebP logo under 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setLogoNotice("CVC could not read that image file.");
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      const base64 = dataUrl.split(",")[1];
      if (!base64) { setLogoNotice("CVC could not prepare that image for upload."); return; }
      uploadLogo.mutate({ mimeType: file.type as "image/png" | "image/jpeg" | "image/webp", base64 });
    };
    reader.readAsDataURL(file);
  }

  const pinMismatch = Boolean(confirmPin) && newPin !== confirmPin;
  return <LeagueLayout><div className="mb-8"><div className="cvc-eyebrow"><ShieldCheck size={14} /> Owner workspace</div><h1 className="mt-2 font-display text-5xl uppercase leading-none tracking-[0.04em] text-white sm:text-6xl">Owner settings</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-cvc-muted">Manage your CVC owner access and franchise identity. PIN changes take effect immediately and preserve your current secure CVC session.</p></div><div className="grid gap-6 xl:grid-cols-2"><SettingsCard title="Team information" icon={UsersRound}><div className="grid gap-4 sm:grid-cols-2"><div className="rounded-lg bg-cvc-tint p-4"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Owner</p><p className="mt-1 font-display text-2xl uppercase text-cvc-deep">{owner?.displayName ?? "CVC owner"}</p><p className="mt-1 text-xs capitalize text-slate-500">{owner?.role ?? "owner"}</p></div><div className="rounded-lg bg-cvc-tint p-4"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Franchise</p><p className="mt-1 font-display text-2xl uppercase text-cvc-deep">{owner?.franchise?.name ?? "League administrator"}</p><p className="mt-1 text-xs text-slate-500">{owner?.franchise?.abbreviation ?? "No franchise assigned"}</p></div></div></SettingsCard><SettingsCard title="Device sign-in readiness" icon={MonitorSmartphone}><div className="flex gap-3"><CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={20} /><div><p className="font-semibold text-cvc-deep">This browser is ready for secure CVC access.</p><p className="mt-1 text-sm leading-6 text-slate-600">Your owner session uses an httpOnly CVC cookie. {deviceReady ? "This device also supports browser credential APIs if CVC adds passkey sign-in in a future update." : "Browser credential APIs are not available here, so sign in with your CVC owner PIN."}</p></div></div></SettingsCard><SettingsCard title="Change PIN" icon={KeyRound}><form onSubmit={submitPinChange} className="grid gap-4"><div className="grid gap-4 sm:grid-cols-3">{pinFields.map(field => <label key={field.label} className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{field.label}<input value={field.value} onChange={event => field.setValue(event.target.value.replace(/\D/g, "").slice(0, 4))} type="password" inputMode="numeric" autoComplete={field.autoComplete} className="mt-2 block w-full rounded-lg border border-cvc-deep/15 bg-white px-3 py-3 text-base tracking-[0.3em] text-cvc-deep outline-none focus:border-cvc-accent" required /></label>)}</div>{pinMismatch ? <p className="text-sm font-medium text-red-700">Your new PIN entries do not match.</p> : null}{changePin.error ? <p className="text-sm font-medium text-red-700">{changePin.error.message}</p> : null}{changePin.isSuccess ? <p className="text-sm font-medium text-emerald-700">Your CVC PIN was updated.</p> : null}<button disabled={currentPin.length !== 4 || newPin.length !== 4 || pinMismatch || changePin.isPending} className="cvc-button w-fit disabled:cursor-not-allowed disabled:opacity-50">{changePin.isPending ? "Updating PIN…" : "Update secure PIN"}</button></form></SettingsCard>{isCommissioner ? <SettingsCard title="Commissioner PIN reset" icon={KeyRound}><div className="space-y-4"><p className="text-sm leading-6 text-slate-600">Reset an owner’s CVC PIN to the league default. Their existing owner sessions will be signed out immediately.</p><select value={resetOwnerId} onChange={event => setResetOwnerId(event.target.value)} className="block w-full rounded-lg border border-cvc-deep/15 bg-white px-3 py-3 text-sm text-cvc-deep outline-none focus:border-cvc-accent"><option value="">Choose an owner to reset</option>{owners.data?.filter(item => item.id !== owner?.id).map(item => <option key={item.id} value={item.id}>{item.displayName}{item.franchise ? ` · ${item.franchise.name}` : " · Administrator"}</option>)}</select>{resetPin.error ? <p className="text-sm font-medium text-red-700">{resetPin.error.message}</p> : null}{resetPin.isSuccess ? <p className="text-sm font-medium text-emerald-700">{resetPin.data.displayName}’s PIN was reset and existing sessions were cleared.</p> : null}<button type="button" disabled={!resetOwnerId || resetPin.isPending} onClick={() => { const selected = owners.data?.find(item => item.id === resetOwnerId); if (window.confirm(`Reset ${selected?.displayName ?? "this owner"} to the CVC default PIN? Their active sessions will be signed out.`)) resetPin.mutate({ ownerId: resetOwnerId }); }} className="cvc-button disabled:cursor-not-allowed disabled:opacity-50">{resetPin.isPending ? "Resetting PIN…" : "Reset to default PIN"}</button></div></SettingsCard> : null}<SettingsCard title="Team logo" icon={Upload}><div className="flex flex-wrap items-center gap-4">{owner?.franchise?.logo_url ? <img src={owner.franchise.logo_url} alt={`${owner.franchise.name} logo`} className="h-20 w-20 rounded-full border border-cvc-deep/15 bg-white object-cover" /> : <span className="cvc-mark cvc-mark-large">{owner?.franchise?.abbreviation ?? "CVC"}</span>}<div><p className="font-semibold text-cvc-deep">Franchise logo management</p><p className="mt-1 max-w-lg text-sm leading-6 text-slate-600">Upload a PNG, JPG, or WebP image under 2 MB to update your team’s CVC logo. The current text mark remains available until a logo is chosen.</p><label className="cvc-button mt-4 inline-flex cursor-pointer">{uploadLogo.isPending ? "Uploading logo…" : "Choose team logo"}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseLogo} className="sr-only" disabled={!owner?.franchise || uploadLogo.isPending} /></label>{logoNotice ? <p className={`mt-2 text-sm font-medium ${logoNotice.includes("updated") ? "text-emerald-700" : "text-red-700"}`}>{logoNotice}</p> : null}{uploadLogo.error ? <p className="mt-2 text-sm font-medium text-red-700">{uploadLogo.error.message}</p> : null}</div></div></SettingsCard></div></LeagueLayout>;
}
