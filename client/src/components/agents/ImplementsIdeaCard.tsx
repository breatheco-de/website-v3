import { Link } from "wouter";
import { IconArrowRight } from "@tabler/icons-react";
import { ProposalStatusLabel } from "@/components/agents/ProposalExplainBadges";
import { McpCopyButton } from "@/components/mcp/McpSetupUi";
import { proposalStatusUi } from "@/lib/proposalStatusUi";
import { cn } from "@/lib/utils";

export type ImplementsIdeaSummary = {
  title: string;
  summary: string;
  status: string;
  kind: string;
};

export function ImplementsIdeaCard({
  ideaId,
  ideaHref,
  idea,
  deleted,
  className,
}: {
  ideaId: string;
  ideaHref: string;
  idea: ImplementsIdeaSummary | undefined;
  deleted: boolean;
  className?: string;
}) {
  const shortId = `${ideaId.slice(0, 8)}…`;
  const ui = idea && !deleted ? proposalStatusUi(idea.status) : null;
  const StatusIcon = ui?.icon;

  return (
    <div
      className={cn("min-w-0 space-y-1.5 rounded-md border border-border bg-muted/30 p-3", className)}
      data-testid="proposal-implements-idea"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Implements idea</p>
        {idea && ui && StatusIcon ? (
          <span className={cn("inline-flex shrink-0 items-center gap-1 text-xs", ui.className)}>
            <StatusIcon className="h-3.5 w-3.5" aria-hidden />
            <ProposalStatusLabel
              status={idea.status}
              kind={idea.kind}
              label={ui.label}
              testIdSuffix="-implements-idea"
            />
          </span>
        ) : null}
      </div>
      {deleted ? (
        <p
          className="text-sm text-muted-foreground"
          title={ideaId}
          data-testid="badge-implements-proposal-deleted"
        >
          This idea was deleted.
        </p>
      ) : (
        <>
          <Link
            href={ideaHref}
            className="block truncate text-sm font-medium text-foreground underline-offset-2 hover:underline"
            title={idea?.title ?? ideaId}
            data-testid="link-implements-proposal-title"
          >
            {idea?.title || shortId}
          </Link>
          {idea?.summary ? (
            <p className="line-clamp-2 text-xs text-muted-foreground" data-testid="text-implements-idea-summary">
              {idea.summary}
            </p>
          ) : null}
        </>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-0.5">
          <span className="font-mono" title={ideaId} data-testid="badge-implements-proposal">
            {shortId}
          </span>
          <McpCopyButton text={ideaId} testId="button-copy-implements-proposal" />
        </span>
        {deleted ? null : (
          <Link
            href={ideaHref}
            className="inline-flex items-center gap-1 rounded-sm text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="link-implements-proposal"
          >
            Open idea
            <IconArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        )}
      </div>
    </div>
  );
}
