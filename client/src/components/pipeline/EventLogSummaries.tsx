import { useQuery } from "@tanstack/react-query";
import {
  IconExternalLink,
  IconFileText,
  IconHash,
  IconLoader2,
  IconRoute,
} from "@tabler/icons-react";
import { useMemo, type ReactNode } from "react";
import { Link } from "wouter";
import JsonViewer from "@/components/editing/JsonViewer";
import { LocaleFlag } from "@/components/DebugBubble/components/LocaleFlag";
import { Badge } from "@/components/ui/badge";
import { useContentTypes } from "@/hooks/useContentTypes";
import { formatIssueActorLine, formatAttributionEntry, formatAttributionSummary, formatCausalityLabel, type EventAttributionEntry } from "@/lib/formatIssueActor";
import { entryPartsToPageUrl } from "@/lib/entryKeyToPageUrl";
import { parseEntryKey } from "@/lib/parseEntryKey";
import { apiFetch } from "@/lib/queryClient";
import { staff404DashboardHref } from "@/lib/staff404";
import { cn } from "@/lib/utils";
import { formatAgentLabel, resolveAgentId } from "./agentIcons";

export type PipelineContentEvent = {
  id: number;
  type: string;
  attribution: EventAttributionEntry[];
  cause?: string;
  resource: Record<string, unknown>;
  payload: Record<string, unknown>;
  triggeredByEventId?: number;
  triggeredByEventIds?: number[];
  agent_session_id?: string;
  published: boolean;
  created_at: number;
};

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

