import { useState, type ComponentType, type MouseEvent, type ReactNode } from "react";
import { IconBulb, IconNote, IconPencil } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { proposalCategoryLabel } from "@/lib/proposalCardMeta";
import { cn } from "@/lib/utils";

function stopCardNav(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
}

export function proposalStatusExplain(
  status: string,
  kind: string,
): { title: string; body: string; advanced: string[] } {
  if (status === "open" && kind === "notes") {
    return {
      title: "Still being tracked",
      body: "This handoff is on the open list as a reminder. Leave it open if work still needs doing, Claim if you are working it, or Close with a reason when you stop tracking it. Open does not change the live site.",
      advanced: [
        "Status stays open until Close, Withdraw, or Reject finishes the proposal.",
        "No auto-retry (if on) only applies while the handoff stays open.",
      ],
    };
  }
  if (status === "open" && kind === "idea") {
    return {
      title: "Waiting for a greenlight",
      body: "This is a brief, not a publish. Accept greenlights the idea with a next step; park it if you are stopping tracking. Open by itself does not change the live site.",
      advanced: [
        "Needs-change notes block Accept until they are cleared.",
        "Accept is four-eyes for MCP roles; staff UI can always Accept.",
      ],
    };
  }
  if (status === "open") {
    return {
      title: "Waiting for review",
      body: "Suggested changes are not live yet. Someone else with edit access can Approve to apply them, or Reject. Open by itself does not change the live site.",
      advanced: [
        "Needs-change notes block Approve until the claimant marks them done.",
        "Apply/Reject are four-eyes: the proposer cannot approve their own edits.",
      ],
    };
  }
  if (status === "partial") {
    return {
      title: "Partly applied",
      body: "Some suggested entries from this proposal are already live; others still need Approve. The live site only changed for the entries that were applied.",
      advanced: [
        "Remaining open entries can still be applied or the proposal can be rejected/withdrawn.",
      ],
    };
  }
  if (status === "finished" && kind === "notes") {
    return {
      title: "Closed",
      body: "This handoff is finished and off the open list. Closing did not change the live site or complete linked issues by itself.",
      advanced: ["Close reason and note are stored on the proposal for later context."],
    };
  }
  if (status === "finished" && kind === "idea") {
    return {
      title: "Finished",
      body: "This idea is off the open list — either accepted with a next step, or parked with a reason. Nothing on the live site changed from this card alone.",
      advanced: [
        "Accept stores close_reason accepted plus the next-step note; park uses wont_fix, tracked_elsewhere, or other.",
      ],
    };
  }
  if (status === "finished") {
    return {
      title: "Finished",
      body: "This proposal’s remaining work is done. Applied entries are live for their locales; nothing else is waiting on this card.",
      advanced: ["Finished clears any active claim on the proposal."],
    };
  }
  if (status === "rejected") {
    return {
      title: "Rejected",
      body: "A reviewer rejected this proposal. It is no longer waiting for Approve. Reject does not undo entries that were already applied earlier. The reason and note stay on this card for the next agent.",
      advanced: [
        "Reject is for bad/impossible/illegal/harmful ideas — not polish (use Needs changes).",
        "A later proposal may link here as a replacement.",
      ],
    };
  }
  if (status === "withdrawn") {
    return {
      title: "Withdrawn",
      body: "The proposer pulled this back. It is no longer waiting for review or tracking as an open handoff.",
      advanced: ["Withdraw does not change the live site."],
    };
  }
  return {
    title: status || "Unknown status",
    body: "This status is not one of the usual proposal states.",
    advanced: [],
  };
}

