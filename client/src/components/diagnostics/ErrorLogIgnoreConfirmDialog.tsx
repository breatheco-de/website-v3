import { useEffect, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  formatErrorLogIgnoreRulePreview,
  suggestDefaultErrorLogIgnoreRule,
  suggestFingerprintErrorLogIgnoreRule,
  type ErrorLogIgnoreCandidate,
  type ErrorLogIgnoreRuleInput,
} from "@shared/error-log-ignore";
import { apiFetch } from "@/lib/queryClient";

export function ErrorLogIgnoreConfirmDialog({
  open,
  onOpenChange,
  candidate,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidate: ErrorLogIgnoreCandidate | null;
  pending: boolean;
  onConfirm: (rule: ErrorLogIgnoreRuleInput) => void;
}) {
  const [useFingerprint, setUseFingerprint] = useState(false);
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [previewPending, setPreviewPending] = useState(false);

  const rule: ErrorLogIgnoreRuleInput | null = candidate
    ? useFingerprint
      ? suggestFingerprintErrorLogIgnoreRule(candidate)
      : suggestDefaultErrorLogIgnoreRule(candidate)
    : null;

  useEffect(() => {
    if (!open) {
      setUseFingerprint(false);
      setMatchCount(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !candidate) return;
    const nextRule = useFingerprint
      ? suggestFingerprintErrorLogIgnoreRule(candidate)
      : suggestDefaultErrorLogIgnoreRule(candidate);
    let cancelled = false;
    setPreviewPending(true);
    void (async () => {
      try {
        const res = await apiFetch("/api/admin/error-log/preview-ignore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rule: nextRule }),
        });
        const body = (await res.json()) as { matchCount?: number };
        if (!cancelled) setMatchCount(typeof body.matchCount === "number" ? body.matchCount : 0);
      } catch {
        if (!cancelled) setMatchCount(null);
      } finally {
        if (!cancelled) setPreviewPending(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, candidate, useFingerprint]);

  if (!candidate || !rule) return null;

  const preview = formatErrorLogIgnoreRulePreview(rule);
  const countLabel =
    matchCount == null
      ? previewPending
        ? "Counting matching rows…"
        : "Could not count matching rows"
      : `${matchCount} matching row${matchCount === 1 ? "" : "s"} in the last 48 hours will be removed.`;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="dialog-error-log-ignore-confirm">
        <AlertDialogHeader>
          <AlertDialogTitle>Ignore this error?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>
                Future matches will not be stored. Matching rows already in the log will be deleted.
                This is a hand-reviewed decision — there are no automatic ignore rules.
              </p>
              <p className="font-mono text-xs text-foreground break-all" data-testid="text-ignore-rule-preview">
                {preview}
              </p>
              <p data-testid="text-ignore-match-count">{countLabel}</p>
              {useFingerprint ? (
                <p className="text-destructive text-xs">
                  Fingerprint mode ignores the whole message shape for this module and level. Real
                  failures that share the same shape will also be hidden.
                </p>
              ) : null}
              <div className="flex items-center gap-2 pt-1">
                <Switch
                  id="error-log-ignore-fingerprint"
                  checked={useFingerprint}
                  onCheckedChange={setUseFingerprint}
                  data-testid="toggle-error-log-ignore-fingerprint"
                />
                <Label htmlFor="error-log-ignore-fingerprint" className="text-sm font-normal">
                  Use broader fingerprint match
                </Label>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-error-log-ignore">Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              onConfirm(rule);
            }}
            data-testid="button-confirm-error-log-ignore"
          >
            {pending ? "Ignoring…" : "Ignore and remove matching rows"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
