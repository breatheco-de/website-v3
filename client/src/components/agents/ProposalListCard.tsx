import type { ReactNode } from "react";
import { Link } from "wouter";
import {
  IconAlertTriangle,
  IconChevronRight,
  IconLink,
  IconNote,
  IconPencil,
  IconRocket,
} from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { proposalStatusUi } from "@/lib/proposalStatusUi";
import {
  formatProposalRelativeUpdatedAt,
  proposalAttributionLines,
  proposalEntryProgress,
} from "@/lib/proposalCardMeta";

export type ProposalCardData = {
  id: string;
  title: string;
  summary: string;
  kind: string;
  status: string;
  review_mode?: string;
  promote_on_apply?: boolean;
  open_blocker_count?: number;
  proposer_username: string;
  proposer_actor?: Record<string, unknown>;
  related_issue_ids: string[];
  entries: Array<{ status: string; variant: string | null }>;
  claim?: { by: string; expiresAt: string; actor?: Record<string, unknown> } | null;
  created_at: number;
  updated_at?: number;
};

function MetaRow({ items }: { items: Array<{ key: string; node: ReactNode }> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-4 text-muted-foreground">
      {items.map((item, i) => (
        <span key={item.key} className="inline-flex items-center gap-2">
          {i > 0 ? (
            <span aria-hidden className="text-muted-foreground/40">
              ·
            </span>
          ) : null}
          {item.node}
        </span>
      ))}
    </div>
  );
}

export function ProposalListCard({
  proposal: p,
  href,
}: {
  proposal: ProposalCardData;
  href: string;
}) {
  const ui = proposalStatusUi(p.status);
  const StatusIcon = ui.icon;
  const KindIcon = p.kind === "notes" ? IconNote : IconPencil;
  const attribution = proposalAttributionLines({
    proposerUsername: p.proposer_username,
    proposerActor: p.proposer_actor,
    claim: p.claim,
  });
  const progress = p.kind === "edits" ? proposalEntryProgress(p.entries ?? []) : null;
  const blockers = p.open_blocker_count ?? 0;
  const issueCount = p.related_issue_ids?.length ?? 0;
  const goLive = p.review_mode === "draft_backed" || Boolean(p.promote_on_apply);

  const meta: Array<{ key: string; node: ReactNode }> = [
    {
      key: "status",
      node: <span className={cn("font-medium", ui.className)}>{ui.label}</span>,
    },
    {
      key: "kind",
      node: (
        <span className="inline-flex items-center gap-1 capitalize">
          <KindIcon className="h-3 w-3 shrink-0" aria-hidden />
          {p.kind}
        </span>
      ),
    },
  ];
  if (progress) {
    meta.push({
      key: "progress",
      node: (
        <span className={progress.failed > 0 ? "font-medium text-destructive" : undefined}>
          {progress.label}
        </span>
      ),
    });
  }
  if (issueCount > 0) {
    meta.push({
      key: "issues",
      node: (
        <span className="inline-flex items-center gap-1">
          <IconLink className="h-3 w-3 shrink-0" aria-hidden />
          {issueCount} linked issue{issueCount === 1 ? "" : "s"}
        </span>
      ),
    });
  }
  for (const line of attribution.lines) {
    meta.push({ key: `attr-${line}`, node: <span className="truncate">{line}</span> });
  }
  if (attribution.expiredLine) {
    meta.push({
      key: "expired",
      node: <span className="text-muted-foreground/70">{attribution.expiredLine}</span>,
    });
  }
  meta.push({
    key: "updated",
    node: <span>{formatProposalRelativeUpdatedAt(p.updated_at ?? p.created_at)}</span>,
  });

  return (
    <Link
      href={href}
      className="group block rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      data-testid={`link-proposal-${p.id}`}
    >
      <Card
        className={cn(
          "flex items-start gap-3 border-l-2 px-4 py-3 cursor-pointer hover-elevate",
          "transition-shadow duration-brand ease-brand group-hover:shadow-md",
          ui.accentClassName,
        )}
        data-testid={`card-proposal-${p.id}`}
      >
        <span
          className={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
            ui.chipClassName,
          )}
          aria-hidden
        >
          <StatusIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold leading-6 text-foreground">
              {p.title}
            </h3>
            <div className="flex shrink-0 items-center gap-1.5">
              {goLive ? (
                <Badge variant="secondary" className="gap-1 font-normal">
                  <IconRocket className="h-3 w-3 shrink-0" aria-hidden />
                  Go-live draft
                </Badge>
              ) : null}
              {blockers > 0 ? (
                <Badge
                  variant="destructive"
                  className="gap-1 font-normal"
                  data-testid={`badge-proposal-blockers-${p.id}`}
                >
                  <IconAlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                  {blockers} blocker{blockers === 1 ? "" : "s"}
                </Badge>
              ) : null}
              <IconChevronRight
                className="h-4 w-4 text-muted-foreground/40 transition-colors group-hover:text-foreground"
                aria-hidden
              />
            </div>
          </div>
          {p.summary ? (
            <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{p.summary}</p>
          ) : null}
          <MetaRow items={meta} />
        </div>
      </Card>
    </Link>
  );
}

export function ProposalListCardSkeleton() {
  return (
    <Card className="flex items-start gap-3 border-l-2 border-l-muted px-4 py-3">
      <Skeleton className="mt-0.5 h-8 w-8 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </Card>
  );
}