function proposalKindExplain(kind: string): {
  title: string;
  body: string;
  label: string;
  testId: string;
  popoverTestId: string;
  advancedTestId: string;
  advanced: ReactNode;
} {
  if (kind === "notes") {
    return {
      label: "Handoff",
      title: "A reminder note, not a content change",
      body: "Someone (often a coding agent) hit a wall and left this open so the next person can pick it up. There is nothing to Approve — leave it open as a reminder, Claim if you are working it, or Close with a reason when you stop tracking it. Closing does not change the live site.",
      testId: "badge-proposal-kind-handoff",
      popoverTestId: "popover-handoff-kind",
      advancedTestId: "button-handoff-kind-advanced",
      advanced: (
        <>
          <p>
            Stored as proposal kind <code className="text-foreground">notes</code> — no field
            updates or draft promote on apply.
          </p>
          <p>
            Close is not four-eyes (unlike Approve/Reject on Edits). Prefer an Edits proposal when
            there is a concrete fix to review.
          </p>
        </>
      ),
    };
  }
  if (kind === "idea") {
    return {
      label: "Idea",
      title: "A brief to greenlight — not a publish",
      body: "This pitches work before any YAML change. Accept greenlights it with a next step. Needs-change notes block Accept until cleared. A different agent role — or this staff UI — can Accept. Agents pick a role under MCP Server → Connection.",
      testId: "badge-proposal-kind-idea",
      popoverTestId: "popover-idea-kind",
      advancedTestId: "button-idea-kind-advanced",
      advanced: (
        <>
          <p>
            Stored as proposal kind <code className="text-foreground">idea</code> — Accept finishes
            with <code className="text-foreground">close_reason: accepted</code> and a next-step
            note; it does not write content.
          </p>
          <p>
            Park (Close) uses wont_fix, tracked_elsewhere, or other — not fixed_elsewhere. Staff UI
            is always a different identity from MCP roles, so Accept stays available here.
          </p>
          <p>
            Role connectors: Private → MCP Server → Connection → choose one or more roles → Choose
            this Role / Choose these Roles.
          </p>
        </>
      ),
    };
  }
  return {
    label: "Edits",
    title: "Proposed content changes to review",
    body: "Someone suggested field updates on the linked pages. Nothing on the live site changes until a different person Approves. Reject leaves live unchanged. Use a Handoff when there is no concrete fix to apply — only a reminder for the next person.",
    testId: "badge-proposal-kind-edits",
    popoverTestId: "popover-edits-kind",
    advancedTestId: "button-edits-kind-advanced",
    advanced: (
      <>
        <p>
          Stored as proposal kind <code className="text-foreground">edits</code> — Approve applies
          field updates and/or promotes a prepared draft; Reject does not write YAML.
        </p>
        <p>
          Approve and Reject are four-eyes: the proposer cannot finish their own proposal. The
          review-mode badge next to this one explains draft vs soft vs go-live.
        </p>
      </>
    ),
  };
}

export function proposalCategoryExplain(category: string): {
  label: string;
  title: string;
  body: string;
  advanced: string[];
} {
  const label = proposalCategoryLabel(category);
  if (category === "content.seo") {
    return {
      label,
      title: "Changes how the page shows up in search",
      body: "This proposal edits search details like the page title and description shown in Google and link previews, not the visible page content. The category is a label; it does not change what Approve does.",
      advanced: [
        "Stored as category content.seo.",
        "Set automatically when any suggested update touches a meta.* or seo.* field, unless the proposer chose a category.",
        "Reviewed as a metadata change (risk class existing_metadata). Mixing risk classes in one proposal is rejected on create.",
      ],
    };
  }
  if (category === "content.field") {
    return {
      label,
      title: "Changes the page content",
      body: "This proposal edits what visitors see on the page, such as headings, copy or section settings. It does not touch the search title or description. The category is a label; it does not change what Approve does.",
      advanced: [
        "Stored as category content.field.",
        "Default when no suggested update touches a meta.* or seo.* field, unless the proposer chose a category.",
        "Reviewed as a content change (risk class existing_content). Mixing risk classes in one proposal is rejected on create.",
      ],
    };
  }
  return {
    label,
    title: label || "Unknown category",
    body: "This category is not one of the usual proposal categories. It is a label only; it does not change what Approve does.",
    advanced: [],
  };
}

