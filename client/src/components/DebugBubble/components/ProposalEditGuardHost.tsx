import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { getDebugUserName } from "@/hooks/useDebugAuth";
import { emitContentUpdated } from "@/lib/contentEvents";
import { setProposalEditGuard, type GuardedDraft } from "@/lib/proposal-edit-guard";
import type { VariantProposalLink } from "../types";

/** Drafts on this page that belong to an open, local proposal the viewer did not file. */
export function guardedDraftsForPage(
  contentType: string | null,
  slug: string | null,
  proposalsByVariant: Record<string, Record<string, VariantProposalLink>> | undefined,
  viewer: string,
): GuardedDraft[] {
  if (!contentType || !slug || !proposalsByVariant) return [];
  const me = viewer.trim().toLowerCase();
  const out: GuardedDraft[] = [];
  for (const [locale, byVariant] of Object.entries(proposalsByVariant)) {
    for (const [variant, link] of Object.entries(byVariant ?? {})) {
      const open = !link.status || link.status === "open" || link.status === "partial";
      if (!link.local || !open) continue;
      if (me && link.proposer_username?.trim().toLowerCase() === me) continue;
      out.push({ contentType, slug, locale, variant, proposalId: link.id, proposalTitle: link.title });
    }
  }
  return out;
}

/** Owns the first-edit co-author warning for the current page (see lib/proposal-edit-guard). */
export function ProposalEditGuardHost({
  contentType,
  slug,
  proposalsByVariant,
}: {
  contentType: string | null;
  slug: string | null;
  proposalsByVariant: Record<string, Record<string, VariantProposalLink>> | undefined;
}) {
  const queryClient = useQueryClient();
  const [request, setRequest] = useState<GuardedDraft | null>(null);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);
  const viewer = getDebugUserName();
  const drafts = useMemo(
    () => guardedDraftsForPage(contentType, slug, proposalsByVariant, viewer),
    [contentType, slug, proposalsByVariant, viewer],
  );

  useEffect(() => {
    setProposalEditGuard({
      drafts,
      confirm: (draft) =>
        new Promise<boolean>((resolve) => {
          resolveRef.current = resolve;
          setRequest(draft);
        }),
      onCancelled: (draft) => {
        void queryClient.invalidateQueries({ queryKey: ["/api/preview"] });
        emitContentUpdated({ contentType: draft.contentType, slug: draft.slug, locale: draft.locale });
      },
    });
    return () => {
      setProposalEditGuard({ drafts: [], confirm: null });
      resolveRef.current?.(false);
      resolveRef.current = null;
    };
  }, [drafts, queryClient]);

  const answer = (ok: boolean) => {
    resolveRef.current?.(ok);
    resolveRef.current = null;
    setRequest(null);
  };

  return (
    <AlertDialog
      open={Boolean(request)}
      onOpenChange={(open) => {
        if (!open && resolveRef.current) answer(false);
      }}
    >
      <AlertDialogContent data-testid="dialog-proposal-edit-guard">
        <AlertDialogHeader>
          <AlertDialogTitle>Edit this proposed draft?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              {request?.proposalTitle ? (
                <p className="text-foreground">“{request.proposalTitle}”</p>
              ) : null}
              <p>
                You&apos;ll become a co-author, so you won&apos;t be able to approve this proposal yourself. Anyone
                currently reviewing it loses their claim, and it goes back to waiting for review.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => answer(false)} data-testid="button-proposal-edit-guard-cancel">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => answer(true)} data-testid="button-proposal-edit-guard-confirm">
            Edit anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
