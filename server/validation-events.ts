/**
 * Admin events for validation issue workflow overlays (claim / complete / reopen).
 */

import type {
  StoredValidationIssue,
  ValidationIssueActor,
  ValidationIssueCompletion,
} from "../scripts/validation/shared/types";
import { emitEvent } from "./events/event-store";
import type { EventType } from "./events/types";
import { singleAttribution } from "./events/types";

export type ValidationIssueWorkflowEventType =
  | "validation_issue_claimed"
  | "validation_issue_completed"
  | "validation_issue_reopened";

function parseResourceFromPath(filePath: string): {
  path: string;
  contentType?: string;
  slug?: string;
  locale?: string;
} {
  const norm = filePath.replace(/\\/g, "/");
  const m = norm.match(
    /\/(programs|landings|locations|pages|blog|workshops|events|courses)\/([^/]+)\/([^/]+)\.ya?ml$/i,
  );
  if (!m) return { path: norm };
  const folder = m[1]!.toLowerCase();
  const typeMap: Record<string, string> = {
    programs: "program",
    landings: "landing",
    locations: "location",
    pages: "page",
    blog: "blog",
    workshops: "workshop",
    events: "event",
    courses: "course",
  };
  const contentType = typeMap[folder] ?? folder.replace(/s$/, "");
  const slug = m[2]!;
  const base = m[3]!.replace(/\.ya?ml$/i, "");
  if (base === "_common") {
    return { path: norm, contentType, slug };
  }
  let locale = base;
  if (base.startsWith("template.") || base.startsWith("single.")) {
    const rest = base.startsWith("template.") ? base.slice("template.".length) : base.slice("single.".length);
    locale = rest.split(".")[0] || locale;
  }
  else if (base.includes(".")) locale = base.split(".").pop() || base;
  return { path: norm, contentType, slug, locale };
}

function parseResourceFromEntryKey(entryKey: string): {
  contentType?: string;
  slug?: string;
  locale?: string;
} {
  const parts = entryKey.split("/");
  if (parts.length < 3) return {};
  const contentType = parts[0];
  const slug = parts[1];
  const locale = parts[2];
  return { contentType, slug, locale };
}

/** Resolve site folder from issue file path or optional request site. */
export function resolveSiteForIssue(
  issue: Pick<StoredValidationIssue, "file" | "targets">,
  requestSite?: string,
): string | null {
  if (requestSite?.startsWith("site_")) return requestSite;
  const file = issue.file?.replace(/\\/g, "/");
  if (file) {
    const parts = file.split("/");
    if (parts[0]?.startsWith("site_")) return parts[0];
  }
  const entryTarget = issue.targets?.find((t) => t.type === "entry") as
    | { type: "entry"; entryKey: string; url?: string }
    | undefined;
  if (entryTarget?.entryKey) {
    // entryKey does not include site prefix — caller should pass requestSite when possible.
  }
  return requestSite ?? null;
}

function issueUrl(issue: StoredValidationIssue): string | undefined {
  const entryTarget = issue.targets?.find((t) => t.type === "entry") as
    | { type: "entry"; entryKey: string; url?: string }
    | undefined;
  return entryTarget?.url;
}

function issueEntryKey(issue: StoredValidationIssue): string | undefined {
  const entryTarget = issue.targets?.find((t) => t.type === "entry") as
    | { type: "entry"; entryKey: string }
    | undefined;
  return entryTarget?.entryKey;
}

export function emitValidationIssueWorkflowEvent(opts: {
  type: ValidationIssueWorkflowEventType;
  site: string;
  issue: StoredValidationIssue;
  author: string;
  actor?: ValidationIssueActor;
  priorCompletion?: ValidationIssueCompletion;
  report?: string;
  agent_session_id?: string;
}): void {
  const { type, site, issue, author, actor, priorCompletion, report } = opts;
  const entryKey = issueEntryKey(issue);
  const fromEntry = entryKey ? parseResourceFromEntryKey(entryKey) : {};
  const fromFile = issue.file ? parseResourceFromPath(issue.file) : { path: "" };
  const resource = {
    path: issue.file ?? fromFile.path,
    ...fromEntry,
  };
  const payload: Record<string, unknown> = {
    issueId: issue.id,
    code: issue.code,
    validator: issue.validator,
    category: issue.category,
    severity: issue.severity,
    actor: actor ?? null,
    url: issueUrl(issue) ?? null,
    file: issue.file ?? null,
    entryKey: entryKey ?? null,
  };
  if (type === "validation_issue_reopened" && priorCompletion) {
    payload.priorCompletedBy = priorCompletion.completedBy;
    payload.priorActor = priorCompletion.actor ?? null;
    payload.priorCompletedAt = priorCompletion.completedAt;
  }
  if (report) {
    payload.report = report;
  }
  emitEvent({
    site,
    type: type as EventType,
    resource,
    attribution: singleAttribution(author, actor),
    agent_session_id: opts.agent_session_id,
    payload,
  });
}
