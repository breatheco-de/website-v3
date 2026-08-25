import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import {
  EventTimeline,
  jumpToLatestRange,
  type VisibleTimeRange,
} from "@/components/pipeline/EventTimeline";
import {
  AGENT_FILTER_OTHER,
  AGENT_IDS,
  formatAgentLabel,
  resolveAgentId,
  type AgentId,
} from "@/components/pipeline/agentIcons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
    pending: ContentEvent[];
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

/** Dense fetch for timeline scrubber + list (v1: no separate load-more). */
const EVENT_LOG_FETCH_LIMIT = 500;

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

function HealthKpiCard({
  label,
  value,
  valueClassName,
  subline,
  icon,
  testId,
  education,
  detail,
}: {
  label: string;
  value: ReactNode;
  valueClassName?: string;
  subline?: ReactNode;
  icon?: ReactNode;
  testId?: string;
  education?: { simple: string; advanced: string };
  /** Optional "View …" popover; omit when the list would be empty. */
  detail?: { label: string; testId: string; content: ReactNode };
}) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
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
            {detail ? (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="mt-1.5 text-[11px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                    data-testid={detail.testId}
                  >
                    {detail.label}
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  side="bottom"
                  align="start"
                  className="w-96 max-h-[min(24rem,70vh)] overflow-y-auto p-3"
                >
                  {detail.content}
                </PopoverContent>
              </Popover>
            ) : null}
          </div>
          {icon ? <span className="text-muted-foreground shrink-0">{icon}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}

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

function inFlightCount(data: PipelineStatus["inFlight"]): number {
  return (
    (data.indexRefresh ? 1 : 0) + data.validations.length + data.propagations.length
  );
}

function eventResourceLabel(ev: ContentEvent): string {
  const r = ev.resource;
  const ct = typeof r.contentType === "string" ? r.contentType : "";
  const slug = typeof r.slug === "string" ? r.slug : "";
  const locale = typeof r.locale === "string" ? r.locale : "";
  if (ct && slug) return locale ? `${ct}/${slug} (${locale})` : `${ct}/${slug}`;
  if (typeof r.path === "string") return r.path;
  return "";
}

