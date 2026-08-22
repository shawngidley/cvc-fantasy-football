import { trpc } from "@/lib/trpc";

export function useCvcOwnerAuth() {
  const utils = trpc.useUtils();
  const session = trpc.ownerAuth.session.useQuery();
  const signOut = trpc.ownerAuth.signOut.useMutation({
    onSuccess: async () => {
      await utils.ownerAuth.session.invalidate();
      await utils.league.access.invalidate();
      await utils.league.myFranchise.invalidate();
    },
  });

  return {
    owner: session.data ?? null,
    isAuthenticated: Boolean(session.data),
    loading: session.isLoading,
    error: session.error,
    logout: signOut.mutateAsync,
    isSigningOut: signOut.isPending,
  };
}
