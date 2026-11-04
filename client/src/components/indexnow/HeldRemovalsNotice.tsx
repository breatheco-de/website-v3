import { useState } from "react";
import { IconAlertTriangle, IconLoader2 } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { INDEXNOW_STATUS_KEY, PUBLIC_URL_CHANGES_KEY, postJson } from "@/lib/indexnow";

export function HeldRemovalsNotice({ removedCount, canEdit }: { removedCount: number; canEdit: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      const res = await postJson<{ error?: string }>("/api/public-url-changes/confirm-removals");
      if (!res.ok) throw new Error(res.body.error || "Could not record the removals");
      toast({ title: "Removals will be recorded", description: "The next check records them in a few seconds." });
      await queryClient.invalidateQueries({ queryKey: INDEXNOW_STATUS_KEY });
      await queryClient.invalidateQueries({ queryKey: [PUBLIC_URL_CHANGES_KEY] });
      setOpen(false);
    } catch (err) {
      toast({
        title: "Could not record removals",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 sm:flex-row sm:items-start sm:justify-between"
      data-testid="notice-held-removals"
    >
      <div className="flex gap-2">
        <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <p className="text-sm text-foreground">
          A recent check would mark {removedCount} pages as removed at once, so it was held in case something was
          temporarily broken. If those pages really were removed, record them.
        </p>
      </div>
      <Button
        size="sm"
        variant="secondary"
        className="shrink-0"
        disabled={!canEdit}
        onClick={() => setOpen(true)}
        data-testid="button-confirm-removals"
      >
        These removals are real, record them
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Record {removedCount} removed pages?</AlertDialogTitle>
            <AlertDialogDescription>
              The next check records these pages as removed and, on the live site, tells search engines to recheck
              them. Only confirm if the pages were removed on purpose.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirm();
              }}
              disabled={busy}
              data-testid="button-confirm-removals-dialog"
            >
              {busy ? <IconLoader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Record removals
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