function strField(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

function numField(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  return typeof v === "number" ? v : undefined;
}

function stringArrayField(obj: Record<string, unknown>, key: string): string[] {
  const v = obj[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function entryFromResourceOrPayload(
  resource: Record<string, unknown>,
  payload: Record<string, unknown>,
): ReturnType<typeof parseEntryKey> {
  const entryKey = strField(payload, "entryKey");
  if (entryKey) return parseEntryKey(entryKey);
  const contentType = strField(resource, "contentType");
  const slug = strField(resource, "slug");
  const locale = strField(resource, "locale");
  if (contentType && slug && locale) {
    return { contentType, slug, locale };
  }
  return null;
}

export function formatBulkSyncPreview(count: number, files: string[]): string {
  if (files.length === 0) return `${count} file${count === 1 ? "" : "s"}`;
  const first = files[0]!;
  const rest = count > 1 ? ` (+${count - 1} more)` : "";
  return `${first}${rest}`;
}

export function formatBindingDoneOutcome(updatedCount: number, errorCount: number): string {
  const parts: string[] = [];
  parts.push(`Updated ${updatedCount} page${updatedCount === 1 ? "" : "s"}`);
  if (errorCount > 0) {
    parts.push(`${errorCount} error${errorCount === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

const TYPED_DETAIL_TYPES = new Set([
  "site_bulk_synced",
  "content_bulk_synced",
  "binding_propagation_done",
  "validation_issue_claimed",
  "validation_issue_completed",
  "validation_issue_reopened",
  "validation_issue_released",
  "validation_results_ready",
]);

/** Prefer icon-matched agent label (e.g. "Grok") over author · via client (model). */
function formatAttributionDisplay(entry: EventAttributionEntry): string {
  const agentId = resolveAgentId([entry]);
  if (agentId) return formatAgentLabel(agentId);
  return formatAttributionEntry(entry);
}

export function EventAttributionBadge({
  attribution,
}: {
  attribution: EventAttributionEntry[];
}) {
  const { primary, extraCount } = formatAttributionSummary(attribution);
  if (!primary) return null;
  const label = formatAttributionDisplay(attribution[0]!);
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
      {label}
      {extraCount > 0 ? (
        <Badge variant="secondary" className="text-[10px] font-normal px-1.5 py-0">
          +{extraCount} more
        </Badge>
      ) : null}
    </span>
  );
}

export function EventAttributionDetails({
  attribution,
}: {
  attribution: EventAttributionEntry[];
}) {
  if (attribution.length <= 1) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-foreground">Attribution</p>
      <ul className="space-y-0.5 text-xs text-muted-foreground">
        {attribution.map((entry, idx) => (
          <li key={idx}>{formatAttributionDisplay(entry)}</li>
        ))}
      </ul>
    </div>
  );
}

export function EventCausalityLine({
  event,
  loadedEventIds,
  onNavigateToEvent,
}: {
  event: PipelineContentEvent;
  loadedEventIds: Set<number>;
  onNavigateToEvent?: (eventId: number) => void;
}) {
  const label = formatCausalityLabel(event, loadedEventIds);
  if (!label) return null;

  const singleId =
    event.triggeredByEventIds?.length === 1
      ? event.triggeredByEventIds[0]
      : event.triggeredByEventId;

  const canLink = singleId != null && loadedEventIds.has(singleId) && onNavigateToEvent;

  return (
    <p className="text-xs text-muted-foreground mt-0.5">
      {canLink ? (
        <button
          type="button"
          className="text-primary hover:underline"
          onClick={() => onNavigateToEvent(singleId)}
        >
          {label}
        </button>
      ) : (
        label
      )}
    </p>
  );
}

export function eventHasTypedDetails(event: PipelineContentEvent): boolean {
  if (!TYPED_DETAIL_TYPES.has(event.type)) return false;
  if (event.type === "validation_results_ready") {
    return typeof event.payload.entryKey === "string";
  }
  return true;
}

/** Agent write-up from claim/complete (MCP `report`), if present. */
export function eventAgentReport(event: PipelineContentEvent): string | null {
  const report = strField(event.payload, "report");
  if (!report) return null;
  const trimmed = report.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function eventValidationEntryRef(
  event: PipelineContentEvent,
): { entryKey: string; pageUrl?: string } | null {
  const entryKey = strField(event.payload, "entryKey");
  if (!entryKey) return null;

  if (event.type === "validation_results_ready") {
    const parsed = parseValidationPayload(event.payload);
    if (parsed.skipped) return null;
    return { entryKey };
  }

  if (
    event.type === "validation_issue_claimed" ||
    event.type === "validation_issue_completed" ||
    event.type === "validation_issue_reopened" ||
    event.type === "validation_issue_released"
  ) {
    return { entryKey, pageUrl: strField(event.payload, "url") };
  }

  return null;
}

export function EntryKeyBadges({
  slug,
  contentType,
  locale,
  variant,
  groupId,
  inline,
  className,
}: {
  slug?: string | null;
  contentType?: string | null;
  locale?: string | null;
  variant?: string | null;
  groupId?: string | null;
  /** Inline layout for embedding in sentence headlines (default: block row). */
  inline?: boolean;
  className?: string;
}) {
  const contentTypes = useContentTypes();
  const entryPageUrl = useMemo(() => {
    if (!slug || !contentType || !locale) return null;
    return entryPartsToPageUrl({ contentType, slug, locale, variant }, contentTypes);
  }, [slug, contentType, locale, variant, contentTypes]);

  if (!slug && !contentType && !locale && !variant && !groupId) return null;
  const Wrapper = inline ? "span" : "div";
  return (
    <Wrapper
      className={cn(
        inline ? "inline-flex flex-wrap items-center gap-1 align-middle" : "flex flex-wrap items-center gap-1.5",
        className,
      )}
    >
      {slug ? (
        entryPageUrl ? (
          <a
            href={entryPageUrl}
            className="inline-flex min-w-0 max-w-full"
            title={`Open ${slug}`}
            data-testid={`link-entry-page-${slug}`}
          >
            <Badge
              variant="outline"
              className="text-xs gap-1 font-normal cursor-pointer hover:text-primary max-w-full"
            >
              <IconHash className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{slug}</span>
            </Badge>
          </a>
        ) : (
          <Badge variant="outline" className="text-xs gap-1 font-normal max-w-full">
            <IconHash className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{slug}</span>
          </Badge>
        )
      ) : groupId ? (
        <Badge variant="outline" className="text-xs gap-1 font-normal">
          <IconHash className="h-3 w-3 shrink-0" aria-hidden />
          {groupId}
        </Badge>
      ) : null}
      {contentType ? (
        <Link
          href={staff404DashboardHref(contentType)}
          className="inline-flex"
          title={`Open ${contentType} dashboard`}
          data-testid={`link-content-type-dashboard-${contentType}`}
        >
          <Badge
            variant="outline"
            className="text-xs gap-1 font-normal cursor-pointer hover:text-primary"
          >
            <IconFileText className="h-3 w-3 shrink-0" aria-hidden />
            {contentType}
          </Badge>
        </Link>
      ) : null}
      {variant ? (
        <Badge variant="secondary" className="text-xs font-normal">
          {variant}
        </Badge>
      ) : null}
      {locale ? (
        <span title={locale} className="inline-flex shrink-0" aria-label={locale}>
          <LocaleFlag locale={locale} className="w-3.5 h-2.5 rounded-sm" />
        </span>
      ) : null}
    </Wrapper>
  );
}

function EventPathRow({ path }: { path: string }) {
  return <p className="text-xs text-muted-foreground font-mono truncate">{path}</p>;
}

function SeverityBadge({ severity }: { severity: string }) {
  const variant =
    severity === "error" ? "destructive" : severity === "warning" ? "outline" : "secondary";
  return (
    <Badge variant={variant} className="text-[10px] font-normal">
      {severity}
    </Badge>
  );
}

function ExternalLinkRow({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
    >
      {label}
      <IconExternalLink className="h-3 w-3" />
    </a>
  );
}

function summarizeResourceFallback(resource: Record<string, unknown>): string {
  return Object.values(resource ?? {})
    .filter((v): v is string | number => typeof v === "string" || typeof v === "number")
    .map(String)
    .join(" · ");
}

function EventContentPathSummary({
  resource,
  payload,
  linkRedirects,
}: {
  resource: Record<string, unknown>;
  payload: Record<string, unknown>;
  linkRedirects?: boolean;
}) {
  const path =
    strField(resource, "path") ?? strField(payload, "path") ?? null;

  if (!path && !linkRedirects) return null;

  return (
    <div className="mt-0.5 space-y-0.5">
      {path ? <EventPathRow path={path} /> : null}
      {linkRedirects ? (
        <ExternalLinkRow href="/private/redirects" label="View redirects" />
      ) : null}
    </div>
  );
}

type ValidationEventPayload = {
  entryKey?: string;
  skipped?: boolean;
  reason?: string;
  summary?: {
    total?: number;
    passed?: number;
    failed?: number;
    warnings?: number;
    duration?: number;
  };
};

function parseValidationPayload(payload: Record<string, unknown>): ValidationEventPayload {
  const summaryRaw = payload.summary;
  const summary =
    summaryRaw && typeof summaryRaw === "object" && !Array.isArray(summaryRaw)
      ? (summaryRaw as ValidationEventPayload["summary"])
      : undefined;
  return {
    entryKey: strField(payload, "entryKey"),
    skipped: payload.skipped === true,
    reason: strField(payload, "reason"),
    summary,
  };
}

function validationSkipLabel(reason: string | undefined): string {
  switch (reason) {
    case "no_matching_files":
      return "no content files matched this entry";
    case "no_validation_context":
      return "validation context could not be built";
    case "deduped_within_hour":
      return "same page already queued or validated in the last hour";
    default:
      return reason ?? "validation did not run";
  }
}

/** Exported for unit tests. */
export function formatValidationSkipReason(reason: string | undefined): string {
  return validationSkipLabel(reason);
}

function validationOutcomeLine(payload: ValidationEventPayload): ReactNode {
  if (payload.skipped) {
    return (
      <p className="text-xs text-muted-foreground">
        Skipped — {validationSkipLabel(payload.reason)}
      </p>
    );
  }
  const s = payload.summary;
  if (s) {
    const parts: string[] = [];
    if (s.failed) parts.push(`${s.failed} error${s.failed === 1 ? "" : "s"}`);
    if (s.warnings) parts.push(`${s.warnings} warning${s.warnings === 1 ? "" : "s"}`);
    if (!s.failed && !s.warnings) parts.push("All validators passed");
    const duration = typeof s.duration === "number" ? formatMs(s.duration) : null;
    return (
      <p className="text-xs text-muted-foreground">
        {parts.join(" · ")}
        {duration ? ` · ${duration}` : ""}
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">Results applied to the Diagnostics cache.</p>
  );
}

function EventValidationSummary({ payload }: { payload: Record<string, unknown> }) {
  const parsed = parseValidationPayload(payload);
  const entry = parsed.entryKey ? parseEntryKey(parsed.entryKey) : null;

  return (
    <div className="mt-0.5 space-y-1">
      {!entry && parsed.entryKey ? <EventPathRow path={parsed.entryKey} /> : null}
      {validationOutcomeLine(parsed)}
    </div>
  );
}

function EventBulkSyncSummary({ payload }: { payload: Record<string, unknown> }) {
  const files = stringArrayField(payload, "files");
  const count = numField(payload, "count") ?? files.length;

  return (
    <div className="mt-0.5 space-y-0.5">
      <Badge variant="outline" className="text-xs font-normal">
        {count} file{count === 1 ? "" : "s"}
      </Badge>
      <p className="text-xs text-muted-foreground">GitHub pull or bulk content sync</p>
      {files.length > 0 ? (
        <p className="text-xs text-muted-foreground font-mono truncate">
          {formatBulkSyncPreview(count, files)}
        </p>
      ) : null}
    </div>
  );
}

function EventIndexSnapshotSummary({ payload }: { payload: Record<string, unknown> }) {
  const generation = numField(payload, "generation");
  const entryCount = numField(payload, "entryCount");

  return (
    <div className="mt-0.5 space-y-0.5">
      {generation != null ? (
        <Badge variant="outline" className="text-xs font-mono font-normal">
          gen {generation}
        </Badge>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Index snapshot written
        {entryCount != null ? ` · ${entryCount} entries indexed` : ""}
        {" — applied by job applier when caught up"}
      </p>
    </div>
  );
}

function EventValidationIssueSummary({
  type,
  resource,
  payload,
}: {
  type: string;
  resource: Record<string, unknown>;
  payload: Record<string, unknown>;
}) {
  const code = strField(payload, "code");
  const severity = strField(payload, "severity");
  const validator = strField(payload, "validator");
  const priorCompletedBy = strField(payload, "priorCompletedBy");

  let outcome: ReactNode = null;
  if (type === "validation_issue_completed") {
    outcome = <p className="text-xs text-emerald-400/90">Resolved</p>;
  } else if (type === "validation_issue_reopened" && priorCompletedBy) {
    outcome = (
      <p className="text-xs text-amber-400/90">
        Reopened — was completed by {priorCompletedBy}
      </p>
    );
  } else if (type === "validation_issue_claimed") {
    outcome = <p className="text-xs text-muted-foreground">In progress</p>;
  } else if (type === "validation_issue_released") {
    const reason = strField(payload, "reason");
    outcome = (
      <p className="text-xs text-amber-400/90">
        {reason === "ttl_expired" ? "Claim expired (30m)" : "Claim released"}
      </p>
    );
  }

  return (
    <div className="mt-0.5 space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {severity ? <SeverityBadge severity={severity} /> : null}
        {code ? (
          <span className="font-mono text-[10px] text-muted-foreground">{code}</span>
        ) : null}
        {validator ? (
          <span className="text-[10px] text-muted-foreground">{validator}</span>
        ) : null}
      </div>
      {outcome}
    </div>
  );
}

function EventEntryDeletedSummary({
  payload,
}: {
  resource: Record<string, unknown>;
  payload: Record<string, unknown>;
}) {
  const entryKeys = stringArrayField(payload, "entryKeys");
  const folderRemoved = payload.folderRemoved === true;

  return (
    <div className="mt-0.5 space-y-1">
      <p className="text-xs text-muted-foreground">
        {folderRemoved ? "Full entry folder removed" : "Locale file(s) removed"}
        {entryKeys.length > 0 ? ` · ${entryKeys.length} key(s)` : ""}
      </p>
    </div>
  );
}

function EventBindingStartedSummary({
  resource,
  payload,
}: {
  resource: Record<string, unknown>;
  payload: Record<string, unknown>;
}) {
  const locale = strField(resource, "locale") ?? strField(payload, "locale");
  const sourceContentType = strField(payload, "sourceContentType");
  const sourceSlug = strField(payload, "sourceSlug");
  const sectionIndex = numField(payload, "sectionIndex");
  const holder = strField(payload, "holder");

  return (
    <div className="mt-0.5 space-y-1">
      {sourceContentType && sourceSlug ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">from</span>
          <EntryKeyBadges slug={sourceSlug} contentType={sourceContentType} locale={locale} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {sectionIndex != null ? (
          <Badge variant="secondary" className="text-[10px] font-normal">
            section #{sectionIndex}
          </Badge>
        ) : null}
        {holder ? <span className="font-mono truncate">holder: {holder}</span> : null}
      </div>
    </div>
  );
}

function EventBindingDoneSummary({
  payload,
}: {
  resource: Record<string, unknown>;
  payload: Record<string, unknown>;
}) {
  const updatedFiles = stringArrayField(payload, "updatedFiles");
  const errors = stringArrayField(payload, "errors");

  return (
    <div className="mt-0.5 space-y-0.5">
      <p
        className={`text-xs ${errors.length > 0 ? "text-red-400/90" : "text-muted-foreground"}`}
      >
        {formatBindingDoneOutcome(updatedFiles.length, errors.length)}
      </p>
    </div>
  );
}

function EventJobFailedSummary({
  resource,
  payload,
}: {
  resource: Record<string, unknown>;
  payload: Record<string, unknown>;
}) {
  const jobType = strField(payload, "jobType") ?? strField(payload, "class");
  const error =
    strField(payload, "error") ??
    strField(payload, "message") ??
    (typeof payload.errors === "string" ? payload.errors : undefined);

  return (
    <div className="mt-0.5 space-y-0.5">
      {jobType ? (
        <Badge variant="destructive" className="text-xs font-normal">
          {jobType}
        </Badge>
      ) : null}
      {error ? (
        <p className="text-xs text-red-400/90 line-clamp-2">{error}</p>
      ) : (
        <p className="text-xs text-muted-foreground">Background job failed — see payload</p>
      )}
      {Object.keys(resource).length > 0 ? (
        <EventContentPathSummary resource={resource} payload={{}} />
      ) : null}
    </div>
  );
}

export function EventSummary({ event }: { event: PipelineContentEvent }) {
  switch (event.type) {
    case "entry_locale_saved":
    case "entry_common_saved":
    case "entry_seo_changed":
    case "entry_redirects_changed":
    case "site_redirects_changed":
    case "registry_file_saved":
    case "content_file_written":
      return <EventContentPathSummary resource={event.resource} payload={event.payload} />;
    case "entry_deleted":
    case "content_entry_deleted":
      return <EventEntryDeletedSummary resource={event.resource} payload={event.payload} />;
    case "redirects_changed":
      return (
        <EventContentPathSummary
          resource={event.resource}
          payload={event.payload}
          linkRedirects
        />
      );
    case "validation_results_ready":
      return <EventValidationSummary payload={event.payload} />;
    case "site_bulk_synced":
    case "content_bulk_synced":
      return <EventBulkSyncSummary payload={event.payload} />;
    case "index_snapshot_ready":
      return <EventIndexSnapshotSummary payload={event.payload} />;
    case "seo_index_ready":
      return (
        <p className="text-xs text-muted-foreground mt-0.5">
          {typeof event.payload?.mode === "string" ? `mode: ${event.payload.mode}` : "Cluster index ready"}
        </p>
      );
    case "validation_issue_claimed":
    case "validation_issue_completed":
    case "validation_issue_reopened":
    case "validation_issue_released":
      return (
        <EventValidationIssueSummary
          type={event.type}
          resource={event.resource}
          payload={event.payload}
        />
      );
    case "binding_propagation_started":
      return (
        <EventBindingStartedSummary resource={event.resource} payload={event.payload} />
      );
    case "binding_propagation_done":
      return <EventBindingDoneSummary resource={event.resource} payload={event.payload} />;
    case "job_failed":
      return <EventJobFailedSummary resource={event.resource} payload={event.payload} />;
    case "ai_image_gc_completed": {
      const imageId =
        typeof event.payload?.imageId === "string" ? event.payload.imageId : null;
      const src = typeof event.payload?.src === "string" ? event.payload.src : null;
      return (
        <div className="text-xs text-muted-foreground mt-0.5 space-y-0.5">
          {imageId ? <p className="truncate font-mono">id: {imageId}</p> : null}
          {src ? <p className="truncate font-mono">{src}</p> : null}
        </div>
      );
    }
    case "agent_session_started": {
      const label = typeof event.payload?.label === "string" ? event.payload.label.trim() : "";
      return label ? (
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{label}</p>
      ) : null;
    }
    case "agent_session_note":
    case "agent_session_summarized": {
      const report = eventAgentReport(event);
      if (!report) return null;
      return (
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 whitespace-pre-wrap">
          {report}
        </p>
      );
    }
    default: {
      const fallback = summarizeResourceFallback(event.resource);
      if (!fallback) return null;
      return <p className="text-xs text-muted-foreground mt-0.5 truncate">{fallback}</p>;
    }
  }
}

type CacheIssueRow = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  validator?: string;
};

function ValidationResultsDetails({
  entryKey,
  skipped,
}: {
  entryKey: string;
  skipped: boolean;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["/api/validation/cache-issues", "entryKey", entryKey],
    queryFn: async () => {
      const res = await apiFetch(
        `/api/validation/cache-issues?entryKey=${encodeURIComponent(entryKey)}`,
      );
      if (!res.ok) throw new Error("Failed to load validation issues");
      return (await res.json()) as { issues: CacheIssueRow[] };
    },
    enabled: !skipped && !!entryKey,
    staleTime: 30_000,
  });

  if (skipped) {
    return (
      <p className="text-xs text-muted-foreground leading-relaxed">
        No validators ran for this entry. The content folder may have been deleted or did not
        match the entry key when the job ran.
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
        Loading issues…
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-xs text-muted-foreground">Could not load issues from Diagnostics cache.</p>
    );
  }

  const issues = data?.issues ?? [];
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const preview = issues.slice(0, 5);

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {errors.length} error{errors.length === 1 ? "" : "s"}
        {" · "}
        {warnings.length} warning{warnings.length === 1 ? "" : "s"}
        {issues.length > preview.length
          ? ` · showing ${preview.length} of ${issues.length}`
          : ""}
      </p>
      {preview.length === 0 ? (
        <p className="text-xs text-emerald-400/90">No open issues for this entry.</p>
      ) : (
        <ul className="space-y-1.5">
          {preview.map((issue, idx) => (
            <li
              key={`${issue.code}-${idx}`}
              className="rounded-md border border-border bg-muted/30 px-2 py-1.5 text-xs"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <SeverityBadge severity={issue.severity} />
                <span className="font-mono text-[10px] text-muted-foreground">{issue.code}</span>
                {issue.validator ? (
                  <span className="text-[10px] text-muted-foreground">{issue.validator}</span>
                ) : null}
              </div>
              <p className="mt-0.5 text-foreground/90 line-clamp-2">{issue.message}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BulkSyncDetails({ payload }: { payload: Record<string, unknown> }) {
  const files = stringArrayField(payload, "files");
  const preview = files.slice(0, 20);
  const remaining = files.length - preview.length;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {files.length} synced path{files.length === 1 ? "" : "s"}
      </p>
      {preview.length > 0 ? (
        <ul className="max-h-40 overflow-y-auto space-y-0.5 text-xs font-mono text-muted-foreground">
          {preview.map((f) => (
            <li key={f} className="truncate">
              {f}
            </li>
          ))}
        </ul>
      ) : null}
      {remaining > 0 ? (
        <p className="text-xs text-muted-foreground">and {remaining} more</p>
      ) : null}
    </div>
  );
}

function BindingDoneDetails({ payload }: { payload: Record<string, unknown> }) {
  const updatedFiles = stringArrayField(payload, "updatedFiles");
  const errors = stringArrayField(payload, "errors");

  return (
    <div className="space-y-2">
      {updatedFiles.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-foreground mb-1">Updated pages</p>
          <ul className="max-h-32 overflow-y-auto space-y-0.5 text-xs font-mono text-muted-foreground">
            {updatedFiles.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No sibling pages updated.</p>
      )}
      {errors.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-red-400 mb-1">Errors</p>
          <ul className="space-y-1 text-xs text-red-400/90">
            {errors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ValidationIssueDetails({
  event,
}: {
  event: PipelineContentEvent;
}) {
  const { payload, attribution } = event;
  const entryKey = strField(payload, "entryKey");
  const actor = payload.actor as EventAttributionEntry["actor"] | null | undefined;
  const primaryAuthor = attribution[0]?.author;
  const fields: Array<{ label: string; value: string | undefined }> = [
    { label: "Code", value: strField(payload, "code") },
    { label: "Validator", value: strField(payload, "validator") },
    { label: "Category", value: strField(payload, "category") },
    { label: "Severity", value: strField(payload, "severity") },
    { label: "Entry key", value: entryKey },
    { label: "URL", value: strField(payload, "url") },
    { label: "File", value: strField(payload, "file") },
    { label: "Issue ID", value: strField(payload, "issueId") },
  ];

  if (primaryAuthor) {
    fields.push({
      label: "Actor",
      value: formatIssueActorLine(primaryAuthor, actor ?? attribution[0]?.actor),
    });
  }

  if (event.type === "validation_issue_reopened") {
    fields.push({
      label: "Prior completed by",
      value: strField(payload, "priorCompletedBy"),
    });
  }

  if (event.type === "validation_issue_released") {
    fields.push({ label: "Reason", value: strField(payload, "reason") });
    fields.push({ label: "Claimed by", value: strField(payload, "claimedBy") });
    fields.push({ label: "Claimed at", value: strField(payload, "claimedAt") });
    fields.push({ label: "Claim report", value: strField(payload, "claimReport") });
  }

  const report = strField(payload, "report");
  if (report) {
    fields.push({ label: "Report", value: report });
  }

  return (
    <div className="space-y-2">
      <dl className="grid gap-1.5 text-xs">
        {fields
          .filter((f) => f.value)
          .map((f) => (
            <div key={f.label} className="grid grid-cols-[7rem_1fr] gap-2">
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd className="font-mono text-[11px] break-all">{f.value}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}

function RawPayloadSection({ event }: { event: PipelineContentEvent }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        Raw payload
      </summary>
      <div className="mt-2 overflow-hidden rounded-md max-h-32">
        <JsonViewer
          value={JSON.stringify(
            {
              resource: event.resource,
              payload: event.payload,
              cause: event.cause,
              attribution: event.attribution,
              triggeredByEventId: event.triggeredByEventId,
              triggeredByEventIds: event.triggeredByEventIds,
            },
            null,
            2,
          )}
          className="[&_.cm-editor]:!max-w-full [&_.cm-scroller]:!overflow-auto [&_.cm-editor]:!max-h-32 [&_.cm-editor]:!text-xs"
        />
      </div>
    </details>
  );
}

function TypedEventBody({ event }: { event: PipelineContentEvent }) {
  switch (event.type) {
    case "content_bulk_synced":
      return <BulkSyncDetails payload={event.payload} />;
    case "binding_propagation_done":
      return <BindingDoneDetails payload={event.payload} />;
    case "validation_issue_claimed":
    case "validation_issue_completed":
    case "validation_issue_reopened":
    case "validation_issue_released":
      return <ValidationIssueDetails event={event} />;
    case "validation_results_ready": {
      const parsed = parseValidationPayload(event.payload);
      if (!parsed.entryKey) return null;
      return (
        <ValidationResultsDetails
          entryKey={parsed.entryKey}
          skipped={parsed.skipped === true}
        />
      );
    }
    default:
      return null;
  }
}

function ParentWriteIdsList({ ids }: { ids: number[] }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-foreground">Parent writes</p>
      <ul className="max-h-32 overflow-y-auto space-y-0.5 text-xs font-mono text-muted-foreground">
        {ids.map((id) => (
          <li key={id}>#{id}</li>
        ))}
      </ul>
    </div>
  );
}

export function EventDetails({ event }: { event: PipelineContentEvent }) {
  const typed = eventHasTypedDetails(event);

  if (!typed) {
    return (
      <div
        className="mt-2 space-y-2 rounded-md border border-border bg-muted/20 p-2"
        data-testid={`event-payload-${event.id}`}
      >
        {event.agent_session_id ? (
          <p className="text-xs font-mono text-muted-foreground break-all">
            agent_session_id: {event.agent_session_id}
          </p>
        ) : null}
        <EventAttributionDetails attribution={event.attribution} />
        {event.triggeredByEventIds && event.triggeredByEventIds.length > 0 ? (
          <ParentWriteIdsList ids={event.triggeredByEventIds} />
        ) : null}
        <RawPayloadSection event={event} />
      </div>
    );
  }

  return (
    <div
      className="mt-2 space-y-2 rounded-md border border-border bg-muted/20 p-2"
      data-testid={`event-payload-${event.id}`}
    >
      <TypedEventBody event={event} />
      {event.agent_session_id ? (
        <p className="text-xs font-mono text-muted-foreground break-all">
          agent_session_id: {event.agent_session_id}
        </p>
      ) : null}
      <EventAttributionDetails attribution={event.attribution} />
      <RawPayloadSection event={event} />
    </div>
  );
}
