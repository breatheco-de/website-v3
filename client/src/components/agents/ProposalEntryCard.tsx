import { useQuery } from "@tanstack/react-query";
import { IconArrowDown, IconLink } from "@tabler/icons-react";
import { deslugifyLabel } from "@shared/relation-field";
import { Badge } from "@/components/ui/badge";
import { LocaleFlag } from "@/components/DebugBubble/components/LocaleFlag";
import {
  RelatedEntryPopover,
  fetchRelatedEntry,
  relatedEntryQueryKey,
} from "@/components/agents/RelatedEntryPopover";
import { EntryActivityBadge } from "@/components/pipeline/EntryActivityBadge";
import { cn } from "@/lib/utils";

type EntryActivity = { writeCount: number; windowDays: number } | undefined;

export type ProposalEntryCardEntry = {
  id: number;
  contentType: string;
  slug: string;
  locale: string;
  variant: string | null;
  status: string;
  draft_missing?: boolean;
};

export function proposalEntryBlockId(entryId: number): string {
  return `proposal-entry-block-${entryId}`;
}

function draftLabel(variant: string): string {
  return variant === "draft" ? "Draft" : `Draft · ${variant}`;
}

export function ProposalEntryCard({
  entry,
  liveKey,
  draftKey,
  liveActivity,
  draftActivity,
  previewHref,
  windowDays,
  className,
}: {
  entry: ProposalEntryCardEntry;
  liveKey: string;
  draftKey: string | null;
  liveActivity: EntryActivity;
  draftActivity: EntryActivity;
  previewHref: string | null;
  windowDays: number;
  className?: string;
}) {
  const { data } = useQuery({
    queryKey: relatedEntryQueryKey(entry.contentType, entry.slug, entry.locale),
    enabled: !!entry.contentType && !!entry.slug,
    staleTime: 60_000,
    retry: false,
    queryFn: () => fetchRelatedEntry(entry.contentType, entry.slug, entry.locale),
  });
  const title = data?.title || data?.page_title || deslugifyLabel(entry.slug);
  const draftMissing = Boolean(entry.variant && entry.draft_missing && entry.status !== "done");
  const failed = entry.status === "failed";

  return (
    <div
      className={cn("min-w-0 space-y-2 rounded-md border border-border bg-muted/30 p-3", className)}
      data-testid={`card-proposal-entry-${entry.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Page being edited
          </p>
          <RelatedEntryPopover
            contentType={entry.contentType}
            slug={entry.slug}
            locale={entry.locale}
            variant={entry.variant}
            previewHref={draftMissing ? null : previewHref}
            testId={`popover-related-entry-${entry.id}`}
            triggerClassName="max-w-full"
          >
            <span
              className="block truncate text-sm font-medium text-foreground underline-offset-2 hover:underline"
              title={title}
              data-testid={`badge-related-entry-${entry.id}`}
            >
              {title}
            </span>
          </RelatedEntryPopover>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <IconLink className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate font-mono" title={`${entry.contentType}/${entry.slug}`}>
              {entry.contentType}/{entry.slug}
            </span>
            <LocaleFlag locale={entry.locale} className="h-2.5 w-3.5 shrink-0 rounded-sm" />
            <span className="shrink-0 uppercase">{entry.locale}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {failed ? (
            <Badge
              variant="destructive"
              className="font-normal"
              data-testid={`badge-proposal-entry-failed-${entry.id}`}
            >
              Failed
            </Badge>
          ) : null}
          {draftMissing ? (
            <Badge
              variant="destructive"
              className="font-normal"
              data-testid={`badge-proposal-entry-draft-missing-${entry.id}`}
            >
              Draft missing · needs revision
            </Badge>
          ) : (
            <Badge
              variant={entry.variant ? "secondary" : "outline"}
              className="font-normal"
              data-testid={`badge-proposal-entry-mode-${entry.id}`}
            >
              {entry.variant ? draftLabel(entry.variant) : "Live"}
            </Badge>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="text-muted-foreground">Recent edits</span>
        <span className="inline-flex items-center gap-1">
          <span className="text-muted-foreground">Live</span>
          <EntryActivityBadge
            entryKey={liveKey}
            writeCount={liveActivity?.writeCount ?? 0}
            windowDays={liveActivity?.windowDays ?? windowDays}
            testIdPrefix={`proposal-activity-live-${entry.id}`}
          />
        </span>
        {draftKey ? (
          <span className="inline-flex items-center gap-1">
            <span className="text-muted-foreground">Draft</span>
            <EntryActivityBadge
              entryKey={draftKey}
              writeCount={draftActivity?.writeCount ?? 0}
              windowDays={draftActivity?.windowDays ?? windowDays}
              testIdPrefix={`proposal-activity-draft-${entry.id}`}
            />
          </span>
        ) : null}
        <button
          type="button"
          className="ml-auto inline-flex items-center gap-1 rounded-sm text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid={`button-proposal-entry-see-changes-${entry.id}`}
          onClick={() => {
            document
              .getElementById(proposalEntryBlockId(entry.id))
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        >
          <IconArrowDown className="h-3 w-3" aria-hidden />
          See changes
        </button>
      </div>
    </div>
  );
}
