import { useState } from "react";
import { IconAlertTriangle, IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { ProposalFieldDiff } from "@/components/agents/ProposalFieldDiff";

export type DraftFieldChange = {
  field_path: string;
  before?: unknown;
  after?: unknown;
  scope?: "common" | "locale";
  removed?: boolean;
  source?: unknown;
};

export type DraftEntryV1 = {
  id: number;
  locale: string;
  ops: Array<{ field_path: string; value?: unknown; op?: "set" | "remove" }>;
  baseline_context: { values: Record<string, unknown>; note?: string };
  author_diff?: DraftFieldChange[];
  author_diff_approximate?: boolean;
  requested_ops?: Array<{ field_path: string; value?: unknown; op?: "set" | "remove" }>;
  ops_match_request?: boolean;
  unrequested_fields?: string[];
  draft_missing?: boolean;
  base_status?: "ok" | "stale" | "unknown";
  merge_preview?: {
    status: string;
    author_fields?: string[];
    live_changes_since_base?: Array<{ field_path: string }>;
    conflicting_fields?: Array<{ field_path: string }>;
  };
  source_changed?: { source_locale: string; fields?: string[] };
  sections_summary?: SectionsSummaryView;
};

export type SectionsSummaryView = {
  before_count: number;
  after_count: number;
  rows: Array<{
    index: number;
    type: string;
    status: "added" | "removed" | "changed" | "moved";
    changed_keys?: string[];
    from_index?: number;
  }>;
  truncated?: boolean;
};

/** "Section 3 (hero): title, image changed" / "Section 5 added (cta_banner)". */
export function plainSectionsSummary(summary: SectionsSummaryView): string[] {
  if (summary.before_count === 0 && summary.after_count > 0) {
    return [`New layout with ${summary.after_count} section${summary.after_count === 1 ? "" : "s"}.`];
  }
  const lines = summary.rows.map((r) => {
    const n = r.index + 1;
    const keys = r.changed_keys?.length ? `: ${r.changed_keys.join(", ")} changed` : "";
    switch (r.status) {
      case "added":
        return `Section ${n} added (${r.type})`;
      case "removed":
        return `Section ${n} removed (${r.type})`;
      case "moved":
        return `Section ${n} (${r.type}) moved from position ${(r.from_index ?? r.index) + 1}${keys}`;
      default:
        return `Section ${n} (${r.type})${keys}`;
    }
  });
  if (summary.truncated) lines.push("…and more sections.");
  return lines;
}

/** v1.0 entry body: field diff from the draft, whole-page / removal markers, and draft state notes. */
export function ProposalDraftEntryDetails({ entry }: { entry: DraftEntryV1 }) {
  const [showRequest, setShowRequest] = useState(false);
  const scopeOf = new Map((entry.author_diff ?? []).map((c) => [c.field_path, c] as const));
  const sectionsChanged = entry.ops.some((o) => o.field_path === "sections" || o.field_path.startsWith("sections."));

  if (entry.draft_missing) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        <IconAlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <p>The draft file for this page no longer exists, so there is nothing to publish. The author needs to revise the proposal.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {entry.base_status === "stale" && entry.merge_preview ? (
        <div
          className="space-y-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
          data-testid={`proposal-entry-merge-preview-${entry.id}`}
        >
          {entry.merge_preview.status === "rebuild" ? (
            <p>
              The live page changed after this draft was made. Approving publishes the author's fields
              {entry.merge_preview.author_fields?.length ? ` (${entry.merge_preview.author_fields.join(", ")})` : ""} on
              top of today's page and keeps the newer live changes
              {entry.merge_preview.live_changes_since_base?.length
                ? ` (${entry.merge_preview.live_changes_since_base.map((c) => c.field_path).join(", ")})`
                : ""}
              .
            </p>
          ) : entry.merge_preview.status === "has_sections" ? (
            <p className="text-destructive">
              The live page changed after this draft was made, and the draft changes the page structure. That cannot be combined automatically — the author must update the proposal first.
            </p>
          ) : entry.merge_preview.status === "no_base_copy" ? (
            <p className="text-destructive">
              The live page changed after this draft was made, and there is no saved starting point to combine them. The author must update the proposal first.
            </p>
          ) : (
            <p className="text-destructive">
              The live page changed the same field(s) as this draft
              {entry.merge_preview.conflicting_fields?.length
                ? `: ${entry.merge_preview.conflicting_fields.map((c) => c.field_path).join(", ")}`
                : ""}
              . Approving will not overwrite them — the author must update the proposal first.
            </p>
          )}
        </div>
      ) : null}
      {entry.base_status === "unknown" ? (
        <p className="text-xs text-muted-foreground" data-testid={`proposal-entry-base-unknown-${entry.id}`}>
          This draft has no recorded starting point, so changes made to the live page since then cannot be detected. Approving asks you to confirm publishing it as-is.
        </p>
      ) : null}
      {entry.source_changed ? (
        <p className="text-xs text-muted-foreground" data-testid={`proposal-entry-source-changed-${entry.id}`}>
          Translated from {entry.source_changed.source_locale}, which changed since
          {entry.source_changed.fields?.length ? ` (${entry.source_changed.fields.join(", ")})` : ""}. Check the translation before approving.
        </p>
      ) : null}
      {entry.author_diff_approximate ? (
        <p className="text-xs text-muted-foreground" data-testid={`proposal-entry-diff-approximate-${entry.id}`}>
          Compared with today's live page — may include published changes that are not the author's.
        </p>
      ) : null}
      {(entry.author_diff ?? []).some((c) => c.scope === "common") ? (
        <p className="text-xs text-muted-foreground">
          Fields marked "Whole page" change this page in every language when published.
        </p>
      ) : null}
      {entry.sections_summary && plainSectionsSummary(entry.sections_summary).length ? (
        <ul
          className="space-y-0.5 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground"
          data-testid={`proposal-entry-sections-summary-${entry.id}`}
        >
          {plainSectionsSummary(entry.sections_summary).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {sectionsChanged ? (
        <p className="text-xs text-muted-foreground">The page structure changed — use Preview draft to see it.</p>
      ) : null}
      {entry.ops.map((op) => {
        const change = scopeOf.get(op.field_path);
        const removed = op.op === "remove" || change?.removed === true;
        const wholePage = change?.scope === "common";
        return (
          <div key={op.field_path} className="space-y-1">
            {wholePage || removed ? (
              <div className="flex flex-wrap gap-1.5">
                {wholePage ? (
                  <Badge variant="outline" className="font-normal" data-testid={`badge-field-whole-page-${entry.id}-${op.field_path}`}>
                    Whole page
                  </Badge>
                ) : null}
                {removed ? (
                  <Badge variant="outline" className="font-normal text-destructive" data-testid={`badge-field-removed-${entry.id}-${op.field_path}`}>
                    {wholePage ? "Removed from the whole page, in every language" : "Removed"}
                  </Badge>
                ) : null}
              </div>
            ) : null}
            <ProposalFieldDiff
              fieldPath={op.field_path}
              current={entry.baseline_context.values[op.field_path]}
              proposed={removed ? undefined : op.value}
            />
            {change?.source !== undefined ? (
              <p className="text-[11px] text-muted-foreground">
                Original: {typeof change.source === "string" ? change.source : JSON.stringify(change.source)}
              </p>
            ) : null}
          </div>
        );
      })}
      {entry.ops_match_request === false && entry.requested_ops?.length ? (
        <div className="rounded-md border border-border">
          {entry.unrequested_fields?.length ? (
            <p
              className="flex items-start gap-1.5 border-b border-border px-3 py-2 text-xs text-foreground"
              data-testid={`text-proposal-entry-unrequested-${entry.id}`}
            >
              <IconAlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              <span>
                Publishing would also change fields the author did not ask for:{" "}
                <span className="font-mono">{entry.unrequested_fields.join(", ")}</span>. If they are not
                intended, ask the author to revise; that restarts the draft from today's live page.
              </span>
            </p>
          ) : null}
          <button
            type="button"
            className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowRequest((v) => !v)}
            data-testid={`button-proposal-entry-original-request-${entry.id}`}
          >
            {showRequest ? <IconChevronDown className="h-3.5 w-3.5" /> : <IconChevronRight className="h-3.5 w-3.5" />}
            Author's original request (the draft now differs)
          </button>
          {showRequest ? (
            <ul className="space-y-1 border-t border-border px-3 py-2 font-mono text-[11px] text-muted-foreground">
              {entry.requested_ops.map((o) => (
                <li key={o.field_path}>
                  {o.field_path}: {o.op === "remove" ? "(remove)" : JSON.stringify(o.value)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
