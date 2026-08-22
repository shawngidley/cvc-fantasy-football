import { trpc } from "@/lib/trpc";
import { useCallback, useEffect, useMemo } from "react";

type UseAuthOptions = { redirectOnUnauthenticated?: boolean; redirectPath?: string };

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = "/login" } = options ?? {};
  const utils = trpc.useUtils();
  const session = trpc.ownerAuth.session.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const signOut = trpc.ownerAuth.signOut.useMutation({ onSuccess: () => utils.ownerAuth.session.setData(undefined, null) });
  const logout = useCallback(async () => { await signOut.mutateAsync(); await utils.ownerAuth.session.invalidate(); }, [signOut, utils]);
  const user = useMemo(() => session.data ? { id: 0, openId: `cvc:${session.data.id}`, name: session.data.displayName, email: null, loginMethod: "cvc_pin", role: session.data.role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() } : null, [session.data]);

  useEffect(() => {
    if (!redirectOnUnauthenticated || session.isLoading || signOut.isPending || user || typeof window === "undefined") return;
    if (window.location.pathname !== redirectPath) window.location.href = redirectPath;
  }, [redirectOnUnauthenticated, redirectPath, session.isLoading, signOut.isPending, user]);

  return { user, loading: session.isLoading || signOut.isPending, error: session.error ?? signOut.error ?? null, isAuthenticated: Boolean(user), refresh: () => session.refetch(), logout };
}
