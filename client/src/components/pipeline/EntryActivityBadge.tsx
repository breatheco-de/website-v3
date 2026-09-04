import React, { useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ENTRY_ACTIVITY_WINDOW_DAYS,
  ENTRY_ACTIVITY_WRITE_TYPES,
  isEntryActivityWriteType,
  resolveAgentId,
} from "@shared/event-log-filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AgentIcon } from "@/components/pipeline/AgentIcon";
import {
  ENTRY_ACTIVITY_PAGE_SIZE,
  formatActivityActorLine,
  formatActivityListCopy,
  formatActivityRelativeTime,
  formatRelatedActivityTitle,
  getActivityLayerLabel,
  getActivityReport,
  selectWriteRelatedEvents,
} from "@/components/pipeline/entryActivityCopy";
import { buildShowAroundHref } from "@/components/pipeline/event-log-url";
import { useContentTypes } from "@/hooks/useContentTypes";
import { entryKeyToPageUrl } from "@/lib/entryKeyToPageUrl";
import { type EventAttributionEntry } from "@/lib/formatIssueActor";
import { apiFetch } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { ArrowLeft, ExternalLink, Loader2, User } from "lucide-react";

const EVENT_LOG_PATH = "/private/background-pipeline";

type ActivityEvent = {
  id: number;
  type: string;
  resource: Record<string, unknown>;
  payload: Record<string, unknown>;
  attribution: EventAttributionEntry[];
  published: boolean;
  created_at: number;
  agent_session_id?: string;
};

function activitySinceMs(windowDays: number): number {
  return Date.now() - windowDays * 24 * 60 * 60 * 1000;
}

function ActivityActorMark({ attribution }: { attribution: EventAttributionEntry[] }) {
  const agentId = resolveAgentId(attribution);
  if (agentId) {
    return <AgentIcon agentId={agentId} size="sm" className="mt-0.5 shrink-0" />;
  }
  return <User className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" aria-hidden />;
}

/** List-view event log deep link: this entry's people/agent writes. */
export function buildEntryActivityEventLogHref(entryKey: string): string {
  return `${EVENT_LOG_PATH}?entry=${encodeURIComponent(entryKey)}&actor=people,agents&kind=writes`;
}

/** Detail-view: ±1h around this write, hash-focus the event. */
export function buildEntryActivityEventFocusHref(eventId: number, createdAt: number): string {
  return buildShowAroundHref(eventId, createdAt, EVENT_LOG_PATH);
}

/** Closing the modal always returns to the list (1A). */
export function resetActivityModalSelection(): null {
  return null;
}

async function fetchActivityPage(opts: {
  entryKey: string;
  since: number;
  before?: number;
}): Promise<ActivityEvent[]> {
  const params = new URLSearchParams({
    entry: opts.entryKey,
    since: String(opts.since),
    kind: "writes",
    actor: "people,agents",
    limit: String(ENTRY_ACTIVITY_PAGE_SIZE),
  });
  if (opts.before != null) params.set("before", String(opts.before));
  const res = await apiFetch(`/api/admin/events?${params}`);
  if (!res.ok) throw new Error("Failed to load activity");
  const data = (await res.json()) as { events?: ActivityEvent[] };
  return (data.events ?? []).filter((e) => isEntryActivityWriteType(e.type));
}

async function fetchWriteRelatedSessionEvents(agentSessionId: string): Promise<ActivityEvent[]> {
  const params = new URLSearchParams({
    agentSessionId,
    kind: "claims,completes,session",
    actor: "people,agents",
    limit: "50",
  });
  const res = await apiFetch(`/api/admin/events?${params}`);
  if (!res.ok) throw new Error("Failed to load related activity");
  const data = (await res.json()) as { events?: ActivityEvent[] };
  return data.events ?? [];
}

