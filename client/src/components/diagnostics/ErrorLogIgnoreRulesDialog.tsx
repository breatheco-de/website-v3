import { useState } from "react";
import { IconTrash } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  formatErrorLogIgnoreRulePreview,
  type ErrorLogIgnoreRule,
} from "@shared/error-log-ignore";

export function ErrorLogIgnoreRulesDialog({
  open,
  onOpenChange,
  ignored,
  canRemove,
  unignorePending,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ignored: ErrorLogIgnoreRule[];
  canRemove: boolean;
  unignorePending: boolean;
  onRemove: (id: string) => void;
}) {
  const [removeId, setRemoveId] = useState<string | null>(null);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto" data-testid="dialog-error-log-ignore-rules">
          <DialogHeader>
            <DialogTitle>Ignore rules</DialogTitle>
            <DialogDescription>
              Hand-reviewed templates that stop matching process errors from being stored. They live in
              a separate file from the log so clearing old rows does not wipe your decisions.
            </DialogDescription>
          </DialogHeader>
          {ignored.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="error-log-ignore-rules-empty">
              No ignore rules yet. Open a unique issue and choose Ignore after reviewing it.
            </p>
          ) : (
            <ul className="divide-y">
              {ignored.map((rule) => {
                const preview = formatErrorLogIgnoreRulePreview(rule);
                return (
                  <li
                    key={rule.id}
                    className="flex items-center gap-2 py-1.5 min-w-0"
                    data-testid={`error-log-ignore-rule-${rule.id}`}
                  >
                    <code className="font-mono text-xs truncate min-w-0 flex-1">{preview}</code>
                    {canRemove ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        disabled={unignorePending}
                        onClick={() => setRemoveId(rule.id)}
                        aria-label={`Remove ignore ${preview}`}
                        data-testid={`button-error-log-unignore-${rule.id}`}
                      >
                        <IconTrash className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!removeId} onOpenChange={(next) => !next && setRemoveId(null)}>
        <AlertDialogContent data-testid="dialog-error-log-unignore-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove ignore rule?</AlertDialogTitle>
            <AlertDialogDescription>
              Matching errors will be recorded again. Rows already deleted from the log are not
              restored.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (removeId) onRemove(removeId);
                setRemoveId(null);
              }}
              data-testid="button-confirm-error-log-unignore"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