function InFlightDetailList({ data }: { data: PipelineStatus["inFlight"] }) {
  return (
    <ul className="space-y-3 text-sm" data-testid="kpi-detail-running">
      {data.indexRefresh ? (
        <li className="flex items-start gap-2">
          <IconLoader2 className="h-4 w-4 animate-spin shrink-0 mt-0.5 text-primary" />
          <div>
            <p className="font-medium">Index refresh in progress</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              The site is rebuilding its internal map of all pages. Multiple quick saves share one
              rebuild.
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
  );
}

function PendingEventsDetailList({
  pending,
  totalCount,
}: {
  pending: ContentEvent[];
  totalCount: number;
}) {
  const truncated = totalCount > pending.length;
  return (
    <div className="space-y-2" data-testid="kpi-detail-waiting">
      <ul className="space-y-2 text-sm">
        {pending.map((ev) => {
          const meta = eventMeta(ev.type);
          const resource = eventResourceLabel(ev);
          const age = Date.now() - ev.created_at;
          return (
            <li
              key={ev.id}
              className="rounded-md border border-border bg-muted/30 px-2.5 py-2 space-y-0.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{meta.label}</span>
                <span className="text-[10px] font-mono text-muted-foreground">#{ev.id}</span>
                <span className="text-xs text-muted-foreground ml-auto">{formatMs(age)} ago</span>
              </div>
              {resource ? (
                <p className="text-xs text-muted-foreground font-mono truncate" title={resource}>
                  {resource}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {truncated ? (
        <p className="text-[11px] text-muted-foreground">
          +{totalCount - pending.length} more in Event log below
        </p>
      ) : null}
    </div>
  );
}

function LocksDetailList({ leases }: { leases: PipelineStatus["leases"] }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <ul className="space-y-3" data-testid="kpi-detail-locks">
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
                Pages: {lease.members.map((m) => `${m.contentType}/${m.slug}`).join(", ")}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function HealthStrip({ data }: { data: PipelineStatus }) {
  const activeCount = inFlightCount(data.inFlight);
  const pending = data.outbox.pending ?? [];
  const waitingCount = data.outbox.unpublishedCount;
  const lockCount = data.leases.length;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="pipeline-health-kpis">
      <HealthKpiCard
        label="Agent engine"
        value={data.engine.status.charAt(0).toUpperCase() + data.engine.status.slice(1)}
        valueClassName={engineStatusValueClass[data.engine.status]}
        icon={engineStatusIcon(data.engine.status)}
        subline={
          <div className="space-y-1">
            {data.engine.dashboardUrl ? (
              <a
                href={data.engine.dashboardUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                Sidequest dashboard
                <IconExternalLink className="h-3 w-3" />
              </a>
            ) : null}
            <p className={cn(activeCount > 0 ? "text-amber-400 font-medium" : undefined)}>
              {activeCount > 0 ? `${activeCount} active` : "Idle"}
            </p>
          </div>
        }
        detail={
          activeCount > 0
            ? {
                label: "View running",
                testId: "button-view-running",
                content: <InFlightDetailList data={data.inFlight} />,
              }
            : undefined
        }
        testId="kpi-pipeline-engine"
        education={{
          simple:
            "Process health for the agent runtime that picks up background work. Running means the engine is up. Idle under it means no tasks are in flight right now — not that the engine is down. Restarting or Stopped: saves are safe, but index and validations wait until it recovers.",
          advanced:
            "Sidequest.js engine in server/jobs/queue.ts, SQLite backend at data/sidequest.sqlite. Auto-restarts with exponential backoff (max 10 attempts). In-flight list from GET /api/admin/pipeline/status → inFlight (events, not the Sidequest job table).",
        }}
      />
      <HealthKpiCard
        label="Events waiting"
        value={waitingCount}
        valueClassName={waitingCount > 0 ? "text-amber-400" : "text-foreground"}
        icon={<IconClock className="h-4 w-4" />}
        subline={
          data.outbox.oldestAgeMs !== null
            ? `Oldest: ${formatMs(data.outbox.oldestAgeMs)}`
            : "Queue empty"
        }
        detail={
          waitingCount > 0 && pending.length > 0
            ? {
                label: "View waiting",
                testId: "button-view-waiting",
                content: (
                  <PendingEventsDetailList pending={pending} totalCount={waitingCount} />
                ),
              }
            : undefined
        }
        testId="kpi-pipeline-waiting"
        education={{
          simple:
            "Work waiting for agents to pick up: saves, bulk sync, and binding propagation. Normally claimed in under a second. Use View waiting for the pending rows; the Event log below has full history. Completion diary rows are logged but not counted here.",
          advanced:
            "Unpublished dispatch rows in data/<site>/app.db (OUTBOX_DISPATCHABLE_EVENT_TYPES). GET /api/admin/pipeline/status → outbox.pending (capped at 20). Stalled threshold: EVENT_STALE_THRESHOLD_MS (default 5 min).",
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
      <HealthKpiCard
        label="Active locks"
        value={lockCount > 0 ? lockCount : "None"}
        valueClassName={lockCount > 0 ? "text-amber-400" : "text-foreground"}
        icon={<IconLock className={cn("h-4 w-4", lockCount > 0 && "text-amber-400")} />}
        subline={lockCount > 0 ? "Binding sections briefly locked" : "No locks"}
        detail={
          lockCount > 0
            ? {
                label: "View locks",
                testId: "button-view-locks",
                content: <LocksDetailList leases={data.leases} />,
              }
            : undefined
        }
        testId="kpi-pipeline-locks"
        education={{
          simple:
            "While a shared section copies to its sibling pages, that one section is briefly locked so two people can't overwrite each other. Everything else stays editable. Locks release themselves within about 30 seconds. Use View locks for holders and time left.",
          advanced:
            "leases table in per-site app.db. Resource key binding:{groupId}:{locale}. Acquire/compare-and-set in server/leases.ts. 409 payload: binding_lease_active. List via GET /api/admin/pipeline/status → leases.",
        }}
      />
    </div>
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
  const [agentFilter, setAgentFilter] = useState<"" | AgentId | typeof AGENT_FILTER_OTHER>("");
  const [events, setEvents] = useState<ContentEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [newIds, setNewIds] = useState<ReadonlySet<number>>(new Set());
  const [clearLogOpen, setClearLogOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [visibleRange, setVisibleRange] = useState<VisibleTimeRange | null>(null);
  const [listHeightPx, setListHeightPx] = useState(672);
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const maxSeenIdRef = useRef<number | null>(null);
  const newIdsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const EVENT_LIST_MIN_PX = 672;
  const EVENT_LIST_BOTTOM_PAD_PX = 24;

  /** Viewport remainder × 3 so the log is tall; page scrolls when needed. */
  useLayoutEffect(() => {
    const el = listScrollRef.current;
    if (!el) return;

    const measure = () => {
      const top = el.getBoundingClientRect().top;
      const viewportRemainder = Math.floor(
        window.innerHeight - top - EVENT_LIST_BOTTOM_PAD_PX,
      );
      const next = Math.max(EVENT_LIST_MIN_PX, viewportRemainder * 3);
      setListHeightPx((prev) => (prev === next ? prev : next));
    };

    measure();
    requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(document.documentElement);
    if (el.parentElement) ro.observe(el.parentElement);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [events.length, loading]);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ site, limit: String(EVENT_LOG_FETCH_LIMIT) });
      if (typeFilter) params.set("type", typeFilter);
      const res = await apiFetch(`/api/admin/events?${params}`);
      if (!res.ok) return;
      const data = (await res.json()) as EventsResponse;
      const incoming = data.events ?? [];
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
      setEvents(incoming);
    } finally {
      setLoading(false);
    }
  }, [site, typeFilter]);

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

  /** Type filter is server-side; agent filter applies to timeline + list. */
  const filterScopedEvents = useMemo(() => {
    if (!agentFilter) return events;
    return events.filter((e) => {
      const agentId = resolveAgentId(e.attribution);
      if (agentFilter === AGENT_FILTER_OTHER) return agentId == null;
      return agentId === agentFilter;
    });
  }, [events, agentFilter]);

  const rangeFilteredEvents = useMemo(() => {
    if (!visibleRange) return filterScopedEvents;
    return filterScopedEvents.filter(
      (e) => e.created_at >= visibleRange.start && e.created_at <= visibleRange.end,
    );
  }, [filterScopedEvents, visibleRange]);

  const loadedEventIds = useMemo(() => new Set(events.map((e) => e.id)), [events]);

  const scrollToEvent = useCallback((eventId: number) => {
    const el = document.querySelector(`[data-testid="event-row-${eventId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const getActivityLabel = useCallback((event: { type: string; payload?: Record<string, unknown> }) => {
    if (event.type === "validation_results_ready" && event.payload?.skipped === true) {
      return "Validation Skipped";
    }
    return eventMeta(event.type).label;
  }, []);

  const failureIds = new Set(failures.map((f) => f.id));
  const activeFilterCount = (typeFilter ? 1 : 0) + (agentFilter ? 1 : 0);

  return (
    <section className="space-y-4">
      <div className="max-w-6xl mx-auto px-6 w-full flex flex-wrap items-center gap-2">
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
              <label className="text-xs font-medium" htmlFor="event-agent-filter">
                Agent
              </label>
              <select
                id="event-agent-filter"
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                value={agentFilter}
                onChange={(e) =>
                  setAgentFilter(e.target.value as "" | AgentId | typeof AGENT_FILTER_OTHER)
                }
                data-testid="select-event-agent-filter"
              >
                <option value="">All agents</option>
                {AGENT_IDS.map((id) => (
                  <option key={id} value={id}>
                    {formatAgentLabel(id)}
                  </option>
                ))}
                <option value={AGENT_FILTER_OTHER}>
                  {formatAgentLabel(AGENT_FILTER_OTHER)}
                </option>
              </select>
            </div>
            {activeFilterCount > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-7 text-xs"
                onClick={() => {
                  setTypeFilter("");
                  setAgentFilter("");
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

      {events.length > 0 ? (
        <EventTimeline
          events={filterScopedEvents}
          getActivityLabel={getActivityLabel}
          visibleRange={visibleRange}
          onRangeChange={setVisibleRange}
          onSelect={scrollToEvent}
          onJumpToLatest={() => setVisibleRange(jumpToLatestRange())}
        />
      ) : null}

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

      <div className="max-w-6xl mx-auto px-6 w-full pb-6">
        {loading && events.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <IconLoader2 className="h-4 w-4 animate-spin" />
            Loading events…
          </div>
        ) : filterScopedEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No background events in the last 7 days retention window.
          </p>
        ) : (
          <div
            ref={listScrollRef}
            className="relative overflow-y-auto overflow-x-hidden pr-1"
            style={{ height: listHeightPx }}
            data-testid="event-list-scroll"
          >
            {rangeFilteredEvents.length === 0 ? (
              <div className="flex h-full flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span>No events in this time window.</span>
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setVisibleRange(jumpToLatestRange())}
                  data-testid="button-list-jump-latest"
                >
                  Jump to latest
                </button>
              </div>
            ) : (
              <div className="relative">
                <span
                  className="absolute left-[17px] top-4 bottom-4 w-px bg-border"
                  aria-hidden
                />
                <ol className="space-y-0">
                  {rangeFilteredEvents.map((e) => {
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
          </div>
        )}
      </div>
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
    <div className="min-h-screen bg-background text-foreground pb-6 space-y-6">
      <div className="max-w-6xl mx-auto px-6 pt-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">
              Agent Pipeline
              {siteDomainLabel ? (
                <>
                  {" for "}
                  <span className="text-primary">{siteDomainLabel}</span>
                </>
              ) : null}
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Agents are why this site feels instant. When you save, you&apos;re done — your page
              updates right away while AI agents quietly finish the rest: refreshing search and lists,
              checking content quality, syncing shared sections across pages, and pushing updates to
              GitHub. That&apos;s how the experience stays accurate and polished for visitors —
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

        {isLoading || !data ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
            <IconLoader2 className="h-5 w-5 animate-spin" />
            Loading pipeline status…
          </div>
        ) : (
          <HealthStrip data={data} />
        )}
      </div>

      {!isLoading && data && site ? (
        <EventLogPanel site={site} failures={data.recentFailures} />
      ) : null}
    </div>
  );
}