export function ProposalCategoryBadge({
  category,
  stopLinkNavigation = false,
  testIdSuffix = "",
  badgeTestId,
}: {
  category: string;
  stopLinkNavigation?: boolean;
  testIdSuffix?: string;
  badgeTestId?: string;
}) {
  const [advanced, setAdvanced] = useState(false);
  const explain = proposalCategoryExplain(category);
  const onTriggerClick = stopLinkNavigation ? stopCardNav : undefined;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0"
          data-testid={`badge-proposal-category${testIdSuffix}`}
          aria-label={`Category: ${explain.label} — what this means`}
          onClick={onTriggerClick}
        >
          <Badge
            variant="outline"
            className="cursor-pointer gap-1 font-normal hover-elevate"
            data-testid={badgeTestId}
          >
            <span className="text-muted-foreground">Category:</span>
            {explain.label}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 space-y-3 text-sm"
        align="start"
        data-testid={`popover-proposal-category${testIdSuffix}`}
        onClick={onTriggerClick}
      >
        <p className="font-medium text-foreground">{explain.title}</p>
        <p className="text-muted-foreground leading-5">{explain.body}</p>
        {explain.advanced.length > 0 ? (
          <>
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              data-testid={`button-proposal-category-advanced${testIdSuffix}`}
              onClick={() => setAdvanced((v) => !v)}
            >
              {advanced ? "Hide advanced" : "Read more (advanced)"}
            </button>
            {advanced ? (
              <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground leading-5">
                {explain.advanced.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export function proposalProgressExplain(progress: {
  done: number;
  total: number;
  failed: number;
}): { title: string; body: string; advanced: string[] } {
  const pending = Math.max(0, progress.total - progress.done - progress.failed);
  if (progress.total === 0) {
    return {
      title: "No page entries",
      body: "This proposal has no linked page entries yet, so there is nothing to apply.",
      advanced: [],
    };
  }
  if (progress.failed > 0) {
    return {
      title: "Some entries failed",
      body: `${progress.done} of ${progress.total} linked page entries are live. ${progress.failed} failed on apply — open the proposal to see the error and retry or revise. ${pending > 0 ? `${pending} still waiting for Approve.` : ""}`.trim(),
      advanced: [
        "Done means that entry was applied successfully for its locale.",
        "Failed entries stay on the proposal until fixed and re-applied, or the proposal is rejected/withdrawn.",
      ],
    };
  }
  if (progress.done === progress.total) {
    return {
      title: "All entries applied",
      body: `All ${progress.total} linked page ${progress.total === 1 ? "entry is" : "entries are"} live for their locales. Nothing from this count is still waiting for Approve.`,
      advanced: [
        "Progress counts per entry (content type + slug + locale), not per field update.",
      ],
    };
  }
  if (progress.done === 0) {
    return {
      title: "Nothing applied yet",
      body: `0 of ${progress.total} linked page ${progress.total === 1 ? "entry has" : "entries have"} been applied. Approve ships them to the live site (or go-live draft, depending on review mode). Reject leaves live unchanged.`,
      advanced: [
        "Partial apply can finish some entries and leave others pending — then the status becomes Partial.",
      ],
    };
  }
  return {
    title: "Partly through the list",
    body: `${progress.done} of ${progress.total} linked page entries are already live; ${pending} still need Approve. The live site only changed for the ones already applied.`,
    advanced: [
      "This count matches entry statuses on the proposal — open an entry row for the exact page and locale.",
    ],
  };
}

export function ProposalStatusLabel({
  status,
  kind,
  label,
  className,
  stopLinkNavigation = false,
  testIdSuffix = "",
}: {
  status: string;
  kind: string;
  label: string;
  className?: string;
  stopLinkNavigation?: boolean;
  testIdSuffix?: string;
}) {
  const [advanced, setAdvanced] = useState(false);
  const explain = proposalStatusExplain(status, kind);
  const onTriggerClick = stopLinkNavigation ? stopCardNav : undefined;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex shrink-0 font-medium hover-elevate rounded-sm px-0.5 -mx-0.5",
            className,
          )}
          data-testid={`badge-proposal-status${testIdSuffix}`}
          aria-label={`${label} — what this means`}
          onClick={onTriggerClick}
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 space-y-3 text-sm"
        align="start"
        data-testid={`popover-proposal-status${testIdSuffix}`}
        onClick={onTriggerClick}
      >
        <p className="font-medium text-foreground">{explain.title}</p>
        <p className="text-muted-foreground leading-5">{explain.body}</p>
        {explain.advanced.length > 0 ? (
          <>
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              data-testid={`button-proposal-status-advanced${testIdSuffix}`}
              onClick={() => setAdvanced((v) => !v)}
            >
              {advanced ? "Hide advanced" : "Read more (advanced)"}
            </button>
            {advanced ? (
              <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground leading-5">
                {explain.advanced.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export function ProposalKindBadge({
  kind,
  stopLinkNavigation = false,
  testIdSuffix = "",
  /** List meta row uses icon + text; detail header uses outline Badge. */
  appearance = "badge",
}: {
  kind: string;
  stopLinkNavigation?: boolean;
  testIdSuffix?: string;
  appearance?: "badge" | "meta";
}) {
  const [advanced, setAdvanced] = useState(false);
  const explain = proposalKindExplain(kind);
  const onTriggerClick = stopLinkNavigation ? stopCardNav : undefined;
  const KindIcon: ComponentType<{ className?: string }> =
    kind === "notes" ? IconNote : kind === "idea" ? IconBulb : IconPencil;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex shrink-0",
            appearance === "meta" &&
              "items-center gap-1 capitalize hover-elevate rounded-sm px-0.5 -mx-0.5",
          )}
          data-testid={`${explain.testId}${testIdSuffix}`}
          aria-label={`${explain.label} — what this means`}
          onClick={onTriggerClick}
        >
          {appearance === "badge" ? (
            <Badge variant="outline" className="cursor-pointer font-normal hover-elevate">
              {explain.label}
            </Badge>
          ) : (
            <>
              <KindIcon className="h-3 w-3 shrink-0" aria-hidden />
              {explain.label}
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 space-y-3 text-sm"
        align="start"
        data-testid={`${explain.popoverTestId}${testIdSuffix}`}
        onClick={onTriggerClick}
      >
        <p className="font-medium text-foreground">{explain.title}</p>
        <p className="text-muted-foreground leading-5">{explain.body}</p>
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          data-testid={`${explain.advancedTestId}${testIdSuffix}`}
          onClick={() => setAdvanced((v) => !v)}
        >
          {advanced ? "Hide advanced" : "Read more (advanced)"}
        </button>
        {advanced ? (
          <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground leading-5">
            {explain.advanced}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export function ProposalProgressLabel({
  progress,
  stopLinkNavigation = false,
  testIdSuffix = "",
  className,
}: {
  progress: { done: number; total: number; failed: number; label: string };
  stopLinkNavigation?: boolean;
  testIdSuffix?: string;
  className?: string;
}) {
  const [advanced, setAdvanced] = useState(false);
  const explain = proposalProgressExplain(progress);
  const onTriggerClick = stopLinkNavigation ? stopCardNav : undefined;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex shrink-0 hover-elevate rounded-sm px-0.5 -mx-0.5",
            progress.failed > 0 ? "font-medium text-destructive" : undefined,
            className,
          )}
          data-testid={`badge-proposal-progress${testIdSuffix}`}
          aria-label={`${progress.label} — what this means`}
          onClick={onTriggerClick}
        >
          {progress.label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 space-y-3 text-sm"
        align="start"
        data-testid={`popover-proposal-progress${testIdSuffix}`}
        onClick={onTriggerClick}
      >
        <p className="font-medium text-foreground">{explain.title}</p>
        <p className="text-muted-foreground leading-5">{explain.body}</p>
        {explain.advanced.length > 0 ? (
          <>
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              data-testid={`button-proposal-progress-advanced${testIdSuffix}`}
              onClick={() => setAdvanced((v) => !v)}
            >
              {advanced ? "Hide advanced" : "Read more (advanced)"}
            </button>
            {advanced ? (
              <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground leading-5">
                {explain.advanced.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
