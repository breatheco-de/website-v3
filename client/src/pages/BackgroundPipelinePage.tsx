import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconActivity,
  IconAlertTriangle,
  IconCheck,
  IconChecklist,
  IconCircleCheck,
  IconClipboardText,
  IconClock,
  IconCloudDownload,
  IconDatabase,
  IconExternalLink,
  IconFilter,
  IconFlame,
  IconInfoCircle,
  IconLink,
  IconLoader2,
  IconLock,
  IconPencil,
  IconRefresh,
  IconRotateClockwise,
  IconRoute,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EntryValidationModalTrigger } from "@/components/pipeline/EntryValidationModalTrigger";
import {
  EventAttributionBadge,
  EventCausalityLine,
  EventDetails,
  EventSummary,
  eventHasTypedDetails,
  eventValidationEntryRef,
} from "@/components/pipeline/EventLogSummaries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiFetch } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type PipelineStatus = {
  engine: {
    status: "running" | "starting" | "stopped" | "restarting";
    restartAttempts: number;
    dashboardUrl?: string;
  };
  outbox: {
    unpublishedCount: number;
    oldestAgeMs: number | null;
    currentGeneration: number;
  };
  index: {
    lastAppliedGeneration: number;
    lastAppliedAt: number | null;
    behindBy: number;
  };
  inFlight: {
    indexRefresh: boolean;
    validations: Array<{ entryKey: string; sinceMs: number }>;
    propagations: Array<{ groupId: string; locale: string; holder: string; sinceMs: number }>;
  };
  leases: Array<{
    resource: string;
    groupId?: string;
    locale: string;
    holder: string;
    expiresAt: number;
    groupName?: string;
    members: Array<{ contentType: string; slug: string }>;
  }>;
  recentFailures: ContentEvent[];
  status: "ok" | "degraded" | "stalled";
};

type ContentEvent = {
  id: number;
  type: string;
  attribution: Array<{ author?: string; actor?: { type: string; client?: string; model?: string; source?: string } }>;
  cause?: string;
  resource: Record<string, unknown>;
  payload: Record<string, unknown>;
  triggeredByEventId?: number;
  triggeredByEventIds?: number[];
  published: boolean;
  created_at: number;
};

type EventsResponse = {
  events: ContentEvent[];
  unpublishedTotal: number;
  education?: string;
};

const EVENT_LOG_PAGE_SIZE = 50;

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