function WriteRelatedHistory({
  entryKey,
  writeEventId,
  agentSessionId,
  testIdPrefix,
}: {
  entryKey: string;
  writeEventId: number;
  agentSessionId: string;
  testIdPrefix: string;
}) {
  const relatedQuery = useQuery({
    queryKey: ["/api/admin/events", "entry-activity-related", agentSessionId, entryKey, writeEventId],
    queryFn: () => fetchWriteRelatedSessionEvents(agentSessionId),
    enabled: Boolean(agentSessionId),
  });

  const related = useMemo(() => {
    if (!relatedQuery.data) return [];
    return selectWriteRelatedEvents({
      events: relatedQuery.data,
      entryKey,
      writeEventId,
    });
  }, [relatedQuery.data, entryKey, writeEventId]);

  if (relatedQuery.isLoading) {
    return (
      <div
        className="flex items-center gap-2 text-xs text-muted-foreground py-1"
        data-testid={`${testIdPrefix}-related-loading`}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Loading related…
      </div>
    );
  }

  if (relatedQuery.isError || related.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2" data-testid={`${testIdPrefix}-related`}>
      <div className="space-y-0.5">
        <p className="text-[11px] font-medium text-foreground">Related to this save</p>
        <p className="text-xs text-muted-foreground leading-snug">
          From the same agent run — why they were here and how it ended.
        </p>
      </div>
      <ul className="space-y-1.5">
        {related.map((event) => {
          const report = getActivityReport(event.payload);
          return (
            <li
              key={event.id}
              className="rounded-md border border-border bg-muted/30 px-2.5 py-2"
              data-testid={`${testIdPrefix}-related-row-${event.id}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-medium text-foreground leading-snug">
                  {formatRelatedActivityTitle(event.type)}
                </p>
                <p className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                  {formatActivityRelativeTime(event.created_at)}
                </p>
              </div>
              {report ? (
                <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2 mt-0.5">
                  {report}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export type EntryActivityDialogProps = {
  entryKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testIdPrefix?: string;
  windowDays?: number;
  /** Prefer over pattern resolution when the caller already has a canonical URL. */
  pageUrl?: string;
};

/** Controlled activity dialog — list/detail of recent people+agent writes for an entry. */
export function EntryActivityDialog({
  entryKey,
  open,
  onOpenChange,
  testIdPrefix = "entry-activity",
  windowDays = ENTRY_ACTIVITY_WINDOW_DAYS,
  pageUrl: pageUrlProp,
}: EntryActivityDialogProps) {
  const contentTypes = useContentTypes();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const since = useMemo(() => activitySinceMs(windowDays), [windowDays, open]);

  const pageHref = useMemo(() => {
    if (pageUrlProp) return pageUrlProp;
    return entryKeyToPageUrl(entryKey, contentTypes);
  }, [pageUrlProp, entryKey, contentTypes]);

  const query = useInfiniteQuery({
    queryKey: ["/api/admin/events", "entry-activity", entryKey, since, windowDays],
    enabled: open && Boolean(entryKey),
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam }) =>
      fetchActivityPage({
        entryKey,
        since,
        before: pageParam,
      }),
    getNextPageParam: (lastPage) => {
      if (lastPage.length < ENTRY_ACTIVITY_PAGE_SIZE) return undefined;
      const last = lastPage[lastPage.length - 1];
      return last?.id;
    },
  });

  const events = useMemo(
    () => query.data?.pages.flatMap((page) => page) ?? [],
    [query.data],
  );
  const selected = selectedId == null ? null : events.find((e) => e.id === selectedId) ?? null;
  const selectedCopy = selected ? formatActivityListCopy(selected) : null;
  const selectedReport = selected ? getActivityReport(selected.payload) : null;
  const selectedLayer = selected ? getActivityLayerLabel(selected.payload) : null;
  const selectedSessionId =
    typeof selected?.agent_session_id === "string" && selected.agent_session_id.trim()
      ? selected.agent_session_id.trim()
      : null;

  const listEventLogHref = buildEntryActivityEventLogHref(entryKey);
  const detailEventLogHref = selected
    ? buildEntryActivityEventFocusHref(selected.id, selected.created_at)
    : listEventLogHref;

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setSelectedId(resetActivityModalSelection());
    }
  }

  function closeForEventLog(e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedId(resetActivityModalSelection());
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-md gap-3 bg-background text-foreground sm:max-w-md"
        onClick={(e) => e.stopPropagation()}
        data-testid={`${testIdPrefix}-dialog`}
      >
        {selected ? (
          <>
            <DialogHeader className="space-y-2 pr-6 text-left">
              <div className="flex flex-wrap items-center gap-1 -ml-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-fit px-2 text-muted-foreground"
                  data-testid={`${testIdPrefix}-back`}
                  onClick={() => setSelectedId(null)}
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                  Back
                </Button>
                {pageHref ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-fit px-2 text-muted-foreground"
                    data-testid={`${testIdPrefix}-open-page`}
                    asChild
                  >
                    <a href={pageHref} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                      Open page
                    </a>
                  </Button>
                ) : null}
              </div>
              <DialogTitle className="text-base">{selectedCopy?.title}</DialogTitle>
              <DialogDescription className="text-xs leading-snug">
                {selectedCopy?.blurb}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm" data-testid={`${testIdPrefix}-detail`}>
              <div className="flex gap-2 items-start">
                <ActivityActorMark attribution={selected.attribution} />
                <p className="text-xs text-muted-foreground">
                  {formatActivityActorLine(selected.attribution, selected.created_at)}
                </p>
              </div>
              {selectedLayer ? (
                <p className="text-xs text-muted-foreground">{selectedLayer}</p>
              ) : null}
              {selectedReport ? (
                <div className="rounded-md border border-border bg-muted/40 p-3">
                  <p className="text-[11px] font-medium text-foreground mb-1">Note</p>
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                    {selectedReport}
                  </p>
                </div>
              ) : null}
              {selectedSessionId ? (
                <WriteRelatedHistory
                  entryKey={entryKey}
                  writeEventId={selected.id}
                  agentSessionId={selectedSessionId}
                  testIdPrefix={testIdPrefix}
                />
              ) : null}
              <Link
                href={detailEventLogHref}
                className="inline-flex text-xs text-primary hover:underline"
                data-testid={`${testIdPrefix}-open-log`}
                onClick={closeForEventLog}
              >
                Open event in log
              </Link>
            </div>
          </>
        ) : (
          <>
            <DialogHeader className="space-y-1.5 pr-6 text-left">
              <DialogTitle className="text-base">Recent saves on this page</DialogTitle>
              <DialogDescription className="text-xs leading-snug">
                People and agents in the last {windowDays} days. Tap a row for more detail.
              </DialogDescription>
            </DialogHeader>
            {query.isLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Loading…
              </div>
            ) : query.isError ? (
              <p className="text-xs text-destructive py-2">Could not load activity.</p>
            ) : !events.length ? (
              <p className="text-xs text-muted-foreground py-2">
                No writes in the last {windowDays} days.
              </p>
            ) : (
              <div className="space-y-2">
                <ul
                  className="space-y-1 max-h-[min(24rem,50vh)] overflow-y-auto pr-0.5 -mx-1"
                  data-testid={`${testIdPrefix}-list`}
                >
                  {events.map((event) => {
                    const copy = formatActivityListCopy(event);
                    return (
                      <li key={event.id}>
                        <button
                          type="button"
                          className={cn(
                            "w-full text-left flex gap-2 items-start rounded-md px-2 py-2",
                            "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                          )}
                          data-testid={`${testIdPrefix}-row-${event.id}`}
                          onClick={() => setSelectedId(event.id)}
                        >
                          <ActivityActorMark attribution={event.attribution} />
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <p className="text-sm font-medium text-foreground leading-snug">
                              {copy.title}
                            </p>
                            <p className="text-xs text-muted-foreground leading-snug line-clamp-2">
                              {copy.blurb}
                            </p>
                            <p className="text-[10px] text-muted-foreground truncate">
                              {formatActivityActorLine(event.attribution, event.created_at)}
                            </p>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {query.hasNextPage ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    data-testid={`${testIdPrefix}-load-more`}
                    disabled={query.isFetchingNextPage}
                    onClick={() => void query.fetchNextPage()}
                  >
                    {query.isFetchingNextPage ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        Loading…
                      </>
                    ) : (
                      "Load more"
                    )}
                  </Button>
                ) : null}
              </div>
            )}
            <Link
              href={listEventLogHref}
              className="inline-flex text-xs text-primary hover:underline"
              data-testid={`${testIdPrefix}-open-log`}
              onClick={closeForEventLog}
            >
              Open in event log
            </Link>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function EntryActivityBadge({
  entryKey,
  writeCount = 0,
  testIdPrefix = "entry-activity",
  windowDays = ENTRY_ACTIVITY_WINDOW_DAYS,
  pageUrl: pageUrlProp,
  className,
}: {
  entryKey: string;
  writeCount?: number;
  testIdPrefix?: string;
  windowDays?: number;
  /** Prefer over pattern resolution when the caller already has a canonical URL. */
  pageUrl?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={cn("shrink-0", className)}
        data-testid={`${testIdPrefix}-badge`}
        aria-label={`${writeCount} write${writeCount === 1 ? "" : "s"} in the last ${windowDays} days`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Badge
          variant="secondary"
          className={cn(
            "h-5 px-1.5 text-[10px] font-normal tabular-nums cursor-pointer underline-offset-2 hover:underline",
            "bg-muted text-muted-foreground border border-border shadow-none",
          )}
        >
          {writeCount} write{writeCount === 1 ? "" : "s"}
        </Badge>
      </button>
      <EntryActivityDialog
        entryKey={entryKey}
        open={open}
        onOpenChange={setOpen}
        testIdPrefix={testIdPrefix}
        windowDays={windowDays}
        pageUrl={pageUrlProp}
      />
    </>
  );
}

/** Exported for tests — write types included in activity. */
export const ENTRY_ACTIVITY_WRITE_TYPES_FOR_TEST = ENTRY_ACTIVITY_WRITE_TYPES;
