import { formatDistanceToNow } from "date-fns";
import { Bot, ClipboardList, History, Layers, OctagonAlert, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { proposalDraftPreviewHref } from "@/lib/proposal-drawer";
import type { PendingProposalForPage } from "../types";

const PROPOSALS_BASE = "/private/agents/proposals";

/** Where "Review proposal" goes: the draft preview with the drawer, or the full proposal page. */
export function proposalReviewTarget(
  proposal: PendingProposalForPage,
  page: { type: string | null; slug: string | null; locale?: string | null },
): { kind: "preview" | "full"; href: string } {
  const full = { kind: "full" as const, href: `${PROPOSALS_BASE}/${encodeURIComponent(proposal.id)}` };
  if (proposal.shared_layout || !page.type || !page.slug) return full;
  const drafts = proposal.entries.filter((e) => e.variant);
  const entry = drafts.find((e) => e.locale === page.locale) ?? drafts[0];
  if (!entry?.variant) return full;
  return {
    kind: "preview",
    href: proposalDraftPreviewHref(
      { contentType: page.type, slug: page.slug, locale: entry.locale, variant: entry.variant },
      proposal.id,
    ),
  };
}

function draftsLabel(p: PendingProposalForPage): string {
  if (p.shared_layout) {
    return p.affected_count != null
      ? `Shared layout, affects ${p.affected_count} page${p.affected_count === 1 ? "" : "s"}`
      : "Shared layout";
  }
  const drafts = p.entries.filter((e) => e.variant);
  if (!drafts.length) return "No draft to preview";
  return drafts.map((e) => `${e.variant} (${e.locale})`).join(", ");
}

export function PendingProposalsDialog({
  open,
  onOpenChange,
  proposals,
  page,
  navigate,
  onSeePastSaves,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposals: PendingProposalForPage[];
  page: { type: string | null; slug: string | null; locale?: string | null };
  navigate: (path: string) => void;
  onSeePastSaves: () => void;
}) {
  const count = proposals.length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-pending-proposals">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-status-away" aria-hidden />
            {count === 1 ? "A proposal is waiting for review" : `${count} proposals are waiting for review`}
          </DialogTitle>
          <DialogDescription>
            This page has changes waiting for your review. Review the proposal to see what changed and why, or look
            at past saves.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 max-h-[50vh] overflow-y-auto" data-testid="list-pending-proposals">
          {proposals.map((p) => {
            const target = proposalReviewTarget(p, page);
            return (
              <li
                key={p.id}
                className="rounded-md border bg-card p-3 space-y-2"
                data-testid={`card-pending-proposal-${p.id}`}
              >
                <div className="space-y-1 min-w-0">
                  <p className="text-sm font-medium text-foreground leading-5 break-words">{p.title}</p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      {p.proposer_kind === "agent" ? (
                        <Bot className="h-3 w-3" aria-hidden />
                      ) : (
                        <User className="h-3 w-3" aria-hidden />
                      )}
                      {p.proposer_username}
                    </span>
                    <span title={new Date(p.updated_at).toLocaleString()}>
                      updated {formatDistanceToNow(p.updated_at, { addSuffix: true })}
                    </span>
                    {p.open_blocker_count > 0 ? (
                      <span className="inline-flex items-center gap-1 text-destructive">
                        <OctagonAlert className="h-3 w-3" aria-hidden />
                        {p.open_blocker_count} open blocker{p.open_blocker_count === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Badge
                    variant="outline"
                    className="min-w-0 gap-1 truncate text-[10px] font-normal"
                    title={draftsLabel(p)}
                  >
                    {p.shared_layout ? <Layers className="h-3 w-3 shrink-0" aria-hidden /> : null}
                    <span className="truncate">{draftsLabel(p)}</span>
                  </Badge>
                  <Button
                    size="sm"
                    className="shrink-0"
                    onClick={() => {
                      onOpenChange(false);
                      navigate(target.href);
                    }}
                    data-testid={`button-review-proposal-${p.id}`}
                  >
                    Review proposal
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              onOpenChange(false);
              onSeePastSaves();
            }}
            data-testid="button-pending-proposals-past-saves"
          >
            <History className="h-3.5 w-3.5" aria-hidden />
            See past saves
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
