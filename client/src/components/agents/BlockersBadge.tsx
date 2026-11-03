import { useState, type MouseEvent } from "react";
import { IconAlertTriangle } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type BlockersBadgeProps = {
  count: number;
  /** When true, stop click from bubbling (e.g. badge inside a list card Link). */
  stopLinkNavigation?: boolean;
  className?: string;
  /** Suffix for test ids — detail uses none; list uses `-${id}`. */
  testIdSuffix?: string;
  /** List cards say “blocker(s)”; detail header says “needs changes”. */
  labelMode?: "blockers" | "needs_changes";
  /** ISO time the daily sweep warned this proposal will close for inactivity. */
  flaggedAt?: string | null;
};

const BLOCKED_CLOSE_AFTER_FLAG_DAYS = 20;

function closeDateLabel(flaggedAt: string): string | null {
  const t = Date.parse(flaggedAt);
  if (Number.isNaN(t)) return null;
  return new Date(t + BLOCKED_CLOSE_AFTER_FLAG_DAYS * 86_400_000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function BlockersBadge({
  count,
  stopLinkNavigation = false,
  className,
  testIdSuffix = "",
  labelMode = "blockers",
  flaggedAt = null,
}: BlockersBadgeProps) {
  const [advanced, setAdvanced] = useState(false);

  if (count <= 0) return null;

  const onTriggerClick = stopLinkNavigation
    ? (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
      }
    : undefined;

  const baseLabel =
    labelMode === "needs_changes"
      ? `${count} needs changes`
      : `${count} blocker${count === 1 ? "" : "s"}`;
  const closesOn = flaggedAt ? closeDateLabel(flaggedAt) : null;
  const label = closesOn ? `${baseLabel} · closes ${closesOn}` : baseLabel;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0"
          data-testid={`badge-proposal-blockers${testIdSuffix}`}
          aria-label={`${label} — what this means`}
          onClick={onTriggerClick}
        >
          <Badge
            variant="destructive"
            className={cn("cursor-pointer gap-1 font-normal", className)}
          >
            <IconAlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
            {label}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 space-y-3 text-sm"
        align="start"
        data-testid={`popover-proposal-blockers${testIdSuffix}`}
        onClick={onTriggerClick}
      >
        <p className="font-medium text-foreground">Needs changes before approve</p>
        <p className="text-muted-foreground leading-5">
          {count === 1
            ? "Someone left one open change request on this proposal."
            : `Someone left ${count} open change requests on this proposal.`}{" "}
          Approve (and Accept for ideas) stay blocked until each request is marked resolved, unless a
          proposal reviewer approves anyway with a written reason. Reject and withdraw still work.
        </p>
        <p className="text-muted-foreground leading-5" data-testid={`text-blockers-inactivity${testIdSuffix}`}>
          {closesOn
            ? `Nobody has worked on these change requests for 10 days. If nothing changes, this proposal closes automatically around ${closesOn}.`
            : "If nobody updates this proposal for 30 days while change requests are open, it closes automatically."}
        </p>
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          data-testid={`button-blockers-advanced${testIdSuffix}`}
          onClick={() => setAdvanced((v) => !v)}
        >
          {advanced ? "Hide advanced" : "Read more (advanced)"}
        </button>
        {advanced ? (
          <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground leading-5">
            <p>
              Open blockers block apply / accept only — reject, withdraw, and close still succeed.
            </p>
            <p>
              Staff with Review proposals (proposals_review) can approve anyway from this page with a
              reason (min 20 characters). Once something goes live, every open blocker is resolved with
              &quot;Overridden on approve by …&quot; and that reason. Agents cannot override.
            </p>
            <p>
              Clearing a blocker does not ship the proposal; re-preview, then Approve with four-eyes.
            </p>
            <p>
              Only the active claimant resolves a blocker; reviewers can reopen one after it was
              cleared.
            </p>
            <p>
              Inactivity: the daily sweep sets blocked_flagged_at after 10 idle days and withdraws with
              close_reason abandoned_blocked after 30. Rewriting the draft, adding / resolving /
              reopening a request, or a reviewer action resets the clock; claiming or releasing does not.
              Pages already published stay live; drafts the proposal created are deleted. Escalated
              proposals are skipped.
            </p>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
