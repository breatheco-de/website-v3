import { useMemo, useState } from "react";
import { IconTrash } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
  pathMatchesAnyIgnoreRule,
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
  canPurge,
  purgeMatchingPending,
  onPurgeMatching,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ignored: IgnoreRule[];
  issuePaths: string[];
  canRemove: boolean;
  unignorePending: boolean;
  onRemove: (id: string) => void;
  canPurge?: boolean;
  purgeMatchingPending?: boolean;
  onPurgeMatching?: () => void;
}) {
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [purgeMatchingOpen, setPurgeMatchingOpen] = useState(false);

  const matchingPathCount = useMemo(() => {
    if (!ignored.length) return 0;
    return issuePaths.filter((p) => pathMatchesAnyIgnoreRule(p, ignored)).length;
  }, [ignored, issuePaths]);

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
          {canPurge && ignored.length > 0 ? (
            <DialogFooter className="flex-col items-stretch gap-2 sm:flex-col sm:items-stretch">
              <p className="text-xs text-muted-foreground text-left">
                Remove matching 404s from log clears rows already covered by these templates (including
                WordPress prefixes). Does not change rules.
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto sm:self-start"
                disabled={purgeMatchingPending || matchingPathCount === 0}
                onClick={() => setPurgeMatchingOpen(true)}
                data-testid="button-purge-matching-ignore-rules"
              >
                Remove matching 404s from log
                {matchingPathCount > 0 ? ` (${matchingPathCount})` : ""}
              </Button>
            </DialogFooter>
          ) : null}
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
      <AlertDialog open={purgeMatchingOpen} onOpenChange={setPurgeMatchingOpen}>
        <AlertDialogContent data-testid="dialog-purge-matching-ignore-rules">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove matching 404s from log?</AlertDialogTitle>
            <AlertDialogDescription>
              Deletes {matchingPathCount} stored 404{matchingPathCount === 1 ? "" : "s"} that match your
              ignore templates. Ignore rules stay in place. Future hits for those paths will not be
              recorded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-purge-matching-ignore-rules">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                onPurgeMatching?.();
                setPurgeMatchingOpen(false);
              }}
              disabled={purgeMatchingPending}
              data-testid="button-confirm-purge-matching-ignore-rules"
            >
              {purgeMatchingPending ? "Removing…" : "Remove from log"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
