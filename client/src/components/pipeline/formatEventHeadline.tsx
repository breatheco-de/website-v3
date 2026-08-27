import {
  formatAttributionEntry,
  type EventAttributionEntry,
} from "@/lib/formatIssueActor";
import { parseEntryKey } from "@/lib/parseEntryKey";
import { cn } from "@/lib/utils";
import { formatAgentLabel, resolveAgentId } from "./agentIcons";
import { EntryKeyBadges, type PipelineContentEvent } from "./EventLogSummaries";

export type ParsedEntryRef = {
  contentType: string;
  slug: string;
  locale?: string;
  variant?: string;
  groupId?: string;
};

function strField(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

function numField(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  return typeof v === "number" ? v : undefined;
}

export function entryRefFromEvent(
  resource: Record<string, unknown>,
  payload: Record<string, unknown>,
): ParsedEntryRef | null {
  const entryKey = strField(payload, "entryKey");
  if (entryKey) {
    const parsed = parseEntryKey(entryKey);
    if (parsed) return parsed;
  }

  const contentType = strField(resource, "contentType");
  const slug = strField(resource, "slug");
  const locale = strField(resource, "locale");
  const variant = strField(resource, "variant");
  if (contentType && slug) {
    return { contentType, slug, locale, variant };
  }

  const groupId = strField(resource, "groupId") ?? strField(payload, "groupId");
  if (groupId) {
    return { contentType: "shared section", slug: groupId, locale: strField(resource, "locale") };
  }

  return null;
}

type ActorInfo = {
  label: string;
  tone: ActorTone;
};

function resolveActorInfo(
  attribution: EventAttributionEntry[],
  asSystem = false,
): ActorInfo {
  if (asSystem) {
    return { label: formatSystemActor(attribution), tone: "system" };
  }
  const agentId = resolveAgentId(attribution);
  if (agentId) {
    return { label: formatAgentLabel(agentId), tone: "user" };
  }
  if (attribution.length === 0) return { label: "Someone", tone: "user" };
  return { label: formatAttributionEntry(attribution[0]!), tone: "user" };
}

function formatSystemActor(attribution: EventAttributionEntry[]): string {
  const source = attribution[0]?.actor?.source?.trim();
  if (!source) return "The system";
  if (source === "index-refresh") return "The site index";
  if (source === "github-pull") return "GitHub sync";
  return source.replace(/[-_]+/g, " ");
}

function entryPlainText(entry: ParsedEntryRef): string {
  const localePart = entry.locale ? `${entry.locale}/` : "";
  return `${entry.contentType} ${localePart}${entry.slug}`;
}

function entryToBadgeProps(entry: ParsedEntryRef) {
  if (entry.contentType === "shared section") {
    return {
      groupId: entry.slug,
      locale: entry.locale,
      variant: entry.variant,
    };
  }
  return {
    contentType: entry.contentType,
    slug: entry.slug,
    locale: entry.locale,
    variant: entry.variant,
    groupId: entry.groupId,
  };
}

const TECHNICAL_LABELS: Record<string, string> = {
  content_file_written: "Content Saved",
  content_entry_deleted: "Entry Deleted",
  content_bulk_synced: "Bulk Content Sync",
  redirects_changed: "Redirects Changed",
  index_snapshot_ready: "Index Snapshot Applied",
  validation_results_ready: "Validation Results Ready",
  validation_issue_claimed: "Validation Issue Claimed",
  validation_issue_completed: "Validation Issue Completed",
  validation_issue_reopened: "Validation Issue Reopened",
  binding_propagation_started: "Shared Section Sync Started",
  binding_propagation_done: "Shared Section Sync Done",
  job_failed: "Job Failed",
};

function technicalLabelFor(event: Pick<PipelineContentEvent, "type" | "payload">): string {
  if (event.type === "validation_results_ready" && event.payload?.skipped === true) {
    return "Validation Skipped";
  }
  return (
    TECHNICAL_LABELS[event.type] ??
    event.type
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

type ActorTone = "user" | "system";

type SentenceParts = {
  /** Agent, staff author, or system actor — rendered with accent color, not a badge. */
  actorLabel?: string;
  actorTone?: ActorTone;
  /** Verb phrase after the actor (leading space when actorLabel is set). */
  rest: string;
  entry?: ParsedEntryRef;
  suffix?: string;
  muted: boolean;
};

function withActor(actor: ActorInfo, rest: string): Pick<SentenceParts, "actorLabel" | "actorTone" | "rest"> {
  return {
    actorLabel: actor.label,
    actorTone: actor.tone,
    rest,
  };
}

function sentenceParts(
  event: Pick<PipelineContentEvent, "type" | "resource" | "payload" | "attribution">,
): SentenceParts {
  const entry = entryRefFromEvent(event.resource, event.payload);
  const actor = resolveActorInfo(event.attribution);
  const systemActor = resolveActorInfo(event.attribution, true);

  switch (event.type) {
    case "content_file_written":
      return entry
        ? { ...withActor(actor, " has updated your"), entry, muted: false }
        : { ...withActor(actor, " has saved content"), muted: false };
    case "content_entry_deleted":
      return entry
        ? { ...withActor(actor, " has deleted your"), entry, muted: false }
        : { ...withActor(actor, " has deleted content"), muted: false };
    case "content_bulk_synced": {
      const count = numField(event.payload, "count");
      const n = count ?? 0;
      return {
        ...withActor(
          actor,
          n > 0
            ? ` synced ${n} file${n === 1 ? "" : "s"} from GitHub`
            : " synced content from GitHub",
        ),
        muted: false,
      };
    }
    case "redirects_changed":
      return { ...withActor(actor, " has updated site redirects"), muted: false };
    case "index_snapshot_ready":
      return entry
        ? { ...withActor(systemActor, " was refreshed after your"), entry, muted: false }
        : { ...withActor(systemActor, " was refreshed"), muted: false };
    case "validation_results_ready":
      if (event.payload?.skipped === true) {
        return entry
          ? { rest: "Validation was skipped for your", entry, muted: true }
          : { rest: "Validation was skipped", muted: true };
      }
      return entry
        ? { ...withActor(actor, " validated your"), entry, muted: false }
        : { ...withActor(actor, " finished validation"), muted: false };
    case "validation_issue_claimed":
      return entry
        ? { ...withActor(actor, " started fixing an issue on your"), entry, muted: false }
        : { ...withActor(actor, " started fixing a validation issue"), muted: false };
    case "validation_issue_completed":
      return entry
        ? { ...withActor(actor, " resolved an issue on your"), entry, muted: false }
        : { ...withActor(actor, " resolved a validation issue"), muted: false };
    case "validation_issue_reopened":
      return entry
        ? { ...withActor(actor, " reopened an issue on your"), entry, muted: false }
        : { ...withActor(actor, " reopened a validation issue"), muted: false };
    case "binding_propagation_started":
      return entry
        ? { ...withActor(actor, " started syncing"), entry, muted: false }
        : { ...withActor(actor, " started syncing a shared section"), muted: false };
    case "binding_propagation_done": {
      const updated =
        numField(event.payload, "updated") ??
        (Array.isArray(event.payload.updatedFiles)
          ? event.payload.updatedFiles.length
          : undefined);
      if (entry && updated != null && updated > 0) {
        return {
          ...withActor(actor, " synced"),
          entry,
          suffix: `to ${updated} page${updated === 1 ? "" : "s"}`,
          muted: false,
        };
      }
      return entry
        ? { ...withActor(actor, " finished syncing"), entry, muted: false }
        : { ...withActor(actor, " finished syncing a shared section"), muted: false };
    }
    case "job_failed": {
      const jobType = strField(event.payload, "jobType") ?? strField(event.payload, "job");
      return {
        ...withActor(
          systemActor,
          jobType ? ` job failed (${jobType})` : " job failed",
        ),
        muted: false,
      };
    }
    default:
      return {
        ...withActor(actor, ` triggered ${technicalLabelFor(event).toLowerCase()}`),
        muted: false,
      };
  }
}

function partsToPlain(parts: SentenceParts): string {
  const prefix = parts.actorLabel ? `${parts.actorLabel}${parts.rest}` : parts.rest;
  if (parts.entry) {
    const mid = entryPlainText(parts.entry);
    return [prefix, mid, parts.suffix].filter(Boolean).join(" ");
  }
  return prefix;
}

export type EventHeadlineResult = {
  plain: string;
  technicalLabel: string;
  muted: boolean;
};

/** Plain-text headline with `#id` prefix — timeline chips, filters, aria. */
export function formatEventHeadlinePlain(
  event: Pick<PipelineContentEvent, "id" | "type" | "resource" | "payload" | "attribution">,
): string {
  return `#${event.id} ${partsToPlain(sentenceParts(event))}`;
}

export function formatEventHeadline(
  event: Pick<PipelineContentEvent, "id" | "type" | "resource" | "payload" | "attribution">,
): EventHeadlineResult {
  const parts = sentenceParts(event);
  return {
    plain: `#${event.id} ${partsToPlain(parts)}`,
    technicalLabel: technicalLabelFor(event),
    muted: parts.muted,
  };
}

export function EventHeadline({
  event,
  className,
  isFailure,
}: {
  event: PipelineContentEvent;
  className?: string;
  isFailure?: boolean;
}) {
  const parts = sentenceParts(event);
  const { technicalLabel } = formatEventHeadline(event);

  return (
    <span
      className={cn(
        "inline-flex flex-wrap items-baseline gap-x-1 gap-y-0.5 min-w-0",
        parts.muted && "text-muted-foreground",
        isFailure && "text-red-400",
        className,
      )}
      aria-label={`${formatEventHeadlinePlain(event)} — ${technicalLabel}`}
    >
      <span className="font-mono text-[10px] font-normal text-muted-foreground shrink-0">
        #{event.id}
      </span>
      {parts.actorLabel ? (
        <span
          className={cn(
            "font-medium shrink-0",
            parts.actorTone === "system" ? "text-muted-foreground" : "text-primary",
            isFailure && "text-red-400",
          )}
        >
          {parts.actorLabel}
        </span>
      ) : null}
      {parts.rest ? <span>{parts.rest}</span> : null}
      {parts.entry ? (
        <EntryKeyBadges inline {...entryToBadgeProps(parts.entry)} />
      ) : null}
      {parts.suffix ? <span>{parts.suffix}</span> : null}
    </span>
  );
}
