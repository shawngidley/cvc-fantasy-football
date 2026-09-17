import { useCallback, useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

type ConfirmRequest = {
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<unknown> | unknown;
};

// In-app replacement for window.confirm, used anywhere an action needs an "are you
// sure?" step before running -- window.confirm/prompt/alert are silently suppressed in
// some browsers and installed-app (PWA) modes, making the button look like it does
// nothing. Renders via the existing shadcn/radix AlertDialog and, on a rejected
// onConfirm, shows the error message inside the dialog itself (not only a toast) so a
// rejection reason (e.g. a locked player) is visible right where the user is looking.
export function useConfirmDialog() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const confirm = useCallback((next: ConfirmRequest) => {
    setRequest(next);
    setError(null);
  }, []);

  const close = () => {
    if (pending) return;
    setRequest(null);
    setError(null);
  };

  const handleConfirm = async () => {
    if (!request) return;
    setPending(true);
    setError(null);
    try {
      await request.onConfirm();
      setRequest(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  };

  const dialog = (
    <AlertDialog open={Boolean(request)} onOpenChange={open => { if (!open) close(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title}</AlertDialogTitle>
          <AlertDialogDescription>{request?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} onClick={close}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={event => { event.preventDefault(); void handleConfirm(); }}
            className={request?.destructive ? "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600" : undefined}
          >
            {pending ? "Working…" : (request?.confirmLabel ?? "Confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, dialog };
}