function formatTs(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `about ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

type EventMeta = {
  label: string;
  description: string;
  icon: typeof IconActivity;
  iconClass: string;
};

const EVENT_META: Record<string, EventMeta> = {
  content_file_written: {
    label: "Content Saved",
    description:
      "Someone saved a content file — a page, section, or registry entry. The file was written to disk and queued for background processing.",
    icon: IconPencil,
    iconClass: "text-primary border-primary/40",
  },
  content_bulk_synced: {
    label: "Bulk Content Sync",
    description:
      "Multiple content files were updated in one batch, usually from a GitHub pull or a bulk sync operation.",
    icon: IconCloudDownload,
    iconClass: "text-primary border-primary/40",
  },
  redirects_changed: {
    label: "Redirects Changed",
    description:
      "Redirect lists in a content file (or custom-redirects.yml) actually changed. Unrelated edits on files that merely contain meta.redirects do not emit this. Redirect cache refresh still rides content_file_written.",
    icon: IconRoute,
    iconClass: "text-primary border-primary/40",
  },
  index_snapshot_ready: {
    label: "Index Snapshot Applied",
    description:
      "The site's internal index was rebuilt and applied. Page lists, search, image usage, and SEO data now reflect the latest saves.",
    icon: IconDatabase,
    iconClass: "text-emerald-400 border-emerald-400/40",
  },
  validation_results_ready: {
    label: "Validation Results Ready",
    description:
      "A validation run finished checking content against schemas and rules. Results are available in Diagnostics.",
    icon: IconChecklist,
    iconClass: "text-emerald-400 border-emerald-400/40",
  },
  validation_issue_claimed: {
    label: "Validation Issue Claimed",
    description:
      "Someone marked a validation issue as in progress — they're working on fixing it.",
    icon: IconClipboardText,
    iconClass: "text-amber-400 border-amber-400/40",
  },
  validation_issue_completed: {
    label: "Validation Issue Completed",
    description:
      "A validation issue was marked as fixed or resolved.",
    icon: IconCircleCheck,
    iconClass: "text-emerald-400 border-emerald-400/40",
  },
  validation_issue_reopened: {
    label: "Validation Issue Reopened",
    description:
      "A previously resolved validation issue was reopened — the fix didn't stick or new problems were found.",
    icon: IconRotateClockwise,
    iconClass: "text-amber-400 border-amber-400/40",
  },
  binding_propagation_started: {
    label: "Shared Section Sync Started",
    description:
      "A shared section started copying its content to sibling pages that are bound together.",
    icon: IconLink,
    iconClass: "text-primary border-primary/40",
  },
  binding_propagation_done: {
    label: "Shared Section Sync Done",
    description:
      "The shared section finished copying to all bound sibling pages.",
    icon: IconLink,
    iconClass: "text-emerald-400 border-emerald-400/40",
  },
  job_failed: {
    label: "Job Failed",
    description:
      "A background job crashed. The save itself may have succeeded, but follow-up work — index rebuild, validation, or sync — did not complete.",
    icon: IconAlertTriangle,
    iconClass: "text-red-400 border-red-400/40",
  },
};

function eventMeta(type: string): EventMeta {
  return (
    EVENT_META[type] ?? {
      label: type
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" "),
      description: `Background event (${type}). Open Payload for technical details.`,
      icon: IconActivity,
      iconClass: "text-muted-foreground border-border",
    }
  );
}

function KpiEducation({
  simple,
  advanced,
}: {
  simple: string;
  advanced: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground leading-relaxed">{simple}</p>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer text-foreground/70 hover:text-foreground">
          Read more (advanced)
        </summary>
        <p className="mt-1 leading-relaxed pl-1 border-l-2 border-border">{advanced}</p>
      </details>
    </div>
  );
}

function HealthKpiCard({
  label,
  value,
  valueClassName,
  subline,
  icon,
  testId,
  education,
}: {
  label: string;
  value: ReactNode;
  valueClassName?: string;
  subline?: ReactNode;
  icon?: ReactNode;
  testId?: string;
  education?: { simple: string; advanced: string };
}) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className={cn("text-2xl font-bold tabular-nums", valueClassName)}>{value}</p>
            <div className="flex items-center gap-1 mt-0.5">
              <p className="text-xs text-muted-foreground">{label}</p>
              {education ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`About ${label}`}
                    >
                      <IconInfoCircle className="h-3 w-3" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="bottom" align="start" className="w-80 space-y-2 p-3">
                    <p className="text-xs text-muted-foreground leading-relaxed">{education.simple}</p>
                    <details className="text-xs text-muted-foreground">
                      <summary className="cursor-pointer text-foreground/70 hover:text-foreground">
                        Read more (advanced)
                      </summary>
                      <p className="mt-1 leading-relaxed pl-1 border-l-2 border-border">{education.advanced}</p>
                    </details>
                  </PopoverContent>
                </Popover>
              ) : null}
            </div>
            {subline ? (
              <div className="text-[11px] text-muted-foreground mt-1">{subline}</div>
            ) : null}
          </div>
          {icon ? <span className="text-muted-foreground shrink-0">{icon}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}

const pipelineStatusValueClass: Record<PipelineStatus["status"], string> = {
  ok: "text-emerald-400",
  degraded: "text-amber-400",
  stalled: "text-red-400",
};

const pipelineStatusLabels: Record<PipelineStatus["status"], string> = {
  ok: "OK",
  degraded: "Degraded",
  stalled: "Stalled",
};

const engineStatusValueClass: Record<PipelineStatus["engine"]["status"], string> = {
  running: "text-emerald-400",
  starting: "text-primary",
  restarting: "text-amber-400",
  stopped: "text-red-400",
};

function engineStatusIcon(status: PipelineStatus["engine"]["status"]) {
  switch (status) {
    case "running":
      return <IconCheck className="h-4 w-4" />;
    case "starting":
    case "restarting":
      return <IconLoader2 className="h-4 w-4 animate-spin" />;
    case "stopped":
      return <IconAlertTriangle className="h-4 w-4" />;
  }
}

function HealthStrip({ data }: { data: PipelineStatus }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="pipeline-health-kpis">
      <HealthKpiCard
        label="Overall"
        value={pipelineStatusLabels[data.status]}
        valueClassName={pipelineStatusValueClass[data.status]}
        icon={
          data.status === "ok" ? (
            <IconCheck className="h-4 w-4" />
          ) : (
            <IconAlertTriangle className="h-4 w-4" />
          )
        }
        testId="kpi-pipeline-overall"
        education={{
          simple:
            "One-look summary. OK: everything is flowing. Degraded: the worker is recovering, small delays possible. Stalled: a save, bulk sync, or binding job has waited more than 5 minutes to start — not diary rows like validation complete. Saves still work; tell a developer if this lasts.",
          advanced:
            "Derived in server/pipeline-status.ts from oldest unpublished dispatch event (OUTBOX_DISPATCHABLE_EVENT_TYPES in server/events/types.ts). Degraded when engine is restarting/starting or write lag (behindBy) > 10. Audit events (validation_results_ready, index_snapshot_ready, redirects_changed diary) do not affect stall.",
        }}
      />
      <HealthKpiCard
        label="Worker engine"
        value={data.engine.status.charAt(0).toUpperCase() + data.engine.status.slice(1)}
        valueClassName={engineStatusValueClass[data.engine.status]}
        icon={engineStatusIcon(data.engine.status)}
        subline={
          data.engine.dashboardUrl ? (
            <a
              href={data.engine.dashboardUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Sidequest dashboard
              <IconExternalLink className="h-3 w-3" />
            </a>
          ) : (
            "Processes background tasks"
          )
        }
        testId="kpi-pipeline-engine"
        education={{
          simple:
            "This is the worker that processes background tasks. Green means it's working. If it says Restarting or Stopped, your saves are safe, but the site index and validations will wait until it recovers.",
          advanced:
            "Sidequest.js engine in server/jobs/queue.ts, SQLite backend at data/sidequest.sqlite. Auto-restarts with exponential backoff (max 10 attempts). Status via GET /api/admin/pipeline/status → engine.",
        }}
      />
      <HealthKpiCard
        label="Events waiting"
        value={data.outbox.unpublishedCount}
        valueClassName={
          data.outbox.unpublishedCount > 0 ? "text-amber-400" : "text-foreground"
        }
        icon={<IconClock className="h-4 w-4" />}
        subline={
          data.outbox.oldestAgeMs !== null
            ? `Oldest: ${formatMs(data.outbox.oldestAgeMs)}`
            : "Queue empty"
        }
        testId="kpi-pipeline-waiting"
        education={{
          simple:
            "Work waiting for the background worker: saves, bulk sync, and binding propagation. Normally picked up in under a second. Completion diary rows (validation ready, snapshot ready) are logged but not counted here. Custom-redirects.yml saves still queue index refresh via the normal save event.",
          advanced:
            "Unpublished dispatch rows in data/<site>/app.db (OUTBOX_DISPATCHABLE_EVENT_TYPES). GET /api/admin/pipeline/status → outbox. Stalled threshold: EVENT_STALE_THRESHOLD_MS (default 5 min). redirects_changed is audit-only; content_file_written handles custom-redirects refresh.",
        }}
      />
      <HealthKpiCard
        label="Index lag"
        value={
          data.index.behindBy > 0 ? (
            data.index.behindBy
          ) : (
            <span className="flex items-center gap-1 text-emerald-400">
              <IconCheck className="h-5 w-5 shrink-0" />
              Up to date
            </span>
          )
        }
        valueClassName={data.index.behindBy > 0 ? "text-amber-400" : undefined}
        icon={<IconRefresh className="h-4 w-4" />}
        subline={
          data.index.behindBy > 0 ? (
            <>
              {data.index.behindBy} generation(s) behind · Index{" "}
              <span className="font-mono">#{data.index.lastAppliedGeneration}</span>
              {" · "}
              saves <span className="font-mono">#{data.outbox.currentGeneration}</span>
            </>
          ) : (
            <>
              Index <span className="font-mono">#{data.index.lastAppliedGeneration}</span>
              {" · "}
              saves <span className="font-mono">#{data.outbox.currentGeneration}</span>
            </>
          )
        }
        testId="kpi-pipeline-index-lag"
        education={{
          simple:
            "Your page content updates instantly when you save. Site-wide lists (image usage, SEO data, search) catch up a few seconds later. These two numbers show how far behind the lists are.",
          advanced:
            "Generation = latest content write event id (saves, bulk sync, redirects) — not validation or binding events. lastAppliedGeneration updated in server/jobs/applier.ts when a snapshot from index_refresh job is applied. Snapshots in <site>/.cache/index-snapshots/.",
        }}
      />
    </div>
  );
}

function InFlightPanel({ data }: { data: PipelineStatus["inFlight"] }) {
  const empty =
    !data.indexRefresh && data.validations.length === 0 && data.propagations.length === 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <IconFlame
            className={cn(
              "h-4 w-4 shrink-0",
              empty ? "text-muted-foreground" : "text-amber-400",
            )}
            aria-hidden
          />
          Happening right now
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <KpiEducation
          simple="Tasks that started but haven't finished yet. When this section is empty, all background work for recent saves is complete."
          advanced="Derived from recent events (not Sidequest job table): written/bulk events newer than last applied snapshot, validations without matching validation_results_ready, propagations without binding_propagation_done. GET /api/admin/pipeline/status → inFlight."
        />
        {empty ? (
          <p className="text-sm text-muted-foreground">
            Nothing running — saves are fully applied.
          </p>
        ) : (
          <ul className="space-y-3 text-sm">
            {data.indexRefresh ? (
              <li className="flex items-start gap-2">
                <IconLoader2 className="h-4 w-4 animate-spin shrink-0 mt-0.5 text-primary" />
                <div>
                  <p className="font-medium">Index refresh in progress</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    The site is rebuilding its internal map of all pages. Multiple quick saves share one rebuild.
                  </p>
                </div>
              </li>
            ) : null}
            {data.validations.map((v) => (
              <li key={v.entryKey} className="flex items-start gap-2">
                <IconLoader2 className="h-4 w-4 animate-spin shrink-0 mt-0.5 text-primary" />
                <div>
                  <p className="font-medium">Validation: {v.entryKey}</p>
                  <p className="text-xs text-muted-foreground">
                    Running for {formatMs(v.sinceMs)} — results appear in Diagnostics shortly after saving.
                  </p>
                </div>
              </li>
            ))}
            {data.propagations.map((p) => (
              <li key={`${p.groupId}:${p.locale}`} className="flex items-start gap-2">
                <IconLoader2 className="h-4 w-4 animate-spin shrink-0 mt-0.5 text-primary" />
                <div>
                  <p className="font-medium">
                    Bound section sync: {p.groupId} ({p.locale})
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Holder: {p.holder} · running for {formatMs(p.sinceMs)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function LeasesPanel({ leases }: { leases: PipelineStatus["leases"] }) {
  const [now, setNow] = useState(Date.now());
  const hasLocks = leases.length > 0;
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <IconLock
            className={cn(
              "h-4 w-4 shrink-0",
              hasLocks ? "text-amber-400" : "text-muted-foreground",
            )}
            aria-hidden
          />
          Active locks
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <KpiEducation
          simple="While a shared section copies to its sibling pages, that one section is briefly locked so two people can't overwrite each other. Only that section is locked — everything else stays editable. Locks release themselves within 30 seconds. If your save was rejected, it retries by itself."
          advanced="leases table in per-site app.db. Resource key binding:{groupId}:{locale}. Acquire/compare-and-set in server/leases.ts. 409 payload: binding_lease_active. List via GET /api/admin/pipeline/status → leases."
        />
        {leases.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active locks.</p>
        ) : (
          <ul className="space-y-3">
            {leases.map((lease) => {
              const remaining = Math.max(0, lease.expiresAt - now);
              return (
                <li
                  key={lease.resource}
                  className="rounded-md border border-border bg-muted/30 p-3 text-sm space-y-1"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{lease.groupName || lease.groupId || lease.resource}</span>
                    <Badge variant="outline" className="text-xs">
                      {lease.locale}
                    </Badge>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <IconClock className="h-3 w-3" />
                      {formatMs(remaining)} left
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">Holder: {lease.holder}</p>
                  {lease.members.length > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Pages:{" "}
                      {lease.members.map((m) => `${m.contentType}/${m.slug}`).join(", ")}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function EventLogPanel({
  site,
  failures,
}: {
  site: string;
  failures: ContentEvent[];
}) {
  const [typeFilter, setTypeFilter] = useState("");
  const [authorFilter, setAuthorFilter] = useState("");
  const [events, setEvents] = useState<ContentEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreEvents, setHasMoreEvents] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [newIds, setNewIds] = useState<ReadonlySet<number>>(new Set());
  const [clearLogOpen, setClearLogOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const maxSeenIdRef = useRef<number | null>(null);
  const newIdsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadEvents = useCallback(
    async (before?: number, append = false) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const params = new URLSearchParams({ site, limit: String(EVENT_LOG_PAGE_SIZE) });
        if (typeFilter) params.set("type", typeFilter);
        if (before) params.set("before", String(before));
        const res = await apiFetch(`/api/admin/events?${params}`);
        if (!res.ok) return;
        const data = (await res.json()) as EventsResponse;
        const incoming = data.events ?? [];
        setHasMoreEvents(incoming.length >= EVENT_LOG_PAGE_SIZE);
        if (!append) {
          const prevMax = maxSeenIdRef.current;
          if (prevMax !== null) {
            const fresh = incoming.filter((ev) => ev.id > prevMax).map((ev) => ev.id);
            if (fresh.length > 0) {
              setNewIds(new Set(fresh));
              if (newIdsTimerRef.current) clearTimeout(newIdsTimerRef.current);
              newIdsTimerRef.current = setTimeout(() => setNewIds(new Set()), 700);
            }
          }
          if (incoming.length > 0) {
            maxSeenIdRef.current = Math.max(prevMax ?? 0, ...incoming.map((ev) => ev.id));
          }
        }
        setEvents((prev) => (append ? [...prev, ...incoming] : incoming));
      } finally {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [site, typeFilter],
  );

  const clearLog = useCallback(async () => {
    setClearing(true);
    try {
      const res = await apiFetch(`/api/admin/events?site=${encodeURIComponent(site)}`, {
        method: "DELETE",
      });
      if (!res.ok) return;
      setEvents([]);
      setExpanded(null);
      setNewIds(new Set());
      maxSeenIdRef.current = null;
      setClearLogOpen(false);
    } finally {
      setClearing(false);
    }
  }, [site]);

  useEffect(() => {
    return () => {
      if (newIdsTimerRef.current) clearTimeout(newIdsTimerRef.current);
    };
  }, []);

  useEffect(() => {
    void loadEvents();
    const onVisibility = () => {
      if (!document.hidden) void loadEvents();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const id = setInterval(() => {
      if (!document.hidden) void loadEvents();
    }, 5000);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(id);
    };
  }, [loadEvents]);

  const filteredEvents = useMemo(() => {
    if (!authorFilter) return events;
    return events.filter((e) =>
      e.attribution.some((a) => a.author?.includes(authorFilter)),
    );
  }, [events, authorFilter]);

  const loadedEventIds = useMemo(() => new Set(events.map((e) => e.id)), [events]);

  const scrollToEvent = useCallback((eventId: number) => {
    const el = document.querySelector(`[data-testid="event-row-${eventId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const failureIds = new Set(failures.map((f) => f.id));
  const oldestId = events.length > 0 ? events[events.length - 1]!.id : undefined;
  const activeFilterCount = (typeFilter ? 1 : 0) + (authorFilter ? 1 : 0);

  return (
    <section className="space-y-4">
      <h2 className="text-base font-semibold">Event log</h2>
        <KpiEducation
          simple="Each row links to the save or action that caused it (Caused by #…). Attribution shows who is accountable — staff name, via Cursor for MCP agents, or a system source like GitHub sync."
          advanced="Event store: data/{site}/app.db → events (triggered_by_event_id, triggered_by_event_ids_json, attribution_json). Validation ready closes the writeEventId that enqueued the job (stashed in pipeline_state) plus any other still-open writes for that entry. Binding done → applier markFileAsModified. GET /api/admin/events?triggeredBy=. Rows pruned after ~7 days."
        />
        <div className="flex flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="relative"
                data-testid="button-event-filters"
              >
                <IconFilter className="h-4 w-4 mr-2" />
                Filters
                {activeFilterCount > 0 ? (
                  <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                    {activeFilterCount}
                  </span>
                ) : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="start" className="w-72 space-y-3 p-3">
              <div className="space-y-1">
                <label className="text-xs font-medium" htmlFor="event-type-filter">
                  Event type
                </label>
                <select
                  id="event-type-filter"
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                >
                  <option value="">All types</option>
                  {Object.entries(EVENT_META).map(([type, meta]) => (
                    <option key={type} value={type}>
                      {meta.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium" htmlFor="event-author-filter">
                  Author
                </label>
                <input
                  id="event-author-filter"
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                  placeholder="e.g. mcp, staff email"
                  value={authorFilter}
                  onChange={(e) => setAuthorFilter(e.target.value)}
                />
              </div>
              {activeFilterCount > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full h-7 text-xs"
                  onClick={() => {
                    setTypeFilter("");
                    setAuthorFilter("");
                  }}
                >
                  <IconX className="h-3.5 w-3.5 mr-1" />
                  Clear filters
                </Button>
              ) : null}
            </PopoverContent>
          </Popover>
          <Button
            variant="outline"
            size="sm"
            disabled={clearing || (events.length === 0 && !loading)}
            onClick={() => setClearLogOpen(true)}
            data-testid="button-clear-event-log"
          >
            {clearing ? (
              <IconLoader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <IconTrash className="h-4 w-4 mr-2" />
            )}
            Clear log
          </Button>
        </div>

        <AlertDialog open={clearLogOpen} onOpenChange={setClearLogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear event log?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes every background event for this site from the log. Saves and
                pipeline work are not undone — only the diary entries disappear. New events will
                still appear as work happens.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={clearing}>Cancel</AlertDialogCancel>
              <Button
                variant="destructive"
                disabled={clearing}
                onClick={() => void clearLog()}
                data-testid="button-confirm-clear-event-log"
              >
                {clearing ? (
                  <IconLoader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                Clear log
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {loading && events.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <IconLoader2 className="h-4 w-4 animate-spin" />
            Loading events…
          </div>
        ) : filteredEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No background events in the last 7 days retention window.
          </p>
        ) : (
          <div className="relative">
            <span
              className="absolute left-[17px] top-4 bottom-4 w-px bg-border"
              aria-hidden
            />
            <ol className="space-y-0">
              {filteredEvents.map((e) => {
                const isFailure = e.type === "job_failed" || failureIds.has(e.id);
                const validationSkipped =
                  e.type === "validation_results_ready" && e.payload?.skipped === true;
                const meta = eventMeta(e.type);
                const label = validationSkipped ? "Validation Skipped" : meta.label;
                const iconClass = validationSkipped
                  ? "text-muted-foreground border-border"
                  : meta.iconClass;
                const Icon = isFailure ? IconAlertTriangle : meta.icon;
                const isExpanded = expanded === e.id;
                const hasTypedDetails = eventHasTypedDetails(e);
                const validationEntry = eventValidationEntryRef(e);
                return (
                  <li
                    key={e.id}
                    className={cn(
                      "relative flex gap-4 pb-6 last:pb-0",
                      newIds.has(e.id) && "timeline-event-enter",
                    )}
                    data-testid={`event-row-${e.id}`}
                  >
                    <span
                      className={cn(
                        "relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-card",
                        isFailure ? "text-red-400 border-red-400/40" : iconClass,
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className={cn(
                                "text-sm font-semibold text-left hover:underline decoration-dotted underline-offset-2 cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                isFailure && "text-red-400",
                                validationSkipped && "text-muted-foreground",
                              )}
                              aria-label={`What is ${label}?`}
                            >
                              {label}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent side="bottom" align="start" className="w-80 p-3">
                            <p className="text-xs font-medium text-foreground mb-1">
                              {label}
                            </p>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              {validationSkipped
                                ? "Validation was not re-run because the same page was already queued or validated recently (1-hour dedupe). The save still succeeded."
                                : meta.description}
                            </p>
                          </PopoverContent>
                        </Popover>
                        {e.attribution.length > 0 ? (
                          <EventAttributionBadge attribution={e.attribution} />
                        ) : null}
                        <span className="text-[10px] font-mono text-muted-foreground">
                          #{e.id}
                        </span>
                      </div>
                      <EventCausalityLine
                        event={e}
                        loadedEventIds={loadedEventIds}
                        onNavigateToEvent={scrollToEvent}
                      />
                      <EventSummary event={e} />
                      {isExpanded && !validationEntry ? <EventDetails event={e} /> : null}
                    </div>
                    <div className="shrink-0 text-right pt-0.5">
                      <p className="text-xs font-medium">{formatTs(e.created_at)}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {formatRelative(e.created_at)}
                      </p>
                      {validationEntry ? (
                        <EntryValidationModalTrigger
                          entryKey={validationEntry.entryKey}
                          pageUrl={validationEntry.pageUrl}
                          className="mt-1 justify-end"
                        />
                      ) : (
                        <button
                          type="button"
                          className="text-xs text-primary hover:underline mt-1"
                          onClick={() => setExpanded(isExpanded ? null : e.id)}
                        >
                          {isExpanded ? "Hide" : hasTypedDetails ? "Details" : "Payload"}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {events.length > 0 && !loading ? (
          <div className="flex justify-center">
            {hasMoreEvents ? (
              <Button
                variant="outline"
                size="sm"
                disabled={loadingMore}
                onClick={() => void loadEvents(oldestId!, true)}
              >
                {loadingMore ? (
                  <IconLoader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Load older
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                You have reached the end of the event log
              </p>
            )}
          </div>
        ) : null}
    </section>
  );
}

export default function BackgroundPipelinePage() {
  const { data: siteInfo } = useQuery<{ domain: string; contentFolder: string }>({
    queryKey: ["/api/site/info"],
  });
  const site = siteInfo?.contentFolder;
  const siteDomainLabel =
    siteInfo?.domain === "4geeks.com" ? "4Geeks.com" : siteInfo?.domain;

  const { data, isLoading, refetch, isFetching } = useQuery<PipelineStatus>({
    queryKey: ["/api/admin/pipeline/status", site],
    queryFn: async () => {
      const res = await apiFetch(`/api/admin/pipeline/status?site=${encodeURIComponent(site!)}`);
      if (!res.ok) throw new Error("Failed to fetch pipeline status");
      return res.json();
    },
    enabled: !!site,
    refetchInterval: () => (document.hidden ? false : 5000),
  });

  return (
    <div className="min-h-screen bg-background text-foreground p-6 pb-[100px] space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            Background Pipeline
            {siteDomainLabel ? (
              <>
                {" for "}
                <span className="text-primary">{siteDomainLabel}</span>
              </>
            ) : null}
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Workers are the reason this website feels so fast. When you save, you&apos;re done —
            your page updates right away while background workers handle the rest: keeping search and
            lists fresh, checking content quality, syncing shared sections across pages, and pushing
            updates to GitHub. That&apos;s what keeps the site accurate and polished for visitors —
            usually within seconds.
          </p>
        </div>
        <Button
          variant="outline"
          size="default"
          onClick={() => refetch()}
          disabled={isFetching || !site}
          data-testid="button-refresh-pipeline"
        >
          <IconRefresh className={cn("w-4 h-4 mr-2", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <div className="flex items-start gap-3 rounded-md border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
        <IconInfoCircle className="h-4 w-4 mt-0.5 shrink-0 text-foreground/60" />
        <div className="space-y-2">
          <span>
            This page is read-only. It does not retry jobs or release locks — those happen
            automatically.
          </span>
          <details className="text-xs">
            <summary className="cursor-pointer text-foreground/80 hover:text-foreground">
              Read more (advanced)
            </summary>
            <p className="mt-1 leading-relaxed pl-1 border-l-2 border-border">
              Pipeline DB (`events`, `pipeline_state`, `leases` in data/&lt;site&gt;/app.db) migrates
              on server restart after deploy — not while you browse. Deploy progress: GitHub Actions →
              Deploy to VPS job log (not this page). If the worker is stopped right after deploy,
              check that log for <code className="font-mono">ensure:pipeline-db --dry-run</code> or
              Settings → Server for a failed restart (Boot ID unchanged). Paths: server/pipeline-db/,
              scripts/ensure-pipeline-db.ts.
            </p>
          </details>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
          <IconLoader2 className="h-5 w-5 animate-spin" />
          Loading pipeline status…
        </div>
      ) : (
        <>
          <HealthStrip data={data} />
          <div className="grid gap-4 md:grid-cols-2">
            <InFlightPanel data={data.inFlight} />
            <LeasesPanel leases={data.leases} />
          </div>
          {site ? <EventLogPanel site={site} failures={data.recentFailures} /> : null}
        </>
      )}
    </div>
  );
}
