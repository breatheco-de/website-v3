import { useState } from "react";
import { Link } from "wouter";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type EvidenceClaimPayload = {
  name: string;
  status: "sourced" | "unsourced" | "unverified" | "no_evidence" | "already_live" | "dismissed";
  row?: { site: string; domain: string; database: string; index: number; label: string; link: string | null };
  row_status?: "sourced" | "unsourced" | "unverified";
  dismissal?: { name: string; reason: string; by: string | null; at: number };
};

export type EvidenceCheckPayload = {
  outcome: "ok" | "unavailable";
  claims: EvidenceClaimPayload[];
  blocking: string[];
  databases: Array<{ site: string; domain: string; database: string; label: string; proves: string[] }>;
};

const STATUS_LABEL: Record<EvidenceClaimPayload["status"], string> = {
  sourced: "Sourced",
  unsourced: "No link",
  unverified: "Unverified",
  no_evidence: "No evidence",
  already_live: "Already live",
  dismissed: "Dismissed",
};

const STATUS_HELP: Record<EvidenceClaimPayload["status"], string> = {
  sourced: "A row with a source link backs this name.",
  unsourced: "A row mentions this name but has no source link. You can still approve.",
  unverified: "An agent last changed this row's link or claim. Verify the row on the database page first.",
  no_evidence: "Nothing on file proves this. Add a row with a source link, or dismiss it if it isn't a claim about us.",
  already_live: "This claim is already on the live page; this proposal doesn't add it.",
  dismissed: "Staff marked this as not a claim about us.",
};

function statusVariant(status: EvidenceClaimPayload["status"]): "outline" | "destructive" | "secondary" {
  if (status === "no_evidence") return "destructive";
  if (status === "sourced" || status === "dismissed") return "secondary";
  return "outline";
}

/** Staff review: named partners / press / awards in the proposal and the evidence rows that back them. */
export function ProposalEvidenceBlock({
  evidence,
  saving,
  onDismiss,
}: {
  evidence: EvidenceCheckPayload | null | undefined;
  saving?: boolean;
  onDismiss?: (name: string, reason: string) => void;
}) {
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  if (!evidence || evidence.claims.length === 0) {
    if (evidence?.outcome === "unavailable") {
      return (
        <div className="rounded-md border border-card-border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground" data-testid="block-proposal-evidence">
          The automatic check for partners, press and awards is unavailable right now. Check any named
          partner or award by hand.
        </div>
      );
    }
    return null;
  }

  const close = () => {
    setDismissing(null);
    setReason("");
  };

  return (
    <div
      className="rounded-md border border-card-border bg-muted/30 px-3 py-2.5 space-y-2"
      data-testid="block-proposal-evidence"
    >
      <div className="space-y-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Evidence</span>
        <p className="text-sm leading-5 text-foreground/90">
          These names are presented as a partner, press outlet or award. Each one needs a sourced row
          before this can go live. If a name isn&apos;t a claim about us, dismiss it and say why.
        </p>
        {evidence.outcome === "unavailable" ? (
          <p className="text-xs text-muted-foreground">
            The automatic check is unavailable, so only names already on file are listed and nothing is
            blocked. Check other names by hand.
          </p>
        ) : null}
      </div>
      <ul className="space-y-1.5">
        {evidence.claims.map((c) => (
          <li
            key={c.name}
            className="flex flex-wrap items-center gap-2 text-sm"
            data-testid={`row-evidence-claim-${c.name}`}
          >
            <span className="font-medium text-foreground">{c.name}</span>
            <Badge variant={statusVariant(c.status)} className="font-normal" title={STATUS_HELP[c.status]}>
              {STATUS_LABEL[c.status]}
            </Badge>
            {c.row ? (
              <Link
                href={`/private/databases/${c.row.database}`}
                className="text-xs text-primary hover:underline"
                data-testid={`link-evidence-row-${c.name}`}
              >
                {c.row.label.length > 60 ? `${c.row.label.slice(0, 60)}…` : c.row.label}
              </Link>
            ) : null}
            {c.row?.link ? (
              <a
                href={c.row.link}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-muted-foreground hover:underline"
              >
                Source
              </a>
            ) : null}
            {c.status === "dismissed" && c.dismissal ? (
              <span className="text-xs text-muted-foreground">
                “{c.dismissal.reason}”{c.dismissal.by ? ` — ${c.dismissal.by}` : ""}
              </span>
            ) : null}
            {c.status === "no_evidence" && onDismiss ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                disabled={saving}
                onClick={() => setDismissing(c.name)}
                data-testid={`button-dismiss-evidence-${c.name}`}
              >
                Not a claim about us
              </Button>
            ) : null}
            <span className={cn("basis-full text-xs text-muted-foreground")}>{STATUS_HELP[c.status]}</span>
          </li>
        ))}
      </ul>

      <Dialog open={dismissing !== null} onOpenChange={(o) => (!o ? close() : null)}>
        <DialogContent className="max-w-md" data-testid="dialog-dismiss-evidence">
          <DialogHeader>
            <DialogTitle>Not a claim about us: {dismissing}</DialogTitle>
            <DialogDescription className="text-left">
              Use this when the text mentions {dismissing} without saying they chose, partnered with,
              covered or awarded us. The proposal stops asking for proof of this name. Nothing changes on
              the live site.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why this isn't a claim about us (e.g. it's an example employer in the article)"
            rows={3}
            data-testid="input-dismiss-evidence-reason"
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={saving || reason.trim().length < 10}
              onClick={() => {
                if (dismissing && onDismiss) onDismiss(dismissing, reason.trim());
                close();
              }}
              data-testid="button-confirm-dismiss-evidence"
            >
              Dismiss
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
