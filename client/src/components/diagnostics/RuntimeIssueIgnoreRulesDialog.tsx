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
  formatIgnoreRulePreview,
  pathMatchesIgnoreRule,
  type IgnoreRule,
} from "@shared/runtime-issues-ignore";

export function RuntimeIssueIgnoreRulesDialog({
  open,
  onOpenChange,
  ignored,
  issuePaths,
  canRemove,
  unignorePending,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ignored: IgnoreRule[];
  issuePaths: string[];
  canRemove: boolean;
  unignorePending: boolean;
  onRemove: (id: string) => void;
}) {
  const [removeId, setRemoveId] = useState<string | null>(null);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto" data-testid="dialog-runtime-ignore-rules">
          <DialogHeader>
            <DialogTitle>Ignore rules</DialogTitle>
            <DialogDescription>
              Staff templates that skip future 404 digestion. They survive Reset 404 log. This is not a
              redirect and not the built-in scraper/probe drops.
            </DialogDescription>
          </DialogHeader>
          {ignored.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="ignore-rules-empty">
              No custom ignore rules yet. Use a path’s menu or select rows, then Ignore selected (exact
              path). Built-in prefixes (e.g. /wordpress/*, /wp/*, /wp-json/*) are seeded automatically.
            </p>
          ) : (
            <ul className="divide-y">
              {ignored.map((rule) => {
                const preview = formatIgnoreRulePreview(rule);
                const matchCount = issuePaths.filter((p) => pathMatchesIgnoreRule(p, rule)).length;
                return (
                  <li
                    key={rule.id}
                    className="flex items-center gap-2 py-1.5 min-w-0"
                    data-testid={`ignore-rule-${rule.id}`}
                  >
                    <code className="font-mono text-xs truncate min-w-0 flex-1">{preview}</code>
                    <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                      {matchCount}
                    </span>
                    {canRemove ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        disabled={unignorePending}
                        onClick={() => setRemoveId(rule.id)}
                        aria-label={`Remove ignore ${preview}`}
                        data-testid={`button-unignore-${rule.id}`}
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
        <AlertDialogContent data-testid="dialog-unignore-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove ignore rule?</AlertDialogTitle>
            <AlertDialogDescription>
              Future 404s for matching paths will be recorded again. Existing counts are not restored.
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
              data-testid="button-confirm-unignore"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
