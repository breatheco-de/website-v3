import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
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
  IconFlask,
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
  EventCausalityLine,
  EventDetails,
  EventSummary,
  eventAgentReport,
  eventHasTypedDetails,
  eventValidationEntryRef,
} from "@/components/pipeline/EventLogSummaries";
import {
  EventHeadline,
  formatEventHeadline,
  formatEventHeadlinePlain,
} from "@/components/pipeline/formatEventHeadline";
import {
  EventTimeline,
  jumpToLatestRange,
  type VisibleTimeRange,
} from "@/components/pipeline/EventTimeline";
import { AgentIcon } from "@/components/pipeline/AgentIcon";
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
import { apiFetch, apiRequestWithAuth } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { SidequestDiagnosticsPanel } from "@/components/pipeline/SidequestDiagnosticsPanel";
import { useSidequestDiagnostics } from "@/hooks/useSidequestDiagnostics";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import { useToast } from "@/hooks/use-toast";

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
  content_entry_deleted: {
    label: "Entry Deleted",
    description:
      "A content entry or locale was removed from disk. The routing index, validation cache, and link index are being cleaned up.",
    icon: IconTrash,
    iconClass: "text-destructive border-destructive/40",
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
          const age = Date.now() - ev.created_at;
          return (
            <li
              key={ev.id}
              className="rounded-md border border-border bg-muted/30 px-2.5 py-2 space-y-0.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-sm min-w-0">
                  <EventHeadline event={ev} />
                </span>
                <span className="text-xs text-muted-foreground ml-auto shrink-0">{formatMs(age)} ago</span>
              </div>
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

function HealthStrip({ data, site }: { data: PipelineStatus; site?: string }) {
  const { roles, isDevelopment } = useDebugAuth();
  const { data: sqDiag } = useSidequestDiagnostics(site, !!site);
  const isStuck = sqDiag?.derivedHealth === "running_stuck";
  const engineNeedsHelp = data.engine.status === "stopped" || isStuck;
  const { toast } = useToast();
  const [openingDash, setOpeningDash] = useState(false);
  const activeCount = inFlightCount(data.inFlight);
  const pending = data.outbox.pending ?? [];
  const waitingCount = data.outbox.unpublishedCount;
  const lockCount = data.leases.length;
  const canOpenSidequest =
    Boolean(data.engine.dashboardUrl) &&
    (isDevelopment || roles.includes("webmaster"));

  const openSidequestDashboard = async () => {
    if (openingDash) return;
    // Open synchronously during the click (keeps a window handle). Never navigate
    // this tab — a null handle used to fall back to location.href and poison the SPA
    // with Sidequest / optional Basic-auth prompts for the whole origin.
    const w = window.open("about:blank", "sidequest_dashboard");
    if (!w) {
      toast({
        title: "Popup blocked",
        description: "Allow pop-ups for this site, then open Sidequest again.",
        variant: "destructive",
      });
      return;
    }
    try {
      w.document.write(
        "<!doctype html><title>Opening Sidequest…</title><p style=\"font:14px system-ui;padding:1rem\">Opening Sidequest…</p>",
      );
      w.document.close();
    } catch {
      // Cross-origin about:blank edge cases — still try location.replace below.
    }
    setOpeningDash(true);
    try {
      const res = await apiRequestWithAuth("POST", "/api/admin/sidequest/open");
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      const path = body.url || data.engine.dashboardUrl || "/admin/sidequest/";
      const absolute = new URL(path, window.location.origin).href;
      w.location.replace(absolute);
    } catch (err) {
      try {
        w.close();
      } catch {
        // ignore
      }
      toast({
        title: "Could not open Sidequest dashboard",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setOpeningDash(false);
    }
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="pipeline-health-kpis">
      <HealthKpiCard
        label="Agent engine"
        value={
          isStuck
            ? "Stuck?"
            : data.engine.status.charAt(0).toUpperCase() + data.engine.status.slice(1)
        }
        valueClassName={
          isStuck
            ? "text-amber-400"
            : engineStatusValueClass[data.engine.status]
        }
        icon={isStuck ? engineStatusIcon("restarting") : engineStatusIcon(data.engine.status)}
        subline={
          <div className="space-y-1">
            {canOpenSidequest ? (
              <button
                type="button"
                onClick={() => void openSidequestDashboard()}
                disabled={openingDash}
                className="inline-flex items-center gap-1 text-primary hover:underline disabled:opacity-50"
                data-testid="button-open-sidequest-dashboard"
              >
                {openingDash ? "Opening…" : "Sidequest dashboard"}
                <IconExternalLink className="h-3 w-3" />
              </button>
            ) : null}
            <p className={cn(activeCount > 0 ? "text-amber-400 font-medium" : undefined)}>
              {activeCount > 0 ? `${activeCount} active` : "Idle"}
            </p>
          </div>
        }
        detail={
          engineNeedsHelp
            ? {
                label: "Diagnostics & logs",
                testId: "button-sidequest-diagnostics",
                content: <SidequestDiagnosticsPanel site={site} />,
              }
            : activeCount > 0
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
            "Process health for the dedicated Sidequest worker (not the website process). Running means the worker is up. Stuck? means the PID is alive but the heartbeat file is stale — the event loop may be blocked. Stopped: locally start `npm run sidequest` in another terminal; in production use Diagnostics & logs → Check again or Restart Sidequest (webmaster). Prod restart uses a flag file + systemd path unit (docs/vps.md).",
          advanced:
            "Sidequest.js in server/jobs/sidequest-worker.ts; enqueue via server/jobs/queue.ts. Liveness: data/sidequest.pid + data/sidequest.heartbeat (SIDEQUEST_HEARTBEAT_STALE_MS, default 120s). APIs: GET /api/admin/sidequest/diagnostics, POST recheck/restart (webmaster), GET logs → data/logs/sidequest.log. Dashboard: POST /api/admin/sidequest/open, proxy /admin/sidequest.",
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

const NEW_EVENT_ANIM_MS = 1000;
/** Gap below the sticky timeline when syncing page scroll to a row. */
const STICKY_LIST_GAP_PX = 12;

type EventRowProps = {
  event: ContentEvent;
  isFailure: boolean;
  isExpanded: boolean;
  isNew: boolean;
  loadedEventIds: ReadonlySet<number>;
  reduceMotion: boolean;
  onToggleExpand: (eventId: number) => void;
  onNavigateToEvent: (eventId: number) => void;
  setRowRef: (id: number, el: HTMLLIElement | null) => void;
};

const EventRow = memo(function EventRow({
  event,
  isFailure,
  isExpanded,
  isNew,
  loadedEventIds,
  reduceMotion,
  onToggleExpand,
  onNavigateToEvent,
  setRowRef,
}: EventRowProps) {
  const headline = formatEventHeadline(event);
  const meta = eventMeta(event.type);
  const agentId = resolveAgentId(event.attribution);
  const iconClass = headline.muted
    ? "text-muted-foreground border-border"
    : agentId && !isFailure
      ? "border-border"
      : meta.iconClass;
  const Icon = isFailure ? IconAlertTriangle : meta.icon;
  const hasTypedDetails = eventHasTypedDetails(event);
  const validationEntry = eventValidationEntryRef(event);
  const agentReport = eventAgentReport(event);
  const agentLabel = agentId ? formatAgentLabel(agentId) : "Agent";

  const avatarClass = cn(
    "relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-card",
    isFailure ? "text-red-400 border-red-400/40" : iconClass,
  );

  const avatarInner = isFailure ? (
    <Icon className="h-4 w-4" />
  ) : agentId ? (
    <AgentIcon agentId={agentId} size="lg" />
  ) : (
    <Icon className="h-4 w-4" />
  );

  return (
    <motion.li
      initial={isNew ? { height: 0, opacity: 0, y: -14 } : false}
      animate={{ height: "auto", opacity: 1, y: 0 }}
      transition={
        reduceMotion
          ? { duration: 0.01 }
          : { type: "spring", stiffness: 420, damping: 26, mass: 0.7 }
      }
      style={{ overflow: "hidden" }}
      ref={(el) => setRowRef(event.id, el)}
      className={cn(
        "relative flex gap-4 pb-6 last:pb-0",
        !isNew && "event-row",
      )}
      data-testid={`event-row-${event.id}`}
    >
      {agentReport ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                avatarClass,
                "cursor-pointer hover:ring-2 hover:ring-ring/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
              aria-label={`View report from ${agentLabel}`}
              data-testid={`button-event-agent-report-${event.id}`}
            >
              {avatarInner}
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="right"
            align="start"
            sideOffset={10}
            className="w-80 border-0 bg-transparent p-0 shadow-none"
          >
            <div className="relative rounded-2xl rounded-tl-md border border-border bg-card px-3.5 py-3 shadow-md">
              <div className="absolute -left-1.5 top-3 h-3 w-3 rotate-45 border-l border-b border-border bg-card" />
              <div className="relative flex items-center gap-2 mb-1.5">
                {agentId ? <AgentIcon agentId={agentId} size="sm" /> : null}
                <p className="text-[11px] font-semibold text-muted-foreground">
                  {agentLabel}
                </p>
              </div>
              <p className="relative text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                {agentReport}
              </p>
            </div>
          </PopoverContent>
        </Popover>
      ) : (
        <span className={avatarClass}>{avatarInner}</span>
      )}
      <div className="flex-1 min-w-0 pt-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "text-sm font-semibold text-left hover:underline decoration-dotted underline-offset-2 cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-w-0",
                  isFailure && "text-red-400",
                )}
                aria-label={`What is ${headline.technicalLabel}?`}
              >
                <EventHeadline event={event} isFailure={isFailure} />
              </button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="start" className="w-80 p-3">
              <p className="text-xs font-medium text-foreground mb-1">{headline.technicalLabel}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {headline.muted
                  ? "Validation was not re-run because the same page was already queued or validated recently (1-hour dedupe). The save still succeeded."
                  : meta.description}
              </p>
            </PopoverContent>
          </Popover>
        </div>
        <EventCausalityLine
          event={event}
          loadedEventIds={loadedEventIds}
          onNavigateToEvent={onNavigateToEvent}
        />
        <EventSummary event={event} />
        {isExpanded && !validationEntry ? <EventDetails event={event} /> : null}
      </div>
      <div className="shrink-0 text-right pt-0.5">
        <p className="text-xs font-medium">{formatTs(event.created_at)}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {formatRelative(event.created_at)}
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
            onClick={() => onToggleExpand(event.id)}
          >
            {isExpanded ? "Hide" : hasTypedDetails ? "Details" : "Payload"}
          </button>
        )}
      </div>
    </motion.li>
  );
});

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
  const [seedingDemo, setSeedingDemo] = useState(false);
  /** Jump-to-latest / programmatic window only — pan does not round-trip through React. */
  const [rangeCommand, setRangeCommand] = useState<VisibleTimeRange | null>(null);
  const reduceMotion = useReducedMotion() ?? false;

  const listRef = useRef<HTMLDivElement | null>(null);
  const maxSeenIdRef = useRef<number | null>(null);
  const newIdsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleRangeRef = useRef<VisibleTimeRange | null>(null);
  const rowElsRef = useRef(new Map<number, HTMLLIElement>());
  const dimmedIdsRef = useRef(new Set<number>());
  const rafIdRef = useRef<number | null>(null);
  /** When true, timeline/poll sync may dim rows but must not move page scroll. */
  const listOwnsScrollRef = useRef(false);
  const programmaticScrollRef = useRef(false);
  const programmaticScrollClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filterScopedEventsRef = useRef<ContentEvent[]>([]);

  const stickyTimelineBottom = useCallback(() => {
    const timeline = document.querySelector<HTMLElement>('[data-testid="event-timeline"]');
    if (!timeline) return 0;
    return timeline.getBoundingClientRect().bottom;
  }, []);

  const scrollRowIntoViewBelowSticky = useCallback(
    (rowEl: HTMLElement, behavior: ScrollBehavior = "auto") => {
      const gap = stickyTimelineBottom() + STICKY_LIST_GAP_PX;
      const delta = rowEl.getBoundingClientRect().top - gap;
      if (Math.abs(delta) < 2) return;
      programmaticScrollRef.current = true;
      if (programmaticScrollClearRef.current) clearTimeout(programmaticScrollClearRef.current);
      window.scrollBy({ top: delta, behavior });
      programmaticScrollClearRef.current = setTimeout(
        () => {
          programmaticScrollRef.current = false;
          programmaticScrollClearRef.current = null;
        },
        behavior === "smooth" ? 450 : 50,
      );
    },
    [stickyTimelineBottom],
  );

  const syncListToRange = useCallback(() => {
    rafIdRef.current = null;
    const range = visibleRangeRef.current;
    if (!range) return;

    const scoped = filterScopedEventsRef.current;
    const nextDimmed = new Set<number>();
    for (const ev of scoped) {
      const inWindow = ev.created_at >= range.start && ev.created_at <= range.end;
      if (!inWindow) nextDimmed.add(ev.id);
    }

    const prevDimmed = dimmedIdsRef.current;
    for (const id of prevDimmed) {
      if (!nextDimmed.has(id)) {
        rowElsRef.current.get(id)?.classList.remove("event-row-dim");
      }
    }
    for (const id of nextDimmed) {
      if (!prevDimmed.has(id)) {
        rowElsRef.current.get(id)?.classList.add("event-row-dim");
      }
    }
    dimmedIdsRef.current = nextDimmed;

    // User is browsing the list — keep dimming in sync, but do not yank page scroll.
    if (listOwnsScrollRef.current) return;

    // Newest-first list: first event at or before the window's right edge.
    let anchor: ContentEvent | undefined;
    for (const ev of scoped) {
      if (ev.created_at <= range.end) {
        anchor = ev;
        break;
      }
    }
    if (!anchor) return;
    const rowEl = rowElsRef.current.get(anchor.id);
    if (!rowEl) return;
    scrollRowIntoViewBelowSticky(rowEl);
  }, [scrollRowIntoViewBelowSticky]);

  const scheduleSync = useCallback(() => {
    if (rafIdRef.current != null) return;
    rafIdRef.current = requestAnimationFrame(syncListToRange);
  }, [syncListToRange]);

  const handleRangeChange = useCallback(
    (range: VisibleTimeRange) => {
      visibleRangeRef.current = range;
      scheduleSync();
    },
    [scheduleSync],
  );

  const setRowRef = useCallback((id: number, el: HTMLLIElement | null) => {
    if (el) rowElsRef.current.set(id, el);
    else rowElsRef.current.delete(id);
  }, []);

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
          newIdsTimerRef.current = setTimeout(() => setNewIds(new Set()), NEW_EVENT_ANIM_MS);
        }
      }
      if (incoming.length > 0) {
        maxSeenIdRef.current = Math.max(prevMax ?? 0, ...incoming.map((ev) => ev.id));
      }
      // Reuse prior object identity for unchanged ids so memoized rows skip re-render.
      setEvents((prev) => {
        if (prev.length === 0) return incoming;
        const prevById = new Map(prev.map((e) => [e.id, e]));
        return incoming.map((ev) => prevById.get(ev.id) ?? ev);
      });
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
      dimmedIdsRef.current = new Set();
      setClearLogOpen(false);
    } finally {
      setClearing(false);
    }
  }, [site]);

  /** Dev-only: historical burst, then a few live drips so pop-in can be exercised. */
  const seedDemoEvents = useCallback(async () => {
    if (!import.meta.env.DEV) return;
    setSeedingDemo(true);
    try {
      const batchRes = await apiFetch("/api/admin/events/seed-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site, mode: "batch" }),
      });
      if (!batchRes.ok) return;
      await loadEvents();
      setRangeCommand(jumpToLatestRange());

      for (let tick = 0; tick < 3; tick++) {
        await new Promise((r) => setTimeout(r, 900));
        const liveRes = await apiFetch("/api/admin/events/seed-demo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ site, mode: "live", tick }),
        });
        if (!liveRes.ok) break;
        await loadEvents();
      }
    } finally {
      setSeedingDemo(false);
    }
  }, [site, loadEvents]);

  useEffect(() => {
    return () => {
      if (newIdsTimerRef.current) clearTimeout(newIdsTimerRef.current);
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current);
      if (programmaticScrollClearRef.current) clearTimeout(programmaticScrollClearRef.current);
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

  // List / page scroll takes ownership until the user scrubs the timeline or jumps to latest.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const markOwns = () => {
      listOwnsScrollRef.current = true;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!el.contains(e.target as Node)) return;
      if (
        e.key === "ArrowDown" ||
        e.key === "ArrowUp" ||
        e.key === "PageDown" ||
        e.key === "PageUp" ||
        e.key === "Home" ||
        e.key === "End" ||
        e.key === " "
      ) {
        markOwns();
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      if (el.contains(e.target as Node)) markOwns();
    };
    const onScroll = () => {
      if (programmaticScrollRef.current) return;
      markOwns();
    };
    el.addEventListener("pointerdown", markOwns);
    el.addEventListener("touchstart", markOwns, { passive: true });
    el.addEventListener("keydown", onKeyDown);
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("pointerdown", markOwns);
      el.removeEventListener("touchstart", markOwns);
      el.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("scroll", onScroll);
    };
  }, [loading, events.length]);

  const releaseListScrollOwnership = useCallback(() => {
    listOwnsScrollRef.current = false;
  }, []);

  /** Type filter is server-side; agent filter applies to timeline + list. */
  const filterScopedEvents = useMemo(() => {
    if (!agentFilter) return events;
    return events.filter((e) => {
      const agentId = resolveAgentId(e.attribution);
      if (agentFilter === AGENT_FILTER_OTHER) return agentId == null;
      return agentId === agentFilter;
    });
  }, [events, agentFilter]);

  filterScopedEventsRef.current = filterScopedEvents;

  // Re-apply dim/scroll when the filtered set changes (agent filter, new poll).
  useEffect(() => {
    scheduleSync();
  }, [filterScopedEvents, scheduleSync]);

  const loadedEventIds = useMemo(() => new Set(events.map((e) => e.id)), [events]);

  const failureIds = useMemo(() => new Set(failures.map((f) => f.id)), [failures]);

  const scrollToEvent = useCallback(
    (eventId: number) => {
      const el = rowElsRef.current.get(eventId) ??
        document.querySelector(`[data-testid="event-row-${eventId}"]`);
      if (!(el instanceof HTMLElement)) return;
      // Chip jump is intentional list navigation — keep ownership so live sync
      // does not yank the row away after scroll settles.
      listOwnsScrollRef.current = true;
      scrollRowIntoViewBelowSticky(el, "smooth");
    },
    [scrollRowIntoViewBelowSticky],
  );

  const onToggleExpand = useCallback((eventId: number) => {
    setExpanded((prev) => (prev === eventId ? null : eventId));
  }, []);

  const getActivityLabel = useCallback((event: ContentEvent) => formatEventHeadlinePlain(event), []);

  const activeFilterCount = (typeFilter ? 1 : 0) + (agentFilter ? 1 : 0);

  /** Outline buttons tuned for the dark help bar; labels hide on small screens. */
  const darkBarBtn =
    "border-background/35 bg-transparent text-background hover:bg-background/10 hover:text-background";

  const filtersToolbar = (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn("relative", darkBarBtn)}
            aria-label="Filters"
            data-testid="button-event-filters"
          >
            <IconFilter className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Filters</span>
            {activeFilterCount > 0 ? (
              <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                {activeFilterCount}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="end" className="w-72 space-y-3 p-3">
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
        className={darkBarBtn}
        disabled={clearing || (events.length === 0 && !loading)}
        onClick={() => setClearLogOpen(true)}
        aria-label="Clear log"
        data-testid="button-clear-event-log"
      >
        {clearing ? (
          <IconLoader2 className="h-4 w-4 animate-spin sm:mr-2" />
        ) : (
          <IconTrash className="h-4 w-4 sm:mr-2" />
        )}
        <span className="hidden sm:inline">Clear log</span>
      </Button>
      {import.meta.env.DEV ? (
        <Button
          variant="outline"
          size="sm"
          className={darkBarBtn}
          disabled={seedingDemo || clearing}
          onClick={() => void seedDemoEvents()}
          aria-label={seedingDemo ? "Seeding demo events" : "Seed demo"}
          data-testid="button-seed-demo-events"
          title="Dev only: inject fake timeline events, then drip three live ones for pop-in"
        >
          {seedingDemo ? (
            <IconLoader2 className="h-4 w-4 animate-spin sm:mr-2" />
          ) : (
            <IconFlask className="h-4 w-4 sm:mr-2" />
          )}
          <span className="hidden sm:inline">{seedingDemo ? "Seeding…" : "Seed demo"}</span>
        </Button>
      ) : null}
    </>
  );

  return (
    <section className="space-y-4">
      {events.length > 0 ? (
        <EventTimeline
          events={filterScopedEvents}
          getActivityLabel={getActivityLabel}
          visibleRange={rangeCommand}
          onRangeChange={handleRangeChange}
          onSelect={scrollToEvent}
          onUserInteract={releaseListScrollOwnership}
          onJumpToLatest={() => {
            releaseListScrollOwnership();
            setRangeCommand(jumpToLatestRange());
            scheduleSync();
          }}
          toolbar={filtersToolbar}
        />
      ) : (
        <div className="sticky top-0 z-30 w-full bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
          <div className="flex flex-wrap items-center justify-end gap-2 px-6 py-2 bg-foreground text-background">
            {filtersToolbar}
          </div>
        </div>
      )}

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
            ref={listRef}
            className="event-list-scroll relative overflow-x-hidden pr-1"
            data-testid="event-list-scroll"
          >
            <div className="relative">
              <span
                className="absolute left-[17px] top-4 bottom-4 w-px bg-border"
                aria-hidden
              />
              <ol className="space-y-0">
                <AnimatePresence initial={false}>
                  {filterScopedEvents.map((e) => (
                    <EventRow
                      key={e.id}
                      event={e}
                      isFailure={e.type === "job_failed" || failureIds.has(e.id)}
                      isExpanded={expanded === e.id}
                      isNew={newIds.has(e.id)}
                      loadedEventIds={loadedEventIds}
                      reduceMotion={reduceMotion}
                      onToggleExpand={onToggleExpand}
                      onNavigateToEvent={scrollToEvent}
                      setRowRef={setRowRef}
                    />
                  ))}
                </AnimatePresence>
              </ol>
            </div>
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
          <HealthStrip data={data} site={site} />
        )}
      </div>

      {!isLoading && data && site ? (
        <EventLogPanel site={site} failures={data.recentFailures} />
      ) : null}
    </div>
  );
}
