import type { ReactNode } from "react";
import { formatMcpActorSubject } from "@shared/agent-identity";
import { ProposalProgressLabel } from "@/components/agents/ProposalExplainBadges";
import {
  asIssueActor,
  formatProposalRelativeUpdatedAt,
  PROPOSAL_LAST_FEEDBACK_TITLE,
  type proposalEntryProgress,
} from "@/lib/proposalCardMeta";
import { cn } from "@/lib/utils";

type MetaField = {
  key: string;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  title?: string;
  muted?: boolean;
};

function actorVia(raw: unknown): string | null {
  const actor = asIssueActor(raw);
  if (!actor) return null;
  if (actor.type === "mcp") return formatMcpActorSubject(actor);
  if (actor.type === "system") return actor.source?.trim() || "system";
  return null;
}

function exactTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function ProposalDetailMetaCard({
  proposal: p,
  isTerminal,
  progress,
  className,
}: {
  proposal: {
    proposer_username: string;
    proposer_actor?: Record<string, unknown>;
    claim?: { by: string; expiresAt: string; actor?: Record<string, unknown> } | null;
    reviewer_action_by?: string | null;
    reviewer_action_by_actor?: Record<string, unknown>;
    reviewer_action_at?: number | null;
    created_at: number;
    updated_at?: number;
  };
  isTerminal: boolean;
  progress: ReturnType<typeof proposalEntryProgress> | null;
  className?: string;
}) {
  const now = Date.now();
  const fields: MetaField[] = [];

  const proposerVia = actorVia(p.proposer_actor);
  fields.push({
    key: "proposer",
    label: "Proposed by",
    value: p.proposer_username,
    sub: proposerVia ? `via ${proposerVia}` : undefined,
  });

  fields.push({
    key: "created",
    label: "Created",
    value: formatProposalRelativeUpdatedAt(p.created_at, now),
    sub: exactTime(p.created_at),
  });

  const updatedAt = p.updated_at ?? p.created_at;
  fields.push({
    key: "updated",
    label: "Updated",
    value: formatProposalRelativeUpdatedAt(updatedAt, now),
    sub: exactTime(updatedAt),
  });

  if (p.claim?.by) {
    const expiresAt = new Date(p.claim.expiresAt).getTime();
    const active = Number.isFinite(expiresAt) && expiresAt > now;
    const claimVia = actorVia(p.claim.actor);
    fields.push({
      key: "claim",
      label: active ? "Claimed by" : "Claim expired",
      value: p.claim.by,
      sub: (
        <>
          {claimVia ? <span className="block">via {claimVia}</span> : null}
          {active ? <span className="block">Holds until {exactTime(expiresAt)}</span> : null}
        </>
      ),
      muted: !active,
    });
  }

  const reviewer = !isTerminal ? p.reviewer_action_by?.trim() : "";
  if (reviewer) {
    const reviewerVia = actorVia(p.reviewer_action_by_actor);
    const at = p.reviewer_action_at;
    fields.push({
      key: "feedback",
      label: "Last feedback",
      value: reviewer,
      title: PROPOSAL_LAST_FEEDBACK_TITLE,
      sub: (
        <>
          {reviewerVia ? <span className="block">via {reviewerVia}</span> : null}
          {at != null && Number.isFinite(at) ? (
            <span className="block">{formatProposalRelativeUpdatedAt(at, now)}</span>
          ) : null}
        </>
      ),
    });
  }

  if (progress) {
    fields.push({
      key: "progress",
      label: "Progress",
      value: <ProposalProgressLabel progress={progress} className="text-sm" />,
    });
  }

  return (
    <dl
      className={cn(
        "grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-x-6 gap-y-3 rounded-md border border-card-border bg-muted/30 px-4 py-3",
        className,
      )}
      data-testid="card-proposal-detail-meta"
    >
      {fields.map((f) => (
        <div
          key={f.key}
          className={cn("min-w-0 space-y-0.5", f.muted && "opacity-70")}
          title={f.title}
          data-testid={`meta-proposal-${f.key}`}
        >
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {f.label}
          </dt>
          <dd className="break-words text-sm text-foreground">{f.value}</dd>
          {f.sub ? <dd className="break-words text-xs text-muted-foreground">{f.sub}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
