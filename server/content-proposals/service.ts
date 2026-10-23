import { createHash, randomUUID } from "crypto";
import fs from "fs";
import type Database from "better-sqlite3";
import { getSiteSqlite } from "../db";
import { child } from "../logger";
import { ensurePipelineDb } from "../pipeline-db/runner";
import { emitEvent } from "../events/event-store";
import { singleAttribution, type EventActor } from "../events/types";
import { getContentForEdit } from "../content-editor";
import { applyFieldUpdates, readFieldValueAtPath } from "../field-write-router";
import type { SiteContext } from "../site-manager";
import { canonicalizePillarPath, entryCanonicalPath } from "../seo-fields";
import { assertMainKeywordAvailable, readSeoIndexFile, seoEntryId } from "../seo-index";
import { isSeoMonitoringEnabled } from "../seo-monitoring";
import { agentOptOutAllowed, findOriginIdeaForEntry, isSeoClusterOptOutOp } from "./idea-origin";
import { fingerprintEdits, fingerprintNotes, fingerprintIdeas, stableJson } from "./fingerprint";
import {
  resolveProposalEntryActivity,
  type ResolveRecentActivityResult,
} from "./entry-activity";
import { hashVariantFileContents } from "../versioning/promote-with-teardown";
import path from "path";
import { sameValue, type FieldChange } from "../versioning/draft-base";
import { fieldScope } from "@shared/field-scope";
import { onVariantWrite, readDraftMeta } from "../versioning/draft-meta";
import {
  draftStoreForSite,
  type ProposalDraftRef,
  type ProposalDraftStore,
} from "./draft-store";
import {
  hasFullSectionsOp,
  isSectionFieldPath,
  missingRequiredFromOps,
  type MissingTargetShape,
  type SectionIssue,
} from "./attached-entry-gate";
import { validateSectionsForProposal } from "./section-proposal-check";
import { checkStaffSummary } from "./blocker-staff-summary";
import { TEXT_LIMITS_EXCEEDED_CODE } from "@shared/component-text-limits";
import { summarizeSectionsChange, type SectionsSummary } from "./sections-summary";
import { scanTemplatePlaceholdersOnSite, type TemplatePlaceholderGap } from "./template-placeholder-scan";
import { layoutInfoForEntry, type EntryLayoutInfo, type LayoutOwner } from "../layout-owner";
import {
  getAllTypes,
  getFolder,
  getContentTypeConfig,
  listExtraUrlPatternParams,
} from "../content-types";
import { parseContentTypeStrategy, type ContentTypeStrategy } from "@shared/contentTypeStrategy";
import {
  resolveIdeaContentTypeStrategies,
  unknownContentTypeError,
  unknownContentTypes,
  type IdeaContentTypeStrategy,
} from "./idea-content-type";
import {
  isEntryDetached,
  isTemplateVersioningSlug,
  resolveWritableVersioningTarget,
} from "../shared-layout-entry";
import { listRequiredEditorFields } from "@shared/validateRequiredFields";
import { extractParamSlug, validateUrlParamPeerValues } from "../url-param-peers";
import { ensurePublishedAtOnce } from "../published-at";
import { isLiveServer } from "../live-server";
import {
  checkAcceptedUrlSlug,
  IDEA_URL_SLUG_CONFLICT,
  LOCALE_URL_SLUG_REQUIRED,
  parseUrlSlugOverride,
  urlPatternUsesSlug,
  validateLocaleUrlSlugFormat,
  validateUrlSlugOverride,
  type UrlSlugOverride,
} from "../locale-url-slug";
import { discardSeededAttachedEntry, seedAttachedLocaleFiles } from "./seed-attached-entry";
import {
  sameAgentIdentity,
  formatAgentActorLine,
  isServerAgentSessionId,
  isStaffUiActor,
  type AgentActorLike,
} from "@shared/agent-identity";
import {
  DEFAULT_PROPOSAL_SETTINGS,
  getProposalSettings as loadProposalSettingsFromDisk,
  type ProposalSettings,
} from "../settings";
import {
  classifyProposalReview,
  collectDamageClassesForMixedCheck,
  isMixedRiskBundle,
  parseReviewSnapshot,
  siteFactsInputText,
  snapshotFromReviewContext,
  type EntryExistenceLookup,
  type RelatedOpenProposal,
  type ReviewContext,
  type SiteFactsCheck,
} from "./review-context";
import type { ExistenceState } from "./proposal-review-rules";
import {
  askTouchesOutcomeFigures,
  askTouchesSiteFacts,
  getDecisionClient,
} from "../ai/decisions";
import { recordDecisionOutcome } from "../ai/decisions/health";
import { anyEntryHasCountsAsLeadForm } from "./counts-as-lead-hint";
import { textFromUnknown, evaluateClaimCues } from "./claim-cues";
import { findFigureVariableTokens } from "./figure-variable-tokens";
import type { VariableDefinition } from "../variable-manager";
import {
  parseReviewSituationIds,
  parseIdeaAuthorSituationIds,
  refreshSituationsAfterRevise,
  type ReviewSituationId,
} from "./review-situations";
import {
  buildDecisionDebug,
  type ProposalDecisionDebug,
} from "./decision-debug";
import {
  compareByAttention,
  deriveProposalAttention,
  emptyAttentionCounts,
  resolvedBlockerCount,
  type AttentionPerspective,
  type ProposalAttention,
} from "./attention";
import {
  getKpiHistory,
  invalidateKpiCache,
  liveByKindStatus,
  type KindStatusCardCounts,
  type KpiCardKind,
  type KpiGranularity,
  type KpiHistoryResult,
} from "./kpi-history";
import {
  funnelFromFieldOps,
  hasFunnelFieldOps,
  ideaFunnelComplete,
  ideaFunnelsEqual,
  ideaFunnelToYamlBlock,
  ideaRequiresStructuredFunnel,
  parseIdeaFunnel,
  validateIdeaFunnel,
  IDEA_FUNNEL_CONFLICT,
  IDEA_FUNNEL_FROZEN,
  IDEA_FUNNEL_REQUIRED,
  type IdeaFunnel,
} from "./idea-funnel";
import {
  IDEA_SEO_TARGET_CONFLICT,
  IDEA_SEO_TARGET_FROZEN,
  IDEA_SEO_TARGET_HUB_GONE,
  IDEA_SEO_TARGET_HUB_MEMBERS_REQUIRED,
  IDEA_SEO_TARGET_MEMBERS_CLAIMED,
  IDEA_SEO_TARGET_HUB_NOT_LIVE,
  IDEA_SEO_TARGET_KEYWORD_TAKEN,
  IDEA_SEO_TARGET_REQUIRED,
  ideaDemandLabel,
  ideaSeoTargetComplete,
  ideaSeoTargetsEqual,
  normalizePath,
  parseIdeaSeoTarget,
  parseSeoTargetOverride,
  seoBlockFromTarget,
  seoTargetDiff,
  standaloneAllowedForDemand,
  standaloneNotAllowed,
  validateIdeaSeoTarget,
  validateSeoTargetOverride,
  type IdeaSeoTarget,
  type SeoTargetDiff,
  type SeoTargetOverride,
} from "./idea-seo-target";

const log = child({ module: "content-proposals" });

export type { AttentionPerspective, ProposalAttention };

export const PROPOSAL_CLAIM_TTL_MS = 30 * 60 * 1000;
export const RAG_SIMILARITY_THRESHOLD = 0.82;
export const MIN_SUMMARY = 80;
export const MIN_BLOCKER_BODY = 80;
export const MIN_CLOSE_NOTE = 20;
export const MIN_ACCEPT_NEXT_STEP = 20;
export const MIN_REJECT_NOTE = 80;
export const ACCEPTED_ENTRY_NOT_CREATABLE = "accepted_entry_not_creatable";
export const ACCEPTED_ENTRY_NEEDS_LAYOUT = "accepted_entry_needs_layout";
export const IDEA_PAGE_RELEASED_WAITING_IDEAS = "idea_page_released_waiting_ideas";

export type ProposalStatus = "open" | "partial" | "finished" | "rejected" | "withdrawn";
export type ProposalKind = "edits" | "notes" | "idea";
export type ProposalCategory = "content.field" | "content.seo";
export type EntryRowStatus = "pending" | "done" | "failed";
export type ReviewMode = "soft" | "soft_variant" | "draft_backed";
export type BlockerStatus = "open" | "resolved";
export type ProposalCloseReason =
  | "wont_fix"
  | "fixed_elsewhere"
  | "tracked_elsewhere"
  | "other"
  | "accepted";

export type ProposalRejectKind =
  | "bad_idea"
  | "not_implementable"
  | "illegal_or_policy"
  | "harmful"
  | "duplicate_weaker"
  | "target_missing";

/** Values stored in close_reason (notes/ideas close, reject kinds, withdraw). */
export type ProposalStoredCloseReason =
  | ProposalCloseReason
  | ProposalRejectKind
  | "withdrawn"
  | "legacy_version"
  | "abandoned_stale"
  | "abandoned_blocked";

export const PROPOSAL_CLOSE_REASONS: ProposalCloseReason[] = [
  "wont_fix",
  "fixed_elsewhere",
  "tracked_elsewhere",
  "other",
  "accepted",
];

export const PROPOSAL_REJECT_KINDS: ProposalRejectKind[] = [
  "bad_idea",
  "not_implementable",
  "illegal_or_policy",
  "harmful",
  "duplicate_weaker",
  "target_missing",
];

/** Close/park reasons for ideas (Accept uses accepted separately). */
export const IDEA_PARK_REASONS: ProposalCloseReason[] = [
  "wont_fix",
  "tracked_elsewhere",
  "other",
];

export type RelatedEntryRef = {
  contentType: string;
  slug: string;
  locale?: string;
};

/** Locked page target set on idea accept (required for follow-through). */
export type AcceptedEntry = {
  contentType: string;
  slug: string;
  locale: string;
  /** This language's public address word (its own `slug:`); the folder name stays `slug`. */
  url_slug?: string;
  /** Reviewer confirmed an address that looks like another language is intended (a name). */
  slug_language_ack?: boolean;
};

export function parseAcceptedEntry(raw: unknown): AcceptedEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const contentType = typeof o.contentType === "string" ? o.contentType.trim() : "";
  const slug = typeof o.slug === "string" ? o.slug.trim() : "";
  const locale = typeof o.locale === "string" ? o.locale.trim() : "";
  if (!contentType || !slug || !locale) return null;
  const urlSlug = typeof o.url_slug === "string" ? o.url_slug.trim() : "";
  return {
    contentType,
    slug,
    locale,
    ...(urlSlug ? { url_slug: urlSlug } : {}),
    ...(o.slug_language_ack === true ? { slug_language_ack: true } : {}),
  };
}

export type AcceptedEntryCreateMode = "attached" | "page" | "manual";

export function acceptedEntryKey(entry: AcceptedEntry): string {
  return `${entry.contentType}/${entry.slug}/${entry.locale}`;
}

export function entriesMatchAccepted(
  entries: Array<{ contentType: string; slug: string; locale: string }>,
  accepted: AcceptedEntry,
): boolean {
  if (entries.length === 0) return false;
  return entries.every(
    (e) =>
      e.contentType === accepted.contentType &&
      e.slug === accepted.slug &&
      e.locale === accepted.locale,
  );
}

export function isProposalCloseReason(raw: string): raw is ProposalCloseReason {
  return (PROPOSAL_CLOSE_REASONS as string[]).includes(raw);
}

export function isProposalRejectKind(raw: string): raw is ProposalRejectKind {
  return (PROPOSAL_REJECT_KINDS as string[]).includes(raw);
}

export type FieldUpdate = {
  field_path: string;
  value?: unknown;
  reset?: boolean;
  op?: "set" | "remove";
};

export type CoAuthor = {
  username: string;
  actor?: Record<string, unknown>;
  at: number;
};

export type ProposalClaim = {
  by: string;
  expiresAt: string;
  report?: string;
  /** MCP client/model (or ui) when claim was taken — for staff “via …” lines. */
  actor?: EventActor;
};

export type ProposalEntryInput = {
  contentType: string;
  slug: string;
  locale: string;
  variant?: string;
  updates?: FieldUpdate[];
  /** v1.0: the draft is a translation of this published locale (records `_draft.translated_from`). */
  translated_from_locale?: string;
};

export type ProposalEntryRow = {
  id: number;
  proposal_id: string;
  entry_key: string;
  locale: string;
  variant: string | null;
  variant_fingerprint: string | null;
  status: EntryRowStatus;
  ops: FieldUpdate[];
  baseline_context: {
    values: Record<string, unknown>;
    note?: string;
    creates_entry?: boolean;
    /** v1.0: who owned the layout when the entry was filed / revised (layout-switch check). */
    layout_owner?: LayoutOwner;
  };
  last_error: string | null;
  applied_at: number | null;
  applied_by: string | null;
  contentType: string;
  slug: string;
  /** v1.0: this proposal created the draft (deleted again on reject / withdraw). */
  created_draft?: boolean;
  /** v1.0: author changes, base copy (or today's live when approximate) vs draft. Same data as `ops`. */
  author_diff?: FieldChange[];
  author_diff_approximate?: boolean;
  /** v1.0: what the author sent (`ops_json`); `ops` is the view of the draft. */
  requested_ops?: FieldUpdate[];
  ops_match_request?: boolean;
  /** v1.0: draft fields that change although the author did not send them (stale seed, migration, co-author). */
  unrequested_fields?: string[];
  /** v1.0: the draft file no longer exists; no ops view. */
  draft_missing?: boolean;
  /** v1.0: what the apply published, field by field (revert source). */
  published_diff?: FieldChange[] | null;
  /** v1.0: raw live/common before apply — only on snapshot export (revert source). */
  pre_apply_snapshot?: { live: string | null; common: string | null } | null;
  /** v1.0: live moved after the draft was created (stale) / no known base (unknown). */
  base_status?: "ok" | "stale" | "unknown";
  /** v1.0: what apply will publish when live moved (same function as the rebuild). */
  merge_preview?: {
    status:
      | "rebuild"
      | "conflict"
      | "has_sections"
      | "no_base_copy"
      | "draft_missing";
    author_fields?: string[];
    live_changes_since_base?: FieldChange[];
    conflicting_fields?: Array<{
      field_path: string;
      author: unknown;
      live: unknown;
    }>;
    result?: Record<string, unknown>;
  };
  /** v1.0: translation source locale changed after translating. */
  source_changed?: { source_locale: string; fields?: string[] };
  /** Read-time: who owns this entry's layout today (shared template vs the entry itself). */
  layout_owner?: LayoutOwner;
  /** Read-time: entry of a shared-layout type that owns its sections because it is detached. */
  detached?: true;
  /** Read-time: this draft is the shared template itself (slug `template`). */
  is_shared_template?: true;
  /** v1.0: per-section view of a `sections` change (author_diff keeps `sections` atomic). */
  sections_summary?: SectionsSummary;
};

export type ProposalBlocker = {
  id: number;
  proposal_id: string;
  kind: "blocker";
  body: string;
  /** Plain-English version for staff; null on blockers filed before it existed. */
  staff_summary: string | null;
  status: BlockerStatus;
  author: string;
  created_at: number;
  resolved_at: number | null;
  resolved_by: string | null;
  resolve_note: string | null;
  agent_session_id: string | null;
  author_actor: Record<string, unknown>;
  resolved_by_actor: Record<string, unknown>;
};

export type ProposalOutcomeVerdict = "good" | "bad";

export type ProposalOutcomeHistoryEntry = {
  outcome: ProposalOutcomeVerdict;
  note: string | null;
  expected: string | null;
  at: number | null;
  by: string | null;
  /** When and by whom this verdict was replaced or cleared. */
  replaced_at: number;
  replaced_by: string;
  replaced_with: ProposalOutcomeVerdict | "cleared";
};

export const OUTCOME_REVIEW_HISTORY_MAX = 20;

/** Title/status of a proposal another proposal links to (implements, supersedes, reverts). */
export type ReferencedProposalSummary = {
  title: string;
  summary: string;
  status: string;
  kind: string;
};

export type ProposalRecord = {
  id: string;
  site: string;
  fingerprint: string;
  status: ProposalStatus;
  kind: ProposalKind;
  category: ProposalCategory;
  title: string;
  summary: string;
  rationale: string | null;
  documentation: Record<string, unknown>;
  related_issue_ids: string[];
  proposer_username: string;
  proposer_actor: Record<string, unknown>;
  created_at: number;
  updated_at: number;
  claim: ProposalClaim | null;
  tags: string[];
  search_text: string;
  created_agent_session_id: string | null;
  promote_on_apply: boolean;
  review_mode: ReviewMode;
  open_blocker_count: number;
  no_auto_retry: boolean;
  escalated: boolean;
  escalated_at: number | null;
  escalated_by: string | null;
  escalated_note: string | null;
  close_reason: ProposalStoredCloseReason | null;
  close_note: string | null;
  closed_by: string | null;
  closed_at: number | null;
  related_entries: RelatedEntryRef[];
  entries: ProposalEntryRow[];
  blockers: ProposalBlocker[];
  /** Author-declared review situation ids (edits). Empty → infer on classify. */
  review_situations: string[];
  /** Snapshot JSON for list badges — persisted. */
  review_context_snapshot: Record<string, unknown> | null;
  /** Staff-only freeze of checklist/menu at terminal decide — persisted. */
  decision_debug: ProposalDecisionDebug | null;
  supersedes_proposal_id: string | null;
  replaced_by_proposal_id: string | null;
  /** Set on idea accept — reserved type/slug/locale for follow-up edits. */
  accepted_entry: AcceptedEntry | null;
  /**
   * Structured funnel intent for new-URL ideas (stage + products).
   * Immutable after accept; creating edits must match / seed from this.
   */
  idea_funnel: IdeaFunnel | null;
  /**
   * Focus keyword + cluster decision for new-URL ideas. Frozen at accept; the
   * creating edits proposal seeds it into the new page's draft `seo:`.
   */
  idea_seo_target: IdeaSeoTarget | null;
  /** Edits implementing an idea: why seo.* ops differ from the locked target. */
  seo_target_override: SeoTargetOverride | null;
  /** Edits implementing an idea: why the `slug` op differs from the idea's locked url_slug. */
  url_slug_override: UrlSlugOverride | null;
  /** Edits that implement an accepted idea (optional unless slug is reserved). */
  implements_proposal_id: string | null;
  /** Computed on read — accepted idea whose locked page is missing and a proposal can create it. */
  attached_create_entry?: AcceptedEntry | null;
  /**
   * Computed on read for accepted ideas whose locked page is missing:
   * attached = blog-style post (field updates only); page = section-built page (full sections);
   * manual = cannot be created by a proposal (database row) — a human creates it first.
   */
  accepted_entry_create_mode?: AcceptedEntryCreateMode | null;
  /** Computed on read next to `accepted_entry_create_mode`: who will own the reserved page's layout. */
  accepted_entry_layout_owner?: LayoutOwner | null;
  /** Last author rewrite or author-marked blocker fix. */
  author_content_at: number | null;
  /** Last reviewer add/reopen/non-author resolve. */
  reviewer_action_at: number | null;
  /** Who made the `reviewer_action_at` action (never the proposer). Not approval. */
  reviewer_action_by: string | null;
  reviewer_action_by_actor: Record<string, unknown>;
  /** Steward retro verdict on a closed proposal. Human-only; informational for agents. */
  outcome_review: ProposalOutcomeVerdict | null;
  outcome_review_note: string | null;
  outcome_review_expected: string | null;
  outcome_review_at: number | null;
  outcome_review_by: string | null;
  /** Earlier verdicts (newest last, capped at OUTCOME_REVIEW_HISTORY_MAX). */
  outcome_review_history: ProposalOutcomeHistoryEntry[];
  outcome_lesson_captured_at: number | null;
  outcome_lesson_captured_by: string | null;
  outcome_lesson_note: string | null;
  /** "1.0" = draft-first proposals; null = legacy (read-only). */
  system_version: string | null;
  /** Staff/agents who edited the proposal's draft directly (four-eyes blocks them from approving). */
  co_authors: CoAuthor[];
  /** Apply publishes every entry or none. */
  all_or_nothing: boolean;
  reverts_proposal_id: string | null;
  /** First time live or the translation source moved under the draft (ISO). Cleared by rebuild / revise. */
  stale_since: string | null;
  stale_flagged_at: string | null;
  /** Open blockers sat idle BLOCKED_FLAG_DAYS (ISO). Cleared when blockers clear or work resumes. */
  blocked_flagged_at: string | null;
  /** Order-only chain: apply is refused until this proposal is fully applied (finished). */
  applies_after_proposal_id: string | null;
  /** Predecessor applied DEPENDENT_OVERDUE_HOURS ago and this is still open (ISO). Never pauses or closes. */
  dependent_overdue_flagged_at: string | null;
  /** Computed on read: proposals whose applies_after_proposal_id is this one. */
  applied_before_proposal_ids?: string[];
  /** Computed on read: the applies_after predecessor is finished. */
  predecessor_applied?: boolean;
  /** v1.0 template proposals: attached entries the change reaches (read-only enrichment). */
  affected_entries?: AffectedEntries | null;
  /** Enriched on read — not persisted. */
  recent_activity?: Array<{ entryKey: string; writeCount: number; windowDays: number }>;
  recent_activity_error?: string;
  /** Other open/partial proposals on overlapping targets that are currently escalated. */
  escalated_siblings?: Array<{ id: string; title: string }>;
};

/** Slim entry stub for multi-row list responses (no ops / baselines). */
export type ProposalEntrySummary = {
  contentType: string;
  slug: string;
  locale: string;
  variant: string | null;
  status: EntryRowStatus;
  last_error?: string | null;
};

/**
 * Thin proposal row for multi-row list / MCP triage.
 * Full ops + baselines stay on GET /:id and list with proposal_id.
 */
export type ProposalSummary = {
  detail: "summary";
  id: string;
  site: string;
  status: ProposalStatus;
  kind: ProposalKind;
  category: ProposalCategory;
  title: string;
  summary: string;
  related_issue_ids: string[];
  proposer_username: string;
  proposer_actor: Record<string, unknown>;
  created_at: number;
  updated_at: number;
  claim: ProposalClaim | null;
  tags: string[];
  created_agent_session_id: string | null;
  promote_on_apply: boolean;
  review_mode: ReviewMode;
  open_blocker_count: number;
  resolved_blocker_count: number;
  /** Derived triage bucket; null when finished/rejected/withdrawn. */
  attention: ProposalAttention | null;
  no_auto_retry: boolean;
  escalated: boolean;
  escalated_at: number | null;
  escalated_by: string | null;
  escalated_note: string | null;
  close_reason: ProposalStoredCloseReason | null;
  close_note: string | null;
  closed_by: string | null;
  closed_at: number | null;
  /** Last non-author blocker add/reopen/resolve — latest feedback, not approval. */
  reviewer_action_at: number | null;
  reviewer_action_by: string | null;
  reviewer_action_by_actor: Record<string, unknown>;
  related_entries: RelatedEntryRef[];
  /** Author-declared review situation ids (edits triage). */
  review_situations: string[];
  review_context_snapshot: Record<string, unknown> | null;
  supersedes_proposal_id: string | null;
  replaced_by_proposal_id: string | null;
  accepted_entry: AcceptedEntry | null;
  /** Structured funnel on ideas (new-URL); null when unset or non-idea. */
  idea_funnel: IdeaFunnel | null;
  /** Keyword + cluster decision on ideas (new-URL); null when unset or non-idea. */
  idea_seo_target: IdeaSeoTarget | null;
  implements_proposal_id: string | null;
  /**
   * Accepted idea whose locked page is missing and a proposal can create it.
   * Computed on read — not stored. Author follow-up is edits with no variant.
   */
  attached_create_entry?: AcceptedEntry | null;
  accepted_entry_create_mode?: AcceptedEntryCreateMode | null;
  accepted_entry_layout_owner?: LayoutOwner | null;
  outcome_review: ProposalOutcomeVerdict | null;
  outcome_review_note: string | null;
  outcome_review_expected: string | null;
  outcome_review_at: number | null;
  outcome_review_by: string | null;
  outcome_lesson_captured_at: number | null;
  outcome_lesson_captured_by: string | null;
  outcome_lesson_note: string | null;
  entry_count: number;
  system_version: string | null;
  all_or_nothing: boolean;
  stale_since: string | null;
  stale_flagged_at: string | null;
  blocked_flagged_at: string | null;
  reverts_proposal_id: string | null;
  applies_after_proposal_id: string | null;
  applied_before_proposal_ids: string[];
  dependent_overdue_flagged_at: string | null;
  /** Unique field paths across all entry ops (sorted). */
  field_paths: string[];
  entries: ProposalEntrySummary[];
  escalated_siblings?: Array<{ id: string; title: string }>;
};

function attentionForRecord(record: ProposalRecord): ProposalAttention | null {
  return deriveProposalAttention({
    status: record.status,
    escalated: record.escalated,
    open_blocker_count: record.open_blocker_count,
    resolved_blocker_count: resolvedBlockerCount(record.blockers),
    author_content_at: record.author_content_at,
    reviewer_action_at: record.reviewer_action_at,
    needs_author: record.stale_since != null,
    predecessor_applied: record.predecessor_applied === true,
  });
}

export function toProposalSummary(record: ProposalRecord): ProposalSummary {
  const pathSet = new Set<string>();
  for (const e of record.entries) {
    for (const op of e.ops ?? []) {
      if (typeof op.field_path === "string" && op.field_path.trim()) {
        pathSet.add(op.field_path);
      }
    }
  }
  const field_paths = [...pathSet].sort();
  const resolved_count = resolvedBlockerCount(record.blockers);
  const attention = attentionForRecord(record);
  return {
    detail: "summary",
    id: record.id,
    site: record.site,
    status: record.status,
    kind: record.kind,
    category: record.category,
    title: record.title,
    summary: record.summary,
    related_issue_ids: record.related_issue_ids,
    proposer_username: record.proposer_username,
    proposer_actor: record.proposer_actor,
    created_at: record.created_at,
    updated_at: record.updated_at,
    claim: record.claim,
    tags: record.tags,
    created_agent_session_id: record.created_agent_session_id,
    promote_on_apply: record.promote_on_apply,
    review_mode: record.review_mode,
    open_blocker_count: record.open_blocker_count,
    resolved_blocker_count: resolved_count,
    attention,
    no_auto_retry: record.no_auto_retry,
    escalated: record.escalated,
    escalated_at: record.escalated_at,
    escalated_by: record.escalated_by,
    escalated_note: record.escalated_note,
    close_reason: record.close_reason,
    close_note: record.close_note,
    closed_by: record.closed_by,
    closed_at: record.closed_at,
    reviewer_action_at: record.reviewer_action_at,
    reviewer_action_by: record.reviewer_action_by,
    reviewer_action_by_actor: record.reviewer_action_by_actor,
    related_entries: record.related_entries,
    review_situations: record.review_situations ?? [],
    review_context_snapshot: record.review_context_snapshot,
    supersedes_proposal_id: record.supersedes_proposal_id,
    replaced_by_proposal_id: record.replaced_by_proposal_id,
    accepted_entry: record.accepted_entry,
    idea_funnel: record.idea_funnel,
    idea_seo_target: record.idea_seo_target,
    implements_proposal_id: record.implements_proposal_id,
    attached_create_entry: record.attached_create_entry ?? null,
    accepted_entry_create_mode: record.accepted_entry_create_mode ?? null,
    accepted_entry_layout_owner: record.accepted_entry_layout_owner ?? null,
    outcome_review: record.outcome_review,
    outcome_review_note: record.outcome_review_note,
    outcome_review_expected: record.outcome_review_expected,
    outcome_review_at: record.outcome_review_at,
    outcome_review_by: record.outcome_review_by,
    outcome_lesson_captured_at: record.outcome_lesson_captured_at,
    outcome_lesson_captured_by: record.outcome_lesson_captured_by,
    outcome_lesson_note: record.outcome_lesson_note,
    entry_count: record.entries.length,
    system_version: record.system_version,
    all_or_nothing: record.all_or_nothing,
    stale_since: record.stale_since,
    stale_flagged_at: record.stale_flagged_at,
    blocked_flagged_at: record.blocked_flagged_at,
    reverts_proposal_id: record.reverts_proposal_id,
    applies_after_proposal_id: record.applies_after_proposal_id,
    applied_before_proposal_ids: record.applied_before_proposal_ids ?? [],
    dependent_overdue_flagged_at: record.dependent_overdue_flagged_at,
    field_paths,
    entries: record.entries.map((e) => ({
      contentType: e.contentType,
      slug: e.slug,
      locale: e.locale,
      variant: e.variant,
      status: e.status,
      ...(e.last_error ? { last_error: e.last_error } : {}),
    })),
    ...(record.escalated_siblings?.length
      ? { escalated_siblings: record.escalated_siblings }
      : {}),
  };
}

type ProposalRow = {
  id: string;
  site: string;
  fingerprint: string;
  status: ProposalStatus;
  kind: ProposalKind;
  category: ProposalCategory;
  title: string;
  summary: string;
  rationale: string | null;
  documentation_json: string;
  related_issue_ids_json: string;
  proposer_username: string;
  proposer_actor_json: string;
  created_at: number;
  updated_at: number;
  claim_json: string | null;
  tags_json: string;
  search_text: string;
  created_agent_session_id: string | null;
  promote_on_apply: number;
  no_auto_retry: number;
  escalated?: number;
  escalated_at?: number | null;
  escalated_by?: string | null;
  escalated_note?: string | null;
  close_reason: string | null;
  close_note: string | null;
  closed_by: string | null;
  closed_at: number | null;
  related_entries_json: string | null;
  review_situations_json?: string | null;
  review_context_snapshot_json: string | null;
  decision_debug_json?: string | null;
  supersedes_proposal_id: string | null;
  replaced_by_proposal_id: string | null;
  accepted_entry_json?: string | null;
  idea_funnel_json?: string | null;
  idea_seo_target_json?: string | null;
  seo_target_override_json?: string | null;
  url_slug_override_json?: string | null;
  implements_proposal_id?: string | null;
  author_content_at?: number | null;
  reviewer_action_at?: number | null;
  reviewer_action_by?: string | null;
  reviewer_action_by_actor_json?: string | null;
  outcome_review?: string | null;
  outcome_review_note?: string | null;
  outcome_review_expected?: string | null;
  outcome_review_at?: number | null;
  outcome_review_by?: string | null;
  outcome_review_history_json?: string | null;
  outcome_lesson_captured_at?: number | null;
  outcome_lesson_captured_by?: string | null;
  outcome_lesson_note?: string | null;
  system_version?: string | null;
  co_authors_json?: string | null;
  all_or_nothing?: number | null;
  reverts_proposal_id?: string | null;
  stale_since?: string | null;
  stale_flagged_at?: string | null;
  blocked_flagged_at?: string | null;
  applies_after_proposal_id?: string | null;
  dependent_overdue_flagged_at?: string | null;
};

type EntryDbRow = {
  id: number;
  proposal_id: string;
  entry_key: string;
  locale: string;
  variant: string | null;
  variant_fingerprint: string | null;
  status: EntryRowStatus;
  ops_json: string;
  baseline_context_json: string;
  last_error: string | null;
  applied_at: number | null;
  applied_by: string | null;
  created_draft?: number | null;
  derived_ops_json?: string | null;
  derived_for_key?: string | null;
  published_diff_json?: string | null;
  pre_apply_snapshot_json?: string | null;
};

type BlockerDbRow = {
  id: number;
  proposal_id: string;
  kind: string;
  body: string;
  staff_summary?: string | null;
  status: BlockerStatus;
  author: string;
  created_at: number;
  resolved_at: number | null;
  resolved_by: string | null;
  resolve_note: string | null;
  agent_session_id: string | null;
  author_actor_json: string | null;
  resolved_by_actor_json: string | null;
};

export type CreateProposalInput = {
  title: string;
  summary: string;
  rationale?: string;
  category?: ProposalCategory;
  documentation?: Record<string, unknown>;
  related_issue_ids?: string[];
  tags?: string[];
  entries?: ProposalEntryInput[];
  confirm_distinct?: boolean;
  /** Soft-confirm after inspecting recent entry writes (see confirm_recent_activity gate). */
  confirm_recent_activity?: boolean;
  situation_note?: string;
  agent_session_id?: string;
  promote_on_apply?: boolean;
  /** Explicit notes|idea when no entries; default notes. Ignored when entries/promote. */
  kind?: "notes" | "idea";
  related_entries?: RelatedEntryRef[];
  /** Optional: link a replacement to a rejected/withdrawn predecessor. */
  supersedes_proposal_id?: string;
  /** Edits: link to an accepted idea this work implements. */
  implements_proposal_id?: string;
  /**
   * Optional author-declared review situations (edits only).
   * Empty/omit → classifier infers from pending ops. Unknown ids fail create.
   */
  review_situations?: string[];
  /**
   * Ideas (new-URL): optional structured funnel `{ stage, products }`.
   * Soft warning when missing on new-URL create; accept refuses until complete.
   */
  idea_funnel?: IdeaFunnel | { stage?: string; products?: unknown };
  /**
   * Ideas (new-URL): focus keyword + cluster decision. Soft warning when missing
   * on create; accept refuses until complete (monitored types).
   */
  idea_seo_target?: unknown;
  /** Edits implementing an idea: reason seo.* ops differ from the locked target. */
  seo_target_override?: unknown;
  /** Edits implementing an idea: reason the slug op differs from the idea's locked url_slug. */
  url_slug_override?: unknown;
  /** v1.0 edits: publish every entry or none on apply. */
  all_or_nothing?: boolean;
  /** v1.0: this proposal reverts an applied proposal (prefilled by revert). */
  reverts_proposal_id?: string;
  /** Order-only chain: apply waits until this proposal is fully applied. */
  applies_after_proposal_id?: string;
};

export type SimilarProposal = { id: string; title: string; score: number };

export type ProposalUpdateAction =
  | "claim"
  | "release"
  | "withdraw"
  | "apply"
  | "acknowledge"
  | "close"
  | "reject"
  | "attach_variant"
  | "add_blocker"
  | "resolve_blocker"
  | "reopen_blocker"
  | "set_no_auto_retry"
  | "accept"
  | "revise_entries"
  | "set_review_situations"
  | "set_idea_funnel"
  | "set_idea_seo_target"
  | "set_related_entries"
  | "set_applies_after"
  | "escalate"
  | "deescalate"
  | "review_outcome"
  | "set_outcome_lesson"
  | "revert";

export type ProposalUpdateCaller = {
  username: string;
  report?: string;
  asStaff?: boolean;
  agent_session_id?: string;
  /** Provenance for claim (and any future actor-storing actions). */
  actor?: EventActor;
  body?: string;
  /** add_blocker: plain-English version for staff. Required from MCP; staff UI notes reuse `body`. */
  staff_summary?: string;
  blocker_id?: number;
  resolve_note?: string;
  variant?: string;
  contentType?: string;
  slug?: string;
  locale?: string;
  confirm_end_experiment?: boolean;
  /** Soft-confirm after inspecting recent entry writes on apply. */
  confirm_recent_activity?: boolean;
  /** Apply of a new attached post: principal approved a URL param not seen on peers. */
  confirm_new_values?: boolean;
  promote_on_apply?: boolean;
  close_reason?: string;
  close_note?: string;
  no_auto_retry?: boolean;
  /** Accept idea: free-text next step (min MIN_ACCEPT_NEXT_STEP). */
  next_step?: string;
  /** Accept idea: required locked page target. */
  accepted_entry?: AcceptedEntry | { contentType?: string; slug?: string; locale?: string };
  /** Reject: must be true for MCP; staff UI sends true after dialog. */
  confirm_reject?: boolean;
  reject_kind?: string;
  /** revise_entries: replacement pending entry set. */
  entries?: ProposalEntryInput[];
  /** set_review_situations: author-declared situation ids (edits). */
  review_situations?: string[];
  /** set_idea_funnel / create: structured funnel for new-URL ideas. */
  idea_funnel?: IdeaFunnel | { stage?: string; products?: unknown };
  /** set_idea_seo_target: keyword + cluster decision for new-URL ideas. */
  idea_seo_target?: unknown;
  /** set_related_entries: replacement idea related pages (target page type + slug). */
  related_entries?: unknown;
  /** revise_entries: reason seo.* ops differ from the implemented idea's locked target. */
  seo_target_override?: unknown;
  /** revise_entries: reason the slug op differs from the implemented idea's locked url_slug. */
  url_slug_override?: unknown;
  /** escalate: required steward note (min MIN_CLOSE_NOTE). */
  escalated_note?: string;
  /** review_outcome: good | bad | clear. */
  outcome_review?: string;
  /** review_outcome: what went wrong (bad: required) or optional note (good). */
  outcome_review_note?: string;
  /** review_outcome bad: what should have happened instead. */
  outcome_review_expected?: string;
  /** set_outcome_lesson: true marks the lesson as captured; false unmarks. */
  outcome_lesson_captured?: boolean;
  outcome_lesson_note?: string;
  /** apply (v1.0): run every check and return the merge preview; write nothing. */
  dry_run?: boolean;
  /** revise_entries (v1.0): toggle all-or-nothing apply. */
  all_or_nothing?: boolean;
  /** apply (v1.0): publish drafts whose base version is unknown (pre-1.0 drafts). */
  confirm_base_unknown?: boolean;
  /** apply (v1.0): staff confirmed publishing text over component text_limits. Ignored for MCP callers. */
  confirm_text_limits?: boolean;
  /** Request came through MCP (x-mcp-author): text-limit violations cannot be confirmed. */
  caller_is_mcp?: boolean;
  /** apply (v1.0) of a template proposal: must equal `affected_entries.count`. */
  confirm_affected_entries?: number;
  /** set_applies_after: predecessor id, or null / "" to unlink. */
  applies_after_proposal_id?: string | null;
};

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function splitEntryKey(entryKey: string): { contentType: string; slug: string } {
  const i = entryKey.indexOf("/");
  if (i <= 0) return { contentType: entryKey, slug: "" };
  return { contentType: entryKey.slice(0, i), slug: entryKey.slice(i + 1) };
}

function makeEntryKey(contentType: string, slug: string): string {
  return `${contentType}/${slug}`;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

function rollupStatus(kind: ProposalKind, entries: ProposalEntryRow[]): ProposalStatus {
  if (kind === "notes" || kind === "idea") return "open";
  if (entries.length === 0) return "open";
  if (entries.every((e) => e.status === "done")) return "finished";
  if (entries.some((e) => e.status === "done")) return "partial";
  return "open";
}

export function deriveReviewMode(opts: {
  promote_on_apply: boolean;
  entries: Array<{ variant?: string | null }>;
}): ReviewMode {
  if (opts.promote_on_apply) return "draft_backed";
  if (opts.entries.some((e) => Boolean(e.variant))) return "soft_variant";
  return "soft";
}

function parseActorRecord(raw: string | null): Record<string, unknown> {
  const parsed = parseJson<unknown>(raw, {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

/** Snapshot replace: missing or non-object actor fields stay SQL NULL. */
function blockerActorColumn(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return JSON.stringify(raw);
}

function mapBlocker(row: BlockerDbRow): ProposalBlocker {
  return {
    id: row.id,
    proposal_id: row.proposal_id,
    kind: "blocker",
    body: row.body,
    staff_summary: row.staff_summary ?? null,
    status: row.status,
    author: row.author,
    created_at: row.created_at,
    resolved_at: row.resolved_at,
    resolved_by: row.resolved_by,
    resolve_note: row.resolve_note,
    agent_session_id: row.agent_session_id,
    author_actor: parseActorRecord(row.author_actor_json),
    resolved_by_actor: parseActorRecord(row.resolved_by_actor_json),
  };
}

/** v1.0 derived ops view cache per loaded entry (`derived_ops_json` + key). */
const derivedViewCache = new WeakMap<
  ProposalEntryRow,
  { key: string | null; json: string | null }
>();

function mapEntry(row: EntryDbRow): ProposalEntryRow {
  const { contentType, slug } = splitEntryKey(row.entry_key);
  const entry: ProposalEntryRow = {
    id: row.id,
    proposal_id: row.proposal_id,
    entry_key: row.entry_key,
    locale: row.locale,
    variant: row.variant,
    variant_fingerprint: row.variant_fingerprint ?? null,
    status: row.status,
    ops: parseJson(row.ops_json, []),
    baseline_context: parseJson(row.baseline_context_json, { values: {} }),
    last_error: row.last_error,
    applied_at: row.applied_at,
    applied_by: row.applied_by,
    contentType,
    slug,
    ...(row.created_draft ? { created_draft: true } : {}),
    ...(row.published_diff_json
      ? {
          published_diff: parseJson<FieldChange[] | null>(
            row.published_diff_json,
            null,
          ),
        }
      : {}),
  };
  derivedViewCache.set(entry, {
    key: row.derived_for_key ?? null,
    json: row.derived_ops_json ?? null,
  });
  return entry;
}

function mapProposal(
  row: ProposalRow,
  entries: ProposalEntryRow[],
  blockers: ProposalBlocker[],
): ProposalRecord {
  const promote_on_apply = Boolean(row.promote_on_apply);
  return {
    id: row.id,
    site: row.site,
    fingerprint: row.fingerprint,
    status: row.status,
    kind: row.kind,
    category: row.category,
    title: row.title,
    summary: row.summary,
    rationale: row.rationale,
    documentation: parseJson(row.documentation_json, {}),
    related_issue_ids: parseJson(row.related_issue_ids_json, []),
    proposer_username: row.proposer_username,
    proposer_actor: parseJson(row.proposer_actor_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
    claim: parseJson(row.claim_json, null),
    tags: parseJson(row.tags_json, []),
    search_text: row.search_text,
    created_agent_session_id: row.created_agent_session_id ?? null,
    promote_on_apply,
    review_mode: row.system_version
      ? "draft_backed"
      : deriveReviewMode({ promote_on_apply, entries }),
    open_blocker_count: blockers.filter((b) => b.status === "open").length,
    no_auto_retry: Boolean(row.no_auto_retry),
    escalated: Boolean(row.escalated),
    escalated_at: row.escalated_at ?? null,
    escalated_by: row.escalated_by ?? null,
    escalated_note: row.escalated_note ?? null,
    close_reason: (row.close_reason as ProposalStoredCloseReason | null) ?? null,
    close_note: row.close_note ?? null,
    closed_by: row.closed_by ?? null,
    closed_at: row.closed_at ?? null,
    related_entries: parseJson(row.related_entries_json ?? null, [] as RelatedEntryRef[]),
    review_situations: parseJson(row.review_situations_json ?? null, [] as string[]),
    review_context_snapshot: parseJson(row.review_context_snapshot_json ?? null, null as Record<
      string,
      unknown
    > | null),
    decision_debug: parseJson(row.decision_debug_json ?? null, null as ProposalDecisionDebug | null),
    supersedes_proposal_id: row.supersedes_proposal_id ?? null,
    replaced_by_proposal_id: row.replaced_by_proposal_id ?? null,
    accepted_entry: parseAcceptedEntry(parseJson(row.accepted_entry_json ?? null, null)),
    idea_funnel: parseIdeaFunnel(parseJson(row.idea_funnel_json ?? null, null)),
    idea_seo_target: parseIdeaSeoTarget(parseJson(row.idea_seo_target_json ?? null, null)),
    seo_target_override: parseSeoTargetOverride(parseJson(row.seo_target_override_json ?? null, null)),
    url_slug_override: parseUrlSlugOverride(parseJson(row.url_slug_override_json ?? null, null)),
    implements_proposal_id: row.implements_proposal_id ?? null,
    author_content_at: row.author_content_at ?? null,
    reviewer_action_at: row.reviewer_action_at ?? null,
    reviewer_action_by: row.reviewer_action_by ?? null,
    reviewer_action_by_actor: parseJson(row.reviewer_action_by_actor_json ?? null, {}),
    outcome_review: parseOutcomeVerdict(row.outcome_review),
    outcome_review_note: row.outcome_review_note ?? null,
    outcome_review_expected: row.outcome_review_expected ?? null,
    outcome_review_at: row.outcome_review_at ?? null,
    outcome_review_by: row.outcome_review_by ?? null,
    outcome_review_history: parseJson(
      row.outcome_review_history_json ?? null,
      [] as ProposalOutcomeHistoryEntry[],
    ),
    outcome_lesson_captured_at: row.outcome_lesson_captured_at ?? null,
    outcome_lesson_captured_by: row.outcome_lesson_captured_by ?? null,
    outcome_lesson_note: row.outcome_lesson_note ?? null,
    system_version: row.system_version ?? null,
    co_authors: parseJson(row.co_authors_json ?? null, [] as CoAuthor[]),
    all_or_nothing: Boolean(row.all_or_nothing),
    reverts_proposal_id: row.reverts_proposal_id ?? null,
    stale_since: row.stale_since ?? null,
    stale_flagged_at: row.stale_flagged_at ?? null,
    blocked_flagged_at: row.blocked_flagged_at ?? null,
    applies_after_proposal_id: row.applies_after_proposal_id ?? null,
    dependent_overdue_flagged_at: row.dependent_overdue_flagged_at ?? null,
    entries: row.system_version ? entries.map(withCachedView) : entries,
    blockers,
  };
}

/** Chain view for one record: dependents + whether the predecessor is fully applied. */
function withChainInfo(db: Database.Database, record: ProposalRecord): ProposalRecord {
  let dependents: string[] = [];
  let predecessorApplied = false;
  try {
    dependents = (
      db
        .prepare(`SELECT id FROM content_proposals WHERE applies_after_proposal_id = ? ORDER BY created_at ASC`)
        .all(record.id) as Array<{ id: string }>
    ).map((r) => r.id);
    if (record.applies_after_proposal_id) {
      const pred = db
        .prepare(`SELECT status FROM content_proposals WHERE id = ?`)
        .get(record.applies_after_proposal_id) as { status: string } | undefined;
      predecessorApplied = pred?.status === "finished";
    }
  } catch {
    // Pre-v37 DB without the column — no chain.
  }
  return { ...record, applied_before_proposal_ids: dependents, predecessor_applied: predecessorApplied };
}

/** Swap in the cached draft view (no file reads). Detail loads re-verify the key. */
function withCachedView(entry: ProposalEntryRow): ProposalEntryRow {
  const cached = derivedViewCache.get(entry);
  if (!cached?.json) return entry;
  const view = parseJson<{
    changes: FieldChange[];
    approximate: boolean;
  } | null>(cached.json, null);
  if (!view) return entry;
  const derived = entryViewFromDiff(entry.ops, view.changes, view.approximate);
  const next = {
    ...entry,
    ...derived,
    baseline_context: withFilingOwner(derived.baseline_context, entry.baseline_context),
  };
  derivedViewCache.set(next, cached);
  return next;
}

/** The derived view replaces `baseline_context`; keep the owner stored at filing. */
function withFilingOwner(
  derived: ProposalEntryRow["baseline_context"],
  stored: ProposalEntryRow["baseline_context"] | undefined,
): ProposalEntryRow["baseline_context"] {
  return stored?.layout_owner ? { ...derived, layout_owner: stored.layout_owner } : derived;
}

/** v1.0: `ops` / `baseline_context` are a read-only view of the draft (author diff). */
export function entryViewFromDiff(
  requested: FieldUpdate[],
  changes: FieldChange[],
  approximate: boolean,
): Pick<
  ProposalEntryRow,
  | "ops"
  | "baseline_context"
  | "author_diff"
  | "author_diff_approximate"
  | "requested_ops"
  | "ops_match_request"
  | "unrequested_fields"
  | "sections_summary"
> {
  const ops: FieldUpdate[] = changes.map((c) =>
    c.removed
      ? { field_path: c.field_path, op: "remove" as const, reset: true }
      : { field_path: c.field_path, value: c.after },
  );
  const values: Record<string, unknown> = {};
  for (const c of changes) values[c.field_path] = c.before;
  if (process.env.NODE_ENV !== "production") {
    Object.freeze(ops);
    Object.freeze(values);
  }
  const sectionsChange = changes.find((c) => c.field_path === "sections");
  const unrequested = unrequestedFields(requested, changes);
  return {
    ops,
    baseline_context: { values },
    author_diff: changes,
    author_diff_approximate: approximate,
    requested_ops: requested,
    ops_match_request: unrequested.length === 0 && requestedMatchesView(requested, changes),
    ...(unrequested.length ? { unrequested_fields: unrequested } : {}),
    ...(sectionsChange ? { sections_summary: summarizeSectionsChange(sectionsChange.before, sectionsChange.after) } : {}),
  };
}

/** Stamped by the editor on every content change, so never part of what the author sends. */
const SYSTEM_STAMPED_FIELDS = new Set(["updated_at", "_updated_at"]);

/** Draft fields that change although no requested op covers them (empty request = whole-draft go-live). */
function unrequestedFields(requested: FieldUpdate[], changes: FieldChange[]): string[] {
  if (requested.length === 0) return [];
  return changes
    .map((c) => c.field_path)
    .filter(
      (p) =>
        !SYSTEM_STAMPED_FIELDS.has(p) &&
        !requested.some(
          (op) => op.field_path === p || op.field_path.startsWith(`${p}.`) || p.startsWith(`${op.field_path}.`),
        ),
    );
}

function valueUnder(value: unknown, rest: string): unknown {
  if (!rest) return value;
  return rest
    .split(".")
    .reduce<unknown>(
      (cur, k) =>
        cur && typeof cur === "object" && !Array.isArray(cur)
          ? (cur as Record<string, unknown>)[k]
          : undefined,
      value,
    );
}

/** Every requested op is reflected in the draft view (paths may be deeper than view fields). */
function requestedMatchesView(
  requested: FieldUpdate[],
  changes: FieldChange[],
): boolean {
  for (const op of requested) {
    const removal =
      op.reset === true || op.op === "remove" || op.value === null;
    const change = changes.find(
      (c) =>
        c.field_path === op.field_path ||
        op.field_path.startsWith(`${c.field_path}.`),
    );
    if (!change) {
      if (removal) continue;
      return false;
    }
    const rest =
      op.field_path === change.field_path
        ? ""
        : op.field_path.slice(change.field_path.length + 1);
    if (removal) {
      if (!change.removed && valueUnder(change.after, rest) != null)
        return false;
      continue;
    }
    if (!valuesEqual(valueUnder(change.after, rest), op.value)) return false;
  }
  return true;
}

function parseOutcomeVerdict(
  raw: string | null | undefined,
): ProposalOutcomeVerdict | null {
  return raw === "good" || raw === "bad" ? raw : null;
}

function dbFor(site: string): Database.Database {
  ensurePipelineDb(site);
  return getSiteSqlite(site);
}

function loadEntries(db: Database.Database, proposalId: string): ProposalEntryRow[] {
  const rows = db
    .prepare(`SELECT * FROM content_proposal_entries WHERE proposal_id = ? ORDER BY id`)
    .all(proposalId) as EntryDbRow[];
  return rows.map(mapEntry);
}

function loadBlockers(db: Database.Database, proposalId: string): ProposalBlocker[] {
  try {
    const rows = db
      .prepare(`SELECT * FROM content_proposal_blockers WHERE proposal_id = ? ORDER BY id`)
      .all(proposalId) as BlockerDbRow[];
    return rows.map(mapBlocker);
  } catch {
    return [];
  }
}

function loadProposal(db: Database.Database, id: string): ProposalRecord | null {
  const row = db.prepare(`SELECT * FROM content_proposals WHERE id = ?`).get(id) as ProposalRow | undefined;
  if (!row) return null;
  return withChainInfo(db, mapProposal(row, loadEntries(db, id), loadBlockers(db, id)));
}

export type ProposalDeletion = { deleted_by: string; deleted_at: number };

export type ProposalDeleteResult = {
  id: string;
  status: "deleted" | "not_found" | "blocked_dependents" | "error";
  reason?: string;
  dependents?: Array<{ id: string; title: string }>;
  drafts_removed: string[];
  drafts_unlinked: string[];
  drafts_kept: string[];
};

/** Staff bulk-delete tombstone (from the `proposal_deleted` event) for an id with no row. */
function findProposalDeletion(
  db: Database.Database,
  site: string,
  id: string,
): ProposalDeletion | null {
  try {
    const row = db
      .prepare(
        `SELECT created_at, attribution_json FROM events
         WHERE site = ? AND type = 'proposal_deleted'
           AND json_extract(payload_json, '$.proposal_id') = ?
         ORDER BY id DESC LIMIT 1`,
      )
      .get(site, id) as { created_at: number; attribution_json: string } | undefined;
    if (!row) return null;
    const attribution = parseJson<Array<{ author?: string }>>(row.attribution_json, []);
    return { deleted_by: attribution[0]?.author || "staff", deleted_at: row.created_at };
  } catch {
    return null;
  }
}

export function proposalDeletedError(deletion: ProposalDeletion): {
  ok: false;
  code: "proposal_deleted";
  error: string;
  deleted_by: string;
  deleted_at: string;
} {
  const at = new Date(deletion.deleted_at).toISOString();
  return {
    ok: false,
    code: "proposal_deleted",
    error: `Proposal was deleted by staff (${deletion.deleted_by} at ${at}). Do not re-file unless staff ask.`,
    deleted_by: deletion.deleted_by,
    deleted_at: at,
  };
}

/** One proposal in export shape (entries + blockers + v1.0 pre-apply snapshots). */
function exportProposalRow(db: Database.Database, row: ProposalRow): ProposalRecord {
  const record = mapProposal(row, loadEntries(db, row.id), loadBlockers(db, row.id));
  if (!row.system_version) return record;
  const snapshots = new Map(
    (
      db
        .prepare(
          `SELECT id, pre_apply_snapshot_json FROM content_proposal_entries
           WHERE proposal_id = ? AND pre_apply_snapshot_json IS NOT NULL`,
        )
        .all(row.id) as Array<{ id: number; pre_apply_snapshot_json: string }>
    ).map((r) => [r.id, r.pre_apply_snapshot_json]),
  );
  return {
    ...record,
    entries: record.entries.map((e) => {
      const raw = snapshots.get(e.id);
      return raw ? { ...e, pre_apply_snapshot: parseJson(raw, null) } : e;
    }),
  };
}

function callerIsProposer(proposal: ProposalRecord, caller: ProposalUpdateCaller): boolean {
  return sameAgentIdentity(
    proposal.proposer_username,
    asAgentActor(proposal.proposer_actor),
    caller.username,
    asAgentActor(caller.actor),
  );
}

/** Author actions never reach here — the proposer is not their own reviewer. */
function stampReviewerAction(
  db: Database.Database,
  id: string,
  now: number,
  caller: ProposalUpdateCaller,
): void {
  db.prepare(
    `UPDATE content_proposals
     SET updated_at = ?, reviewer_action_at = ?, reviewer_action_by = ?, reviewer_action_by_actor_json = ?
     WHERE id = ?`,
  ).run(now, now, caller.username, JSON.stringify(caller.actor ?? {}), id);
}

function persistRollup(
  db: Database.Database,
  proposal: ProposalRecord,
  opts?: { closedBy?: string },
): ProposalStatus {
  if (proposal.kind === "notes" || proposal.kind === "idea") return proposal.status;
  const next = rollupStatus(proposal.kind, proposal.entries);
  const now = Date.now();
  if (next === "finished" && proposal.status !== "finished") {
    db.prepare(
      `UPDATE content_proposals
       SET status = ?, updated_at = ?,
           closed_at = COALESCE(closed_at, ?),
           closed_by = COALESCE(closed_by, ?)
       WHERE id = ?`,
    ).run(next, now, now, opts?.closedBy ?? null, proposal.id);
  } else {
    db.prepare(`UPDATE content_proposals SET status = ?, updated_at = ? WHERE id = ?`).run(
      next,
      now,
      proposal.id,
    );
  }
  return next;
}

function activeClaim(
  proposal: ProposalRecord,
  now = Date.now(),
): { active: ProposalClaim | null; expired: boolean } {
  const claim = proposal.claim;
  if (!claim) return { active: null, expired: false };
  if (new Date(claim.expiresAt).getTime() <= now) return { active: null, expired: true };
  return { active: claim, expired: false };
}

/** Open/partial notes with no_auto_retry that share any related issue id. */
function findOpenNotesBlockingRetry(
  db: Database.Database,
  site: string,
  relatedIssueIds: string[],
): ProposalRecord | null {
  if (relatedIssueIds.length === 0) return null;
  const rows = db
    .prepare(
      `SELECT * FROM content_proposals
       WHERE site = ? AND kind = 'notes' AND status IN ('open', 'partial') AND no_auto_retry = 1`,
    )
    .all(site) as ProposalRow[];
  for (const row of rows) {
    const ids = parseJson<string[]>(row.related_issue_ids_json, []);
    if (relatedIssueIds.some((id) => ids.includes(id))) {
      return mapProposal(row, loadEntries(db, row.id), loadBlockers(db, row.id));
    }
  }
  return null;
}

function validateCloseReason(
  reasonRaw: string | undefined,
  noteRaw: string | undefined,
):
  | { ok: true; reason: ProposalCloseReason; note: string | null }
  | { ok: false; code: string; error: string } {
  const reason = (reasonRaw || "").trim();
  if (reason === "accepted") {
    return {
      ok: false,
      code: "use_accept",
      error: "Use action accept with next_step to greenlight an idea",
    };
  }
  if (!isProposalCloseReason(reason)) {
    return {
      ok: false,
      code: "close_reason_required",
      error: `close_reason required: ${PROPOSAL_CLOSE_REASONS.join(" | ")}`,
    };
  }
  const note = (noteRaw || "").trim();
  if (reason !== "wont_fix" && note.length < MIN_CLOSE_NOTE) {
    return {
      ok: false,
      code: "close_note_required",
      error: `close_note required (min ${MIN_CLOSE_NOTE} characters) for ${reason}: say where / what`,
    };
  }
  return { ok: true, reason, note: note || null };
}

function emitProposalEvent(
  site: string,
  type:
    | "proposal_created"
    | "proposal_applied_progress"
    | "proposal_finished"
    | "proposal_acknowledged"
    | "proposal_closed"
    | "proposal_rejected"
    | "proposal_withdrawn"
    | "proposal_revised"
    | "proposal_escalated"
    | "proposal_deescalated"
    | "proposal_outcome_reviewed"
    | "proposal_outcome_lesson_set"
    | "proposal_review_situations_set"
    | "proposal_idea_funnel_set"
    | "proposal_idea_seo_target_set"
    | "proposal_reverted"
    | "proposal_stale_flagged"
    | "proposal_closed_abandoned_stale"
    | "proposal_blocked_flagged"
    | "proposal_closed_abandoned_blocked"
    | "proposal_needs_author"
    | "proposal_applies_after_set"
    | "proposal_predecessor_closed"
    | "proposal_dependent_overdue"
    | "proposal_migrated_v1"
    | "draft_rebuilt"
    | "draft_orphan_cleaned"
    | "proposal_co_author_edit"
    | "proposal_deleted",
  proposalId: string,
  author: string,
  payload: Record<string, unknown> = {},
  actor?: EventActor,
): void {
  if (
    type === "proposal_created" ||
    type === "proposal_finished" ||
    type === "proposal_closed" ||
    type === "proposal_rejected" ||
    type === "proposal_withdrawn" ||
    type === "proposal_closed_abandoned_stale" ||
    type === "proposal_closed_abandoned_blocked" ||
    type === "proposal_applied_progress" ||
    type === "proposal_deleted"
  ) {
    invalidateKpiCache(site);
  }
  emitEvent({
    site,
    type,
    attribution: singleAttribution(author, actor),
    payload: { proposal_id: proposalId, ...payload },
  });
}

export type AffectedEntries = {
  count: number;
  sample: Array<{ contentType: string; slug: string; locale: string; variant: string | null }>;
};

export type PromoteEntryOpts = {
  confirm_end_experiment?: boolean;
  /** Run every promote check (incl. rebuild preview) without writing. */
  dry_run?: boolean;
  /** Reviewer confirmed publishing a draft whose base version is unknown. */
  confirm_base_unknown?: boolean;
  /** Reviewer confirmed publishing text over component text_limits (staff only). */
  confirm_text_limits?: boolean;
  caller_is_mcp?: boolean;
  /** New locale published standalone (seo.pillar_path: null): the proposal's seo_target_override reason. */
  seo_standalone_reason?: string | null;
};

export type PromoteEntryResult = {
  ok: boolean;
  error?: string;
  code?: string;
  traffic_siblings?: Array<{
    slug: string;
    locale: string;
    allocation: number;
  }>;
  details?: Record<string, unknown>;
  warnings?: Array<{ code: string; message: string; fields?: string[] }>;
  rebuilt?: { kept_live_fields: string[]; author_fields: string[] };
  published_diff?: FieldChange[];
  pre_apply_snapshot?: { live: string | null; common: string | null };
  dry_run?: boolean;
};

/** One entry of a v1.0 apply (dry run or pending list after a partial apply). */
export type ApplyEntryPreview = {
  entry_key: string;
  locale: string;
  variant: string | null;
  ok: boolean;
  code?: string;
  error?: string;
  details?: Record<string, unknown>;
  rebuilt?: { kept_live_fields: string[]; author_fields: string[] };
  published_diff?: FieldChange[];
  /** Non-blocking publish notes for reviewers (e.g. `display_values_change`). */
  warnings?: Array<{ code: string; message: string; fields?: string[] }>;
};

export type ProposalServiceDeps = {
  site: string;
  issueExists: (id: string) => boolean;
  captureBaseline: (entry: ProposalEntryInput) => { values: Record<string, unknown>; error?: string };
  applyUpdates: (
    entry: ProposalEntryRow,
    author: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  readVariantFingerprint?: (entry: {
    contentType: string;
    slug: string;
    locale: string;
    variant: string;
  }) => { fingerprint: string; error?: string };
  promoteEntry?: (
    entry: ProposalEntryRow,
    author: string,
    opts: PromoteEntryOpts,
  ) => Promise<PromoteEntryResult>;
  /**
   * v1.0 draft-first: when set, create / revise write updates into drafts and apply only
   * promotes. Absent (unit tests of the legacy flow) → pre-1.0 behavior.
   */
  draftStore?: ProposalDraftStore;
  findSimilar?: (query: string) => Promise<SimilarProposal[]>;
  indexSearch?: (proposal: ProposalRecord) => Promise<void>;
  /** Override for tests; default uses event-store recent writes. */
  resolveRecentActivity?: (opts: {
    entries: Array<{ contentType: string; slug: string; locale: string; variant?: string | null }>;
    excludeAgentSessionId?: string | null;
    excludeProposalApplies?: Array<{
      contentType: string;
      slug: string;
      locale: string;
      variant?: string | null;
      applied_at: number | null;
      applied_by: string | null;
    }>;
  }) => ResolveRecentActivityResult;
  /**
   * Resolve whether live (and optional draft) content exists.
   * Default assumes exists (tests); production wires getContentForEdit.
   */
  resolveExistence?: (entry: {
    contentType: string;
    slug: string;
    locale: string;
    variant?: string | null;
  }) => { live: ExistenceState; draftExists: boolean };
  /**
   * When live content is missing: database row vs file-based attached post vs anything else.
   * Default (tests): other — missing live stays entry_not_found.
   */
  inspectMissingTarget?: (entry: { contentType: string; slug: string }) => MissingTargetShape;
  /**
   * Who owns the entry's layout today (`layoutInfoForEntry`). Absent (tests) → unknown:
   * no layout_owner on reads, no new-language sections gate, no layout-switch check.
   */
  resolveLayoutOwner?: (entry: { contentType: string; slug: string }) => EntryLayoutInfo;
  /**
   * Template proposals: find new `{{ entry.* }}` placeholders attached entries cannot fill.
   * Absent (tests) → not scanned.
   */
  scanTemplatePlaceholders?: (entry: {
    contentType: string;
    locale: string;
    liveSections: unknown;
    draftSections: unknown;
    attachedSlugs: string[];
  }) => TemplatePlaceholderGap[];
  /**
   * Registry check for a full `sections` array in an edits update. Empty = valid.
   * Absent (tests) → not checked.
   */
  validateSections?: (sections: unknown) => SectionIssue[];
  /** Validate and seed a new attached locale before field ops. seeded means this apply created the folder. */
  prepareCreatesEntry?: (
    entry: ProposalEntryRow,
    opts: {
      confirmNewValues?: boolean;
      author: string;
      /** When implementing an accepted idea, seed matching funnel onto _common.yml. */
      ideaFunnel?: IdeaFunnel | null;
    },
  ) => Promise<{ ok: boolean; error?: string; code?: string; seeded?: boolean }>;
  /** Delete a folder this apply created after a later step failed. */
  discardSeededEntry?: (entry: ProposalEntryRow) => void;
  /** Stamp published_at on first go-live when still empty. */
  stampPublishedAt?: (entry: ProposalEntryRow, author: string) => { ok: boolean; error?: string };
  /** Site Agents Rules policy; default = hardcoded defaults (tests / omitted). */
  getProposalSettings?: () => ProposalSettings;
  /**
   * Site facts for idea SEO targets (hub liveness, keyword owners, monitoring).
   * Absent (tests) → only shape + demand rules are enforced.
   */
  seoTarget?: IdeaSeoTargetDeps;
  /** Content type `strategy` from content-types.yml (null when unset). Absent (tests) → no strategy context on ideas. */
  strategyForContentType?: (contentType: string) => ContentTypeStrategy | null;
  /** Content type keys from content-types.yml (not folder names). Absent (tests) → idea related_entries types are not checked. */
  knownContentTypes?: () => string[];
  /** Site variables (variables.yml). Absent (tests) → no figure/fact token checks. */
  variableDefinitions?: () => Record<string, VariableDefinition>;
  /** Per-language URL facts. Absent (tests) → no address checks at accept or filing. */
  localeUrlSlug?: LocaleUrlSlugDeps;
};

export type LocaleUrlSlugDeps = {
  /** Published languages of the page (`{locale}.yml`, no variants). */
  liveLocales: (contentType: string, slug: string) => string[];
  urlPattern: (contentType: string) => Record<string, string> | null;
  /** Folder slug of the page that already serves `urlSlug` in this language, or null. */
  ownerOf: (contentType: string, urlSlug: string, locale: string) => string | null;
};

export type IdeaSeoHubFacts = {
  /** Canonical path after following renames/redirects. */
  path: string;
  live: boolean;
  /** Locale the hub is published in (null when unknown). */
  locale: string | null;
  /** true/false when the SEO index knows the page; null when unknown. */
  is_hub: boolean | null;
  /** Hub entry from the SEO index (null when the index does not know the path). */
  entry?: { contentType: string; slug: string; locale: string } | null;
};

export type IdeaSeoTargetDeps = {
  /** Content type has SEO monitoring on (target required at accept). */
  isMonitored: (contentType: string) => boolean;
  resolveHub: (pillarPath: string, locale: string) => IdeaSeoHubFacts;
  /** Live page holding this exact main_keyword (excluding `exclude`); "unavailable" when the index is missing. */
  keywordOwner: (
    keyword: string,
    exclude: { contentType: string; slug: string; locale: string },
  ) => { path: string } | null | "unavailable";
  /** Public path of an entry locale (null when unknown / not live yet). */
  selfPath: (contentType: string, slug: string, locale: string) => string | null;
  memberInfo: (
    contentType: string,
    slug: string,
    locale: string,
  ) => { live: boolean; monitored: boolean; pillar_path: string | null };
};

export type ProposalStats = {
  total: number;
  by_status: Record<ProposalStatus, number>;
  by_kind: Record<ProposalKind, number>;
  escalated_count: number;
  /** Open|partial rows by derived attention (escalated label wins when flagged). */
  by_attention: Record<ProposalAttention, number>;
  /** Live stock for KPI cards: open includes partial; withdrawn omitted. */
  by_kind_status: KindStatusCardCounts;
  /** Accepted ideas with locked entry and no open/partial/finished implements child. */
  stalled_ideas: number;
  /** Open|partial edits in awaiting_rereview or no_feedback (not blocked, not escalated). */
  needs_review_edits: number;
  by_outcome: ProposalOutcomeCounts;
};

/** Steward verdict counts. `none` = closed, unreviewed, not a system closure; `bad_open` = bad with no lesson captured. */
export type ProposalOutcomeCounts = {
  good: number;
  bad: number;
  bad_open: number;
  none: number;
};

const EMPTY_STATUS_COUNTS: Record<ProposalStatus, number> = {
  open: 0,
  partial: 0,
  finished: 0,
  rejected: 0,
  withdrawn: 0,
};

const EMPTY_KIND_COUNTS: Record<ProposalKind, number> = {
  edits: 0,
  notes: 0,
  idea: 0,
};

function asAgentActor(actor: EventActor | Record<string, unknown> | undefined | null): AgentActorLike | null {
  if (!actor || typeof actor !== "object") return null;
  const type = (actor as { type?: string }).type;
  if (type !== "ui" && type !== "mcp" && type !== "system") return null;
  return actor as AgentActorLike;
}

function fourEyesBlocked(
  proposerUsername: string,
  proposerActor: Record<string, unknown> | EventActor | undefined,
  callerUsername: string,
  callerActor: EventActor | undefined,
): boolean {
  return sameAgentIdentity(
    proposerUsername,
    asAgentActor(proposerActor),
    callerUsername,
    asAgentActor(callerActor),
  );
}

function fourEyesBlockedForCaller(
  policy: ProposalSettings,
  proposerUsername: string,
  proposerActor: Record<string, unknown> | EventActor | undefined,
  callerUsername: string,
  callerActor: EventActor | undefined,
): boolean {
  if (!policy.four_eyes.enabled) return false;
  if (policy.four_eyes.staff_ui_exempt && isStaffUiActor(asAgentActor(callerActor))) {
    return false;
  }
  return fourEyesBlocked(proposerUsername, proposerActor, callerUsername, callerActor);
}

/** `outcome_recent` = verdict time, else close time, else updated (Agents → Outcomes). */
export const PROPOSAL_SORT_FIELDS = ["created_at", "updated_at", "attention", "outcome_recent"] as const;
export type ProposalSortField = (typeof PROPOSAL_SORT_FIELDS)[number];
export type ProposalSortDir = "asc" | "desc";

export const PROPOSER_ACTOR_TYPES = ["ui", "mcp", "system"] as const;
export type ProposerActorType = (typeof PROPOSER_ACTOR_TYPES)[number];

export function parseProposalSort(
  sort?: string | null,
  sortDir?: string | null,
):
  | { ok: true; sort: ProposalSortField; sortDir: ProposalSortDir }
  | { ok: false; error: string } {
  const fieldRaw = sort == null || String(sort).trim() === "" ? "updated_at" : String(sort).trim();
  if (!(PROPOSAL_SORT_FIELDS as readonly string[]).includes(fieldRaw)) {
    return {
      ok: false,
      error: `Invalid sort '${fieldRaw}'. Allowed: ${PROPOSAL_SORT_FIELDS.join(", ")}`,
    };
  }
  // Attention rank is fixed; sort_dir is accepted but ignored by list().
  const dirRaw =
    sortDir == null || String(sortDir).trim() === "" ? "desc" : String(sortDir).trim();
  if (dirRaw !== "asc" && dirRaw !== "desc") {
    return {
      ok: false,
      error: `Invalid sort_dir '${dirRaw}'. Allowed: asc, desc`,
    };
  }
  return { ok: true, sort: fieldRaw as ProposalSortField, sortDir: dirRaw };
}

/** Empty/missing → undefined (no filter). Invalid non-empty → error. */
export function parseProposerActorType(
  raw?: string | null,
):
  | { ok: true; type: ProposerActorType | undefined }
  | { ok: false; error: string } {
  if (raw == null || String(raw).trim() === "") {
    return { ok: true, type: undefined };
  }
  const trimmed = String(raw).trim();
  if (trimmed === "ui" || trimmed === "mcp" || trimmed === "system") {
    return { ok: true, type: trimmed };
  }
  return {
    ok: false,
    error: `Invalid proposer_actor_type '${trimmed}'. Allowed: ui, mcp, system`,
  };
}

/** Empty/missing → undefined (no filter). `1`/`true`/`0`/`false` (case-insensitive). */
export function parseEscalatedQuery(
  raw?: string | null,
): { ok: true; escalated: boolean | undefined } | { ok: false; error: string } {
  if (raw == null || String(raw).trim() === "") {
    return { ok: true, escalated: undefined };
  }
  const trimmed = String(raw).trim().toLowerCase();
  if (trimmed === "1" || trimmed === "true") return { ok: true, escalated: true };
  if (trimmed === "0" || trimmed === "false") return { ok: true, escalated: false };
  return {
    ok: false,
    error: `Invalid escalated '${raw}'. Allowed: 1, 0, true, false`,
  };
}

export function isClosedProposalStatus(status: ProposalStatus): boolean {
  return status === "finished" || status === "rejected" || status === "withdrawn";
}

export const OUTCOME_REVIEW_FILTERS = ["good", "bad", "none", "bad_open", "any"] as const;
export type OutcomeReviewFilter = (typeof OUTCOME_REVIEW_FILTERS)[number];

/** Closures the system made on its own — not a decision anyone can judge, so never "needs a verdict". */
export const SYSTEM_CLOSE_REASONS = ["abandoned_stale", "abandoned_blocked", "legacy_version"] as const;

/** SQL predicate: closed by a person or agent (not a system closure). */
export function reviewableClosedSql(col: (name: string) => string = (name) => name): string {
  const reasons = SYSTEM_CLOSE_REASONS.map((r) => `'${r}'`).join(", ");
  return `${col("status")} IN ('finished', 'rejected', 'withdrawn') AND (${col("close_reason")} IS NULL OR ${col("close_reason")} NOT IN (${reasons}))`;
}

export function outcomeRecentAt(p: Pick<ProposalRecord, "outcome_review_at" | "closed_at" | "updated_at">): number {
  return p.outcome_review_at ?? p.closed_at ?? p.updated_at;
}

/**
 * Empty/missing → undefined. `bad_open` = bad with no lesson captured.
 * `none` = closed, unreviewed, not a system closure. `any` = reviewed, or `none`.
 */
export function parseOutcomeReviewQuery(
  raw?: string | null,
): { ok: true; outcome_review: OutcomeReviewFilter | undefined } | { ok: false; error: string } {
  if (raw == null || String(raw).trim() === "") {
    return { ok: true, outcome_review: undefined };
  }
  const trimmed = String(raw).trim().toLowerCase();
  if ((OUTCOME_REVIEW_FILTERS as readonly string[]).includes(trimmed)) {
    return { ok: true, outcome_review: trimmed as OutcomeReviewFilter };
  }
  return {
    ok: false,
    error: `Invalid outcome_review '${raw}'. Allowed: ${OUTCOME_REVIEW_FILTERS.join(", ")}`,
  };
}
function compareProposalsBySort(
  a: ProposalRecord,
  b: ProposalRecord,
  sort: ProposalSortField,
  sortDir: ProposalSortDir,
): number {
  if (sort === "attention") {
    // Callers should use compareByAttention; keep a safe chronological fallback.
    const factor = sortDir === "asc" ? 1 : -1;
    if (a.updated_at !== b.updated_at) return (a.updated_at - b.updated_at) * factor;
    return a.id.localeCompare(b.id);
  }
  const factor = sortDir === "asc" ? 1 : -1;
  const av = sort === "outcome_recent" ? outcomeRecentAt(a) : a[sort];
  const bv = sort === "outcome_recent" ? outcomeRecentAt(b) : b[sort];
  if (av !== bv) return (av - bv) * factor;
  return a.id.localeCompare(b.id);
}

function findOpenProposalForVariant(
  db: Database.Database,
  site: string,
  contentType: string,
  slug: string,
  locale: string,
  variant: string,
): ProposalRecord | null {
  const entryKey = makeEntryKey(contentType, slug);
  const rows = db
    .prepare(
      `SELECT p.id FROM content_proposals p
       INNER JOIN content_proposal_entries e ON e.proposal_id = p.id
       WHERE p.site = ? AND p.status IN ('open','partial')
         AND e.entry_key = ? AND e.locale = ? AND e.variant = ?
       LIMIT 1`,
    )
    .all(site, entryKey, locale, variant) as Array<{ id: string }>;
  if (!rows[0]) return null;
  return loadProposal(db, rows[0].id);
}

export const PROPOSAL_SYSTEM_VERSION = "1.0";

/** Actions still allowed on a pre-1.0 proposal (cleanup and steward retro only). */
/** Apply dry_run on a proposal with open blockers: preview ran, real apply still refused. */
export const PREVIEW_WHILE_BLOCKED_CODE = "preview_while_blocked";

const LEGACY_ALLOWED_ACTIONS = new Set<ProposalUpdateAction>([
  "withdraw",
  "reject",
  "release",
  "review_outcome",
  "set_outcome_lesson",
  "escalate",
  "deescalate",
]);

/** Proposals live only in production; written on draft links so older readers keep parsing. */
export const DRAFT_LINK_ENV = "production";

/** Draft files the proposal service itself is writing (create / revise) — not co-author edits. */
const ownDraftWrites = new Map<string, number>();

async function withOwnDraftWrite<T>(
  filePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = path.resolve(filePath);
  ownDraftWrites.set(key, (ownDraftWrites.get(key) ?? 0) + 1);
  try {
    return await fn();
  } finally {
    const n = (ownDraftWrites.get(key) ?? 1) - 1;
    if (n <= 0) ownDraftWrites.delete(key);
    else ownDraftWrites.set(key, n);
  }
}

function sameUsername(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * A data migration rewrote a proposal's draft without changing what the author proposed:
 * record the new fingerprint so apply does not see an outside edit. No co-author, no review reset.
 */
export function recordSystemDraftRewrite(site: string, proposalId: string, filePath: string): number {
  const db = dbFor(site);
  const proposal = loadProposal(db, proposalId);
  if (!proposal || !fs.existsSync(filePath)) return 0;
  const fingerprint = hashVariantFileContents(fs.readFileSync(filePath, "utf-8"));
  const base = path.basename(filePath);
  const dirSlug = path.basename(path.dirname(filePath));
  let updated = 0;
  for (const e of proposal.entries) {
    if (!e.variant || (e.status !== "pending" && e.status !== "failed")) continue;
    if (!base.endsWith(`${e.variant}.${e.locale}.yml`)) continue;
    if (!isTemplateVersioningSlug(e.slug) && dirSlug !== e.slug) continue;
    if (e.variant_fingerprint === fingerprint) continue;
    db.prepare(`UPDATE content_proposal_entries SET variant_fingerprint = ? WHERE id = ?`).run(fingerprint, e.id);
    updated++;
  }
  return updated;
}

/** Status and open needs-changes count of a proposal (migration reports). */
export function proposalBlockerSummary(
  site: string,
  proposalId: string,
): { id: string; title: string; status: string; open_blocker_count: number } | null {
  const proposal = loadProposal(dbFor(site), proposalId);
  if (!proposal) return null;
  return {
    id: proposal.id,
    title: proposal.title,
    status: proposal.status,
    open_blocker_count: proposal.open_blocker_count,
  };
}

/** A process, not a person (migrations, sweeps, sync pulls, writes with no author). */
export function isSystemDraftEditor(editor: string | null | undefined): boolean {
  const e = editor?.trim().toLowerCase() ?? "";
  return (
    !e ||
    e === "unknown" ||
    e === "system" ||
    e === "github-pull" ||
    e.startsWith("migration:") ||
    e.startsWith("system:")
  );
}

/** A person other than the proposer edited the draft directly (system writes do not count). */
export function hasPersonCoAuthor(coAuthors: ReadonlyArray<{ username: string }>): boolean {
  return coAuthors.some((c) => !isSystemDraftEditor(c.username));
}

/**
 * Someone edited a v1.0 proposal's draft outside `revise_entries`: record the new draft
 * fingerprint and, when it is a person other than the proposer, add them as co-author,
 * release the claim and send the proposal back to review. System writes only record the
 * fingerprint. The draft base never changes here.
 */
export function absorbDraftEdit(
  site: string,
  proposalId: string,
  filePath: string,
  editor: string,
): { absorbed: boolean; co_author: boolean } {
  const db = dbFor(site);
  const proposal = loadProposal(db, proposalId);
  if (!proposal || !proposal.system_version)
    return { absorbed: false, co_author: false };
  if (proposal.status !== "open" && proposal.status !== "partial")
    return { absorbed: false, co_author: false };
  if (!fs.existsSync(filePath)) return { absorbed: false, co_author: false };
  const fingerprint = hashVariantFileContents(
    fs.readFileSync(filePath, "utf-8"),
  );
  const base = path.basename(filePath);
  const dirSlug = path.basename(path.dirname(filePath));
  const targets = proposal.entries.filter(
    (e) =>
      e.variant &&
      (e.status === "pending" || e.status === "failed") &&
      base.endsWith(`${e.variant}.${e.locale}.yml`) &&
      (isTemplateVersioningSlug(e.slug) || dirSlug === e.slug),
  );
  const changed = targets.filter((e) => e.variant_fingerprint !== fingerprint);
  if (!changed.length) return { absorbed: false, co_author: false };
  const now = Date.now();
  for (const e of changed) {
    db.prepare(
      `UPDATE content_proposal_entries SET variant_fingerprint = ? WHERE id = ?`,
    ).run(fingerprint, e.id);
  }
  if (isSystemDraftEditor(editor)) return { absorbed: true, co_author: false };
  const who = editor.trim();
  const isProposer = sameUsername(proposal.proposer_username, who);
  if (isProposer) {
    db.prepare(
      `UPDATE content_proposals SET author_content_at = ?, updated_at = ? WHERE id = ?`,
    ).run(now, now, proposalId);
    return { absorbed: true, co_author: false };
  }
  const coAuthors = proposal.co_authors.filter(
    (c) => !sameUsername(c.username, who),
  );
  coAuthors.push({ username: who, at: now });
  db.prepare(
    `UPDATE content_proposals
     SET co_authors_json = ?, author_content_at = ?, claim_json = NULL, updated_at = ?
     WHERE id = ?`,
  ).run(JSON.stringify(coAuthors), now, now, proposalId);
  emitProposalEvent(site, "proposal_co_author_edit", proposalId, who, {
    entries: changed.map((e) => ({
      entry_key: e.entry_key,
      locale: e.locale,
      variant: e.variant,
    })),
  });
  return { absorbed: true, co_author: true };
}

onVariantWrite((filePath, opts) => {
  if (ownDraftWrites.has(path.resolve(filePath))) return;
  const link = readDraftMeta(filePath)?.proposal;
  if (!link) return;
  const rel = path
    .relative(process.cwd(), path.resolve(filePath))
    .replace(/\\/g, "/");
  const site = rel.split("/")[0];
  if (!site || site.startsWith("..")) return;
  try {
    absorbDraftEdit(site, link.id, filePath, opts.author || "unknown");
  } catch (err) {
    log.warn({ err, proposal_id: link.id }, "absorb draft edit failed");
  }
});

export function findOpenProposalLinkForDraft(
  site: string,
  ref: { contentType: string; slug: string; locale: string; variant: string },
): { id: string; env: string; title?: string } | null {
  try {
    const found = findOpenProposalForVariant(
      dbFor(site),
      site,
      ref.contentType,
      ref.slug,
      ref.locale,
      ref.variant,
    );
    if (!found) return null;
    return { id: found.id, env: DRAFT_LINK_ENV, title: found.title };
  } catch {
    return null;
  }
}

/** Open/partial edits targeting same type+slug+locale (any variant). */
function findOpenEditsForEntry(
  db: Database.Database,
  site: string,
  contentType: string,
  slug: string,
  locale: string,
  excludeProposalId?: string,
): ProposalRecord | null {
  const entryKey = makeEntryKey(contentType, slug);
  const rows = db
    .prepare(
      `SELECT p.id FROM content_proposals p
       INNER JOIN content_proposal_entries e ON e.proposal_id = p.id
       WHERE p.site = ? AND p.kind = 'edits' AND p.status IN ('open','partial')
         AND e.entry_key = ? AND e.locale = ?
       LIMIT 5`,
    )
    .all(site, entryKey, locale) as Array<{ id: string }>;
  for (const row of rows) {
    if (excludeProposalId && row.id === excludeProposalId) continue;
    return loadProposal(db, row.id);
  }
  return null;
}

const STALLED_IMPLEMENTS_STATUSES = "('open','partial','finished')";

/** SQL predicate for stalled accepted ideas. Pass table alias (e.g. `p`) or `""` for unqualified columns. */
function stalledIdeaSqlPredicate(alias: string): string {
  const col = (name: string) => (alias ? `${alias}.${name}` : name);
  return (
    `${col("kind")} = 'idea' AND ${col("status")} = 'finished' AND ${col("close_reason")} = 'accepted' ` +
    `AND ${col("accepted_entry_json")} IS NOT NULL AND TRIM(${col("accepted_entry_json")}) != '' ` +
    `AND ${col("accepted_entry_json")} != 'null' AND NOT EXISTS (` +
    `SELECT 1 FROM content_proposals c WHERE c.site = ${col("site")} ` +
    `AND c.implements_proposal_id = ${col("id")} AND c.kind = 'edits' ` +
    `AND c.status IN ${STALLED_IMPLEMENTS_STATUSES})`
  );
}

function countStalledIdeas(db: Database.Database, site: string): number {
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM content_proposals p WHERE p.site = ? AND ${stalledIdeaSqlPredicate("p")}`,
      )
      .get(site) as { n: number };
    return Number(row?.n) || 0;
  } catch {
    return 0;
  }
}

/**
 * An accepted idea holds its page until one implementing edit is applied with none still
 * open/partial. Rejected or withdrawn edits do not release it (the idea stays stalled).
 */
function ideaHoldsEntry(db: Database.Database, site: string, ideaId: string): boolean {
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) AS applied,
         SUM(CASE WHEN status IN ('open','partial') THEN 1 ELSE 0 END) AS active
       FROM content_proposals
       WHERE site = ? AND kind = 'edits' AND implements_proposal_id = ?`,
    )
    .get(site, ideaId) as { applied: number | null; active: number | null } | undefined;
  const applied = Number(row?.applied) || 0;
  const active = Number(row?.active) || 0;
  return applied === 0 || active > 0;
}

/** The accepted idea currently holding this page+locale (released ideas are skipped). */
function findAcceptedIdeaOwningEntry(
  db: Database.Database,
  site: string,
  contentType: string,
  slug: string,
  locale: string,
  excludeIdeaId?: string,
): ProposalRecord | null {
  const key = acceptedEntryKey({ contentType, slug, locale });
  const rows = db
    .prepare(
      `SELECT id, accepted_entry_json FROM content_proposals
       WHERE site = ? AND kind = 'idea' AND status = 'finished' AND close_reason = 'accepted'
         AND accepted_entry_json IS NOT NULL
       ORDER BY closed_at DESC`,
    )
    .all(site) as Array<{ id: string; accepted_entry_json: string }>;
  for (const row of rows) {
    if (excludeIdeaId && row.id === excludeIdeaId) continue;
    const entry = parseAcceptedEntry(parseJson(row.accepted_entry_json, null));
    if (!entry) continue;
    if (acceptedEntryKey(entry) !== key) continue;
    if (!ideaHoldsEntry(db, site, row.id)) continue;
    return loadProposal(db, row.id);
  }
  return null;
}

function waitingIdeasPayload(
  released: { details: Record<string, unknown> } | null,
): Record<string, unknown> {
  if (!released) return {};
  const waiting = (released.details.waiting_ideas ?? []) as Array<{ id: string }>;
  return { released_entry: released.details.released_entry, waiting_idea_ids: waiting.map((w) => w.id) };
}

/** Open ideas whose related_entries name this page (an entry without locale matches any locale). */
function findIdeasWaitingOnEntry(
  db: Database.Database,
  site: string,
  entry: AcceptedEntry,
): Array<{ id: string; title: string }> {
  const rows = db
    .prepare(
      `SELECT id, title, related_entries_json FROM content_proposals
       WHERE site = ? AND kind = 'idea' AND status IN ('open','partial')
         AND related_entries_json IS NOT NULL
       ORDER BY created_at`,
    )
    .all(site) as Array<{ id: string; title: string; related_entries_json: string }>;
  const out: Array<{ id: string; title: string }> = [];
  for (const row of rows) {
    const refs = parseJson<unknown>(row.related_entries_json, []);
    if (!Array.isArray(refs)) continue;
    const hit = refs.some((r) => {
      if (!r || typeof r !== "object") return false;
      const o = r as Record<string, unknown>;
      if (o.contentType !== entry.contentType || o.slug !== entry.slug) return false;
      const loc = typeof o.locale === "string" ? o.locale.trim() : "";
      return !loc || loc === entry.locale;
    });
    if (hit) out.push({ id: row.id, title: row.title });
  }
  return out;
}

function findOpenImplementsForIdea(
  db: Database.Database,
  site: string,
  ideaId: string,
  excludeProposalId?: string,
): ProposalRecord | null {
  const rows = db
    .prepare(
      `SELECT id FROM content_proposals
       WHERE site = ? AND kind = 'edits' AND status IN ('open','partial')
         AND implements_proposal_id = ?
       LIMIT 5`,
    )
    .all(site, ideaId) as Array<{ id: string }>;
  for (const row of rows) {
    if (excludeProposalId && row.id === excludeProposalId) continue;
    return loadProposal(db, row.id);
  }
  return null;
}

/** Open proposals referencing a variant (for delete_variant warnings). */
export function listOpenProposalsForVariant(
  site: string,
  contentType: string,
  slug: string,
  locale: string,
  variant: string,
): Array<{ id: string; title: string; status: ProposalStatus }> {
  const db = dbFor(site);
  const entryKey = makeEntryKey(contentType, slug);
  const rows = db
    .prepare(
      `SELECT p.id, p.title, p.status FROM content_proposals p
       INNER JOIN content_proposal_entries e ON e.proposal_id = p.id
       WHERE p.site = ? AND p.status IN ('open','partial')
         AND e.entry_key = ? AND e.locale = ? AND e.variant = ?`,
    )
    .all(site, entryKey, locale, variant) as Array<{
    id: string;
    title: string;
    status: ProposalStatus;
  }>;
  return rows;
}

export type OpenProposalForEntry = {
  id: string;
  title: string;
  status: ProposalStatus;
  locale: string;
  variant: string | null;
  proposer_username: string;
  proposer_kind: "agent" | "staff";
  proposer_role?: string;
  created_at: number;
  updated_at: number;
  open_blocker_count: number;
};

/** Open/partial proposals on any locale/variant of one page (single query, for the Versions panel). */
export function listOpenProposalsForEntry(
  site: string,
  contentType: string,
  slug: string,
): OpenProposalForEntry[] {
  const db = dbFor(site);
  const entryKey = makeEntryKey(contentType, slug);
  const rows = db
    .prepare(
      `SELECT p.id, p.title, p.status, p.proposer_username, p.proposer_actor_json, p.created_at,
              p.updated_at, e.locale, e.variant,
              (SELECT COUNT(*) FROM content_proposal_blockers b
               WHERE b.proposal_id = p.id AND b.status = 'open') AS open_n
       FROM content_proposals p
       INNER JOIN content_proposal_entries e ON e.proposal_id = p.id
       WHERE p.site = ? AND p.status IN ('open','partial') AND e.entry_key = ?
       ORDER BY p.created_at DESC`,
    )
    .all(site, entryKey) as Array<{
    id: string;
    title: string;
    status: ProposalStatus;
    proposer_username: string;
    proposer_actor_json: string;
    created_at: number;
    updated_at: number;
    locale: string;
    variant: string | null;
    open_n: number;
  }>;
  return rows.map((r) => {
    const actor = parseJson<Record<string, unknown>>(r.proposer_actor_json, {});
    const role = typeof actor.role === "string" ? actor.role : undefined;
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      locale: r.locale,
      variant: r.variant,
      proposer_username: r.proposer_username,
      proposer_kind: actor.type === "mcp" ? "agent" : "staff",
      ...(role ? { proposer_role: role } : {}),
      created_at: r.created_at,
      updated_at: r.updated_at,
      open_blocker_count: Number(r.open_n) || 0,
    };
  });
}

const MAX_PROPOSAL_QUERY_TERMS = 8;

/** Whitespace-split, lowercased, de-duplicated; every term must match (AND). */
export function proposalQueryTerms(query: string | undefined): string[] {
  if (!query) return [];
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return [...new Set(terms)].slice(0, MAX_PROPOSAL_QUERY_TERMS);
}

function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function proposalTargetKeys(proposal: {
  entries?: Array<{ contentType: string; slug: string; locale: string }>;
  related_entries?: RelatedEntryRef[];
}): Set<string> {
  const keys = new Set<string>();
  for (const e of proposal.entries ?? []) {
    keys.add(`${e.contentType}\0${e.slug}\0${e.locale}`);
  }
  for (const r of proposal.related_entries ?? []) {
    keys.add(`${r.contentType}\0${r.slug}\0${r.locale ?? ""}`);
  }
  return keys;
}

function findEscalatedSiblings(
  db: Database.Database,
  site: string,
  proposal: ProposalRecord,
): Array<{ id: string; title: string }> {
  const mine = proposalTargetKeys(proposal);
  if (mine.size === 0) return [];
  const rows = db
    .prepare(
      `SELECT * FROM content_proposals
       WHERE site = ? AND status IN ('open','partial') AND escalated = 1 AND id != ?`,
    )
    .all(site, proposal.id) as ProposalRow[];
  const out: Array<{ id: string; title: string }> = [];
  for (const row of rows) {
    const other = mapProposal(row, loadEntries(db, row.id), []);
    const theirs = proposalTargetKeys(other);
    let overlap = false;
    for (const k of mine) {
      if (theirs.has(k)) {
        overlap = true;
        break;
      }
    }
    if (overlap) out.push({ id: row.id, title: row.title });
  }
  return out;
}

export function createProposalService(deps: ProposalServiceDeps) {
  const site = deps.site;

  function variableDefs(): Record<string, VariableDefinition> | null {
    try {
      return deps.variableDefinitions?.() ?? null;
    } catch {
      return null;
    }
  }

  function figureTokensIn(text: string): boolean {
    const defs = variableDefs();
    return !!defs && findFigureVariableTokens(text, defs).length > 0;
  }

  function policy(): ProposalSettings {
    if (deps.getProposalSettings) return deps.getProposalSettings();
    return {
      withdraw: { ...DEFAULT_PROPOSAL_SETTINGS.withdraw },
      four_eyes: { ...DEFAULT_PROPOSAL_SETTINGS.four_eyes },
      hold: { ...DEFAULT_PROPOSAL_SETTINGS.hold },
      claim: { ...DEFAULT_PROPOSAL_SETTINGS.claim },
    };
  }

  function runResolveActivity(opts: {
    entries: Array<{ contentType: string; slug: string; locale: string; variant?: string | null }>;
    excludeAgentSessionId?: string | null;
    excludeProposalApplies?: Array<{
      contentType: string;
      slug: string;
      locale: string;
      variant?: string | null;
      applied_at: number | null;
      applied_by: string | null;
    }>;
  }): ResolveRecentActivityResult {
    if (deps.resolveRecentActivity) return deps.resolveRecentActivity(opts);
    return resolveProposalEntryActivity({ site, ...opts });
  }

  /** True when the page is live in another language but not in this one. */
  function isNewLanguageOfLivePage(ref: { contentType: string; slug: string; locale: string }): boolean {
    const facts = deps.localeUrlSlug;
    if (!facts || isTemplateVersioningSlug(ref.slug)) return false;
    const live = facts.liveLocales(ref.contentType, ref.slug);
    return live.length > 0 && !live.includes(ref.locale);
  }

  function addressUsesSlug(ref: { contentType: string; locale: string }): boolean {
    const facts = deps.localeUrlSlug;
    if (!facts) return false;
    return urlPatternUsesSlug(facts.urlPattern(ref.contentType), ref.locale);
  }

  /** Idea accept: lock this language's address (own url_slug for a new language). */
  function gateAcceptedUrlSlug(
    ae: AcceptedEntry,
  ): { ok: true } | { ok: false; code: string; error: string; details: Record<string, unknown> } {
    const facts = deps.localeUrlSlug;
    if (!facts || isTemplateVersioningSlug(ae.slug) || !addressUsesSlug(ae)) return { ok: true };
    return checkAcceptedUrlSlug({
      contentType: ae.contentType,
      folderSlug: ae.slug,
      locale: ae.locale,
      urlSlug: ae.url_slug ?? null,
      isNewLanguage: isNewLanguageOfLivePage(ae),
      ack: ae.slug_language_ack === true,
      ownerOf: (urlSlug) => facts.ownerOf(ae.contentType, urlSlug, ae.locale),
    });
  }

  function resolveExistence(entry: {
    contentType: string;
    slug: string;
    locale: string;
    variant?: string | null;
  }): { live: ExistenceState; draftExists: boolean } {
    if (deps.resolveExistence) return deps.resolveExistence(entry);
    return { live: "exists", draftExists: Boolean(entry.variant?.trim()) };
  }

  function normalizeRelatedEntries(raw: unknown): RelatedEntryRef[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object")
      .map((r) => {
        const locale = typeof r.locale === "string" ? r.locale.trim() : "";
        return {
          contentType: String(r.contentType || "").trim(),
          slug: String(r.slug || "").trim(),
          ...(locale ? { locale } : {}),
        };
      })
      .filter((r) => r.contentType && r.slug);
  }

  function ideaRelatedMixedRisk(relatedEntries: RelatedEntryRef[]) {
    if (relatedEntries.length === 0) return null;
    const classTargets = relatedEntries.map((r) => ({
      contentType: r.contentType,
      existence: resolveExistence({ contentType: r.contentType, slug: r.slug, locale: r.locale?.trim() || "en" }).live,
      forIdea: true as const,
    }));
    if (!isMixedRiskBundle(collectDamageClassesForMixedCheck(classTargets))) return null;
    return {
      ok: false as const,
      code: "mixed_risk_bundle",
      error:
        "This idea brief mixes different risk levels across related pages. Split into separate ideas — one risk class each.",
    };
  }

  function attachedCreateKey(contentType: string, slug: string, locale: string): string {
    return `${contentType}\0${slug}\0${locale}`;
  }

  function inspectTarget(contentType: string, slug: string): MissingTargetShape {
    if (!deps.inspectMissingTarget) return { shape: "other" };
    return deps.inspectMissingTarget({ contentType, slug });
  }

  function layoutOwnerAtFiling(ref: { contentType: string; slug: string }): { layout_owner?: LayoutOwner } {
    const info = layoutInfo(ref.contentType, ref.slug);
    return info ? { layout_owner: info.layout_owner } : {};
  }

  function layoutInfo(contentType: string, slug: string): EntryLayoutInfo | null {
    if (!deps.resolveLayoutOwner) return null;
    try {
      return deps.resolveLayoutOwner({ contentType, slug });
    } catch (err) {
      log.warn({ err, contentType, slug }, "resolve layout owner failed");
      return null;
    }
  }

  /**
   * A new language (live locale missing) on an existing entry that owns its layout, or a new
   * shared-template language, must send one full `sections` update — the draft starts empty.
   */
  function gateNewLocaleSections(opts: {
    entry: ProposalEntryInput;
    /** Existing draft that will keep its body (named by the caller, or owned and not reset). */
    keptDraft: ProposalDraftRef | null;
  }): { ok: true } | { ok: false; code: string; error: string; details: Record<string, unknown> } {
    const e = opts.entry;
    const info = layoutInfo(e.contentType, e.slug);
    if (!info) return { ok: true };
    if (info.layout_owner !== "entry" && !info.is_shared_template) return { ok: true };
    if (hasFullSectionsOp(e.updates ?? [])) return { ok: true };
    if (opts.keptDraft && store?.draftValue) {
      const existing = store.draftValue(opts.keptDraft, "sections");
      if (Array.isArray(existing) && existing.length > 0) return { ok: true };
    }
    const where = `${e.contentType}/${e.slug} (${e.locale})`;
    const why = info.is_shared_template
      ? `${where} is a new shared template language. It must contain the full layout; it will apply to every attached entry in that language.`
      : info.detached
        ? `${where} is a new language of an entry that has its own layout (detached).`
        : `${where} is a new language of a page type that owns its layout.`;
    return {
      ok: false,
      code: "sections_required",
      error:
        `${why} The draft starts empty, so send the whole translated layout as one update: ` +
        '{ field_path: "sections", value: [ ...section objects ] } (non-empty). Start from get_entry_content on the source locale.',
      details: {
        layout_owner: info.layout_owner,
        ...(info.detached ? { detached: true } : {}),
        ...(info.is_shared_template ? { is_shared_template: true } : {}),
        new_locale: true,
        entry: { contentType: e.contentType, slug: e.slug, locale: e.locale },
      },
    };
  }

  /** Template entries that skip some of the type's live template languages. */
  function templateLocalesWarnings(
    entries: ProposalEntryInput[],
  ): Array<{ code: string; message: string; details?: Record<string, unknown> }> {
    if (!store?.listTemplateLocales) return [];
    const byType = new Map<string, Set<string>>();
    for (const e of entries) {
      if (!isTemplateVersioningSlug(e.slug)) continue;
      const set = byType.get(e.contentType) ?? new Set<string>();
      set.add(e.locale);
      byType.set(e.contentType, set);
    }
    const out: Array<{ code: string; message: string; details?: Record<string, unknown> }> = [];
    for (const [contentType, covered] of byType) {
      const all = store.listTemplateLocales(contentType);
      const missing = all.filter((l) => !covered.has(l));
      if (!missing.length) continue;
      const changed = [...covered].sort();
      out.push({
        code: "template_locales_incomplete",
        message:
          `Only ${changed.join(", ")} of ${all.join(", ")} changed for the ${contentType} template — the other languages keep the old layout and will differ in structure. ` +
          "Add those locales or confirm this is intentional.",
        details: { contentType, changed_locales: changed, template_locales: all, missing_locales: missing },
      });
    }
    return out;
  }

  function attachedCreateHintFor(
    proposal: ProposalRecord,
  ): { entry: AcceptedEntry; mode: AcceptedEntryCreateMode } | null {
    if (proposal.kind !== "idea" || proposal.close_reason !== "accepted" || !proposal.accepted_entry) {
      return null;
    }
    const ae = proposal.accepted_entry;
    const ex = resolveExistence({ contentType: ae.contentType, slug: ae.slug, locale: ae.locale });
    if (ex.live === "exists") return null;
    const shape = inspectTarget(ae.contentType, ae.slug);
    if (shape.shape === "attached_file") return { entry: ae, mode: "attached" };
    if (shape.shape === "page_file") return { entry: ae, mode: "page" };
    if (shape.shape === "database" && ex.live === "missing") return { entry: ae, mode: "manual" };
    return null;
  }

  function withAttachedCreate(proposal: ProposalRecord): ProposalRecord {
    const hint = attachedCreateHintFor(proposal);
    if (!hint) return proposal;
    const owner =
      layoutInfo(hint.entry.contentType, hint.entry.slug)?.layout_owner ??
      (hint.mode === "page" ? "entry" : "shared_template");
    return {
      ...proposal,
      attached_create_entry: hint.mode === "manual" ? null : hint.entry,
      accepted_entry_create_mode: hint.mode,
      accepted_entry_layout_owner: owner,
    };
  }

  function resolveImplementsForEdits(
    db: Database.Database,
    implementsRaw: string | undefined,
    entriesIn: ProposalEntryInput[],
    excludeProposalId?: string,
  ):
    | { ok: true; idea: ProposalRecord | null }
    | {
        ok: false;
        code: string;
        error: string;
        existing_proposal?: ProposalRecord;
        duplicate_of?: string;
      } {
    const id = implementsRaw?.trim() || "";
    let idea: ProposalRecord | null = null;
    if (id) {
      idea = loadProposal(db, id);
      if (
        !idea ||
        idea.site !== site ||
        idea.kind !== "idea" ||
        idea.close_reason !== "accepted" ||
        idea.status !== "finished"
      ) {
        return {
          ok: false,
          code: "implements_not_found",
          error:
            "implements_proposal_id must reference an accepted idea on this site (finished with close_reason accepted).",
        };
      }
      if (!idea.accepted_entry) {
        return {
          ok: false,
          code: "implements_idea_incomplete",
          error:
            "That accepted idea has no locked page entry. Staff must re-accept with a content type, slug, and locale (legacy ideas).",
          existing_proposal: idea,
        };
      }
      if (!entriesMatchAccepted(entriesIn, idea.accepted_entry)) {
        const ae = idea.accepted_entry;
        return {
          ok: false,
          code: "implements_entry_mismatch",
          error: `Edits must target ${ae.contentType}/${ae.slug} (${ae.locale}) to implement this idea.`,
          existing_proposal: idea,
        };
      }
      const openImpl = findOpenImplementsForIdea(db, site, idea.id, excludeProposalId);
      if (openImpl) {
        return {
          ok: false,
          code: "idea_already_in_progress",
          error: `An open edits proposal already implements this idea (${openImpl.id}). Join it instead of creating another.`,
          duplicate_of: openImpl.id,
          existing_proposal: openImpl,
        };
      }
    }
    for (const e of entriesIn) {
      const owner = findAcceptedIdeaOwningEntry(db, site, e.contentType, e.slug, e.locale);
      if (!owner) continue;
      if (!id) {
        return {
          ok: false,
          code: "implements_required",
          error: `An accepted idea (${owner.id}) already reserved ${e.contentType}/${e.slug} (${e.locale}). Pass implements_proposal_id: "${owner.id}".`,
          duplicate_of: owner.id,
          existing_proposal: owner,
        };
      }
      if (id !== owner.id) {
        return {
          ok: false,
          code: "implements_required",
          error: `That page is reserved by accepted idea ${owner.id}. Pass implements_proposal_id: "${owner.id}".`,
          duplicate_of: owner.id,
          existing_proposal: owner,
        };
      }
    }
    return { ok: true, idea };
  }

  /** The address the implemented idea locked for exactly this page + language, if any. */
  function lockedUrlSlugFor(
    idea: ProposalRecord | null,
    ref: { contentType: string; slug: string; locale: string },
  ): string | null {
    const ae = idea?.accepted_entry;
    if (!ae?.url_slug) return null;
    if (ae.contentType !== ref.contentType || ae.slug !== ref.slug || ae.locale !== ref.locale) return null;
    return ae.url_slug;
  }

  /**
   * Edits filing a new language of a page already live in another language: it must end
   * up with its own `slug` — the idea's locked url_slug (seeded), a slug op, or a slug on
   * the kept draft. A slug op that differs from the locked one needs url_slug_override.reason.
   */
  function checkEditsUrlSlug(
    idea: ProposalRecord | null,
    entries: ProposalEntryInput[],
    overrideRaw: unknown,
    /** Draft that keeps its body through this write (default: the named variant). */
    keptVariantOf: (e: ProposalEntryInput) => string | null = (e) => e.variant?.trim() || null,
  ):
    | { ok: true; override: UrlSlugOverride | null }
    | { ok: false; code: string; error: string; details?: Record<string, unknown> } {
    const ov = validateUrlSlugOverride(overrideRaw);
    if (!ov.ok) return ov;
    const facts = deps.localeUrlSlug;
    if (!facts) return { ok: true, override: ov.override };
    for (const e of entries) {
      if (isTemplateVersioningSlug(e.slug) || !addressUsesSlug(e)) continue;
      const where = `${e.contentType}/${e.slug} (${e.locale})`;
      const slugOp = (e.updates ?? []).find(
        (u) => u.field_path === "slug" && u.reset !== true && u.op !== "remove" && u.value != null,
      );
      const proposed = typeof slugOp?.value === "string" ? slugOp.value.trim() : null;
      if (proposed) {
        const formatErr = validateLocaleUrlSlugFormat(proposed);
        if (formatErr) {
          return { ok: false, code: "invalid_locale_slug", error: `${where}: ${formatErr}`, details: { property_path: "slug" } };
        }
        const owner = facts.ownerOf(e.contentType, proposed, e.locale);
        if (owner && owner !== e.slug) {
          return {
            ok: false,
            code: "slug_already_owned_by_other_entry",
            error: `${where}: "${proposed}" is already the ${e.locale} address of ${e.contentType}/${owner}. Pick another slug.`,
            details: { property_path: "slug", url_slug: proposed, owner_slug: owner },
          };
        }
      }
      const locked = lockedUrlSlugFor(idea, e);
      if (locked) {
        if (proposed && proposed !== locked && !ov.override) {
          return {
            ok: false,
            code: IDEA_URL_SLUG_CONFLICT,
            error:
              `${where}: the accepted idea locked the address "${locked}", but this edit sets slug "${proposed}". ` +
              "Drop the slug update to use the locked address, or pass url_slug_override.reason (min 40 chars) explaining why it must change.",
            details: { locked_url_slug: locked, proposed_url_slug: proposed, property_path: "slug" },
          };
        }
        continue;
      }
      if (proposed || !isNewLanguageOfLivePage(e)) continue;
      const keptVariant = keptVariantOf(e);
      const keptDraftSlug =
        keptVariant && store?.draftValue
          ? store.draftValue({ contentType: e.contentType, slug: e.slug, locale: e.locale, variant: keptVariant }, "slug")
          : undefined;
      if (typeof keptDraftSlug === "string" && keptDraftSlug.trim()) continue;
      return {
        ok: false,
        code: LOCALE_URL_SLUG_REQUIRED,
        error:
          `${where} is a new language of a page that is already live in another language. ` +
          `Without its own slug its URL reuses "${e.slug}", the address word picked for the other language. ` +
          `Add { field_path: "slug", value: "<address-in-${e.locale}>" } (same word only when it is a name that works in every language).`,
        details: { locale: e.locale, current_slug: e.slug, property_path: "slug", suggested_field: "slug" },
      };
    }
    return { ok: true, override: ov.override };
  }

  /**
   * Edits implementing an idea: seo.* ops that differ from the idea's locked
   * keyword/hub need `seo_target_override.reason`; standalone still follows the demand rule.
   */
  function checkSeoTargetOverride(
    idea: ProposalRecord | null,
    entries: Array<{ updates?: Array<{ field_path: string; value?: unknown; reset?: boolean }> }>,
    overrideRaw: unknown,
  ):
    | { ok: true; override: SeoTargetOverride | null; diff: SeoTargetDiff | null }
    | { ok: false; code: string; error: string; details?: Record<string, unknown> } {
    const ov = validateSeoTargetOverride(overrideRaw);
    if (!ov.ok) return ov;
    const locked = idea?.idea_seo_target;
    if (!locked) return { ok: true, override: ov.override, diff: null };
    const diff = seoTargetDiff(
      entries.flatMap((e) => e.updates ?? []),
      locked,
    );
    if (!diff.differs) return { ok: true, override: ov.override, diff };
    if (!ov.override) {
      return {
        ok: false,
        code: IDEA_SEO_TARGET_CONFLICT,
        error:
          `These edits change the ${diff.fields.join(" and ")} the accepted idea locked (${describeLockedTarget(locked)}). ` +
          "Drop the seo.* ops to use the locked target, or pass seo_target_override.reason (min 40 chars) explaining why it must change.",
        details: { locked, proposed: diff.proposed, fields: diff.fields },
      };
    }
    if (diff.proposed_mode === "standalone") {
      const label = ideaDemandLabel(idea!.review_situations);
      if (!standaloneAllowedForDemand(label)) return standaloneNotAllowed(label);
    }
    return { ok: true, override: ov.override, diff };
  }

  /** Agent edits that take an idea-born page out of clustering: demand rule + reason. */
  function gateAgentSeoOptOut(
    actor: unknown,
    implementsIdea: ProposalRecord | null,
    entries: Array<{ contentType: string; slug: string; updates?: Array<{ field_path: string; value?: unknown; reset?: boolean }> }>,
    reason: string | null | undefined,
  ): { ok: true } | { ok: false; code: string; error: string; details?: Record<string, unknown> } {
    if (!actor || typeof actor !== "object" || (actor as { type?: string }).type !== "mcp") return { ok: true };
    for (const e of entries) {
      if (!(e.updates ?? []).some(isSeoClusterOptOutOp)) continue;
      const origin = findOriginIdeaForEntry(site, e.contentType, e.slug);
      if (!origin) continue;
      if (origin.id === implementsIdea?.id && implementsIdea.idea_seo_target?.cluster.mode === "standalone") continue;
      const allowed = agentOptOutAllowed(origin, reason);
      if (!allowed.ok) return allowed;
    }
    return { ok: true };
  }

  function describeLockedTarget(t: IdeaSeoTarget): string {
    const c = t.cluster;
    if (c.mode === "join") return `"${t.main_keyword}" in hub ${c.pillar_path}`;
    if (c.mode === "hub") return `"${t.main_keyword}" as a new hub`;
    return `"${t.main_keyword}" standalone`;
  }

  /**
   * `seo:` block to seed into the implementing draft when the locale is not
   * published yet. Follows hub renames; a hub that is gone fails.
   */
  function ideaSeoSeed(
    idea: ProposalRecord | null,
    ref: { contentType: string; slug: string; locale: string },
  ):
    | { ok: true; seo: Record<string, unknown> | null; warnings: Array<{ code: string; message: string }> }
    | { ok: false; code: string; error: string; details?: Record<string, unknown> } {
    const t = idea?.idea_seo_target;
    if (!t) return { ok: true, seo: null, warnings: [] };
    const warnings: Array<{ code: string; message: string }> = [];
    const facts = deps.seoTarget;
    let resolvedPillarPath: string | null = null;
    if (t.cluster.mode === "join" && facts) {
      const hub = facts.resolveHub(t.cluster.pillar_path, ref.locale);
      if (!hub.live) {
        return {
          ok: false,
          code: IDEA_SEO_TARGET_HUB_GONE,
          error:
            `The hub this idea locked (${t.cluster.pillar_path}) is no longer live. ` +
            "Pass seo_target_override.reason with seo.pillar_path set to another live hub, or refile the idea.",
          details: { locked_pillar_path: t.cluster.pillar_path, resolved_path: hub.path },
        };
      }
      if (normalizePath(hub.path) !== normalizePath(t.cluster.pillar_path)) {
        resolvedPillarPath = hub.path;
        warnings.push({
          code: "idea_seo_target_hub_renamed",
          message: `The locked hub ${t.cluster.pillar_path} moved to ${hub.path}; the new page joins ${hub.path}.`,
        });
      }
    }
    const selfPath =
      t.cluster.mode === "hub" && facts ? facts.selfPath(ref.contentType, ref.slug, ref.locale) : null;
    return { ok: true, seo: seoBlockFromTarget(t, { selfPath, resolvedPillarPath }), warnings };
  }

  /**
   * An implementing edit just finished. If that released the idea's page, list the open
   * ideas that were waiting on it (never accepted automatically — accept stays four-eyes).
   */
  function pageReleasedFollowUp(
    db: Database.Database,
    edit: ProposalRecord,
  ): { code: string; message: string; details: Record<string, unknown> } | null {
    if (!edit.implements_proposal_id) return null;
    const idea = loadProposal(db, edit.implements_proposal_id);
    const entry = idea?.accepted_entry;
    if (!entry) return null;
    if (findAcceptedIdeaOwningEntry(db, site, entry.contentType, entry.slug, entry.locale)) return null;
    const waiting = findIdeasWaitingOnEntry(db, site, entry);
    if (!waiting.length) return null;
    const where = acceptedEntryKey(entry);
    return {
      code: IDEA_PAGE_RELEASED_WAITING_IDEAS,
      message:
        `${where} is free again. ${waiting.length} open idea${waiting.length === 1 ? " was" : "s were"} waiting on it: ` +
        waiting.map((w) => `"${w.title}" (${w.id})`).join(", ") +
        ". Review and accept next.",
      details: {
        released_entry: entry,
        waiting_ideas: waiting,
        next_actions: waiting.map((w) => ({
          tool: "list_proposals",
          priority: "recommended",
          reason: `Review waiting idea "${w.title}", then accept it with accepted_entry ${where}.`,
          args_hint: { proposal_id: w.id },
        })),
      },
    };
  }

  type FollowUpWarning = { code: string; message: string; details: Record<string, unknown> };

  /** Validate an applies_after predecessor for `selfId` (null on create). Empty → unlink. */
  function checkAppliesAfter(
    db: Database.Database,
    raw: string | null | undefined,
    selfId: string | null,
  ): { ok: true; id: string | null } | { ok: false; code: string; error: string } {
    const predId = typeof raw === "string" ? raw.trim() : "";
    if (!predId) return { ok: true, id: null };
    if (selfId && predId === selfId) {
      return { ok: false, code: "applies_after_cycle", error: "A proposal cannot wait on itself." };
    }
    const pred = loadProposal(db, predId);
    if (!pred || pred.site !== site) {
      return {
        ok: false,
        code: "applies_after_not_found",
        error: `applies_after_proposal_id ${predId} was not found on this site.`,
      };
    }
    if (pred.kind !== "edits") {
      return {
        ok: false,
        code: "applies_after_edits_only",
        error: `applies_after_proposal_id must point at an edits proposal (${predId} is ${pred.kind}).`,
      };
    }
    if (pred.status === "rejected" || pred.status === "withdrawn") {
      return {
        ok: false,
        code: "applies_after_closed",
        error: `Proposal ${predId} is ${pred.status}; it will never be applied. Link an open or finished proposal instead.`,
      };
    }
    if (selfId) {
      const seen = new Set<string>([pred.id]);
      let cur = pred.applies_after_proposal_id;
      while (cur) {
        if (cur === selfId) {
          return {
            ok: false,
            code: "applies_after_cycle",
            error: `Linking ${predId} would create a loop: it already waits (directly or not) on this proposal.`,
          };
        }
        if (seen.has(cur)) break;
        seen.add(cur);
        const row = db
          .prepare(`SELECT applies_after_proposal_id FROM content_proposals WHERE id = ?`)
          .get(cur) as { applies_after_proposal_id: string | null } | undefined;
        cur = row?.applies_after_proposal_id ?? null;
      }
    }
    return { ok: true, id: pred.id };
  }

  /** Apply gate: the applies_after predecessor must be fully applied (partial does not count). */
  function predecessorGate(
    db: Database.Database,
    proposal: ProposalRecord,
  ): { ok: true } | { ok: false; code: string; error: string; details: Record<string, unknown> } {
    const predId = proposal.applies_after_proposal_id;
    if (!predId) return { ok: true };
    const pred = db
      .prepare(`SELECT id, title, status FROM content_proposals WHERE id = ?`)
      .get(predId) as { id: string; title: string; status: ProposalStatus } | undefined;
    if (pred?.status === "finished") return { ok: true };
    return {
      ok: false,
      code: "predecessor_not_applied",
      error: pred
        ? `This proposal publishes after "${pred.title}" (${pred.id}), which is ${pred.status === "partial" ? "only partly published" : pred.status}. Apply that one fully first.`
        : `This proposal publishes after ${predId}, which no longer exists. Unlink it (set_applies_after with an empty id) or close this proposal.`,
      details: { applies_after_proposal_id: predId, predecessor_status: pred?.status ?? null },
    };
  }

  /** Open dependents of `predId` (applies_after_proposal_id = predId). */
  function openDependents(db: Database.Database, predId: string): Array<{ id: string; title: string }> {
    try {
      return db
        .prepare(
          `SELECT id, title FROM content_proposals
           WHERE site = ? AND applies_after_proposal_id = ? AND status IN ('open','partial')
           ORDER BY created_at`,
        )
        .all(site, predId) as Array<{ id: string; title: string }>;
    } catch {
      return [];
    }
  }

  /** Predecessor just finished: point at each open dependent (nothing is applied for them). */
  function dependentsReadyFollowUp(db: Database.Database, predId: string): FollowUpWarning | null {
    const waiting = openDependents(db, predId);
    if (!waiting.length) return null;
    return {
      code: "dependents_ready",
      message:
        `${waiting.length} proposal(s) were waiting on this one and can be applied now: ` +
        waiting.map((d) => `"${d.title}" (${d.id})`).join(", ") +
        ". Applying this proposal does not apply them.",
      details: {
        dependents: waiting,
        next_actions: waiting.map((d) => ({
          tool: "update_proposal",
          priority: "recommended",
          reason: `Review and apply "${d.title}" — the proposal it waits on is now live.`,
          args_hint: { proposal_id: d.id, action: "apply" },
        })),
      },
    };
  }

  /** Predecessor was rejected/withdrawn: one system blocker on each open dependent. */
  function blockDependentsOnClose(db: Database.Database, pred: ProposalRecord, now: number): string[] {
    const waiting = openDependents(db, pred.id);
    for (const d of waiting) {
      db.prepare(
        `INSERT INTO content_proposal_blockers (
          proposal_id, kind, body, staff_summary, status, author, created_at, agent_session_id, author_actor_json
        ) VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(
        d.id,
        "blocker",
        `predecessor_closed: the proposal this waits on ("${pred.title}", ${pred.id}) was ${pred.status}, so it will never be applied. ` +
          "Fixed looks like: unlink it (set_applies_after with an empty id, or link a replacement) or close this proposal. " +
          "Why: this proposal can only be applied after that one.",
        `The proposal this one waits on ("${pred.title}") was ${pred.status === "rejected" ? "rejected" : "withdrawn"}, ` +
          "so this one can't go live as planned. Unlink it or close this proposal.",
        "open",
        "system:applies-after",
        now,
        null,
        JSON.stringify({ type: "system" }),
      );
      db.prepare(`UPDATE content_proposals SET updated_at = ? WHERE id = ?`).run(now, d.id);
      emitProposalEvent(site, "proposal_predecessor_closed", d.id, "system:applies-after", {
        predecessor_id: pred.id,
        predecessor_status: pred.status,
      });
    }
    return waiting.map((d) => d.id);
  }

  function predecessorClosedWarning(dependentIds: string[]): FollowUpWarning {
    return {
      code: "predecessor_closed",
      message:
        `${dependentIds.length} proposal(s) were waiting on this one; each got a predecessor_closed blocker ` +
        "(unlink or close them). Closing this proposal did not close them.",
      details: { dependents: dependentIds },
    };
  }

  /**
   * New page from a join-mode idea: remind the author to link it from its hub with a chained
   * internal_links proposal. Null when not applicable or a dependent on the hub already exists.
   */
  function hubLinkReminder(
    db: Database.Database,
    proposal: ProposalRecord,
    idea: ProposalRecord | null,
  ): FollowUpWarning | null {
    const t = idea?.idea_seo_target;
    const accepted = idea?.accepted_entry;
    if (!t || t.cluster.mode !== "join" || !accepted || !deps.seoTarget) return null;
    const pageEntry = proposal.entries.find(
      (e) =>
        e.contentType === accepted.contentType && e.slug === accepted.slug && e.locale === accepted.locale,
    );
    if (!pageEntry) return null;
    const hub = deps.seoTarget.resolveHub(t.cluster.pillar_path, accepted.locale);
    const hubEntry = hub.entry ?? null;
    if (!hubEntry) return null;
    const hubKey = makeEntryKey(hubEntry.contentType, hubEntry.slug);
    const dependentIds = (proposal.applied_before_proposal_ids ?? []).filter(Boolean);
    for (const depId of dependentIds) {
      const dep = loadProposal(db, depId);
      if (!dep || dep.status === "rejected" || dep.status === "withdrawn") continue;
      if (dep.entries.some((e) => e.entry_key === hubKey && e.locale === hubEntry.locale)) return null;
    }
    const pagePath = deps.seoTarget.selfPath(accepted.contentType, accepted.slug, accepted.locale);
    const blocking = (
      db
        .prepare(
          `SELECT DISTINCT p.id, p.title FROM content_proposals p
           INNER JOIN content_proposal_entries e ON e.proposal_id = p.id
           WHERE p.site = ? AND p.kind = 'edits' AND p.status IN ('open','partial')
             AND e.entry_key = ? AND e.locale = ? AND p.id != ?`,
        )
        .all(site, hubKey, hubEntry.locale, proposal.id) as Array<{ id: string; title: string }>
    );
    const hubLabel = `${hub.path} (${hubEntry.contentType}/${hubEntry.slug})`;
    if (blocking.length) {
      return {
        code: "hub_has_open_edits",
        message:
          `The hub ${hubLabel} already has an open edits proposal, so a hub-link proposal cannot be filed yet ` +
          `(competing_entry_edits). This page can still go live first. File the internal_links proposal on the hub ` +
          `when ${blocking.map((b) => `"${b.title}" (${b.id})`).join(", ")} closes.`,
        details: {
          hub_path: hub.path,
          hub_entry: hubEntry,
          blocking_proposals: blocking,
          next_actions: blocking.map((b) => ({
            tool: "list_proposals",
            priority: "optional",
            reason: `See the open hub proposal "${b.title}"; file the hub link after it closes.`,
            args_hint: { proposal_id: b.id },
          })),
        },
      };
    }
    return {
      code: "hub_link_follow_up",
      message:
        `Link this new page from its hub ${hubLabel}: file one edits proposal on the hub with ` +
        `review_situations ["internal_links"] and applies_after_proposal_id "${proposal.id}". ` +
        "It cannot be applied until this page is live; it does not apply by itself.",
      details: {
        hub_path: hub.path,
        hub_entry: hubEntry,
        page_path: pagePath,
        next_actions: [
          {
            tool: "propose_change",
            priority: "recommended",
            reason: `Hub link: ${hubEntry.slug} → ${accepted.slug} (content only, anchor on an existing phrase).`,
            args_hint: {
              title: `Hub links: ${hubEntry.slug} → ${accepted.slug}`,
              review_situations: ["internal_links"],
              applies_after_proposal_id: proposal.id,
              related_entries: [
                { contentType: accepted.contentType, slug: accepted.slug, locale: accepted.locale },
              ],
              entries: [
                {
                  contentType: hubEntry.contentType,
                  slug: hubEntry.slug,
                  locale: hubEntry.locale,
                  updates: [{ field_path: "content", value: `<hub body with a link to ${pagePath ?? accepted.slug}>` }],
                },
              ],
            },
          },
        ],
      },
    };
  }

  /**
   * Hub-mode idea just went live: members join via one cluster-fix edits proposal
   * each (never moved automatically). Flags members already in another hub.
   */
  function hubMemberFollowUp(
    idea: ProposalRecord | null,
    entry: { contentType: string; slug: string; locale: string },
    hubProposalId?: string,
  ): FollowUpWarning | null {
    const t = idea?.idea_seo_target;
    if (!t || t.cluster.mode !== "hub") return null;
    const hubPath = deps.seoTarget?.selfPath(entry.contentType, entry.slug, entry.locale) ?? null;
    const members = t.cluster.members.map((m) => {
      const info = deps.seoTarget?.memberInfo(m.contentType, m.slug, entry.locale);
      const current = info?.pillar_path?.trim() || null;
      const inOtherHub =
        current != null && (!hubPath || normalizePath(current) !== normalizePath(hubPath));
      return { ...m, locale: entry.locale, current_pillar_path: current, in_other_hub: inOtherHub };
    });
    const moving = members.filter((m) => m.in_other_hub);
    return {
      code: "idea_seo_hub_members_follow_up",
      message:
        `New hub ${hubPath ?? `${entry.contentType}/${entry.slug}`} is live. File one edits proposal per member setting seo.pillar_path to it: ` +
        members.map((m) => `${m.contentType}/${m.slug}`).join(", ") +
        (moving.length
          ? `. Already in another hub (moving them leaves that hub): ${moving.map((m) => `${m.contentType}/${m.slug} → ${m.current_pillar_path}`).join(", ")}.`
          : ".") +
        (moving.length
          ? " In the same proposal, change the member's in-body link back to its old hub so it points at the new hub (MEMBER_MISSING_HUB_LINK otherwise)."
          : "") +
        (hubProposalId ? ` Chain each one with applies_after_proposal_id "${hubProposalId}".` : ""),
      details: {
        hub_path: hubPath,
        members,
        next_actions: members.map((m) => ({
          tool: "propose_change",
          priority: "recommended",
          reason:
            `Cluster-fix: ${m.contentType}/${m.slug} (${m.locale}) joins the new hub` +
            (m.in_other_hub
              ? ` — currently in hub ${m.current_pillar_path}; moving it leaves that hub. Also replace its in-body link to ${m.current_pillar_path} with ${hubPath ?? "the new hub"} (content op in this proposal)`
              : ""),
          args_hint: {
            title: `Join hub: ${m.slug}`,
            category: "content.seo",
            ...(hubProposalId ? { applies_after_proposal_id: hubProposalId } : {}),
            entries: [
              {
                contentType: m.contentType,
                slug: m.slug,
                locale: m.locale,
                updates: [{ field_path: "seo.pillar_path", value: hubPath }],
              },
            ],
          },
        })),
      },
    };
  }

  /** Accepted ideas whose locked page is not live yet that already claim this keyword. */
  function ideaHoldingKeyword(
    db: Database.Database,
    keyword: string,
    excludeId: string,
  ): ProposalRecord | null {
    const rows = db
      .prepare(
        `SELECT id FROM content_proposals
         WHERE site = ? AND kind = 'idea' AND close_reason = 'accepted'
           AND idea_seo_target_json IS NOT NULL AND id != ?`,
      )
      .all(site, excludeId) as Array<{ id: string }>;
    const kw = keyword.trim().toLowerCase();
    for (const r of rows) {
      const idea = loadProposal(db, r.id);
      if (!idea?.idea_seo_target || !idea.accepted_entry) continue;
      if (idea.idea_seo_target.main_keyword.trim().toLowerCase() !== kw) continue;
      const ex = resolveExistence(idea.accepted_entry);
      if (ex.live === "exists") continue;
      return idea;
    }
    return null;
  }

  /** Accepted hub-mode ideas whose new hub is not live yet that claim any of these members. */
  function ideasClaimingMembers(
    db: Database.Database,
    members: Array<{ contentType: string; slug: string }>,
    excludeId: string,
  ): Array<{ id: string; title: string; members: string[] }> {
    const want = new Set(members.map((m) => `${m.contentType}/${m.slug}`));
    if (!want.size) return [];
    const rows = db
      .prepare(
        `SELECT id FROM content_proposals
         WHERE site = ? AND kind = 'idea' AND close_reason = 'accepted'
           AND idea_seo_target_json IS NOT NULL AND id != ?`,
      )
      .all(site, excludeId) as Array<{ id: string }>;
    const out: Array<{ id: string; title: string; members: string[] }> = [];
    for (const r of rows) {
      const idea = loadProposal(db, r.id);
      const c = idea?.idea_seo_target?.cluster;
      if (!idea || !c || c.mode !== "hub" || !idea.accepted_entry) continue;
      if (resolveExistence(idea.accepted_entry).live === "exists") continue;
      const overlap = c.members.map((m) => `${m.contentType}/${m.slug}`).filter((k) => want.has(k));
      if (overlap.length) out.push({ id: idea.id, title: idea.title, members: overlap });
    }
    return out;
  }

  /** Accept gate: target complete, demand rule, hub live + same locale, members valid, keyword free. */
  function gateIdeaSeoTargetAtAccept(
    proposal: ProposalRecord,
    accepted: AcceptedEntry,
    db: Database.Database,
  ): { ok: true } | { ok: false; code: string; error: string; details?: Record<string, unknown> } {
    const t = proposal.idea_seo_target;
    if (!t || !ideaSeoTargetComplete(t)) {
      return {
        ok: false,
        code: IDEA_SEO_TARGET_REQUIRED,
        error:
          "This idea creates a new page on an SEO-monitored type: set idea_seo_target first (set_idea_seo_target) — " +
          'main_keyword plus cluster { mode: "join", pillar_path } | { mode: "hub", members } | { mode: "standalone", reason }.',
      };
    }
    const label = ideaDemandLabel(proposal.review_situations);
    if (t.cluster.mode === "standalone" && !standaloneAllowedForDemand(label)) {
      return standaloneNotAllowed(label);
    }
    const facts = deps.seoTarget;
    if (facts && t.cluster.mode === "join") {
      const hub = facts.resolveHub(t.cluster.pillar_path, accepted.locale);
      if (!hub.live || hub.is_hub === false) {
        return {
          ok: false,
          code: IDEA_SEO_TARGET_HUB_NOT_LIVE,
          error: hub.live
            ? `${hub.path} is live but is not a hub (is_pillar). Pick a live hub or use mode "hub".`
            : `The hub ${t.cluster.pillar_path} is not live. Pick a live hub, or use mode "hub" with named members.`,
          details: { pillar_path: t.cluster.pillar_path, resolved_path: hub.path },
        };
      }
      if (hub.locale && hub.locale !== accepted.locale) {
        return {
          ok: false,
          code: IDEA_SEO_TARGET_HUB_NOT_LIVE,
          error: `The hub ${hub.path} is in ${hub.locale}, but this page is ${accepted.locale}. Pick a ${accepted.locale} hub.`,
          details: { pillar_path: hub.path, hub_locale: hub.locale, page_locale: accepted.locale },
        };
      }
    }
    if (facts && t.cluster.mode === "hub") {
      const bad: string[] = [];
      for (const m of t.cluster.members) {
        const info = facts.memberInfo(m.contentType, m.slug, accepted.locale);
        if (!info.live || !info.monitored) bad.push(`${m.contentType}/${m.slug}`);
      }
      if (bad.length) {
        return {
          ok: false,
          code: IDEA_SEO_TARGET_HUB_MEMBERS_REQUIRED,
          error: `Hub members must be live, SEO-monitored ${accepted.locale} pages. Not valid: ${bad.join(", ")}.`,
          details: { invalid_members: bad },
        };
      }
    }
    if (t.cluster.mode === "hub") {
      const claims = ideasClaimingMembers(db, t.cluster.members, proposal.id);
      if (claims.length) {
        return {
          ok: false,
          code: IDEA_SEO_TARGET_MEMBERS_CLAIMED,
          error:
            `Another accepted idea that is not live yet already moves these pages into its new hub: ` +
            claims.map((c) => `${c.members.join(", ")} (idea ${c.id})`).join("; ") +
            `. Join that split or drop those members before accepting.`,
          details: { claimed_by: claims },
        };
      }
    }
    if (facts) {
      const owner = facts.keywordOwner(t.main_keyword, accepted);
      if (owner === "unavailable") {
        return {
          ok: false,
          code: "seo_index_unavailable",
          error: "SEO index is unavailable, so the keyword cannot be checked. Rebuild the cluster index, then accept again.",
        };
      }
      if (owner) {
        return {
          ok: false,
          code: IDEA_SEO_TARGET_KEYWORD_TAKEN,
          error: `Main keyword "${t.main_keyword}" is already won by live page ${owner.path}. Pick another keyword or improve that page instead.`,
          details: { owner_path: owner.path },
        };
      }
    }
    const holder = ideaHoldingKeyword(db, t.main_keyword, proposal.id);
    if (holder) {
      return {
        ok: false,
        code: IDEA_SEO_TARGET_KEYWORD_TAKEN,
        error: `Main keyword "${t.main_keyword}" is already claimed by accepted idea ${holder.id} ("${holder.title}"), which is not live yet.`,
        details: { owner_proposal_id: holder.id },
      };
    }
    return { ok: true };
  }

  function gateMissingAttachedEntry(opts: {
    entry: ProposalEntryInput;
    promoteOnApply: boolean;
    hasVariant: boolean;
    implementsIdea: ProposalRecord | null;
    db: Database.Database;
  }):
    | { ok: true; createsEntry: boolean }
    | {
        ok: false;
        code: string;
        error: string;
        existing_proposal?: ProposalRecord;
        duplicate_of?: string;
        details?: Record<string, unknown>;
      } {
    const e = opts.entry;
    const shape = inspectTarget(e.contentType, e.slug);
    const where = `${e.contentType}/${e.slug} (${e.locale})`;
    if (shape.shape === "database") {
      return {
        ok: false,
        code: "database_entry_required",
        error:
          `${where} is a database entry and has no row yet. This workflow cannot create that row. ` +
          "Field updates still work once the row exists (they write overrides). The accepted idea can stay reserved.",
      };
    }
    if (shape.shape === "attached_file" && (opts.hasVariant || opts.promoteOnApply)) {
      return {
        ok: false,
        code: "attached_no_draft",
        error:
          `${where} is an attached post. Do not attach a draft or promote_on_apply. ` +
          "Resubmit with implements_proposal_id, review_situations [\"new_public_content\"], and field updates only. Apply creates the files.",
      };
    }
    if (shape.shape === "page_file") return gateMissingPageFile({ ...opts, shape, where });
    if (shape.shape !== "attached_file") {
      if (!opts.hasVariant) {
        return {
          ok: false,
          code: "entry_not_found",
          error: opts.implementsIdea
            ? `Page ${where} does not exist yet, and this page type cannot be created from a proposal. ` +
              "Someone must create the page first (CMS or create_entry); then resubmit these edits with the same implements_proposal_id."
            : `Page ${where} does not exist yet. File an idea brief, or create the draft first, then propose edits on that target.`,
        };
      }
      return {
        ok: false,
        code: "entry_not_found",
        error: `Draft variant '${e.variant}' for ${where} was not found. Create the draft first, or use kind idea for a new-page brief.`,
      };
    }
    if (!opts.implementsIdea) {
      const owner = findAcceptedIdeaOwningEntry(opts.db, site, e.contentType, e.slug, e.locale);
      if (owner) {
        return {
          ok: false,
          code: "implements_required",
          error: `An accepted idea (${owner.id}) already reserved ${where}. Pass implements_proposal_id: "${owner.id}".`,
          duplicate_of: owner.id,
          existing_proposal: owner,
        };
      }
      return {
        ok: false,
        code: "entry_not_found",
        error: `Page ${where} does not exist yet. File an idea brief, accept it with this slug, then propose field edits with implements_proposal_id. Do not create a draft.`,
      };
    }
    const updates = e.updates ?? [];
    const sectionPaths = updates.map((u) => u.field_path).filter(isSectionFieldPath);
    if (sectionPaths.length) {
      return {
        ok: false,
        code: "attached_sections_refused",
        error: `Attached posts do not take section writes (${sectionPaths.join(", ")}). Send field updates only. The shared template stays unchanged.`,
        details: { layout_owner: "shared_template", field_paths: sectionPaths },
      };
    }
    const missing = missingRequiredFromOps(shape.requiredFields, updates);
    if (missing.length) {
      return {
        ok: false,
        code: "required_fields_missing",
        error: `This new post is missing required fields: ${missing.join(", ")}. The accepted idea still holds the slug. Add those field updates and retry.`,
      };
    }
    return { ok: true, createsEntry: true };
  }

  /** New section-built page (downloadable, landing, …): needs an accepted idea and a full sections array. */
  function gateMissingPageFile(opts: {
    entry: ProposalEntryInput;
    promoteOnApply: boolean;
    hasVariant: boolean;
    implementsIdea: ProposalRecord | null;
    db: Database.Database;
    shape: { shape: "page_file"; requiredFields: string[] };
    where: string;
  }):
    | { ok: true; createsEntry: boolean }
    | {
        ok: false;
        code: string;
        error: string;
        existing_proposal?: ProposalRecord;
        duplicate_of?: string;
        details?: Record<string, unknown>;
      } {
    const { entry: e, where } = opts;
    if (!opts.implementsIdea) {
      const owner = findAcceptedIdeaOwningEntry(opts.db, site, e.contentType, e.slug, e.locale);
      if (owner) {
        return {
          ok: false,
          code: "implements_required",
          error: `An accepted idea (${owner.id}) already reserved ${where}. Pass implements_proposal_id: "${owner.id}".`,
          duplicate_of: owner.id,
          existing_proposal: owner,
        };
      }
      return {
        ok: false,
        code: "entry_not_found",
        error:
          `Page ${where} does not exist yet. File an idea brief and get it accepted with this slug, ` +
          'then propose edits with implements_proposal_id including a full { field_path: "sections", value: [...] } update.',
      };
    }
    if (opts.hasVariant || opts.promoteOnApply) {
      return {
        ok: false,
        code: "page_create_no_draft",
        error:
          `${where} is a new page. Do not name a variant or set promote_on_apply. ` +
          "Resubmit with implements_proposal_id and field updates (including full sections); the proposal creates the page folder and its draft.",
      };
    }
    const updates = e.updates ?? [];
    if (!hasFullSectionsOp(updates)) {
      return {
        ok: false,
        code: "sections_required",
        error:
          `${where} is a new page of a type that owns its sections. Send the whole layout as one update: ` +
          '{ field_path: "sections", value: [ ...section objects ] } (non-empty). Paths like sections[0].title do not work on a page that does not exist yet.',
        details: {
          layout_owner: "entry",
          new_page: true,
          entry: { contentType: e.contentType, slug: e.slug, locale: e.locale },
        },
      };
    }
    const missing = missingRequiredFromOps(opts.shape.requiredFields, updates);
    if (missing.length) {
      return {
        ok: false,
        code: "required_fields_missing",
        error: `This new page is missing required fields: ${missing.join(", ")}. The accepted idea still holds the slug. Add those field updates and retry.`,
      };
    }
    return { ok: true, createsEntry: true };
  }

  /** Registry check for every full `sections` update (new pages, new languages, full rewrites). */
  function checkSectionUpdates(entries: ProposalEntryInput[]):
    | { ok: true }
    | { ok: false; code: string; error: string; details: Record<string, unknown> } {
    if (!deps.validateSections) return { ok: true };
    for (const e of entries) {
      for (const u of e.updates ?? []) {
        if (u.field_path !== "sections" || u.reset || u.op === "remove" || u.value == null) continue;
        const issues = deps.validateSections(u.value);
        if (!issues.length) continue;
        const where = `${e.contentType}/${e.slug} (${e.locale})`;
        const first = issues[0]!;
        return {
          ok: false,
          code: "invalid_sections",
          error: `${where}: ${first.property_path}: ${first.message}` +
            (issues.length > 1 ? ` (+${issues.length - 1} more)` : ""),
          details: {
            property_path: first.property_path,
            message: first.message,
            issues,
            entry: { contentType: e.contentType, slug: e.slug, locale: e.locale },
            ...(() => {
              const info = layoutInfo(e.contentType, e.slug);
              return info ? { ...info } : {};
            })(),
          },
        };
      }
    }
    return { ok: true };
  }

  function buildLookupsForProposal(proposal: ProposalRecord): EntryExistenceLookup[] {
    const lookups: EntryExistenceLookup[] = [];
    if (proposal.kind === "edits") {
      for (const e of proposal.entries) {
        const ex = resolveExistence({
          contentType: e.contentType,
          slug: e.slug,
          locale: e.locale,
          variant: e.variant,
        });
        const info = e.layout_owner
          ? {
              layout_owner: e.layout_owner,
              ...(e.detached ? { detached: true as const } : {}),
              ...(e.is_shared_template ? { is_shared_template: true as const } : {}),
            }
          : layoutInfo(e.contentType, e.slug);
        lookups.push({
          contentType: e.contentType,
          slug: e.slug,
          locale: e.locale,
          variant: e.variant,
          existence: ex.live,
          draftExists: ex.draftExists,
          ...(info ? info : {}),
          ...(e.baseline_context?.layout_owner
            ? { layout_owner_at_filing: e.baseline_context.layout_owner }
            : {}),
        });
      }
    } else if (proposal.kind === "idea") {
      for (const r of proposal.related_entries ?? []) {
        const locale = r.locale?.trim() || "en";
        const ex = resolveExistence({
          contentType: r.contentType,
          slug: r.slug,
          locale,
        });
        const info = layoutInfo(r.contentType, r.slug);
        lookups.push({
          contentType: r.contentType,
          slug: r.slug,
          locale,
          existence: ex.live,
          draftExists: false,
          ...(info ? info : {}),
        });
      }
    }
    return lookups;
  }

  function findRelatedOpenByIssues(proposal: ProposalRecord): RelatedOpenProposal[] {
    const ids = proposal.related_issue_ids ?? [];
    if (!ids.length) return [];
    const db = dbFor(site);
    const rows = db
      .prepare(
        `SELECT * FROM content_proposals WHERE site = ? AND status IN ('open','partial') AND id != ?`,
      )
      .all(site, proposal.id) as ProposalRow[];
    const out: RelatedOpenProposal[] = [];
    for (const row of rows) {
      const issueIds = parseJson<string[]>(row.related_issue_ids_json, []);
      const shared = ids.filter((id) => issueIds.includes(id));
      if (!shared.length) continue;
      out.push({
        id: row.id,
        title: row.title,
        kind: row.kind,
        shared_issue_ids: shared,
      });
    }
    return out;
  }

  function persistSnapshot(proposalId: string, snap: Record<string, unknown>): void {
    dbFor(site)
      .prepare(
        `UPDATE content_proposals SET review_context_snapshot_json = ?, updated_at = ? WHERE id = ?`,
      )
      .run(JSON.stringify(snap), Date.now(), proposalId);
  }

  function mergeProposalTags(proposalId: string, add: string[]): void {
    if (!add.length) return;
    const row = dbFor(site)
      .prepare(`SELECT tags_json FROM content_proposals WHERE id = ?`)
      .get(proposalId) as { tags_json: string } | undefined;
    if (!row) return;
    const existing = parseJson<string[]>(row.tags_json, []);
    const next = [...existing];
    for (const t of add) {
      if (!next.includes(t)) next.push(t);
    }
    if (next.length === existing.length) return;
    dbFor(site)
      .prepare(`UPDATE content_proposals SET tags_json = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(next), Date.now(), proposalId);
  }

  function tryLoadPromoteDraftText(proposal: ProposalRecord): string | null {
    if (!proposal.promote_on_apply || !deps.readVariantFingerprint) return null;
    try {
      const e = proposal.entries.find((x) => x.variant?.trim());
      if (!e?.variant?.trim()) return null;
      // Fingerprint path already proved file exists at create; re-read raw via getContentForEdit-style if available
      const baseline = e.baseline_context?.values;
      if (baseline && typeof baseline === "object") {
        const fromBaseline = textFromUnknown(baseline);
        if (fromBaseline.trim()) return fromBaseline;
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Idea page-type strategies (any status). Null for non-ideas or when the site has no strategy dep. */
  function contentTypeStrategiesFor(proposal: ProposalRecord): IdeaContentTypeStrategy[] | null {
    if (proposal.kind !== "idea" || !deps.strategyForContentType) return null;
    return resolveIdeaContentTypeStrategies({
      related: proposal.related_entries ?? [],
      accepted: proposal.accepted_entry ?? null,
      known: deps.knownContentTypes?.() ?? null,
      strategyFor: deps.strategyForContentType,
    });
  }

  type StoredSiteFactsCheck = SiteFactsCheck & { text_hash: string; model?: string | null; at: number };

  function readSiteFactsCache(proposalId: string): StoredSiteFactsCheck | null {
    const row = dbFor(site)
      .prepare(`SELECT site_facts_check_json FROM content_proposals WHERE id = ?`)
      .get(proposalId) as { site_facts_check_json: string | null } | undefined;
    const parsed = parseJson<StoredSiteFactsCheck | null>(row?.site_facts_check_json ?? null, null);
    return parsed && typeof parsed.text_hash === "string" && Array.isArray(parsed.categories) ? parsed : null;
  }

  /** Cached per proposal text hash; an unavailable result is retried on the next read. */
  async function resolveSiteFactsCheck(
    proposal: ProposalRecord,
    promoteDraftText: string | null,
  ): Promise<SiteFactsCheck> {
    const text = siteFactsInputText(proposal, promoteDraftText);
    const textHash = createHash("sha256").update(text).digest("hex");
    const cached = readSiteFactsCache(proposal.id);
    if (cached && cached.text_hash === textHash && cached.outcome !== "unavailable") {
      return { outcome: cached.outcome, categories: cached.categories };
    }
    const { outcome, categories, raw } = await askTouchesSiteFacts(getDecisionClient(), text);
    recordDecisionOutcome(site, raw);
    const stored: StoredSiteFactsCheck = {
      text_hash: textHash,
      outcome,
      categories,
      model: raw?.status === "ok" ? raw.model : null,
      at: Date.now(),
    };
    dbFor(site)
      .prepare(`UPDATE content_proposals SET site_facts_check_json = ? WHERE id = ?`)
      .run(JSON.stringify(stored), proposal.id);
    mergeProposalTags(proposal.id, [outcome === "unavailable" ? "used_jev_unavailable" : "used_jev"]);
    return { outcome, categories };
  }

  async function classifyLive(
    proposal: ProposalRecord,
    opts?: { persistIfMissingSnapshot?: boolean; refreshSnapshot?: boolean },
  ): Promise<ReviewContext | null> {
    if (proposal.status !== "open" && proposal.status !== "partial") return null;

    const workEntries = proposal.entries.filter(
      (e) => !e.status || e.status === "pending" || e.status === "failed",
    );
    const countsAsLeadForm =
      proposal.kind === "edits"
        ? anyEntryHasCountsAsLeadForm(
            (workEntries.length ? workEntries : proposal.entries).map((e) => ({
              contentType: e.contentType,
              slug: e.slug,
              locale: e.locale,
            })),
          )
        : false;

    const promoteDraftText = tryLoadPromoteDraftText(proposal);

    const classifyOpts = {
      proposal,
      ...(proposal.kind === "idea"
        ? {
            contentTypeStrategies: contentTypeStrategiesFor(proposal),
            knownContentTypes: deps.knownContentTypes?.() ?? null,
          }
        : {}),
      lookups: buildLookupsForProposal(proposal),
      relatedOpen: findRelatedOpenByIssues(proposal),
      snapshot: proposal.review_context_snapshot
        ? {
            damage_class:
              typeof proposal.review_context_snapshot.damage_class === "string"
                ? proposal.review_context_snapshot.damage_class
                : undefined,
          }
        : null,
      promoteDraftText,
      countsAsLeadForm,
      variableDefinitions: variableDefs(),
      ...(deps.seoTarget ? { ideaSeoTargetMonitored: deps.seoTarget.isMonitored } : {}),
      ...(proposal.kind === "edits" && proposal.implements_proposal_id
        ? (() => {
            const implemented = loadProposal(dbFor(site), proposal.implements_proposal_id);
            const ae = implemented?.accepted_entry;
            return {
              implementedIdeaSeoTarget: implemented?.idea_seo_target ?? null,
              implementedIdeaUrlSlug: ae?.url_slug
                ? { contentType: ae.contentType, slug: ae.slug, locale: ae.locale, url_slug: ae.url_slug }
                : null,
            };
          })()
        : {}),
    };

    let ctx = classifyProposalReview(classifyOpts);
    let enrichedOpts: Parameters<typeof classifyProposalReview>[0] = classifyOpts;

    if (ctx.needs_jev_claim_check && proposal.kind === "edits") {
      const { outcome, raw } = await askTouchesOutcomeFigures(
        getDecisionClient(),
        ctx.claim_cue_text ?? "",
      );
      recordDecisionOutcome(site, raw);
      enrichedOpts = { ...enrichedOpts, claimCueJevOutcome: outcome };
      ctx = classifyProposalReview(enrichedOpts);
      if (outcome === "unavailable") {
        mergeProposalTags(proposal.id, ["used_jev_unavailable"]);
      } else {
        mergeProposalTags(proposal.id, ["used_jev"]);
      }
    }

    if (ctx.needs_site_facts_check) {
      const siteFactsCheck = await resolveSiteFactsCheck(proposal, promoteDraftText);
      enrichedOpts = { ...enrichedOpts, siteFactsCheck };
      ctx = classifyProposalReview(enrichedOpts);
    }

    const snap = snapshotFromReviewContext(ctx);
    if (opts?.refreshSnapshot) {
      persistSnapshot(proposal.id, snap);
    } else if (opts?.persistIfMissingSnapshot && !proposal.review_context_snapshot) {
      persistSnapshot(proposal.id, snap);
    }
    return ctx;
  }

  function persistDecisionDebug(proposalId: string, blob: ProposalDecisionDebug): void {
    dbFor(site)
      .prepare(`UPDATE content_proposals SET decision_debug_json = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(blob), Date.now(), proposalId);
  }

  function captureDecisionDebug(
    proposal: ProposalRecord,
    action: "apply" | "reject" | "accept" | "close" | "withdraw",
    caller: ProposalUpdateCaller,
    reviewContext: ReviewContext | null,
  ): void {
    const actorRole =
      caller.actor && "role" in caller.actor && typeof caller.actor.role === "string"
        ? caller.actor.role
        : undefined;
    const enriched = enrichRecentActivity(proposal, {
      excludeAgentSessionId: caller.agent_session_id,
    });
    const blob = buildDecisionDebug({
      action,
      proposal: {
        id: proposal.id,
        // discovery_path builder only emits for open|partial — freeze as of pre-terminal.
        status: "open",
        kind: proposal.kind,
        title: proposal.title,
        summary: proposal.summary,
        escalated: proposal.escalated,
        escalated_note: proposal.escalated_note,
        entries: proposal.entries,
        related_entries: proposal.related_entries,
        open_blocker_count: proposal.open_blocker_count,
        blockers: proposal.blockers,
      },
      reviewContext,
      caller: {
        username: caller.username,
        asStaff: Boolean(caller.asStaff || caller.actor?.type === "ui"),
        agent_session_id: caller.agent_session_id ?? null,
        actor: caller.actor
          ? { type: caller.actor.type, ...(actorRole ? { role: actorRole } : {}) }
          : null,
      },
      recentActivity: enriched.recent_activity ?? null,
    });
    persistDecisionDebug(proposal.id, blob);
  }

  function enrichRecentActivity(
    proposal: ProposalRecord,
    opts?: { excludeAgentSessionId?: string | null },
  ): ProposalRecord {
    if (proposal.kind !== "edits" || proposal.entries.length === 0) return proposal;
    const resolved = runResolveActivity({
      entries: proposal.entries.map((e) => ({
        contentType: e.contentType,
        slug: e.slug,
        locale: e.locale,
        variant: e.variant,
      })),
      excludeAgentSessionId: opts?.excludeAgentSessionId,
      // Match apply gate: ignore this proposal's already-applied entry writes.
      excludeProposalApplies: proposal.entries
        .filter((e) => e.status === "done")
        .map((e) => ({
          contentType: e.contentType,
          slug: e.slug,
          locale: e.locale,
          variant: e.variant,
          applied_at: e.applied_at,
          applied_by: e.applied_by,
        })),
    });
    if (!resolved.ok) {
      return { ...proposal, recent_activity_error: resolved.error };
    }
    return { ...proposal, recent_activity: resolved.activity };
  }

  function withSiblings(proposal: ProposalRecord): ProposalRecord {
    const siblings = findEscalatedSiblings(dbFor(site), site, proposal);
    return siblings.length ? { ...proposal, escalated_siblings: siblings } : proposal;
  }

  // ── v1.0 draft-first ────────────────────────────────────────────────────────

  const store = deps.draftStore;

  function refOf(e: {
    contentType: string;
    slug: string;
    locale: string;
    variant: string | null;
  }): ProposalDraftRef {
    return {
      contentType: e.contentType,
      slug: e.slug,
      locale: e.locale,
      variant: e.variant ?? "",
    };
  }

  function linkFor(
    proposalId: string,
    created: boolean,
    fingerprint: string | null,
  ) {
    return {
      id: proposalId,
      env: DRAFT_LINK_ENV,
      ...(created
        ? {
            created_by_proposal: true,
            ...(fingerprint ? { created_fingerprint: fingerprint } : {}),
          }
        : {}),
    };
  }

  /** Open v1.0 proposal (other than `excludeId`) whose draft on this page stages page-level fields. */
  function findOpenSharedFieldEditsForEntry(
    contentType: string,
    slug: string,
    excludeId?: string,
  ): ProposalRecord | null {
    if (!store) return null;
    const db = dbFor(site);
    const entryKey = makeEntryKey(contentType, slug);
    const rows = db
      .prepare(
        `SELECT DISTINCT p.id FROM content_proposals p
         JOIN content_proposal_entries e ON e.proposal_id = p.id
         WHERE p.site = ? AND p.status IN ('open','partial') AND p.system_version IS NOT NULL
           AND e.entry_key = ? AND e.status IN ('pending','failed') AND e.variant IS NOT NULL AND p.id != ?`,
      )
      .all(site, entryKey, excludeId ?? "") as Array<{ id: string }>;
    for (const r of rows) {
      const p = loadProposal(db, r.id);
      if (!p) continue;
      const hit = p.entries.some(
        (e) =>
          e.entry_key === entryKey &&
          (e.status === "pending" || e.status === "failed") &&
          e.variant &&
          store.carriesCommon(refOf(e)),
      );
      if (hit) return p;
    }
    return null;
  }

  /**
   * v1.0 read: `ops` / `baseline_context` / `author_diff` come from the draft (cached in
   * `derived_ops_json` by draft + base + live hashes), plus base / source / merge state.
   */
  function affectedEntriesFor(record: ProposalRecord): AffectedEntries | null {
    if (!store?.listAttachedEntries) return null;
    const seen = new Set<string>();
    const all: AffectedEntries["sample"] = [];
    for (const e of record.entries) {
      if (e.status === "done" || !isTemplateVersioningSlug(e.slug)) continue;
      const key = `${e.contentType}:${e.locale}`;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const slug of store.listAttachedEntries(e.contentType, e.locale)) {
        all.push({ contentType: e.contentType, slug, locale: e.locale, variant: e.variant });
      }
    }
    return seen.size ? { count: all.length, sample: all.slice(0, 3) } : null;
  }

  function hydrate(record: ProposalRecord | null): ProposalRecord | null {
    if (!record || !store || !record.system_version || record.kind !== "edits")
      return record;
    const affected = affectedEntriesFor(record);
    const db = dbFor(site);
    const withLayout = (e: ProposalEntryRow): ProposalEntryRow => {
      if (e.status === "done") return e;
      const info = layoutInfo(e.contentType, e.slug);
      return info ? { ...e, ...info } : e;
    };
    const hydrateEntry = (e: ProposalEntryRow): ProposalEntryRow => {
      if (!e.variant || e.status === "done") return e;
      const ref = refOf(e);
      const requested = e.requested_ops ?? e.ops;
      if (!store.exists(ref)) {
        return {
          ...e,
          ops: [],
          baseline_context: { values: {} },
          requested_ops: requested,
          draft_missing: true,
        };
      }
      const key = store.derivedKey(ref);
      const cached = derivedViewCache.get(e);
      let view: { changes: FieldChange[]; approximate: boolean } | null =
        cached?.key && cached.key === key && cached.json
          ? parseJson(cached.json, null)
          : null;
      if (!view) {
        const diff = store.authorDiff(ref);
        view = {
          changes: diff?.changes ?? [],
          approximate: diff?.approximate ?? true,
        };
        try {
          db.prepare(
            `UPDATE content_proposal_entries SET derived_ops_json = ?, derived_for_key = ? WHERE id = ?`,
          ).run(JSON.stringify(view), key, e.id);
        } catch {
          /* cache is best-effort */
        }
      }
      const derived = entryViewFromDiff(requested, view.changes, view.approximate);
      const next: ProposalEntryRow = {
        ...e,
        ...derived,
        baseline_context: withFilingOwner(derived.baseline_context, e.baseline_context),
      };
      const base = store.checkBase(ref);
      next.base_status = base.status;
      if (base.status === "stale") {
        const r = store.rebuild(ref, { preview: true });
        next.merge_preview = r.ok
          ? {
              status: "rebuild",
              author_fields: r.author_changes.map((c) => c.field_path),
              live_changes_since_base: r.live_changes_since_base,
              result: r.result,
            }
          : {
              status: r.reason,
              ...(r.conflicting_fields
                ? { conflicting_fields: r.conflicting_fields }
                : {}),
              ...(r.live_changes_since_base
                ? { live_changes_since_base: r.live_changes_since_base }
                : {}),
            };
      }
      const source = store.checkSource(ref, true);
      if (source.status === "changed") {
        next.source_changed = {
          source_locale: source.source_locale,
          ...(source.source_changed_fields
            ? { fields: source.source_changed_fields }
            : {}),
        };
      }
      derivedViewCache.set(next, { key, json: JSON.stringify(view) });
      return next;
    };
    const entries = record.entries.map((e) => withLayout(hydrateEntry(e)));
    return { ...record, entries, ...(affected ? { affected_entries: affected } : {}) };
  }

  function markStale(
    proposalId: string,
    reason: string,
    detail: Record<string, unknown>,
    author: string,
  ): void {
    const db = dbFor(site);
    const row = db
      .prepare(`SELECT stale_since FROM content_proposals WHERE id = ?`)
      .get(proposalId) as { stale_since: string | null } | undefined;
    if (!row || row.stale_since) return;
    db.prepare(`UPDATE content_proposals SET stale_since = ? WHERE id = ?`).run(
      new Date().toISOString(),
      proposalId,
    );
    emitProposalEvent(site, "proposal_needs_author", proposalId, author, {
      reason,
      ...detail,
    });
  }

  function clearStale(proposalId: string): void {
    dbFor(site)
      .prepare(
        `UPDATE content_proposals SET stale_since = NULL, stale_flagged_at = NULL WHERE id = ?`,
      )
      .run(proposalId);
  }

  type V1Plan = {
    input: ProposalEntryInput & { updates: FieldUpdate[] };
    ref: ProposalDraftRef;
    created: boolean;
    fingerprint: string | null;
  };
  type V1Fail = {
    ok: false;
    code: string;
    error: string;
    duplicate_of?: string;
    existing_proposal?: ProposalRecord;
    details?: unknown;
  };

  /**
   * Write each entry's updates into its draft (creating it when missing). All or nothing:
   * a failure restores / removes every draft touched so far.
   */
  async function prepareV1Drafts(opts: {
    proposalId: string;
    entries: Array<ProposalEntryInput & { updates: FieldUpdate[] }>;
    author: string;
    newEntryKeys: Set<string>;
    ideaFunnel: IdeaFunnel | null;
    /** Implemented idea: its locked SEO target seeds the draft when the locale is not published. */
    idea?: ProposalRecord | null;
    /** revise_entries: drafts this proposal already owns (entry key → variant, created). */
    owned?: Map<string, { variant: string; created: boolean }>;
    /** revise_entries: start drafts this proposal created from today's live (no co-author edits to keep). */
    resetCreated?: boolean;
  }): Promise<
    | {
        ok: true;
        plans: V1Plan[];
        warnings: Array<{ code: string; message: string }>;
      }
    | V1Fail
  > {
    const s = store!;
    const plans: V1Plan[] = [];
    const warnings: Array<{ code: string; message: string }> = [];
    const undo: Array<() => unknown> = [];
    const fail = async (r: V1Fail): Promise<V1Fail> => {
      for (const u of undo.reverse()) {
        try {
          await u();
        } catch (err) {
          log.warn({ err }, "proposal draft rollback failed");
        }
      }
      return r;
    };
    const db = dbFor(site);
    for (const e of opts.entries) {
      const key = attachedCreateKey(e.contentType, e.slug, e.locale);
      const ownedForKey = opts.owned?.get(key);
      const variant =
        e.variant?.trim() ||
        ownedForKey?.variant ||
        s.pickVariant(e, opts.proposalId);
      const owned =
        ownedForKey && ownedForKey.variant === variant
          ? ownedForKey
          : undefined;
      const ref: ProposalDraftRef = {
        contentType: e.contentType,
        slug: e.slug,
        locale: e.locale,
        variant,
      };
      const where = `${e.contentType}/${e.slug} (${e.locale})`;
      const failed = await withOwnDraftWrite(
        s.pathOf(ref),
        async (): Promise<V1Fail | null> => {
          const exists = s.exists(ref);
          if (exists) {
            const alloc = s.allocation(ref) ?? 0;
            if (alloc > 0) {
              return fail({
                ok: false,
                code: "variant_has_traffic",
                error: `Variant '${variant}' on ${where} has ${alloc}% traffic, so it is an experiment. Proposals only target drafts (0% traffic).`,
              });
            }
            const link = s.readLink(ref);
            if (link && link.id !== opts.proposalId) {
              const local = loadProposal(db, link.id);
              const open = local ? local.status === "open" || local.status === "partial" : false;
              if (open) {
                return fail({
                  ok: false,
                  code: "draft_in_proposal",
                  error: `Draft '${variant}' on ${where} is under review in proposal ${link.id}. Join that proposal instead.`,
                  duplicate_of: link.id,
                  ...(local ? { existing_proposal: local } : {}),
                });
              }
            }
          }
          const wouldCarryCommon =
            e.updates.some((u) => fieldScope(u.field_path) === "common") ||
            (exists && s.carriesCommon(ref));
          if (wouldCarryCommon) {
            const other = findOpenSharedFieldEditsForEntry(
              e.contentType,
              e.slug,
              opts.proposalId,
            );
            if (other) {
              return fail({
                ok: false,
                code: "competing_shared_fields",
                error: `Proposal ${other.id} already changes page-level fields (funnel, authors, publish date, …) of ${e.contentType}/${e.slug}. Only one open proposal per page may change them — join ${other.id}.`,
                duplicate_of: other.id,
                existing_proposal: other,
              });
            }
          }
          let created = false;
          let rebaseAfterWrite = false;
          let reseedSeo = false;
          const localeLive = resolveExistence(ref).live === "exists";
          let seoSeed: Record<string, unknown> | null = null;
          if (!localeLive && opts.idea?.idea_seo_target) {
            const seed = ideaSeoSeed(opts.idea, ref);
            if (!seed.ok) return fail(seed);
            seoSeed = seed.seo;
            warnings.push(...seed.warnings);
          }
          if (!exists) {
            const newEntry = opts.newEntryKeys.has(key)
              ? {
                  funnel: opts.ideaFunnel
                    ? (ideaFunnelToYamlBlock(opts.ideaFunnel) as Record<
                        string,
                        unknown
                      >)
                    : null,
                }
              : undefined;
            const res = s.create(ref, { author: opts.author, newEntry, seo: seoSeed });
            if (!res.ok) {
              return fail({
                ok: false,
                code: res.code,
                error: `${where}: ${res.error} Create the page first (create_entry), or implement an accepted idea.`,
              });
            }
            created = true;
            undo.push(() => s.remove(ref, opts.author));
          } else {
            const raw = s.snapshotRaw(ref);
            if (raw != null)
              undo.push(() => s.restoreRaw(ref, raw, opts.author));
            if (owned) {
              if (opts.resetCreated && owned.created) {
                s.reset(ref, opts.author);
                reseedSeo = seoSeed != null;
              } else {
                const base = s.checkBase(ref);
                if (base.status === "stale") {
                  const r = s.rebuild(ref, {
                    preview: false,
                    author: opts.author,
                  });
                  if (r.ok) {
                    emitProposalEvent(
                      site,
                      "draft_rebuilt",
                      opts.proposalId,
                      opts.author,
                      {
                        ...ref,
                        kept_live_fields: r.live_changes_since_base.map(
                          (c) => c.field_path,
                        ),
                      },
                    );
                  }
                } else {
                  rebaseAfterWrite = base.status === "unknown";
                }
              }
            }
          }
          if (e.translated_from_locale?.trim())
            s.recordSource(ref, e.translated_from_locale.trim(), opts.author);
          const lockedUrlSlug = !localeLive ? lockedUrlSlugFor(opts.idea ?? null, ref) : null;
          const slugSeed: FieldUpdate[] =
            lockedUrlSlug && !e.updates.some((u) => u.field_path === "slug")
              ? [{ field_path: "slug", value: lockedUrlSlug }]
              : [];
          if (slugSeed.length) {
            warnings.push({
              code: "idea_url_slug_locked",
              message: `${where}: the draft uses the address "${lockedUrlSlug}" the accepted idea locked (slug: in ${ref.locale}.yml). The folder name "${ref.slug}" stays the page ID; other languages keep their addresses.`,
            });
          }
          const writeOps = [
            ...slugSeed,
            ...(reseedSeo && seoSeed
              ? Object.entries(seoSeed).map(([k, v]) => ({ field_path: `seo.${k}`, value: v }) as FieldUpdate)
              : []),
            ...e.updates,
          ];
          const wrote = await s.write(ref, writeOps, opts.author);
          if (!wrote.ok) {
            return fail({
              ok: false,
              code: wrote.code || "draft_write_failed",
              error: `${where}: ${wrote.error}`,
              ...(wrote.details !== undefined
                ? { details: wrote.details }
                : {}),
            });
          }
          warnings.push(...wrote.warnings);
          const structure = s.structureError(ref);
          if (structure) {
            return fail({
              ok: false,
              code: "attached_draft_structure",
              error: `${where}: ${structure} Drafts of posts that use the shared template may only change fields.`,
              details: { layout_owner: "shared_template" },
            });
          }
          if (rebaseAfterWrite) s.recordBase(ref, opts.author);
          plans.push({
            input: { ...e, variant },
            ref,
            created: created || owned?.created === true,
            fingerprint: s.fingerprint(ref),
          });
          return null;
        },
      );
      if (failed) return failed;
    }
    return { ok: true, plans, warnings };
  }

  /**
   * Reject / withdraw / drop from revise: delete drafts this proposal created, unlink the rest.
   * `forDelete` (staff bulk delete): draft files are touched only on the live server (a laptop
   * holds a test copy), empty links are never rewritten, co-authored drafts are kept,
   * and a failed removal throws so the caller can keep the proposal row.
   */
  async function releaseV1Drafts(
    proposalId: string,
    entries: ProposalEntryRow[],
    author: string,
    opts?: { forDelete?: { keepCreated: boolean } },
  ): Promise<Array<{ code: string; message: string; path?: string }>> {
    if (!store) return [];
    const forDelete = opts?.forDelete;
    const out: Array<{ code: string; message: string; path?: string }> = [];
    for (const e of entries) {
      if (!e.variant || e.status === "done") continue;
      const ref = refOf(e);
      if (!store.exists(ref)) continue;
      const link = store.readLink(ref);
      if (link && link.id !== proposalId) continue;
      const where = `${e.variant} of ${e.contentType}/${e.slug} (${e.locale})`;
      const relPath = forDelete ? path.relative(process.cwd(), store.pathOf(ref)) : undefined;
      if (forDelete && !isLiveServer()) {
        out.push({
          code: "draft_test_copy",
          message: `Left draft ${where} untouched (this is a test copy; drafts are only removed on the live server).`,
          path: relPath,
        });
        continue;
      }
      try {
        const remove = forDelete ? e.created_draft && !forDelete.keepCreated : e.created_draft;
        if (remove) {
          const { entryDeleted } = await store.remove(ref, author);
          out.push({
            code: "draft_deleted",
            message: entryDeleted
              ? `Deleted draft ${where} and the unpublished page it created.`
              : `Deleted draft ${where} (created by this proposal).`,
            path: relPath,
          });
        } else if (forDelete && e.created_draft) {
          if (link) store.link(ref, null, author);
          out.push({
            code: "draft_kept_co_authors",
            message: `Kept draft ${where} because co-authors edited it; unlinked.`,
            path: relPath,
          });
        } else if (forDelete && !link) {
          continue;
        } else {
          store.link(ref, null, author);
          out.push({
            code: "draft_kept",
            message: `Kept draft ${where} (it existed before this proposal); unlinked.`,
            path: relPath,
          });
        }
      } catch (err) {
        if (forDelete) throw err;
        log.warn({ err, proposalId }, "release proposal draft failed");
      }
    }
    return out;
  }

  /** Map promote failures to proposal terms (apply never overwrites newer live). */
  function applyFailureFor(code: string | undefined, details: Record<string, unknown> | undefined) {
    const staleDetails = (reason: string) => {
      const { reason: inner, ...rest } = details ?? {};
      return { ...rest, reason, ...(inner != null ? { rebuild_reason: inner } : {}) };
    };
    if (code === "draft_base_stale") return { code: "context_stale", details: staleDetails("live_changed") };
    if (code === "translation_source_changed") return { code: "context_stale", details: staleDetails("source_changed") };
    return { code: code ?? "promote_failed", details };
  }

  /** Owned its layout at filing, uses the shared template now, and the draft changes sections. */
  function layoutSwitchedToTemplate(entry: ProposalEntryRow): boolean {
    if (entry.baseline_context?.layout_owner !== "entry" || !entry.variant) return false;
    const now = entry.layout_owner ?? layoutInfo(entry.contentType, entry.slug)?.layout_owner;
    if (now !== "shared_template") return false;
    const diff = entry.author_diff ?? store?.authorDiff(refOf(entry))?.changes ?? [];
    return diff.some((c) => isSectionFieldPath(c.field_path));
  }

  /** Every check promote would run, without writing (rebuild preview included). */
  async function checkV1Entry(
    entry: ProposalEntryRow,
    caller: ProposalUpdateCaller,
    seo?: { reason: string | null; idea: ProposalRecord | null; overridden: boolean },
  ): Promise<ApplyEntryPreview> {
    const seoReason = seo?.reason ?? null;
    const out: ApplyEntryPreview = { entry_key: entry.entry_key, locale: entry.locale, variant: entry.variant, ok: false };
    if (!entry.variant) return { ...out, code: "variant_required", error: "v1.0 entries always have a draft variant" };
    const lockedCluster = seo?.idea?.idea_seo_target?.cluster;
    if (
      lockedCluster?.mode === "join" &&
      !seo?.overridden &&
      deps.seoTarget &&
      resolveExistence(entry).live !== "exists"
    ) {
      const hub = deps.seoTarget.resolveHub(lockedCluster.pillar_path, entry.locale);
      if (!hub.live) {
        return {
          ...out,
          code: IDEA_SEO_TARGET_HUB_GONE,
          error:
            `The hub this idea locked (${lockedCluster.pillar_path}) is no longer live, so the new page would join a dead cluster. ` +
            "Revise with seo.pillar_path set to another live hub and seo_target_override.reason.",
          details: { locked_pillar_path: lockedCluster.pillar_path, resolved_path: hub.path },
        };
      }
    }
    const ref = refOf(entry);
    if (!store!.exists(ref)) {
      return { ...out, code: "draft_missing", error: `Draft ${entry.variant}.${entry.locale}.yml no longer exists.` };
    }
    const fp = store!.fingerprint(ref);
    if (entry.variant_fingerprint && fp !== entry.variant_fingerprint) {
      return {
        ...out,
        code: "context_stale",
        error: "The draft changed outside the proposal flow (for example a content sync) after the last review.",
        details: { reason: "draft_changed" },
      };
    }
    if (layoutSwitchedToTemplate(entry)) {
      return {
        ...out,
        code: "context_stale",
        error:
          "This entry now uses the shared template (reattached) since the proposal was filed, so the draft's sections would be ignored. The author must revise to fields only or withdraw.",
        details: { reason: "layout_owner_changed", layout_owner_at_filing: "entry", layout_owner: "shared_template" },
      };
    }
    const alloc = store!.allocation(ref) ?? 0;
    if (alloc > 0) {
      return { ...out, code: "variant_has_traffic", error: `Variant '${entry.variant}' has ${alloc}% traffic (experiment).` };
    }
    if (!deps.promoteEntry) return { ...out, code: "promote_not_configured", error: "promote not configured" };
    const dry = await deps.promoteEntry(entry, caller.username, {
      dry_run: true,
      confirm_end_experiment: caller.confirm_end_experiment,
      confirm_base_unknown: caller.confirm_base_unknown,
      confirm_text_limits: caller.confirm_text_limits,
      caller_is_mcp: caller.caller_is_mcp,
      seo_standalone_reason: seoReason,
    });
    if (!dry.ok) {
      const mapped = applyFailureFor(dry.code, dry.details);
      return {
        ...out,
        code: mapped.code,
        error: dry.error ?? "promote check failed",
        ...(mapped.details ? { details: mapped.details } : {}),
      };
    }
    const displayWarnings = (dry.warnings ?? []).filter((w) => w.code === "display_values_change");
    return {
      ...out,
      ok: true,
      ...(dry.rebuilt ? { rebuilt: dry.rebuilt } : {}),
      ...(dry.published_diff ? { published_diff: dry.published_diff } : {}),
      ...(displayWarnings.length ? { warnings: displayWarnings } : {}),
    };
  }

  const STALE_CODES = new Set(["context_stale", "draft_missing"]);

  /**
   * Template entries: new `{{ entry.* }}` placeholders that some attached entries leave empty.
   * Never blocks; a failed scan is logged and skipped.
   */
  function templatePlaceholderWarnings(
    work: ProposalEntryRow[],
  ): Array<{ code: string; message: string; details: Record<string, unknown> }> {
    if (!deps.scanTemplatePlaceholders || !store?.listAttachedEntries || !store.draftValue) return [];
    const out: Array<{ code: string; message: string; details: Record<string, unknown> }> = [];
    for (const e of work) {
      if (!e.variant || !isTemplateVersioningSlug(e.slug)) continue;
      try {
        const placeholders = deps.scanTemplatePlaceholders({
          contentType: e.contentType,
          locale: e.locale,
          liveSections: store.liveValue(e, "sections"),
          draftSections: store.draftValue(refOf(e), "sections"),
          attachedSlugs: store.listAttachedEntries(e.contentType, e.locale),
        });
        if (!placeholders.length) continue;
        const parts = placeholders.map(
          (p) => `${p.missing} of ${p.total} pages have no value for ${p.name} (e.g. ${p.sample.join(", ")})`,
        );
        out.push({
          code: "template_placeholders_unfilled",
          message: `${e.contentType} template (${e.locale}): ${parts.join("; ")} — those pages will show an empty spot. Not blocking.`,
          details: { contentType: e.contentType, locale: e.locale, placeholders },
        });
      } catch (err) {
        log.warn({ err, entry: e.entry_key, locale: e.locale }, "template placeholder scan failed");
      }
    }
    return out;
  }

  /** v1.0 apply: only promotes drafts. Checks every entry first (all_or_nothing / dry_run). */
  async function applyV1(
    proposal: ProposalRecord,
    work: ProposalEntryRow[],
    caller: ProposalUpdateCaller,
    reviewForApply: ReviewContext | null,
  ) {
    const db = dbFor(site);
    const id = proposal.id;
    const checks: ApplyEntryPreview[] = [];
    const implementedIdea = proposal.implements_proposal_id
      ? loadProposal(db, proposal.implements_proposal_id)
      : null;
    const seoCtx = {
      reason: proposal.seo_target_override?.reason ?? null,
      idea: implementedIdea,
      overridden: proposal.seo_target_override != null,
    };
    const localeWasLive = new Map<number, boolean>();
    for (const entry of work) {
      localeWasLive.set(entry.id, resolveExistence(entry).live === "exists");
      checks.push(await checkV1Entry(entry, caller, seoCtx));
    }
    const failed = checks.filter((c) => !c.ok);

    const endExperiment = failed.find((c) => c.code === "confirm_end_experiment");
    if (endExperiment && !caller.dry_run) {
      return {
        ok: false as const,
        code: "confirm_end_experiment",
        error: endExperiment.error ?? "confirm_end_experiment required",
        proposal,
      };
    }
    const affected = affectedEntriesFor(proposal);
    if (affected && !caller.dry_run && caller.confirm_affected_entries !== affected.count) {
      return {
        ok: false as const,
        code: "confirm_affected_entries",
        error: `This proposal changes the shared template, which reaches ${affected.count} attached page(s). Re-send with confirm_affected_entries: ${affected.count} to publish.`,
        proposal,
        details: affected,
      };
    }
    const unknownBase = failed.filter((c) => c.code === "draft_base_unknown");
    if (unknownBase.length && !caller.dry_run) {
      return {
        ok: false as const,
        code: "draft_base_unknown",
        error:
          "Some drafts have no recorded starting point, so changes made to live since then cannot be detected. Re-send with confirm_base_unknown: true to publish the draft as-is.",
        proposal,
        details: { entries: unknownBase.map((c) => ({ entry_key: c.entry_key, locale: c.locale, variant: c.variant })) },
      };
    }
    const textTooLong = failed.filter((c) => c.code === TEXT_LIMITS_EXCEEDED_CODE);
    if (textTooLong.length && !caller.dry_run) {
      return {
        ok: false as const,
        code: TEXT_LIMITS_EXCEEDED_CODE,
        error: caller.caller_is_mcp
          ? "Some drafts have text longer than the section allows. Shorten it on the draft and retry; agents cannot publish over the limit."
          : "Some drafts have text longer than the section allows. Shorten it, or re-send with confirm_text_limits: true to publish anyway.",
        proposal,
        details: {
          entries: textTooLong.map((c) => ({
            entry_key: c.entry_key,
            locale: c.locale,
            variant: c.variant,
            error: c.error,
            ...(c.details ?? {}),
          })),
        },
      };
    }
    const placeholderGaps = affected ? templatePlaceholderWarnings(work) : [];
    if (caller.dry_run) {
      const chainGate = predecessorGate(db, proposal);
      const openBlockerIds = proposal.blockers.filter((b) => b.status === "open").map((b) => b.id);
      const dryWarnings = [
        ...(openBlockerIds.length
          ? [
              {
                code: PREVIEW_WHILE_BLOCKED_CODE,
                message: `Preview only: ${openBlockerIds.length} open blocker(s) (${openBlockerIds.map((b) => `#${b}`).join(", ")}) still prevent apply. A clean preview is not approval — resolve the blocker(s), then apply.`,
                details: { open_blocker_ids: openBlockerIds },
              },
            ]
          : []),
        ...(chainGate.ok ? [] : [{ code: chainGate.code, message: chainGate.error, details: chainGate.details }]),
        ...failed.map((c) => ({ code: c.code ?? "apply_check_failed", message: `${c.entry_key} (${c.locale}): ${c.error}` })),
        ...checks.flatMap((c) =>
          (c.warnings ?? []).map((w) => ({
            code: w.code,
            message: `${c.entry_key} (${c.locale}): ${w.message}`,
            details: { entry_key: c.entry_key, locale: c.locale, fields: w.fields ?? [] },
          })),
        ),
        ...placeholderGaps,
      ];
      return {
        ok: true as const,
        proposal,
        dry_run: true,
        merge_preview: checks,
        ...(dryWarnings.length ? { warnings: dryWarnings } : {}),
      };
    }

    const failEntry = (entryId: number, c: ApplyEntryPreview) => {
      db.prepare(`UPDATE content_proposal_entries SET status = 'failed', last_error = ? WHERE id = ?`).run(
        `${c.code}: ${c.error}${c.details ? ` ${JSON.stringify(c.details)}` : ""}`,
        entryId,
      );
    };
    const staleFailures = failed.filter((c) => c.code && STALE_CODES.has(c.code));
    if (staleFailures.length) {
      markStale(id, "context_stale", {
        entries: staleFailures.map((c) => ({ entry_key: c.entry_key, locale: c.locale, ...(c.details ?? {}) })),
      }, caller.username);
    }

    if (proposal.all_or_nothing && failed.length) {
      work.forEach((entry, i) => {
        if (!checks[i]!.ok) failEntry(entry.id, checks[i]!);
      });
      return {
        ok: false as const,
        code: "all_or_nothing_blocked",
        error: `All-or-nothing proposal: ${failed.length} of ${checks.length} entries cannot be published, so nothing was published.`,
        proposal: get(id)!,
        pending: failed,
      };
    }

    const warnings: Array<{ code: string; message: string; details?: Record<string, unknown> }> = [...placeholderGaps];
    for (let i = 0; i < work.length; i++) {
      const entry = work[i]!;
      const check = checks[i]!;
      if (!check.ok) {
        failEntry(entry.id, check);
        continue;
      }
      const promoted = await deps.promoteEntry!(entry, caller.username, {
        confirm_end_experiment: caller.confirm_end_experiment,
        confirm_base_unknown: caller.confirm_base_unknown,
        confirm_text_limits: caller.confirm_text_limits,
        caller_is_mcp: caller.caller_is_mcp,
        seo_standalone_reason: proposal.seo_target_override?.reason ?? null,
      });
      if (!promoted.ok) {
        const mapped = applyFailureFor(promoted.code, promoted.details);
        const c = { ...check, ok: false, code: mapped.code, error: promoted.error ?? "promote failed", ...(mapped.details ? { details: mapped.details } : {}) };
        failed.push(c);
        failEntry(entry.id, c);
        continue;
      }
      db.prepare(
        `UPDATE content_proposal_entries
         SET status = 'done', last_error = NULL, applied_at = ?, applied_by = ?,
             published_diff_json = ?, pre_apply_snapshot_json = ?
         WHERE id = ?`,
      ).run(
        Date.now(),
        caller.username,
        promoted.published_diff ? JSON.stringify(promoted.published_diff) : null,
        promoted.pre_apply_snapshot ? JSON.stringify(promoted.pre_apply_snapshot) : null,
        entry.id,
      );
      if (promoted.rebuilt) {
        emitProposalEvent(site, "draft_rebuilt", id, caller.username, {
          entry_key: entry.entry_key,
          locale: entry.locale,
          variant: entry.variant,
          ...promoted.rebuilt,
        });
      }
      for (const w of promoted.warnings ?? []) {
        warnings.push({
          code: w.code,
          message: `${entry.entry_key} (${entry.locale}): ${w.message}`,
          ...(w.code === "display_values_change" ? { details: { entry_key: entry.entry_key, locale: entry.locale, fields: w.fields ?? [] } } : {}),
        });
      }
      if (!localeWasLive.get(entry.id)) {
        const followUp = hubMemberFollowUp(implementedIdea, entry, id);
        if (followUp) warnings.push(followUp);
      }
    }
    if (!failed.length) clearStale(id);
    const updated = get(id)!;
    const next = persistRollup(db, updated, { closedBy: caller.username });
    const fresh = get(id)!;
    if (next === "finished") {
      if (fresh.dependent_overdue_flagged_at) {
        db.prepare(`UPDATE content_proposals SET dependent_overdue_flagged_at = NULL WHERE id = ?`).run(id);
      }
      const ready = dependentsReadyFollowUp(db, id);
      if (ready) warnings.push(ready);
      const reminder = hubLinkReminder(db, fresh, implementedIdea);
      if (reminder) warnings.push(reminder);
    }
    emitProposalEvent(site, "proposal_applied_progress", id, caller.username, {
      status: next,
      done: fresh.entries.filter((e) => e.status === "done").length,
      total: fresh.entries.length,
    }, caller.actor);
    if (next === "finished") {
      captureDecisionDebug(proposal, "apply", caller, reviewForApply);
      const released = pageReleasedFollowUp(db, fresh);
      if (released) warnings.push(released);
      emitProposalEvent(site, "proposal_finished", id, caller.username, waitingIdeasPayload(released), caller.actor);
    }
    return {
      ok: true as const,
      proposal: fresh,
      ...(warnings.length ? { warnings } : {}),
      ...(failed.length ? { pending: failed } : {}),
    };
  }

  function get(id: string): ProposalRecord | null {
    const raw = hydrate(loadProposal(dbFor(site), id));
    return raw
      ? withAttachedCreate(withSiblings(enrichRecentActivity(raw)))
      : null;
  }

  /** Unenriched load for internal mutate paths (avoid nested activity reads mid-apply). */
  function getRaw(id: string): ProposalRecord | null {
    return hydrate(loadProposal(dbFor(site), id));
  }

  function stats(): ProposalStats {
    const db = dbFor(site);
    const by_status = { ...EMPTY_STATUS_COUNTS };
    const by_kind = { ...EMPTY_KIND_COUNTS };
    const by_attention = emptyAttentionCounts();
    let needs_review_edits = 0;
    const statusRows = db
      .prepare(`SELECT status, COUNT(*) AS n FROM content_proposals WHERE site = ? GROUP BY status`)
      .all(site) as Array<{ status: ProposalStatus; n: number }>;
    for (const row of statusRows) {
      if (row.status in by_status) by_status[row.status] = Number(row.n) || 0;
    }
    const kindRows = db
      .prepare(`SELECT kind, COUNT(*) AS n FROM content_proposals WHERE site = ? GROUP BY kind`)
      .all(site) as Array<{ kind: ProposalKind; n: number }>;
    for (const row of kindRows) {
      if (row.kind in by_kind) by_kind[row.kind] = Number(row.n) || 0;
    }
    const totalRow = db
      .prepare(`SELECT COUNT(*) AS n FROM content_proposals WHERE site = ?`)
      .get(site) as { n: number };
    const escalatedRow = db
      .prepare(
        `SELECT COUNT(*) AS n FROM content_proposals WHERE site = ? AND escalated = 1`,
      )
      .get(site) as { n: number };

    try {
      const attentionRows = db
        .prepare(
          `SELECT p.id, p.kind, p.status, p.escalated, p.author_content_at, p.reviewer_action_at, p.stale_since,
                  (SELECT q.status FROM content_proposals q WHERE q.id = p.applies_after_proposal_id) AS pred_status,
                  (SELECT COUNT(*) FROM content_proposal_blockers b
                   WHERE b.proposal_id = p.id AND b.status = 'open') AS open_n,
                  (SELECT COUNT(*) FROM content_proposal_blockers b
                   WHERE b.proposal_id = p.id AND b.status = 'resolved') AS resolved_n
           FROM content_proposals p
           WHERE p.site = ? AND p.status IN ('open', 'partial')`,
        )
        .all(site) as Array<{
        id: string;
        kind: ProposalKind;
        status: ProposalStatus;
        escalated: number;
        author_content_at: number | null;
        reviewer_action_at: number | null;
        stale_since: string | null;
        pred_status: string | null;
        open_n: number;
        resolved_n: number;
      }>;
      for (const row of attentionRows) {
        const bucket = deriveProposalAttention({
          status: row.status,
          escalated: Boolean(row.escalated),
          open_blocker_count: Number(row.open_n) || 0,
          resolved_blocker_count: Number(row.resolved_n) || 0,
          author_content_at: row.author_content_at,
          reviewer_action_at: row.reviewer_action_at,
          needs_author: row.stale_since != null,
          predecessor_applied: row.pred_status === "finished",
        });
        if (bucket) by_attention[bucket] += 1;
        if (
          row.kind === "edits" &&
          (bucket === "awaiting_rereview" || bucket === "no_feedback" || bucket === "predecessor_applied")
        ) {
          needs_review_edits += 1;
        }
      }
    } catch {
      // Blockers table missing in older DBs — leave by_attention zeros.
    }

    const outcomeRow = db
      .prepare(
        `SELECT
           SUM(CASE WHEN outcome_review = 'good' THEN 1 ELSE 0 END) AS good,
           SUM(CASE WHEN outcome_review = 'bad' THEN 1 ELSE 0 END) AS bad,
           SUM(CASE WHEN outcome_review = 'bad' AND outcome_lesson_captured_at IS NULL THEN 1 ELSE 0 END) AS bad_open,
           SUM(CASE WHEN outcome_review IS NULL AND ${reviewableClosedSql()} THEN 1 ELSE 0 END) AS none
         FROM content_proposals WHERE site = ?`,
      )
      .get(site) as Partial<Record<keyof ProposalOutcomeCounts, number | null>> | undefined;

    return {
      total: Number(totalRow?.n) || 0,
      by_status,
      by_kind,
      escalated_count: Number(escalatedRow?.n) || 0,
      by_attention,
      by_kind_status: liveByKindStatus(db, site),
      stalled_ideas: countStalledIdeas(db, site),
      needs_review_edits,
      by_outcome: {
        good: Number(outcomeRow?.good) || 0,
        bad: Number(outcomeRow?.bad) || 0,
        bad_open: Number(outcomeRow?.bad_open) || 0,
        none: Number(outcomeRow?.none) || 0,
      },
    };
  }

  function kpiHistory(opts?: {
    kind?: KpiCardKind | null;
    granularity?: KpiGranularity;
    from?: string;
    to?: string;
    fresh?: boolean;
  }): KpiHistoryResult {
    return getKpiHistory(dbFor(site), site, opts);
  }

  /** Distinct proposers with a proposal touched in the last `days` (by updated_at). */
  function listRecentProposers(opts?: { days?: number; limit?: number }): string[] {
    const days = Math.min(Math.max(opts?.days ?? 30, 1), 365);
    const limit = Math.min(Math.max(opts?.limit ?? 200, 1), 500);
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const db = dbFor(site);
    const rows = db
      .prepare(
        `SELECT proposer_username AS username
         FROM content_proposals
         WHERE site = ?
           AND proposer_username IS NOT NULL
           AND TRIM(proposer_username) != ''
           AND updated_at >= ?
         GROUP BY LOWER(proposer_username)
         ORDER BY MAX(updated_at) DESC, LOWER(proposer_username) ASC
         LIMIT ?`,
      )
      .all(site, since, limit) as Array<{ username: string }>;
    return rows.map((r) => r.username).filter((u) => Boolean(u?.trim()));
  }

  /** Distinct latest-feedback reviewers and finished/rejected closers active in the last `days`. */
  function listRecentReviewers(opts?: { days?: number; limit?: number }): string[] {
    const days = Math.min(Math.max(opts?.days ?? 30, 1), 365);
    const limit = Math.min(Math.max(opts?.limit ?? 200, 1), 500);
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const db = dbFor(site);
    const rows = db
      .prepare(
        `SELECT username FROM (
           SELECT reviewer_action_by AS username, reviewer_action_at AS at
           FROM content_proposals
           WHERE site = ? AND reviewer_action_by IS NOT NULL AND TRIM(reviewer_action_by) != ''
             AND reviewer_action_at >= ?
           UNION ALL
           SELECT closed_by AS username, closed_at AS at
           FROM content_proposals
           WHERE site = ? AND status IN ('finished', 'rejected')
             AND closed_by IS NOT NULL AND TRIM(closed_by) != ''
             AND closed_at >= ?
         )
         GROUP BY LOWER(username)
         ORDER BY MAX(at) DESC, LOWER(username) ASC
         LIMIT ?`,
      )
      .all(site, since, site, since, limit) as Array<{ username: string }>;
    return rows.map((r) => r.username).filter((u) => Boolean(u?.trim()));
  }

  function exportAll(): ProposalRecord[] {
    return exportAllProposals(site);
  }

  function list(opts: {
    status?: ProposalStatus;
    kind?: ProposalKind;
    issue_id?: string;
    query?: string;
    proposal_id?: string;
    proposer_username?: string;
    proposer_actor_type?: ProposerActorType;
    proposer_actor_role?: string;
    agent_session_id?: string;
    /** Latest non-author feedback, or the finished/rejected closer (exact, case-insensitive). */
    reviewer_username?: string;
    escalated?: boolean;
    attention?: ProposalAttention;
    /** Steward outcome review on closed proposals. */
    outcome_review?: OutcomeReviewFilter;
    /** Accepted ideas with no successful implements follow-up. */
    stalled?: boolean;
    /** Open|partial edits that still need a reviewer (re-check or no feedback). */
    needs_review?: boolean;
    limit?: number;
    offset?: number;
    sort?: ProposalSortField;
    sortDir?: ProposalSortDir;
    attention_perspective?: AttentionPerspective;
    /** Username for within-bucket foreign-claim demotion (attention sort). */
    caller_username?: string;
  }): {
    proposals: ProposalRecord[];
    total: number;
    status_bias_applied: boolean;
    attention_perspective: AttentionPerspective | null;
  } {
    if (opts.proposal_id) {
      const one = get(opts.proposal_id);
      return {
        proposals: one ? [one] : [],
        total: one ? 1 : 0,
        status_bias_applied: false,
        attention_perspective: null,
      };
    }
    const db = dbFor(site);
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(0, opts.offset ?? 0);
    const sort: ProposalSortField = opts.sort ?? "updated_at";
    const sortDir: ProposalSortDir = opts.sortDir ?? "desc";
    const perspective: AttentionPerspective = opts.attention_perspective ?? "reviewer";
    const needsReview = opts.needs_review === true;
    const stalled = opts.stalled === true && !needsReview;
    const sortForRank: ProposalSortField = needsReview ? "attention" : sort;
    const useAttentionPath = sortForRank === "attention" || opts.attention != null || needsReview;
    const statusBiasApplied =
      needsReview ||
      (useAttentionPath && opts.status == null && !stalled && opts.outcome_review == null);
    const tableAlias = stalled ? "p" : "";
    const fromSql = tableAlias ? `content_proposals ${tableAlias}` : `content_proposals`;
    const col = (name: string) => (tableAlias ? `${tableAlias}.${name}` : name);

    let where = `WHERE ${col("site")} = ?`;
    const params: unknown[] = [site];
    if (stalled) {
      where += ` AND ${stalledIdeaSqlPredicate(tableAlias || "p")}`;
    }
    if (needsReview) {
      where += ` AND ${col("kind")} = 'edits' AND ${col("status")} IN ('open', 'partial')`;
    } else {
      if (opts.status) {
        where += ` AND ${col("status")} = ?`;
        params.push(opts.status);
      } else if (statusBiasApplied) {
        where += ` AND ${col("status")} IN ('open', 'partial')`;
      }
      if (opts.kind) {
        where += ` AND ${col("kind")} = ?`;
        params.push(opts.kind);
      }
    }
    if (opts.issue_id) {
      where += ` AND ${col("related_issue_ids_json")} LIKE ?`;
      params.push(`%${opts.issue_id}%`);
    }
    for (const term of proposalQueryTerms(opts.query)) {
      const needle = `%${escapeLikeTerm(term)}%`;
      where += ` AND (${col("search_text")} LIKE ? ESCAPE '\\' OR LOWER(${col("id")}) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(${col("proposer_username")}, '')) LIKE ? ESCAPE '\\')`;
      params.push(needle, needle, needle);
    }
    const proposerUsername = opts.proposer_username?.trim();
    if (proposerUsername) {
      where += ` AND LOWER(${col("proposer_username")}) = LOWER(?)`;
      params.push(proposerUsername);
    }
    if (opts.proposer_actor_type) {
      where += ` AND json_extract(${col("proposer_actor_json")}, '$.type') = ?`;
      params.push(opts.proposer_actor_type);
    }
    const proposerActorRole = opts.proposer_actor_role?.trim();
    if (proposerActorRole) {
      where += ` AND json_extract(${col("proposer_actor_json")}, '$.role') = ?`;
      params.push(proposerActorRole);
    }
    const agentSessionId = opts.agent_session_id?.trim();
    if (agentSessionId) {
      where += ` AND ${col("created_agent_session_id")} = ?`;
      params.push(agentSessionId);
    }
    const reviewerUsername = opts.reviewer_username?.trim();
    if (reviewerUsername) {
      where += ` AND (LOWER(${col("reviewer_action_by")}) = LOWER(?)
        OR (${col("status")} IN ('finished', 'rejected') AND LOWER(${col("closed_by")}) = LOWER(?)))`;
      params.push(reviewerUsername, reviewerUsername);
    }
    if (opts.escalated === true) {
      where += ` AND ${col("escalated")} = 1`;
    } else if (opts.escalated === false) {
      where += ` AND ${col("escalated")} = 0`;
    }
    if (opts.outcome_review === "good" || opts.outcome_review === "bad") {
      where += ` AND ${col("outcome_review")} = ?`;
      params.push(opts.outcome_review);
    } else if (opts.outcome_review === "bad_open") {
      where += ` AND ${col("outcome_review")} = 'bad' AND ${col("outcome_lesson_captured_at")} IS NULL`;
    } else if (opts.outcome_review === "none") {
      where += ` AND ${reviewableClosedSql(col)} AND ${col("outcome_review")} IS NULL`;
    } else if (opts.outcome_review === "any") {
      where += ` AND (${col("outcome_review")} IS NOT NULL OR (${reviewableClosedSql(col)}))`;
    }
    const sortSql = (field: Exclude<ProposalSortField, "attention">) =>
      field === "outcome_recent"
        ? `COALESCE(${col("outcome_review_at")}, ${col("closed_at")}, ${col("updated_at")})`
        : col(field);

    const mapRow = (r: ProposalRow) =>
      withChainInfo(db, mapProposal(r, loadEntries(db, r.id), loadBlockers(db, r.id)));

    const withAttentionMeta = (p: ProposalRecord) => {
      const resolved = resolvedBlockerCount(p.blockers);
      const attention = attentionForRecord(p);
      return { proposal: p, attention, resolved };
    };

    if (useAttentionPath || opts.issue_id) {
      const orderSql =
        sortForRank === "attention"
          ? `ORDER BY ${col("updated_at")} DESC, ${col("id")} ASC`
          : `ORDER BY ${sortSql(sort === "attention" ? "updated_at" : sort)} ${sortDir.toUpperCase()}, ${col("id")} ASC`;
      const rows = db
        .prepare(`SELECT ${tableAlias ? `${tableAlias}.*` : "*"} FROM ${fromSql} ${where} ${orderSql}`)
        .all(...params) as ProposalRow[];
      let records = rows.map(mapRow);
      if (opts.issue_id) {
        records = records.filter((p) => p.related_issue_ids.includes(opts.issue_id!));
      }

      let decorated = records.map(withAttentionMeta);
      if (needsReview) {
        decorated = decorated.filter(
          (d) =>
            d.attention === "awaiting_rereview" ||
            d.attention === "no_feedback" ||
            d.attention === "predecessor_applied",
        );
      }
      if (opts.attention) {
        decorated = decorated.filter((d) => d.attention === opts.attention);
      }

      if (sortForRank === "attention") {
        decorated = [...decorated].sort((a, b) =>
          compareByAttention(
            {
              id: a.proposal.id,
              updated_at: a.proposal.updated_at,
              attention: a.attention,
              claim: a.proposal.claim,
            },
            {
              id: b.proposal.id,
              updated_at: b.proposal.updated_at,
              attention: b.attention,
              claim: b.proposal.claim,
            },
            perspective,
            opts.caller_username,
          ),
        );
      } else if (opts.issue_id) {
        decorated = [...decorated].sort((a, b) =>
          compareProposalsBySort(a.proposal, b.proposal, sort, sortDir),
        );
      }

      const total = decorated.length;
      return {
        proposals: decorated
          .slice(offset, offset + limit)
          .map((d) => withAttachedCreate(withSiblings(enrichRecentActivity(d.proposal)))),
        total,
        status_bias_applied: statusBiasApplied,
        attention_perspective: sortForRank === "attention" ? perspective : null,
      };
    }

    const orderSql = `ORDER BY ${sortSql(sort === "attention" ? "updated_at" : sort)} ${sortDir.toUpperCase()}, ${col("id")} ASC`;
    const totalRow = db
      .prepare(`SELECT COUNT(*) AS n FROM ${fromSql} ${where}`)
      .get(...params) as { n: number };
    const total = Number(totalRow?.n) || 0;
    const rows = db
      .prepare(
        `SELECT ${tableAlias ? `${tableAlias}.*` : "*"} FROM ${fromSql} ${where} ${orderSql} LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as ProposalRow[];
    const proposals = rows.map((r) =>
      withAttachedCreate(withSiblings(enrichRecentActivity(mapRow(r)))),
    );
    return {
      proposals,
      total,
      status_bias_applied: false,
      attention_perspective: null,
    };
  }

  async function create(
    input: CreateProposalInput,
    proposer: { username: string; actor?: EventActor | Record<string, unknown> },
  ): Promise<
    | {
        ok: true;
        proposal: ProposalRecord;
        duplicate?: boolean;
        similar?: SimilarProposal[];
        warnings?: Array<{ code: string; message: string }>;
      }
    | {
        ok: false;
        code: string;
        error: string;
        similar?: SimilarProposal[];
        duplicate_of?: string;
        existing_proposal?: ProposalRecord;
        activity?: Array<{
          entryKey: string;
          writeCount: number;
          windowDays: number;
        }>;
        details?: unknown;
      }
  > {
    const summary = (input.summary || "").trim();
    if (summary.length < MIN_SUMMARY) {
      return { ok: false, code: "summary_too_short", error: `summary required (min ${MIN_SUMMARY} characters)` };
    }
    const title = (input.title || "").trim();
    if (!title) return { ok: false, code: "title_required", error: "title is required" };

    const related = [...new Set((input.related_issue_ids ?? []).map((id) => id.trim()).filter(Boolean))];
    for (const id of related) {
      if (!deps.issueExists(id)) {
        return { ok: false, code: "unknown_issue_id", error: `Unknown issue id: ${id}` };
      }
    }

    const promote_on_apply = Boolean(input.promote_on_apply);
    const entriesIn = (input.entries ?? []).map((e) => ({
      ...e,
      updates: e.updates ?? [],
    }));
    const createsEntryKeys = new Set<string>();
    let implementsIdeaForDrafts: ProposalRecord | null = null;
    let kind: ProposalKind;
    if (entriesIn.length > 0 || promote_on_apply) {
      kind = "edits";
    } else if (input.kind === "idea") {
      kind = "idea";
    } else {
      kind = "notes";
    }
    let filedReviewSituations: ReviewSituationId[] = [];

    if (kind === "notes" && (input.review_situations?.length ?? 0) > 0) {
      return {
        ok: false,
        code: "review_situations_edits_only",
        error: "review_situations is only valid on edits or idea proposals (not notes).",
      };
    }

    if (kind === "idea" && (input.review_situations?.length ?? 0) > 0) {
      const ideaSit = parseIdeaAuthorSituationIds(input.review_situations);
      if (!ideaSit.ok) {
        return {
          ok: false,
          code: ideaSit.code ?? "invalid_review_situations",
          error: ideaSit.error,
        };
      }
      filedReviewSituations = ideaSit.ids;
    }

    if (input.kind === "idea" && (entriesIn.length > 0 || promote_on_apply)) {
      return {
        ok: false,
        code: "invalid_kind",
        error: "kind idea cannot include entries or promote_on_apply — use an edits proposal",
      };
    }

    const relatedEntries = normalizeRelatedEntries(input.related_entries);

    if (kind === "idea" && deps.knownContentTypes) {
      const known = deps.knownContentTypes();
      const unknown = unknownContentTypes(relatedEntries, known);
      if (unknown.length) return unknownContentTypeError(unknown, known);
    }

    if (kind === "notes" && related.length > 0) {
      const blocking = findOpenNotesBlockingRetry(dbFor(site), site, related);
      if (blocking) {
        return {
          ok: false,
          code: "notes_no_auto_retry",
          error: `An open notes proposal already covers linked issue(s) with no auto-retry (${blocking.id}). Claim that proposal or clear no_auto_retry before opening another notes handoff.`,
          existing_proposal: blocking,
        };
      }
    }

    if (promote_on_apply) {
      if (entriesIn.length !== 1) {
        return {
          ok: false,
          code: "promote_entry_required",
          error: "promote_on_apply requires exactly one entry with contentType, slug, locale, and variant",
        };
      }
      const e = entriesIn[0]!;
      if (!e.contentType || !e.slug || !e.locale || !e.variant?.trim()) {
        return {
          ok: false,
          code: "promote_variant_required",
          error: "promote_on_apply requires contentType, slug, locale, and variant on the entry",
        };
      }
    }

    if (kind === "edits") {
      for (const e of entriesIn) {
        if (!e.contentType || !e.slug || !e.locale) {
          return { ok: false, code: "entry_required", error: "Each entry needs contentType, slug, and locale" };
        }
        if (!promote_on_apply && !e.updates?.length) {
          return { ok: false, code: "updates_required", error: `Entry ${e.contentType}/${e.slug} has no field updates` };
        }
      }

      const situationsParse = parseReviewSituationIds(input.review_situations ?? []);
      if (!situationsParse.ok) {
        return {
          ok: false,
          code: "invalid_review_situations",
          error: situationsParse.error,
        };
      }
      filedReviewSituations = situationsParse.ids;

      const dbEarly = dbFor(site);
      const implementsResolved = resolveImplementsForEdits(dbEarly, input.implements_proposal_id, entriesIn);
      if (!implementsResolved.ok) return implementsResolved;
      const implementsIdea = implementsResolved.idea;
      implementsIdeaForDrafts = implementsIdea;

      // Existence + mixed risk
      const classTargets: Array<{
        contentType: string;
        category?: ProposalCategory;
        existence: ExistenceState;
        draftExists?: boolean;
        createsEntry?: boolean;
        outcomeFigures?: boolean;
      }> = [];
      for (const e of entriesIn) {
        const hasVariant = Boolean(e.variant?.trim());
        const ex = resolveExistence({
          contentType: e.contentType,
          slug: e.slug,
          locale: e.locale,
          variant: e.variant,
        });
        const liveOk = ex.live === "exists";
        const draftOk = hasVariant && ex.draftExists;
        const liveMissing = !liveOk && ex.live !== "unknown";
        if (store) {
          // v1.0: a missing draft is created on this page; only a brand-new page needs an accepted idea.
          if (
            liveMissing &&
            !draftOk &&
            !store.entryExists(e.contentType, e.slug)
          ) {
            const gate = gateMissingAttachedEntry({
              entry: e,
              promoteOnApply: false,
              hasVariant: false,
              implementsIdea,
              db: dbEarly,
            });
            if (!gate.ok) return gate;
            if (gate.createsEntry) {
              createsEntryKeys.add(
                attachedCreateKey(e.contentType, e.slug, e.locale),
              );
            }
          } else if (liveMissing) {
            const gate = gateNewLocaleSections({
              entry: e,
              keptDraft: draftOk
                ? { contentType: e.contentType, slug: e.slug, locale: e.locale, variant: e.variant!.trim() }
                : null,
            });
            if (!gate.ok) return gate;
          }
        } else if (liveMissing && !draftOk) {
          const gate = gateMissingAttachedEntry({
            entry: e,
            promoteOnApply: promote_on_apply,
            hasVariant,
            implementsIdea,
            db: dbEarly,
          });
          if (!gate.ok) return gate;
          if (gate.createsEntry) {
            createsEntryKeys.add(attachedCreateKey(e.contentType, e.slug, e.locale));
          }
        } else if (!hasVariant && !liveOk) {
          return {
            ok: false,
            code: "entry_not_found",
            error: `Page ${e.contentType}/${e.slug} (${e.locale}) does not exist yet. File an idea brief, or create the draft first, then propose edits on that target.`,
          };
        } else if (hasVariant && !ex.draftExists) {
          return {
            ok: false,
            code: "entry_not_found",
            error: `Draft variant '${e.variant}' for ${e.contentType}/${e.slug} (${e.locale}) was not found. Create the draft first, or use kind idea for a new-page brief.`,
          };
        }
        const createsEntry = createsEntryKeys.has(attachedCreateKey(e.contentType, e.slug, e.locale));
        const updateText = (e.updates ?? [])
          .map((u) => textFromUnknown(u.value))
          .filter(Boolean)
          .join("\n");
        const outcomeFigures =
          (input.review_situations ?? []).includes("selling_figures") ||
          evaluateClaimCues(updateText) === "clear_yes" ||
          figureTokensIn(updateText);
        classTargets.push({
          contentType: e.contentType,
          category:
            input.category ??
            ((e.updates ?? []).some(
              (u) => u.field_path.startsWith("meta.") || u.field_path.startsWith("seo."),
            )
              ? "content.seo"
              : "content.field"),
          existence: ex.live === "unknown" ? "unknown" : liveOk ? "exists" : "missing",
          draftExists: draftOk,
          createsEntry,
          outcomeFigures,
        });
      }
      const classes = collectDamageClassesForMixedCheck(classTargets);
      if (isMixedRiskBundle(classes)) {
        return {
          ok: false,
          code: "mixed_risk_bundle",
          error:
            "This proposal mixes different risk levels (for example outcome figures and a blog metadata fix). Split into separate proposals — one risk class each.",
        };
      }
      const sectionsCheck = checkSectionUpdates(entriesIn);
      if (!sectionsCheck.ok) return sectionsCheck;
    }

    if (kind === "idea") {
      const mixed = ideaRelatedMixedRisk(relatedEntries);
      if (mixed) return mixed;
    }

    const db = dbFor(site);

    for (const e of entriesIn) {
      if (!e.variant?.trim()) continue;
      const existingVariant = findOpenProposalForVariant(
        db,
        site,
        e.contentType,
        e.slug,
        e.locale,
        e.variant.trim(),
      );
      if (existingVariant) {
        return {
          ok: false,
          code: "proposal_exists",
          error: `An open proposal already references variant '${e.variant}' for ${e.contentType}/${e.slug} (${e.locale}). Join that proposal instead of creating another.`,
          duplicate_of: existingVariant.id,
          existing_proposal: existingVariant,
        };
      }
    }

    const category: ProposalCategory =
      input.category ??
      (kind === "edits" ? inferCategory(entriesIn) : "content.field");
    const fingerprint =
      kind === "idea"
        ? fingerprintIdeas({
            site,
            title,
            summary,
            relatedIssueIds: related,
            relatedEntries,
          })
        : kind === "notes"
          ? fingerprintNotes({ site, category, relatedIssueIds: related, summary })
          : fingerprintEdits({
              site,
              category,
              entries: entriesIn.map((e) => ({
                contentType: e.contentType,
                slug: e.slug,
                locale: e.locale,
                variant: e.variant,
                updates: e.updates ?? [],
              })),
            });

    const existing = db
      .prepare(
        `SELECT id FROM content_proposals WHERE site = ? AND fingerprint = ? AND status IN ('open','partial') LIMIT 1`,
      )
      .get(site, fingerprint) as { id: string } | undefined;
    if (existing) {
      const dup = get(existing.id)!;
      return { ok: true, proposal: dup, duplicate: true };
    }

    if (kind === "edits") {
      for (const e of entriesIn) {
        const competing = findOpenEditsForEntry(db, site, e.contentType, e.slug, e.locale);
        if (competing) {
          return {
            ok: false,
            code: "competing_entry_edits",
            error: `An open edits proposal already targets ${e.contentType}/${e.slug} (${e.locale}). Join ${competing.id} instead of creating another.`,
            duplicate_of: competing.id,
            existing_proposal: competing,
          };
        }
      }
    }

    const implementsIdForInsert =
      kind === "edits" ? input.implements_proposal_id?.trim() || null : null;

    const searchBlob = [
      title,
      summary,
      input.rationale ?? "",
      ...(input.tags ?? []),
      ...related,
      ...entriesIn.map(
        (e) =>
          `${e.contentType}/${e.slug} ${e.variant ?? ""} ${(e.updates ?? []).map((u) => u.field_path).join(" ")}`,
      ),
      promote_on_apply ? "promote_on_apply" : "",
    ]
      .join(" ")
      .toLowerCase();

    if (!input.confirm_distinct && deps.findSimilar) {
      try {
        const similar = (await deps.findSimilar(searchBlob)).filter((s) => s.score >= RAG_SIMILARITY_THRESHOLD);
        if (similar.length) {
          return {
            ok: false,
            code: "similar_proposals",
            error: "Similar open proposals exist. Pass confirm_distinct: true to create anyway.",
            similar,
          };
        }
      } catch (err) {
        log.warn({ err }, "proposal RAG similar search failed");
      }
    }

    if (kind === "edits" && entriesIn.length > 0) {
      const activityResult = runResolveActivity({
        entries: entriesIn.map((e) => ({
          contentType: e.contentType,
          slug: e.slug,
          locale: e.locale,
          variant: e.variant,
        })),
        excludeAgentSessionId: input.agent_session_id,
      });
      if (!activityResult.ok) {
        return {
          ok: false,
          code: "activity_unavailable",
          error:
            activityResult.error ||
            "Could not load recent entry activity. Retry when activity history is available.",
        };
      }
      if (activityResult.gateWriteCount > 0 && !input.confirm_recent_activity) {
        return {
          ok: false,
          code: "confirm_recent_activity",
          error:
            "This entry has recent writes. Inspect get_entry_activity first. " +
            "If recent writes already delivered a similar same-field SERP/meta fix and live is not broken: " +
            "reject duplicate_weaker (title/description-only) or revise_entries to drop those SERP ops then apply (mixed) — do not confirm. " +
            "Pass confirm_recent_activity: true only if this proposal is still needed and distinct from those writes.",
          activity: activityResult.activity,
        };
      }
    }

    const captured: Array<{
      input: ProposalEntryInput & { updates: FieldUpdate[] };
      baseline: { values: Record<string, unknown>; note?: string; creates_entry?: boolean };
      variant_fingerprint: string | null;
    }> = [];
    for (const e of store ? [] : entriesIn) {
      const updates = e.updates ?? [];
      const createsEntry = createsEntryKeys.has(attachedCreateKey(e.contentType, e.slug, e.locale));
      let baseline: { values: Record<string, unknown>; note?: string; creates_entry?: boolean } = {
        values: {},
        note: input.situation_note,
        ...(createsEntry ? { creates_entry: true } : {}),
      };
      if (updates.length && !createsEntry) {
        const capturedBaseline = deps.captureBaseline({ ...e, updates });
        if (capturedBaseline.error) {
          return { ok: false, code: "baseline_failed", error: capturedBaseline.error };
        }
        baseline = { values: capturedBaseline.values, note: input.situation_note };
      }
      let variant_fingerprint: string | null = null;
      if (e.variant?.trim() && deps.readVariantFingerprint) {
        const fp = deps.readVariantFingerprint({
          contentType: e.contentType,
          slug: e.slug,
          locale: e.locale,
          variant: e.variant.trim(),
        });
        if (fp.error) return { ok: false, code: "baseline_failed", error: fp.error };
        variant_fingerprint = fp.fingerprint;
      }
      captured.push({
        input: { ...e, updates },
        baseline,
        variant_fingerprint,
      });
    }

    if (promote_on_apply && captured.length === 0 && !store) {
      return {
        ok: false,
        code: "promote_entry_required",
        error: "promote_on_apply requires an entry",
      };
    }

    let supersedesId: string | null = null;
    const supersedesRaw = input.supersedes_proposal_id?.trim();
    if (supersedesRaw) {
      const pred = loadProposal(db, supersedesRaw);
      if (!pred || pred.site !== site) {
        return {
          ok: false,
          code: "supersedes_not_found",
          error: `Predecessor proposal ${supersedesRaw} was not found on this site.`,
        };
      }
      if (pred.status !== "rejected" && pred.status !== "withdrawn") {
        return {
          ok: false,
          code: "supersedes_not_closed",
          error: `Predecessor must be rejected or withdrawn (currently ${pred.status}).`,
        };
      }
      if (pred.replaced_by_proposal_id) {
        return {
          ok: false,
          code: "supersedes_already_replaced",
          error: `Predecessor already has a replacement (${pred.replaced_by_proposal_id}).`,
          existing_proposal: pred,
        };
      }
      supersedesId = pred.id;
    }

    let appliesAfterId: string | null = null;
    if (input.applies_after_proposal_id != null && String(input.applies_after_proposal_id).trim()) {
      if (kind !== "edits") {
        return {
          ok: false,
          code: "applies_after_edits_only",
          error: "applies_after_proposal_id is only valid on edits proposals (ideas and notes are never applied).",
        };
      }
      const chain = checkAppliesAfter(db, input.applies_after_proposal_id, null);
      if (!chain.ok) return { ok: false, code: chain.code, error: chain.error };
      appliesAfterId = chain.id;
    }

    let ideaFunnelJson: string | null = null;
    if (kind === "idea" && input.idea_funnel != null) {
      const funnelCheck = validateIdeaFunnel(input.idea_funnel);
      if (!funnelCheck.ok) {
        return { ok: false, code: funnelCheck.code, error: funnelCheck.error };
      }
      ideaFunnelJson = JSON.stringify(funnelCheck.funnel);
    } else if (kind !== "idea" && input.idea_funnel != null) {
      return {
        ok: false,
        code: "idea_funnel_ideas_only",
        error: "idea_funnel is only valid on kind idea proposals.",
      };
    }

    let ideaSeoTargetJson: string | null = null;
    if (kind === "idea" && input.idea_seo_target != null) {
      const label = ideaDemandLabel(filedReviewSituations);
      const seoCheck = validateIdeaSeoTarget(input.idea_seo_target, {
        demandLabel: label,
        enforceDemand: true,
      });
      if (!seoCheck.ok) return { ok: false, code: seoCheck.code, error: seoCheck.error };
      ideaSeoTargetJson = JSON.stringify(seoCheck.target);
    } else if (kind !== "idea" && input.idea_seo_target != null) {
      return {
        ok: false,
        code: "idea_seo_target_ideas_only",
        error: "idea_seo_target is only valid on kind idea proposals.",
      };
    }

    let seoOverrideJson: string | null = null;
    if (kind === "edits") {
      const ovCheck = checkSeoTargetOverride(implementsIdeaForDrafts, entriesIn, input.seo_target_override);
      if (!ovCheck.ok) return ovCheck;
      if (ovCheck.override) seoOverrideJson = JSON.stringify(ovCheck.override);
      const optOut = gateAgentSeoOptOut(
        proposer.actor,
        implementsIdeaForDrafts,
        entriesIn,
        ovCheck.override?.reason,
      );
      if (!optOut.ok) return optOut;
    } else if (input.seo_target_override != null) {
      return {
        ok: false,
        code: "seo_target_override_edits_only",
        error: "seo_target_override is only valid on edits proposals that implement an accepted idea.",
      };
    }

    let urlSlugOverrideJson: string | null = null;
    if (kind === "edits") {
      const slugCheck = checkEditsUrlSlug(implementsIdeaForDrafts, entriesIn, input.url_slug_override);
      if (!slugCheck.ok) return slugCheck;
      if (slugCheck.override) urlSlugOverrideJson = JSON.stringify(slugCheck.override);
    } else if (input.url_slug_override != null) {
      return {
        ok: false,
        code: "url_slug_override_edits_only",
        error: "url_slug_override is only valid on edits proposals that implement an accepted idea.",
      };
    }

    const now = Date.now();
    const id = randomUUID();
    const sessionId = input.agent_session_id?.trim() || null;
    const noAutoRetry = kind === "notes" ? 1 : 0;

    // v1.0: every edits entry is a draft; updates are written into it now, apply only promotes.
    let draftPlans: V1Plan[] = [];
    const draftWarnings: Array<{ code: string; message: string; details?: Record<string, unknown> }> = [];
    if (store && kind === "edits") {
      const prepared = await prepareV1Drafts({
        proposalId: id,
        entries: entriesIn,
        author: proposer.username,
        newEntryKeys: createsEntryKeys,
        ideaFunnel: implementsIdeaForDrafts?.idea_funnel ?? null,
        idea: implementsIdeaForDrafts,
      });
      if (!prepared.ok) return prepared;
      draftPlans = prepared.plans;
      draftWarnings.push(...prepared.warnings, ...templateLocalesWarnings(entriesIn));
    }

    db.prepare(
      `INSERT INTO content_proposals (
        id, site, fingerprint, status, kind, category, title, summary, rationale,
        documentation_json, related_issue_ids_json, proposer_username, proposer_actor_json,
        created_at, updated_at, claim_json, tags_json, search_text,
        created_agent_session_id, promote_on_apply, no_auto_retry, related_entries_json,
        review_context_snapshot_json, supersedes_proposal_id, replaced_by_proposal_id,
        review_situations_json, implements_proposal_id, idea_funnel_json,
        system_version, all_or_nothing, reverts_proposal_id,
        idea_seo_target_json, seo_target_override_json, applies_after_proposal_id,
        url_slug_override_json
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      site,
      fingerprint,
      "open",
      kind,
      category,
      title,
      summary,
      input.rationale?.trim() || null,
      JSON.stringify(input.documentation ?? {}),
      JSON.stringify(related),
      proposer.username,
      JSON.stringify(proposer.actor ?? {}),
      now,
      now,
      null,
      JSON.stringify(input.tags ?? []),
      searchBlob,
      sessionId,
      promote_on_apply ? 1 : 0,
      noAutoRetry,
      JSON.stringify(relatedEntries),
      null,
      supersedesId,
      null,
      JSON.stringify(filedReviewSituations),
      implementsIdForInsert,
      ideaFunnelJson,
      store ? PROPOSAL_SYSTEM_VERSION : null,
      kind === "edits" && input.all_or_nothing ? 1 : 0,
      input.reverts_proposal_id?.trim() || null,
      ideaSeoTargetJson,
      seoOverrideJson,
      appliesAfterId,
      urlSlugOverrideJson,
    );

    if (supersedesId) {
      db.prepare(
        `UPDATE content_proposals SET replaced_by_proposal_id = ?, updated_at = ? WHERE id = ?`,
      ).run(id, now, supersedesId);
    }

    for (const cap of captured) {
      db.prepare(
        `INSERT INTO content_proposal_entries (
          proposal_id, entry_key, locale, variant, status, ops_json, baseline_context_json, variant_fingerprint
        ) VALUES (?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        makeEntryKey(cap.input.contentType, cap.input.slug),
        cap.input.locale,
        cap.input.variant || null,
        "pending",
        JSON.stringify(cap.input.updates),
        JSON.stringify(cap.baseline),
        cap.variant_fingerprint,
      );
    }
    for (const plan of draftPlans) {
      db.prepare(
        `INSERT INTO content_proposal_entries (
          proposal_id, entry_key, locale, variant, status, ops_json, baseline_context_json, variant_fingerprint, created_draft
        ) VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        makeEntryKey(plan.ref.contentType, plan.ref.slug),
        plan.ref.locale,
        plan.ref.variant,
        "pending",
        JSON.stringify(plan.input.updates),
        JSON.stringify({
          values: {},
          ...(input.situation_note ? { note: input.situation_note } : {}),
          ...layoutOwnerAtFiling(plan.ref),
        }),
        plan.fingerprint,
        plan.created ? 1 : 0,
      );
      store!.link(
        plan.ref,
        linkFor(id, plan.created, plan.fingerprint),
        proposer.username,
      );
    }

    const proposal = get(id)!;
    const reviewCtx = await classifyLive(proposal, { refreshSnapshot: true });
    const withSnap = get(id)!;
    const proposerEventActor =
      proposer.actor && typeof proposer.actor === "object" && "type" in proposer.actor
        ? (proposer.actor as EventActor)
        : undefined;
    emitProposalEvent(site, "proposal_created", id, proposer.username, {
      ...(supersedesId ? { supersedes_proposal_id: supersedesId } : {}),
      ...(appliesAfterId ? { applies_after_proposal_id: appliesAfterId } : {}),
    }, proposerEventActor);
    if (withSnap.kind === "edits") {
      const reminder = hubLinkReminder(db, withSnap, implementsIdeaForDrafts ?? null);
      if (reminder) draftWarnings.push(reminder);
    }
    if (withSnap.kind === "idea" && withSnap.idea_funnel) {
      emitProposalEvent(
        site,
        "proposal_idea_funnel_set",
        id,
        proposer.username,
        { idea_funnel: withSnap.idea_funnel },
        proposerEventActor,
      );
    }
    if (withSnap.kind === "idea" && withSnap.idea_seo_target) {
      emitProposalEvent(
        site,
        "proposal_idea_seo_target_set",
        id,
        proposer.username,
        { idea_seo_target: withSnap.idea_seo_target },
        proposerEventActor,
      );
    }
    if (deps.indexSearch) {
      deps.indexSearch(withSnap).catch((err) => log.warn({ err }, "proposal index failed"));
    }
    return {
      ok: true,
      proposal: withSnap,
      ...(reviewCtx ? { review_context: reviewCtx } : {}),
      ...(draftWarnings.length ? { warnings: draftWarnings } : {}),
    };
  }

  async function update(
    id: string,
    action: ProposalUpdateAction,
    caller: ProposalUpdateCaller,
  ): Promise<
    | {
        ok: true;
        proposal: ProposalRecord;
        warnings?: Array<{ code: string; message: string }>;
        traffic_siblings?: Array<{
          slug: string;
          locale: string;
          allocation: number;
        }>;
        dry_run?: boolean;
        merge_preview?: ApplyEntryPreview[];
        pending?: ApplyEntryPreview[];
        reverted_from?: string;
        conflicting_fields?: RevertConflict[];
      }
    | {
        ok: false;
        code: string;
        error: string;
        proposal?: ProposalRecord;
        conflicting_fields?: RevertConflict[];
        claim_expired?: boolean;
        traffic_siblings?: Array<{ slug: string; locale: string; allocation: number }>;
        existing_proposal?: ProposalRecord;
        activity?: Array<{
          entryKey: string;
          writeCount: number;
          windowDays: number;
        }>;
        duplicate_of?: string;
        details?: unknown;
        pending?: ApplyEntryPreview[];
        review_context?: ReviewContext;
      }
  > {
    const db = dbFor(site);
    const proposal = getRaw(id);
    if (!proposal) {
      const deleted = findProposalDeletion(db, site, id);
      if (deleted) return proposalDeletedError(deleted);
      return { ok: false, code: "not_found", error: "Proposal not found" };
    }

    if (
      store &&
      !proposal.system_version &&
      !LEGACY_ALLOWED_ACTIONS.has(action)
    ) {
      return {
        ok: false,
        code: "legacy_version",
        error:
          "This proposal was filed before proposals v1.0 (drafts as the source of truth) and is read-only. Withdraw or reject it and file a new proposal; accepted legacy ideas can still be implemented.",
        proposal,
      };
    }

    if (action === "revert") return revertProposal(proposal, caller);

    const report = caller.report?.trim() ?? "";
    const now = Date.now();

    if (action === "review_outcome" || action === "set_outcome_lesson") {
      if (caller.actor?.type === "mcp") {
        return {
          ok: false,
          code: "steward_ui_only",
          error:
            "Outcome reviews are set by staff stewards in the UI only — agents can read outcome_review fields but cannot set them.",
          proposal,
        };
      }
      if (!isClosedProposalStatus(proposal.status)) {
        return {
          ok: false,
          code: "not_closed",
          error: "Outcome reviews are only for closed proposals (finished, rejected, or withdrawn).",
          proposal,
        };
      }
    }

    if (action === "review_outcome") {
      const outcome = (caller.outcome_review ?? "").trim();
      if (outcome !== "good" && outcome !== "bad" && outcome !== "clear") {
        return {
          ok: false,
          code: "invalid_outcome_review",
          error: "outcome_review must be good, bad, or clear",
        };
      }
      const note = (caller.outcome_review_note ?? "").trim();
      const expected = (caller.outcome_review_expected ?? "").trim();
      if (outcome === "bad") {
        if (note.length < MIN_CLOSE_NOTE || expected.length < MIN_CLOSE_NOTE) {
          return {
            ok: false,
            code: "outcome_review_note_required",
            error: `A bad outcome needs outcome_review_note (what went wrong) and outcome_review_expected (what should have happened), each min ${MIN_CLOSE_NOTE} characters`,
          };
        }
      }
      if (outcome === "clear" && !proposal.outcome_review) {
        return { ok: false, code: "not_reviewed", error: "Proposal has no outcome review", proposal };
      }
      const history = [...proposal.outcome_review_history];
      if (proposal.outcome_review) {
        history.push({
          outcome: proposal.outcome_review,
          note: proposal.outcome_review_note,
          expected: proposal.outcome_review_expected,
          at: proposal.outcome_review_at,
          by: proposal.outcome_review_by,
          replaced_at: now,
          replaced_by: caller.username,
          replaced_with: outcome === "clear" ? "cleared" : outcome,
        });
      }
      const trimmedHistory = history.slice(-OUTCOME_REVIEW_HISTORY_MAX);
      const keepLesson = outcome === "bad" && proposal.outcome_review === "bad";
      if (outcome === "clear") {
        db.prepare(
          `UPDATE content_proposals
           SET outcome_review = NULL, outcome_review_note = NULL, outcome_review_expected = NULL,
               outcome_review_at = NULL, outcome_review_by = NULL, outcome_review_history_json = ?,
               outcome_lesson_captured_at = NULL, outcome_lesson_captured_by = NULL,
               outcome_lesson_note = NULL, updated_at = ?
           WHERE id = ?`,
        ).run(JSON.stringify(trimmedHistory), now, id);
      } else {
        db.prepare(
          `UPDATE content_proposals
           SET outcome_review = ?, outcome_review_note = ?, outcome_review_expected = ?,
               outcome_review_at = ?, outcome_review_by = ?, outcome_review_history_json = ?,
               outcome_lesson_captured_at = ?, outcome_lesson_captured_by = ?,
               outcome_lesson_note = ?, updated_at = ?
           WHERE id = ?`,
        ).run(
          outcome,
          note || null,
          outcome === "bad" ? expected : null,
          now,
          caller.username,
          JSON.stringify(trimmedHistory),
          keepLesson ? proposal.outcome_lesson_captured_at : null,
          keepLesson ? proposal.outcome_lesson_captured_by : null,
          keepLesson ? proposal.outcome_lesson_note : null,
          now,
          id,
        );
      }
      emitProposalEvent(
        site,
        "proposal_outcome_reviewed",
        id,
        caller.username,
        {
          outcome: outcome === "clear" ? "cleared" : outcome,
          previous: proposal.outcome_review,
          ...(note ? { note } : {}),
          ...(outcome === "bad" ? { expected } : {}),
        },
        caller.actor,
      );
      return { ok: true, proposal: get(id)! };
    }

    if (action === "set_outcome_lesson") {
      if (proposal.outcome_review !== "bad") {
        return {
          ok: false,
          code: "not_bad",
          error: "Lesson captured can only be set on a proposal marked as a bad outcome",
          proposal,
        };
      }
      const captured = caller.outcome_lesson_captured === true;
      const lessonNote = (caller.outcome_lesson_note ?? "").trim();
      db.prepare(
        `UPDATE content_proposals
         SET outcome_lesson_captured_at = ?, outcome_lesson_captured_by = ?,
             outcome_lesson_note = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        captured ? now : null,
        captured ? caller.username : null,
        captured ? lessonNote || null : null,
        now,
        id,
      );
      emitProposalEvent(
        site,
        "proposal_outcome_lesson_set",
        id,
        caller.username,
        { captured, ...(captured && lessonNote ? { note: lessonNote } : {}) },
        caller.actor,
      );
      return { ok: true, proposal: get(id)! };
    }

    if (action === "escalate" || action === "deescalate") {
      if (caller.actor?.type === "mcp") {
        return {
          ok: false,
          code: "steward_ui_only",
          error: "Escalate and release are staff steward actions in the UI — agents cannot set them.",
          proposal,
        };
      }
    } else if (proposal.escalated && caller.actor?.type === "mcp") {
      return {
        ok: false,
        code: "escalated",
        error:
          "A steward paused agent work on this proposal. Do not claim, add blockers, apply, or reject until they release it.",
        proposal,
      };
    }

    if (action === "escalate") {
      if (proposal.status !== "open" && proposal.status !== "partial") {
        return { ok: false, code: "closed", error: "Cannot escalate a closed proposal" };
      }
      if (proposal.escalated) {
        return { ok: false, code: "already_escalated", error: "Proposal is already escalated", proposal };
      }
      const note = (caller.escalated_note || caller.close_note || caller.body || "").trim();
      if (note.length < MIN_CLOSE_NOTE) {
        return {
          ok: false,
          code: "escalated_note_required",
          error: `escalated_note required (min ${MIN_CLOSE_NOTE} characters): why agents must pause`,
        };
      }
      db.prepare(
        `UPDATE content_proposals
         SET escalated = 1, escalated_at = ?, escalated_by = ?, escalated_note = ?,
             claim_json = NULL, updated_at = ?
         WHERE id = ?`,
      ).run(now, caller.username, note, now, id);
      emitProposalEvent(site, "proposal_escalated", id, caller.username, { note }, caller.actor);
      return { ok: true, proposal: get(id)! };
    }

    if (action === "deescalate") {
      if (!proposal.escalated) {
        return { ok: false, code: "not_escalated", error: "Proposal is not escalated", proposal };
      }
      db.prepare(`UPDATE content_proposals SET escalated = 0, updated_at = ? WHERE id = ?`).run(
        now,
        id,
      );
      emitProposalEvent(site, "proposal_deescalated", id, caller.username, {}, caller.actor);
      return { ok: true, proposal: get(id)! };
    }

    if (action === "claim") {
      const claim = proposal.claim;
      const settings = policy();
      const uiTakeover =
        isStaffUiActor(asAgentActor(caller.actor)) && settings.claim.staff_ui_takeover;
      if (
        claim &&
        new Date(claim.expiresAt).getTime() > now &&
        !sameAgentIdentity(
          claim.by,
          asAgentActor(claim.actor),
          caller.username,
          asAgentActor(caller.actor),
        ) &&
        !uiTakeover
      ) {
        const holder = formatAgentActorLine(claim.by, asAgentActor(claim.actor));
        return { ok: false, code: "claimed", error: `Claimed by ${holder} until ${claim.expiresAt}` };
      }
      const next: ProposalClaim = {
        by: caller.username,
        expiresAt: new Date(now + PROPOSAL_CLAIM_TTL_MS).toISOString(),
        ...(report ? { report } : {}),
        ...(caller.actor ? { actor: caller.actor } : {}),
      };
      db.prepare(`UPDATE content_proposals SET claim_json = ?, updated_at = ? WHERE id = ?`).run(
        JSON.stringify(next),
        now,
        id,
      );
      return { ok: true, proposal: get(id)! };
    }

    if (action === "release") {
      if (proposal.claim && report && report.length < MIN_SUMMARY) {
        return { ok: false, code: "report_too_short", error: `release report min ${MIN_SUMMARY} characters` };
      }
      db.prepare(`UPDATE content_proposals SET claim_json = NULL, updated_at = ? WHERE id = ?`).run(now, id);
      return { ok: true, proposal: get(id)! };
    }

    if (action === "withdraw") {
      const settings = policy();
      const sameProposer =
        proposal.proposer_username.trim().toLowerCase() === caller.username.trim().toLowerCase();
      const isMcp = caller.actor?.type === "mcp";
      if (isMcp) {
        if (settings.withdraw.mcp === "disabled") {
          return {
            ok: false,
            code: "withdraw_disabled",
            error:
              "Site rules disable agent withdraw — ask staff to withdraw in the UI, or Reject Completely if it must not ship",
          };
        }
        if (settings.withdraw.mcp === "proposer_only" && !sameProposer) {
          return {
            ok: false,
            code: "not_proposer",
            error: "Only the proposer or an editor can withdraw",
          };
        }
        // any_create_author: any MCP author may withdraw
      } else if (!sameProposer && !caller.asStaff) {
        return {
          ok: false,
          code: "not_proposer",
          error: "Only the proposer or an editor can withdraw",
        };
      }
      if (proposal.status === "finished") {
        return { ok: false, code: "already_finished", error: "Finished proposals cannot be withdrawn" };
      }
      if (proposal.status === "rejected" || proposal.status === "withdrawn") {
        return { ok: false, code: "closed", error: "Proposal is already closed" };
      }
      const withdrawNote = (caller.close_note || caller.report || "").trim();
      if (withdrawNote.length < MIN_CLOSE_NOTE) {
        return {
          ok: false,
          code: "withdraw_note_required",
          error: `withdraw note required (min ${MIN_CLOSE_NOTE} characters)`,
        };
      }
      const reviewBeforeWithdraw = await classifyLive(proposal);
      db.prepare(
        `UPDATE content_proposals
         SET status = 'withdrawn', claim_json = NULL, updated_at = ?,
             close_reason = ?, close_note = ?, closed_by = ?, closed_at = ?
         WHERE id = ?`,
      ).run(now, "withdrawn", withdrawNote, caller.username, now, id);
      captureDecisionDebug(proposal, "withdraw", caller, reviewBeforeWithdraw);
      emitProposalEvent(
        site,
        "proposal_withdrawn",
        id,
        caller.username,
        {},
        caller.actor,
      );
      const released = proposal.system_version
        ? await releaseV1Drafts(id, proposal.entries, caller.username)
        : [];
      const blockedDependents = blockDependentsOnClose(db, { ...proposal, status: "withdrawn" }, now);
      const withdrawWarnings = [
        ...released,
        ...(blockedDependents.length ? [predecessorClosedWarning(blockedDependents)] : []),
      ];
      return {
        ok: true,
        proposal: get(id)!,
        ...(withdrawWarnings.length ? { warnings: withdrawWarnings } : {}),
      };
    }

    if (action === "reject") {
      if (
        fourEyesBlockedForCaller(
          policy(),
          proposal.proposer_username,
          proposal.proposer_actor,
          caller.username,
          caller.actor,
        )
      ) {
        return {
          ok: false,
          code: "four_eyes",
          error: "Four-eyes: a different agent role (or staff UI) must reject",
        };
      }
      if (
        proposal.status === "finished" ||
        proposal.status === "rejected" ||
        proposal.status === "withdrawn"
      ) {
        return { ok: false, code: "closed", error: "Proposal is already closed" };
      }
      if (!caller.confirm_reject) {
        return {
          ok: false,
          code: "confirm_reject",
          error:
            "Reject is for bad/impossible/illegal/harmful ideas only — not polish. Pass confirm_reject: true with reject_kind and close_note. Prefer add_blocker when the idea is fine but needs changes.",
          proposal,
        };
      }
      const kindRaw = (caller.reject_kind || "").trim();
      if (!isProposalRejectKind(kindRaw)) {
        return {
          ok: false,
          code: "reject_kind_required",
          error: `reject_kind required: ${PROPOSAL_REJECT_KINDS.join(" | ")}`,
        };
      }
      const rejectNote = (caller.close_note || caller.body || "").trim();
      if (rejectNote.length < MIN_REJECT_NOTE) {
        return {
          ok: false,
          code: "reject_note_too_short",
          error: `reject note required (min ${MIN_REJECT_NOTE} characters): why this must not ship`,
        };
      }
      const reviewBeforeReject = await classifyLive(proposal);
      db.prepare(
        `UPDATE content_proposals
         SET status = 'rejected', claim_json = NULL, updated_at = ?,
             close_reason = ?, close_note = ?, closed_by = ?, closed_at = ?
         WHERE id = ?`,
      ).run(now, kindRaw, rejectNote, caller.username, now, id);
      captureDecisionDebug(proposal, "reject", caller, reviewBeforeReject);
      emitProposalEvent(
        site,
        "proposal_rejected",
        id,
        caller.username,
        {
          reject_kind: kindRaw,
        },
        caller.actor,
      );
      const released = proposal.system_version
        ? await releaseV1Drafts(id, proposal.entries, caller.username)
        : [];
      const blockedDependents = blockDependentsOnClose(db, { ...proposal, status: "rejected" }, now);
      const rejectWarnings = [
        ...released,
        ...(blockedDependents.length ? [predecessorClosedWarning(blockedDependents)] : []),
      ];
      return {
        ok: true,
        proposal: get(id)!,
        ...(rejectWarnings.length ? { warnings: rejectWarnings } : {}),
      };
    }

    if (action === "accept") {
      if (proposal.kind !== "idea") {
        return {
          ok: false,
          code: "wrong_kind",
          error: "accept is for idea proposals only",
        };
      }
      if (
        proposal.status === "finished" ||
        proposal.status === "rejected" ||
        proposal.status === "withdrawn"
      ) {
        return { ok: false, code: "closed", error: "Proposal is already closed" };
      }
      if (
        fourEyesBlockedForCaller(
          policy(),
          proposal.proposer_username,
          proposal.proposer_actor,
          caller.username,
          caller.actor,
        )
      ) {
        return {
          ok: false,
          code: "four_eyes",
          error: "Four-eyes: a different agent role (or staff UI) must accept",
        };
      }
      if (proposal.open_blocker_count > 0) {
        return {
          ok: false,
          code: "proposal_blocked",
          error: `Cannot accept while ${proposal.open_blocker_count} open blocker(s) remain`,
          proposal,
        };
      }
      const nextStep = (caller.next_step || caller.close_note || "").trim();
      if (nextStep.length < MIN_ACCEPT_NEXT_STEP) {
        return {
          ok: false,
          code: "next_step_required",
          error: `Accept requires a next-step note (min ${MIN_ACCEPT_NEXT_STEP} characters)`,
        };
      }
      const acceptedEntry = parseAcceptedEntry(caller.accepted_entry);
      if (!acceptedEntry) {
        return {
          ok: false,
          code: "accepted_entry_required",
          error:
            "Accept requires accepted_entry with contentType, slug, and locale (the page this idea locks for follow-up work).",
        };
      }
      const entryTaken = () => {
        const holder = findAcceptedIdeaOwningEntry(
          db,
          site,
          acceptedEntry.contentType,
          acceptedEntry.slug,
          acceptedEntry.locale,
          id,
        );
        if (!holder) return null;
        const openEdit = findOpenImplementsForIdea(db, site, holder.id);
        return {
          ok: false as const,
          code: "accepted_entry_taken",
          error:
            `${acceptedEntryKey(acceptedEntry)} is reserved by accepted idea "${holder.title}" (${holder.id}) until its edit is applied` +
            (openEdit ? ` (open edit ${openEdit.id})` : "") +
            ". Leave this idea open and accept it after that. Do not close it.",
          existing_proposal: holder,
          details: {
            holder_id: holder.id,
            open_edit_id: openEdit?.id ?? null,
            releases_when: "holder_edit_applied",
          },
        };
      };
      const taken = entryTaken();
      if (taken) return taken;
      const urlSlugGate = gateAcceptedUrlSlug(acceptedEntry);
      if (!urlSlugGate.ok) return { ...urlSlugGate, proposal };
      const acceptEx = resolveExistence({
        contentType: acceptedEntry.contentType,
        slug: acceptedEntry.slug,
        locale: acceptedEntry.locale,
      });
      const needsFunnel = ideaRequiresStructuredFunnel({
        title: proposal.title,
        summary: proposal.summary,
        accepted_entry: { ...acceptedEntry, existence: acceptEx.live },
      });
      if (needsFunnel && !ideaFunnelComplete(proposal.idea_funnel)) {
        return {
          ok: false,
          code: IDEA_FUNNEL_REQUIRED,
          error:
            "This idea locks a new URL. Set structured idea_funnel (stage + products) via set_idea_funnel before accept. products \"all\" only with stage awareness.",
          proposal,
        };
      }
      const needsSeoTarget =
        needsFunnel &&
        (deps.seoTarget
          ? deps.seoTarget.isMonitored(acceptedEntry.contentType)
          : proposal.idea_seo_target != null);
      if (needsSeoTarget) {
        const seoGate = gateIdeaSeoTargetAtAccept(proposal, acceptedEntry, db);
        if (!seoGate.ok) return { ...seoGate, proposal };
      }
      const reviewBeforeAccept = await classifyLive(proposal);
      const takenMeanwhile = entryTaken();
      if (takenMeanwhile) return takenMeanwhile;
      db.prepare(
        `UPDATE content_proposals
         SET status = 'finished', claim_json = NULL, updated_at = ?,
             close_reason = ?, close_note = ?, closed_by = ?, closed_at = ?,
             accepted_entry_json = ?
         WHERE id = ?`,
      ).run(now, "accepted", nextStep, caller.username, now, JSON.stringify(acceptedEntry), id);
      captureDecisionDebug(proposal, "accept", caller, reviewBeforeAccept);
      emitProposalEvent(site, "proposal_closed", id, caller.username, {
        close_reason: "accepted",
        close_note: nextStep,
        accepted_entry: acceptedEntry,
      }, caller.actor);
      const acceptWarnings: Array<{ code: string; message: string; details?: Record<string, unknown> }> = [];
      const acceptShape =
        acceptEx.live === "missing" ? inspectTarget(acceptedEntry.contentType, acceptedEntry.slug).shape : null;
      if (acceptShape === "database") {
        acceptWarnings.push({
          code: ACCEPTED_ENTRY_NOT_CREATABLE,
          message:
            `${acceptedEntryKey(acceptedEntry)} does not exist yet and this page type cannot be created from a proposal. ` +
            "The slug stays reserved; someone must create the page in the CMS before edits can follow.",
        });
      } else if (acceptShape === "page_file") {
        acceptWarnings.push({
          code: ACCEPTED_ENTRY_NEEDS_LAYOUT,
          message:
            `layout_owner: entry — ${acceptedEntryKey(acceptedEntry)} owns its layout. The follow-up edits must send the whole layout ` +
            'as one full { field_path: "sections", value: [...] } update (checked against the component registry), not only fields.',
          details: { layout_owner: "entry", accepted_entry: acceptedEntry },
        });
      }
      return {
        ok: true,
        proposal: get(id)!,
        ...(acceptWarnings.length ? { warnings: acceptWarnings } : {}),
      };
    }

    if (action === "close" || action === "acknowledge") {
      if (proposal.kind === "edits") {
        return {
          ok: false,
          code: "wrong_kind",
          error: "close is for notes or idea proposals; use apply for edits",
        };
      }
      if (action === "acknowledge" && proposal.kind !== "notes") {
        return {
          ok: false,
          code: "wrong_kind",
          error: "acknowledge is a notes-only alias of close",
        };
      }
      if (
        proposal.status === "finished" ||
        proposal.status === "rejected" ||
        proposal.status === "withdrawn"
      ) {
        return { ok: false, code: "closed", error: "Proposal is already closed" };
      }
      if (proposal.kind === "idea") {
        const reasonRaw = (caller.close_reason || "").trim();
        if (reasonRaw === "accepted") {
          return {
            ok: false,
            code: "use_accept",
            error: "Use action accept (with next_step) to greenlight an idea",
          };
        }
        if (!IDEA_PARK_REASONS.includes(reasonRaw as ProposalCloseReason)) {
          return {
            ok: false,
            code: "close_reason_invalid",
            error: `Idea close reason must be one of: ${IDEA_PARK_REASONS.join(", ")}`,
          };
        }
      }
      const validated = validateCloseReason(caller.close_reason, caller.close_note);
      if (!validated.ok) {
        return { ok: false, code: validated.code, error: validated.error };
      }
      const reviewBeforeClose = await classifyLive(proposal);
      db.prepare(
        `UPDATE content_proposals
         SET status = 'finished', claim_json = NULL, updated_at = ?,
             close_reason = ?, close_note = ?, closed_by = ?, closed_at = ?
         WHERE id = ?`,
      ).run(now, validated.reason, validated.note, caller.username, now, id);
      captureDecisionDebug(proposal, "close", caller, reviewBeforeClose);
      emitProposalEvent(site, "proposal_closed", id, caller.username, {
        close_reason: validated.reason,
        close_note: validated.note,
      }, caller.actor);
      return { ok: true, proposal: get(id)! };
    }

    if (action === "set_no_auto_retry") {
      if (proposal.kind !== "notes") {
        return {
          ok: false,
          code: "wrong_kind",
          error: "set_no_auto_retry is for notes proposals only",
        };
      }
      if (
        proposal.status === "finished" ||
        proposal.status === "rejected" ||
        proposal.status === "withdrawn"
      ) {
        return { ok: false, code: "closed", error: "Cannot change no_auto_retry on a closed proposal" };
      }
      if (typeof caller.no_auto_retry !== "boolean") {
        return {
          ok: false,
          code: "no_auto_retry_required",
          error: "no_auto_retry boolean is required",
        };
      }
      const isMcp = caller.actor?.type === "mcp";
      if (isMcp) {
        const { active, expired } = activeClaim(proposal, now);
        if (
          !active ||
          !sameAgentIdentity(
            active.by,
            asAgentActor(active.actor),
            caller.username,
            asAgentActor(caller.actor),
          )
        ) {
          return {
            ok: false,
            code: "not_claimant",
            error: expired
              ? "Claim expired. Claim the proposal again, then set_no_auto_retry."
              : "MCP agents must claim the proposal before changing no_auto_retry.",
            claim_expired: expired,
            proposal,
          };
        }
      }
      db.prepare(`UPDATE content_proposals SET no_auto_retry = ?, updated_at = ? WHERE id = ?`).run(
        caller.no_auto_retry ? 1 : 0,
        now,
        id,
      );
      return { ok: true, proposal: get(id)! };
    }

    if (action === "set_idea_funnel") {
      if (proposal.kind !== "idea") {
        return {
          ok: false,
          code: "wrong_kind",
          error: "set_idea_funnel is for idea proposals only",
        };
      }
      if (proposal.status === "finished" || proposal.status === "rejected" || proposal.status === "withdrawn") {
        return {
          ok: false,
          code: proposal.close_reason === "accepted" ? IDEA_FUNNEL_FROZEN : "closed",
          error:
            proposal.close_reason === "accepted"
              ? "idea_funnel is frozen after accept. Reject/refile if the plan was wrong — do not edit the lock."
              : "Cannot change idea_funnel on a closed proposal",
        };
      }
      if (
        !sameAgentIdentity(
          proposal.proposer_username,
          asAgentActor(proposal.proposer_actor),
          caller.username,
          asAgentActor(caller.actor),
        ) &&
        !caller.asStaff
      ) {
        return {
          ok: false,
          code: "not_proposer",
          error: "Only the original proposer (or staff) may set idea_funnel",
        };
      }
      const funnelCheck = validateIdeaFunnel(caller.idea_funnel);
      if (!funnelCheck.ok) {
        return { ok: false, code: funnelCheck.code, error: funnelCheck.error };
      }
      if (proposal.idea_funnel && ideaFunnelsEqual(proposal.idea_funnel, funnelCheck.funnel)) {
        return { ok: true, proposal: get(id)! };
      }
      db.prepare(`UPDATE content_proposals SET idea_funnel_json = ?, updated_at = ? WHERE id = ?`).run(
        JSON.stringify(funnelCheck.funnel),
        now,
        id,
      );
      const after = getRaw(id)!;
      await classifyLive(after, { refreshSnapshot: true });
      emitProposalEvent(
        site,
        "proposal_idea_funnel_set",
        id,
        caller.username,
        { idea_funnel: funnelCheck.funnel },
        caller.actor,
      );
      return { ok: true, proposal: get(id)! };
    }

    if (action === "set_idea_seo_target") {
      if (proposal.kind !== "idea") {
        return {
          ok: false,
          code: "wrong_kind",
          error: "set_idea_seo_target is for idea proposals only",
        };
      }
      if (proposal.status === "finished" || proposal.status === "rejected" || proposal.status === "withdrawn") {
        return {
          ok: false,
          code: proposal.close_reason === "accepted" ? IDEA_SEO_TARGET_FROZEN : "closed",
          error:
            proposal.close_reason === "accepted"
              ? "idea_seo_target is frozen after accept. The implementing edits proposal may override it with seo_target_override.reason."
              : "Cannot change idea_seo_target on a closed proposal",
        };
      }
      if (
        !sameAgentIdentity(
          proposal.proposer_username,
          asAgentActor(proposal.proposer_actor),
          caller.username,
          asAgentActor(caller.actor),
        ) &&
        !caller.asStaff
      ) {
        return {
          ok: false,
          code: "not_proposer",
          error: "Only the original proposer (or staff) may set idea_seo_target",
        };
      }
      const seoCheck = validateIdeaSeoTarget(caller.idea_seo_target, {
        demandLabel: ideaDemandLabel(proposal.review_situations),
        enforceDemand: true,
      });
      if (!seoCheck.ok) {
        return { ok: false, code: seoCheck.code, error: seoCheck.error };
      }
      if (proposal.idea_seo_target && ideaSeoTargetsEqual(proposal.idea_seo_target, seoCheck.target)) {
        return { ok: true, proposal: get(id)! };
      }
      db.prepare(`UPDATE content_proposals SET idea_seo_target_json = ?, updated_at = ? WHERE id = ?`).run(
        JSON.stringify(seoCheck.target),
        now,
        id,
      );
      const after = getRaw(id)!;
      await classifyLive(after, { refreshSnapshot: true });
      emitProposalEvent(
        site,
        "proposal_idea_seo_target_set",
        id,
        caller.username,
        { idea_seo_target: seoCheck.target },
        caller.actor,
      );
      return { ok: true, proposal: get(id)! };
    }

    if (action === "set_related_entries") {
      if (proposal.kind !== "idea") {
        return { ok: false, code: "wrong_kind", error: "set_related_entries is for idea proposals only" };
      }
      if (proposal.status !== "open" && proposal.status !== "partial") {
        return {
          ok: false,
          code: "closed",
          error:
            proposal.close_reason === "accepted"
              ? "related_entries cannot change after accept — accepted_entry owns the page now."
              : "Cannot change related_entries on a closed proposal",
        };
      }
      if (
        !sameAgentIdentity(
          proposal.proposer_username,
          asAgentActor(proposal.proposer_actor),
          caller.username,
          asAgentActor(caller.actor),
        ) &&
        !caller.asStaff
      ) {
        return {
          ok: false,
          code: "not_proposer",
          error: "Only the original proposer (or staff) may set related_entries",
        };
      }
      if (!Array.isArray(caller.related_entries)) {
        return {
          ok: false,
          code: "related_entries_required",
          error: "Pass related_entries: [{ contentType, slug, locale? }] (an empty array clears them).",
        };
      }
      const nextRelated = normalizeRelatedEntries(caller.related_entries);
      if (deps.knownContentTypes) {
        const known = deps.knownContentTypes();
        const unknown = unknownContentTypes(nextRelated, known);
        if (unknown.length) return unknownContentTypeError(unknown, known);
      }
      const mixed = ideaRelatedMixedRisk(nextRelated);
      if (mixed) return mixed;
      if (stableJson(nextRelated) === stableJson(proposal.related_entries ?? [])) {
        return { ok: true, proposal: get(id)! };
      }
      const fingerprint = fingerprintIdeas({
        site,
        title: proposal.title,
        summary: proposal.summary,
        relatedIssueIds: proposal.related_issue_ids,
        relatedEntries: nextRelated,
      });
      db.prepare(
        `UPDATE content_proposals SET related_entries_json = ?, fingerprint = ?, updated_at = ?, author_content_at = ? WHERE id = ?`,
      ).run(JSON.stringify(nextRelated), fingerprint, now, now, id);
      const after = getRaw(id)!;
      await classifyLive(after, { refreshSnapshot: true });
      return { ok: true, proposal: get(id)! };
    }

    if (action === "set_applies_after") {
      if (proposal.kind !== "edits") {
        return {
          ok: false,
          code: "applies_after_edits_only",
          error: "set_applies_after is for edits proposals only (ideas and notes are never applied).",
        };
      }
      if (proposal.status !== "open" && proposal.status !== "partial") {
        return { ok: false, code: "closed", error: "Cannot change applies_after on a closed proposal" };
      }
      if (
        !sameAgentIdentity(
          proposal.proposer_username,
          asAgentActor(proposal.proposer_actor),
          caller.username,
          asAgentActor(caller.actor),
        ) &&
        !caller.asStaff
      ) {
        return {
          ok: false,
          code: "not_proposer",
          error: "Only the original proposer (or staff) may set applies_after",
        };
      }
      const chain = checkAppliesAfter(db, caller.applies_after_proposal_id ?? null, id);
      if (!chain.ok) return { ok: false, code: chain.code, error: chain.error };
      if (chain.id === proposal.applies_after_proposal_id) {
        return { ok: true, proposal: get(id)! };
      }
      db.prepare(
        `UPDATE content_proposals SET applies_after_proposal_id = ?, dependent_overdue_flagged_at = NULL, updated_at = ? WHERE id = ?`,
      ).run(chain.id, now, id);
      emitProposalEvent(
        site,
        "proposal_applies_after_set",
        id,
        caller.username,
        { applies_after_proposal_id: chain.id, previous: proposal.applies_after_proposal_id },
        caller.actor,
      );
      return {
        ok: true,
        proposal: get(id)!,
        warnings: [
          chain.id
            ? {
                code: "applies_after_set",
                message:
                  `Apply now waits until ${chain.id} is fully applied. Applying that one does not apply this one. ` +
                  "If this proposal has an open predecessor_closed blocker, resolve it now that the link is fixed.",
              }
            : { code: "applies_after_cleared", message: "This proposal no longer waits on another proposal." },
        ],
      };
    }

    if (action === "set_review_situations") {
      if (proposal.kind !== "edits" && proposal.kind !== "idea") {
        return {
          ok: false,
          code: "wrong_kind",
          error: "set_review_situations is for edits or idea proposals only",
        };
      }
      if (proposal.status !== "open" && proposal.status !== "partial") {
        return { ok: false, code: "closed", error: "Cannot change situations on a closed proposal" };
      }
      if (
        !sameAgentIdentity(
          proposal.proposer_username,
          asAgentActor(proposal.proposer_actor),
          caller.username,
          asAgentActor(caller.actor),
        ) &&
        !caller.asStaff
      ) {
        return {
          ok: false,
          code: "not_proposer",
          error: "Only the original proposer (or staff) may set review situations",
        };
      }
      let parsedIds: ReviewSituationId[];
      if (proposal.kind === "idea") {
        const ideaSit = parseIdeaAuthorSituationIds(caller.review_situations ?? []);
        if (!ideaSit.ok) {
          return {
            ok: false,
            code: ideaSit.code ?? "invalid_review_situations",
            error: ideaSit.error,
          };
        }
        parsedIds = ideaSit.ids;
      } else {
        const parsed = parseReviewSituationIds(caller.review_situations ?? []);
        if (!parsed.ok) {
          return { ok: false, code: "invalid_review_situations", error: parsed.error };
        }
        parsedIds = parsed.ids;
      }
      db.prepare(
        `UPDATE content_proposals SET review_situations_json = ?, updated_at = ? WHERE id = ?`,
      ).run(JSON.stringify(parsedIds), now, id);
      const after = getRaw(id)!;
      await classifyLive(after, { refreshSnapshot: true });
      emitProposalEvent(site, "proposal_review_situations_set", id, caller.username, {
        review_situations: parsedIds,
      });
      return { ok: true, proposal: get(id)! };
    }

    if (action === "revise_entries") {
      if (proposal.kind !== "edits") {
        return {
          ok: false,
          code: "wrong_kind",
          error: "revise_entries is for edits proposals only",
        };
      }
      if (proposal.status !== "open" && proposal.status !== "partial") {
        return { ok: false, code: "closed", error: "Cannot revise a closed proposal" };
      }
      if (
        !sameAgentIdentity(
          proposal.proposer_username,
          asAgentActor(proposal.proposer_actor),
          caller.username,
          asAgentActor(caller.actor),
        ) &&
        !caller.asStaff
      ) {
        return {
          ok: false,
          code: "not_proposer",
          error: "Only the original proposer (or staff) may revise entries",
        };
      }
      const { active } = activeClaim(proposal, now);
      if (
        active &&
        !sameAgentIdentity(
          active.by,
          asAgentActor(active.actor),
          caller.username,
          asAgentActor(caller.actor),
        ) &&
        !isStaffUiActor(asAgentActor(caller.actor))
      ) {
        const holder = formatAgentActorLine(active.by, asAgentActor(active.actor));
        return {
          ok: false,
          code: "claimed",
          error: `Claimed by ${holder} until ${active.expiresAt}. Wait or coordinate before revising.`,
          proposal,
        };
      }

      const doneEntries = proposal.entries.filter((e) => e.status === "done");
      const entriesIn = (caller.entries ?? []).map((e) => ({
        ...e,
        updates: e.updates ?? [],
      }));
      if (entriesIn.length === 0 && !proposal.promote_on_apply) {
        return {
          ok: false,
          code: "entries_required",
          error: "revise_entries requires entries[] for the pending set",
        };
      }
      if (proposal.promote_on_apply) {
        if (entriesIn.length !== 1) {
          return {
            ok: false,
            code: "promote_entry_required",
            error: "promote_on_apply proposals require exactly one entry when revising",
          };
        }
        const e = entriesIn[0]!;
        if (!e.contentType || !e.slug || !e.locale || !e.variant?.trim()) {
          return {
            ok: false,
            code: "promote_variant_required",
            error: "promote_on_apply requires contentType, slug, locale, and variant",
          };
        }
      }

      for (const e of entriesIn) {
        if (!e.contentType || !e.slug || !e.locale) {
          return { ok: false, code: "entry_required", error: "Each entry needs contentType, slug, and locale" };
        }
        if (!proposal.promote_on_apply && !e.updates?.length) {
          return {
            ok: false,
            code: "updates_required",
            error: `Entry ${e.contentType}/${e.slug} has no field updates`,
          };
        }
      }

      const reviseDb = dbFor(site);
      const implementsResolved = resolveImplementsForEdits(
        reviseDb,
        proposal.implements_proposal_id ?? undefined,
        entriesIn,
        id,
      );
      if (!implementsResolved.ok) return implementsResolved;
      const reviseOverride = checkSeoTargetOverride(
        implementsResolved.idea,
        entriesIn,
        caller.seo_target_override !== undefined
          ? caller.seo_target_override
          : proposal.seo_target_override,
      );
      if (!reviseOverride.ok) return reviseOverride;
      const reviseOptOut = gateAgentSeoOptOut(
        caller.actor,
        implementsResolved.idea,
        entriesIn,
        reviseOverride.override?.reason,
      );
      if (!reviseOptOut.ok) return reviseOptOut;
      const reviseResetsCreated = !hasPersonCoAuthor(proposal.co_authors);
      const reviseSlug = checkEditsUrlSlug(
        implementsResolved.idea,
        entriesIn,
        caller.url_slug_override !== undefined ? caller.url_slug_override : proposal.url_slug_override,
        (e) => {
          const prior = proposal.entries.find(
            (p) =>
              p.contentType === e.contentType &&
              p.slug === e.slug &&
              p.locale === e.locale &&
              (p.status === "pending" || p.status === "failed") &&
              p.variant,
          );
          const variant = e.variant?.trim() || prior?.variant || null;
          if (!variant) return null;
          if (prior && prior.variant === variant && prior.created_draft && reviseResetsCreated) return null;
          return variant;
        },
      );
      if (!reviseSlug.ok) return reviseSlug;
      const reviseCreates = new Set<string>();

      const classTargets: Array<{
        contentType: string;
        category?: ProposalCategory;
        existence: ExistenceState;
        draftExists?: boolean;
        createsEntry?: boolean;
        outcomeFigures?: boolean;
      }> = [];
      for (const e of entriesIn) {
        const hasVariant = Boolean(e.variant?.trim());
        const ex = resolveExistence({
          contentType: e.contentType,
          slug: e.slug,
          locale: e.locale,
          variant: e.variant,
        });
        const liveOk = ex.live === "exists";
        const draftOk = hasVariant && ex.draftExists;
        const liveMissing = !liveOk && ex.live !== "unknown";
        const ownedDraft = proposal.entries.some(
          (pe) =>
            pe.contentType === e.contentType &&
            pe.slug === e.slug &&
            pe.locale === e.locale &&
            pe.variant &&
            store?.exists(refOf(pe)),
        );
        if (store && proposal.system_version) {
          if (
            liveMissing &&
            !draftOk &&
            !ownedDraft &&
            !store.entryExists(e.contentType, e.slug)
          ) {
            const gate = gateMissingAttachedEntry({
              entry: e,
              promoteOnApply: false,
              hasVariant: false,
              implementsIdea: implementsResolved.idea,
              db: reviseDb,
            });
            if (!gate.ok) return gate;
            if (gate.createsEntry) {
              reviseCreates.add(
                attachedCreateKey(e.contentType, e.slug, e.locale),
              );
            }
          } else if (liveMissing) {
            const owned = proposal.entries.find(
              (pe) =>
                pe.contentType === e.contentType &&
                pe.slug === e.slug &&
                pe.locale === e.locale &&
                pe.variant &&
                (pe.status === "pending" || pe.status === "failed") &&
                store.exists(refOf(pe)),
            );
            const namesOwned = owned && (!hasVariant || e.variant!.trim() === owned.variant);
            // Revise resets drafts this proposal created (no person co-authors) to live, which is empty here.
            const willReset = namesOwned && owned!.created_draft && reviseResetsCreated;
            const keptDraft: ProposalDraftRef | null = willReset
              ? null
              : draftOk
                ? { contentType: e.contentType, slug: e.slug, locale: e.locale, variant: e.variant!.trim() }
                : namesOwned
                  ? refOf(owned!)
                  : null;
            const gate = gateNewLocaleSections({ entry: e, keptDraft });
            if (!gate.ok) return gate;
          }
        } else if (liveMissing && !draftOk) {
          const gate = gateMissingAttachedEntry({
            entry: e,
            promoteOnApply: proposal.promote_on_apply,
            hasVariant,
            implementsIdea: implementsResolved.idea,
            db: reviseDb,
          });
          if (!gate.ok) return gate;
          if (gate.createsEntry) {
            reviseCreates.add(attachedCreateKey(e.contentType, e.slug, e.locale));
          }
        } else if (!hasVariant && !liveOk) {
          return {
            ok: false,
            code: "entry_not_found",
            error: `Page ${e.contentType}/${e.slug} (${e.locale}) does not exist yet.`,
          };
        } else if (hasVariant && !ex.draftExists) {
          return {
            ok: false,
            code: "entry_not_found",
            error: `Draft variant '${e.variant}' for ${e.contentType}/${e.slug} (${e.locale}) was not found.`,
          };
        }
        const updateText = (e.updates ?? [])
          .map((u) => textFromUnknown(u.value))
          .filter(Boolean)
          .join("\n");
        const outcomeFigures =
          (proposal.review_situations ?? []).includes("selling_figures") ||
          evaluateClaimCues(updateText) === "clear_yes" ||
          figureTokensIn(updateText);
        classTargets.push({
          contentType: e.contentType,
          category: (e.updates ?? []).some(
            (u) => u.field_path.startsWith("meta.") || u.field_path.startsWith("seo."),
          )
            ? "content.seo"
            : "content.field",
          existence: ex.live === "unknown" ? "unknown" : liveOk ? "exists" : "missing",
          draftExists: draftOk,
          createsEntry: reviseCreates.has(attachedCreateKey(e.contentType, e.slug, e.locale)),
          outcomeFigures,
        });
      }
      const classes = collectDamageClassesForMixedCheck(classTargets);
      if (isMixedRiskBundle(classes)) {
        return {
          ok: false,
          code: "mixed_risk_bundle",
          error:
            "This revise mixes different risk levels. Keep one risk class per proposal.",
        };
      }
      const sectionsCheck = checkSectionUpdates(entriesIn);
      if (!sectionsCheck.ok) return sectionsCheck;

      for (const e of entriesIn) {
        if (e.variant?.trim()) {
          const existingVariant = findOpenProposalForVariant(
            db,
            site,
            e.contentType,
            e.slug,
            e.locale,
            e.variant.trim(),
          );
          if (existingVariant && existingVariant.id !== id) {
            return {
              ok: false,
              code: "proposal_exists",
              error: `An open proposal already references variant '${e.variant}'`,
              existing_proposal: existingVariant,
            };
          }
        }
        const competing = findOpenEditsForEntry(db, site, e.contentType, e.slug, e.locale, id);
        if (competing) {
          return {
            ok: false,
            code: "competing_entry_edits",
            error: `Another open edits proposal already targets ${e.contentType}/${e.slug} (${e.locale}).`,
            existing_proposal: competing,
          };
        }
      }

      if (entriesIn.length > 0) {
        const activityResult = runResolveActivity({
          entries: entriesIn.map((e) => ({
            contentType: e.contentType,
            slug: e.slug,
            locale: e.locale,
            variant: e.variant,
          })),
          excludeAgentSessionId: caller.agent_session_id,
          excludeProposalApplies: doneEntries.map((e) => ({
            contentType: e.contentType,
            slug: e.slug,
            locale: e.locale,
            variant: e.variant,
            applied_at: e.applied_at,
            applied_by: e.applied_by,
          })),
        });
        if (!activityResult.ok) {
          return {
            ok: false,
            code: "activity_unavailable",
            error:
              activityResult.error ||
              "Could not load recent entry activity. Retry when activity history is available.",
            proposal,
          };
        }
        if (activityResult.gateWriteCount > 0 && !caller.confirm_recent_activity) {
          return {
            ok: false,
            code: "confirm_recent_activity",
            error:
              "Linked entries have recent writes. Inspect get_entry_activity first. " +
              "Same-field SERP churn + live not broken → reject (title/description-only) or revise to drop SERP ops (mixed); do not confirm. " +
              "Pass confirm_recent_activity: true only to revise when the change is still needed and distinct.",
            activity: activityResult.activity,
            proposal: enrichRecentActivity({
              ...proposal,
              recent_activity: activityResult.activity,
            }),
          };
        }
      }

      const v1Revise = Boolean(store && proposal.system_version);
      const captured: Array<{
        input: ProposalEntryInput & { updates: FieldUpdate[] };
        baseline: { values: Record<string, unknown>; note?: string };
        variant_fingerprint: string | null;
      }> = [];
      for (const e of v1Revise ? [] : entriesIn) {
        const updates = e.updates ?? [];
        const createsEntry = reviseCreates.has(attachedCreateKey(e.contentType, e.slug, e.locale));
        let baseline: { values: Record<string, unknown>; note?: string; creates_entry?: boolean } = {
          values: {},
          ...(createsEntry ? { creates_entry: true } : {}),
        };
        if (updates.length && !createsEntry) {
          const capturedBaseline = deps.captureBaseline({ ...e, updates });
          if (capturedBaseline.error) {
            return { ok: false, code: "baseline_failed", error: capturedBaseline.error };
          }
          baseline = { values: capturedBaseline.values };
        }
        let variant_fingerprint: string | null = null;
        if (e.variant?.trim() && deps.readVariantFingerprint) {
          const fp = deps.readVariantFingerprint({
            contentType: e.contentType,
            slug: e.slug,
            locale: e.locale,
            variant: e.variant.trim(),
          });
          if (fp.error) return { ok: false, code: "baseline_failed", error: fp.error };
          variant_fingerprint = fp.fingerprint;
        }
        captured.push({ input: { ...e, updates }, baseline, variant_fingerprint });
      }

      const fingerprint = fingerprintEdits({
        site,
        category: proposal.category,
        entries: entriesIn.map((e) => ({
          contentType: e.contentType,
          slug: e.slug,
          locale: e.locale,
          variant: e.variant,
          updates: e.updates ?? [],
        })),
      });
      const dup = db
        .prepare(
          `SELECT id FROM content_proposals WHERE site = ? AND fingerprint = ? AND status IN ('open','partial') AND id != ? LIMIT 1`,
        )
        .get(site, fingerprint, id) as { id: string } | undefined;
      if (dup) {
        return {
          ok: false,
          code: "duplicate_fingerprint",
          error: `Another open proposal already has this exact change set (${dup.id}).`,
          existing_proposal: loadProposal(db, dup.id) ?? undefined,
        };
      }

      const searchBlob = [
        proposal.title,
        proposal.summary,
        proposal.rationale ?? "",
        ...(proposal.tags ?? []),
        ...proposal.related_issue_ids,
        ...entriesIn.map(
          (e) =>
            `${e.contentType}/${e.slug} ${e.variant ?? ""} ${(e.updates ?? []).map((u) => u.field_path).join(" ")}`,
        ),
        proposal.promote_on_apply ? "promote_on_apply" : "",
      ]
        .join(" ")
        .toLowerCase();

      let revisePlans: V1Plan[] = [];
      const reviseWarnings: Array<{ code: string; message: string }> = [];
      if (v1Revise) {
        const pendingBefore = proposal.entries.filter(
          (e) => (e.status === "pending" || e.status === "failed") && e.variant,
        );
        const owned = new Map<string, { variant: string; created: boolean }>();
        for (const e of pendingBefore) {
          owned.set(attachedCreateKey(e.contentType, e.slug, e.locale), {
            variant: e.variant!,
            created: Boolean(e.created_draft),
          });
        }
        const prepared = await prepareV1Drafts({
          proposalId: id,
          entries: entriesIn,
          author: caller.username,
          newEntryKeys: reviseCreates,
          ideaFunnel: implementsResolved.idea?.idea_funnel ?? null,
          idea: implementsResolved.idea,
          owned,
          resetCreated: reviseResetsCreated,
        });
        if (!prepared.ok) return prepared;
        revisePlans = prepared.plans;
        reviseWarnings.push(...prepared.warnings, ...templateLocalesWarnings(entriesIn));
        const kept = new Set(
          revisePlans.map(
            (p) =>
              `${attachedCreateKey(p.ref.contentType, p.ref.slug, p.ref.locale)}\0${p.ref.variant}`,
          ),
        );
        const dropped = pendingBefore.filter(
          (e) =>
            !kept.has(
              `${attachedCreateKey(e.contentType, e.slug, e.locale)}\0${e.variant}`,
            ),
        );
        reviseWarnings.push(
          ...(await releaseV1Drafts(id, dropped, caller.username)),
        );
      }

      db.prepare(
        `DELETE FROM content_proposal_entries WHERE proposal_id = ? AND status IN ('pending','failed')`,
      ).run(id);
      db.prepare(`UPDATE content_proposals SET seo_target_override_json = ?, url_slug_override_json = ? WHERE id = ?`).run(
        reviseOverride.override ? JSON.stringify(reviseOverride.override) : null,
        reviseSlug.override ? JSON.stringify(reviseSlug.override) : null,
        id,
      );
      for (const plan of revisePlans) {
        db.prepare(
          `INSERT INTO content_proposal_entries (
            proposal_id, entry_key, locale, variant, status, ops_json, baseline_context_json, variant_fingerprint, created_draft
          ) VALUES (?,?,?,?,?,?,?,?,?)`,
        ).run(
          id,
          makeEntryKey(plan.ref.contentType, plan.ref.slug),
          plan.ref.locale,
          plan.ref.variant,
          "pending",
          JSON.stringify(plan.input.updates),
          JSON.stringify({ values: {}, ...layoutOwnerAtFiling(plan.ref) }),
          plan.fingerprint,
          plan.created ? 1 : 0,
        );
        store!.link(
          plan.ref,
          linkFor(id, plan.created, plan.fingerprint),
          caller.username,
        );
      }
      if (v1Revise) {
        clearStale(id);
        if (typeof caller.all_or_nothing === "boolean") {
          db.prepare(
            `UPDATE content_proposals SET all_or_nothing = ? WHERE id = ?`,
          ).run(caller.all_or_nothing ? 1 : 0, id);
        }
      }
      for (const cap of captured) {
        db.prepare(
          `INSERT INTO content_proposal_entries (
            proposal_id, entry_key, locale, variant, status, ops_json, baseline_context_json, variant_fingerprint
          ) VALUES (?,?,?,?,?,?,?,?)`,
        ).run(
          id,
          makeEntryKey(cap.input.contentType, cap.input.slug),
          cap.input.locale,
          cap.input.variant || null,
          "pending",
          JSON.stringify(cap.input.updates),
          JSON.stringify(cap.baseline),
          cap.variant_fingerprint,
        );
      }
      db.prepare(
        `UPDATE content_proposals SET fingerprint = ?, search_text = ?, updated_at = ?, author_content_at = ? WHERE id = ?`,
      ).run(fingerprint, searchBlob, now, now, id);

      const afterOps = getRaw(id)!;
      const priorDeclared = (afterOps.review_situations ?? []) as ReviewSituationId[];
      const refreshed = refreshSituationsAfterRevise(priorDeclared, afterOps.entries, {
        summary: afterOps.summary,
        title: afterOps.title,
        promoteOnApply: afterOps.promote_on_apply,
      });
      // Store author-declared ids that still own remaining ops (inferred extras stay live-only).
      const stillDeclared = refreshed.situations.filter((s) => priorDeclared.includes(s));
      db.prepare(
        `UPDATE content_proposals SET review_situations_json = ?, updated_at = ? WHERE id = ?`,
      ).run(JSON.stringify(stillDeclared), now, id);

      const after = getRaw(id)!;
      persistRollup(db, after);
      await classifyLive(after, { refreshSnapshot: true });
      emitProposalEvent(
        site,
        "proposal_revised",
        id,
        caller.username,
        {
          entry_count: v1Revise ? revisePlans.length : captured.length,
          open_blocker_count: after.open_blocker_count,
        },
        caller.actor,
      );
      return {
        ok: true,
        proposal: get(id)!,
        warnings: [
          ...reviseWarnings,
          {
            code: "blockers_remain_after_revise",
            message:
              "Open needs-changes still block apply. Resolve each blocker after fixing, then re-preview before apply.",
          },
          ...refreshed.warnings,
        ],
      };
    }

    if (action === "add_blocker") {
      if (proposal.status === "finished" || proposal.status === "rejected" || proposal.status === "withdrawn") {
        return { ok: false, code: "closed", error: "Cannot add blockers to a closed proposal" };
      }
      const body = (caller.body || "").trim();
      if (body.length < MIN_BLOCKER_BODY) {
        return {
          ok: false,
          code: "blocker_too_short",
          error: `blocker body required (min ${MIN_BLOCKER_BODY} characters): what's wrong, what fixed looks like, and why`,
        };
      }
      const fromAgent = caller.actor?.type === "mcp" || caller.caller_is_mcp === true;
      let staffSummary = (caller.staff_summary || "").trim();
      if (fromAgent) {
        if (!staffSummary) {
          return {
            ok: false,
            code: "blocker_staff_summary_required",
            error:
              "staff_summary required: a plain-English version of this blocker for staff (what visitors or Google would see change, what must happen before approving, who does it). body stays the technical version for the author.",
          };
        }
        const check = checkStaffSummary(staffSummary);
        if (!check.ok) {
          return {
            ok: false,
            code: "blocker_staff_summary_not_plain",
            error: `staff_summary reads like code. Rewrite it for a staff member who has not read the code: ${check.problems.join("; ")}. Keep the technical detail in body.`,
            details: { problems: check.problems },
          };
        }
      } else if (!staffSummary) {
        staffSummary = body;
      }
      db.prepare(
        `INSERT INTO content_proposal_blockers (
          proposal_id, kind, body, staff_summary, status, author, created_at, agent_session_id, author_actor_json
        ) VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        "blocker",
        body,
        staffSummary,
        "open",
        caller.username,
        now,
        caller.agent_session_id?.trim() || null,
        JSON.stringify(caller.actor ?? {}),
      );
      if (callerIsProposer(proposal, caller)) {
        db.prepare(`UPDATE content_proposals SET updated_at = ? WHERE id = ?`).run(now, id);
      } else {
        stampReviewerAction(db, id, now, caller);
      }
      return { ok: true, proposal: get(id)! };
    }

    if (action === "resolve_blocker") {
      const { active, expired } = activeClaim(proposal, now);
      if (
        !active ||
        !sameAgentIdentity(
          active.by,
          asAgentActor(active.actor),
          caller.username,
          asAgentActor(caller.actor),
        )
      ) {
        return {
          ok: false,
          code: "not_claimant",
          error: expired
            ? "Claim expired. Claim the proposal again, then resolve the blocker."
            : "Only the active claimant may resolve blockers. Claim the proposal first.",
          claim_expired: expired,
          proposal,
        };
      }
      const blockerId = caller.blocker_id;
      if (!blockerId) return { ok: false, code: "blocker_required", error: "blocker_id is required" };
      const resolveNote = (caller.resolve_note || "").trim();
      if (resolveNote.length < 20) {
        return {
          ok: false,
          code: "resolve_note_too_short",
          error: "resolve_note required (min 20 characters): what changed",
        };
      }
      const blocker = proposal.blockers.find((b) => b.id === blockerId);
      if (!blocker) return { ok: false, code: "blocker_not_found", error: "Blocker not found" };
      if (blocker.status !== "open") {
        return { ok: false, code: "blocker_not_open", error: "Blocker is not open" };
      }
      db.prepare(
        `UPDATE content_proposal_blockers
         SET status = 'resolved', resolved_at = ?, resolved_by = ?, resolve_note = ?,
             resolved_by_actor_json = ?
         WHERE id = ? AND proposal_id = ?`,
      ).run(now, caller.username, resolveNote, JSON.stringify(caller.actor ?? {}), blockerId, id);
      if (callerIsProposer(proposal, caller)) {
        db.prepare(
          `UPDATE content_proposals SET updated_at = ?, author_content_at = ? WHERE id = ?`,
        ).run(now, now, id);
      } else {
        stampReviewerAction(db, id, now, caller);
      }
      const fresh = get(id)!;
      const warnings =
        fresh.open_blocker_count === 0
          ? [
              {
                code: "blockers_cleared_repreview",
                message:
                  "All blockers are resolved. Re-preview the draft (or soft diffs) before apply — cleared blockers do not mean approved.",
              },
            ]
          : undefined;
      return { ok: true, proposal: fresh, warnings };
    }

    if (action === "reopen_blocker") {
      const blockerId = caller.blocker_id;
      if (!blockerId) return { ok: false, code: "blocker_required", error: "blocker_id is required" };
      const blocker = proposal.blockers.find((b) => b.id === blockerId);
      if (!blocker) return { ok: false, code: "blocker_not_found", error: "Blocker not found" };
      if (blocker.status !== "resolved") {
        return { ok: false, code: "blocker_not_resolved", error: "Only resolved blockers can be reopened" };
      }
      db.prepare(
        `UPDATE content_proposal_blockers
         SET status = 'open', resolved_at = NULL, resolved_by = NULL, resolve_note = NULL,
             resolved_by_actor_json = NULL
         WHERE id = ? AND proposal_id = ?`,
      ).run(blockerId, id);
      if (callerIsProposer(proposal, caller)) {
        db.prepare(`UPDATE content_proposals SET updated_at = ? WHERE id = ?`).run(now, id);
      } else {
        stampReviewerAction(db, id, now, caller);
      }
      return { ok: true, proposal: get(id)! };
    }

    if (action === "attach_variant") {
      if (proposal.status !== "open" && proposal.status !== "partial") {
        return { ok: false, code: "closed", error: "Cannot attach a variant to a closed proposal" };
      }
      const session = caller.agent_session_id?.trim();
      if (!proposal.created_agent_session_id) {
        return {
          ok: false,
          code: "session_required",
          error: "This proposal has no creating session; variant attach is not allowed",
        };
      }
      const sameSession = isServerAgentSessionId(session) && session === proposal.created_agent_session_id;
      const legacySessionSameProposer =
        !isServerAgentSessionId(proposal.created_agent_session_id) && callerIsProposer(proposal, caller);
      if (!sameSession && !legacySessionSameProposer) {
        return {
          ok: false,
          code: "session_mismatch",
          error: "attach_variant is only allowed in the same agent session that created the proposal",
        };
      }
      const entry = proposal.entries[0];
      if (!entry) {
        return { ok: false, code: "entry_required", error: "Proposal has no entries to attach a variant to" };
      }
      if (entry.variant) {
        return {
          ok: false,
          code: "variant_locked",
          error: `Variant '${entry.variant}' is already attached and cannot be changed`,
        };
      }
      const variant = (caller.variant || "").trim();
      if (!variant) return { ok: false, code: "variant_required", error: "variant is required" };
      const attachRef: ProposalDraftRef = {
        contentType: entry.contentType,
        slug: entry.slug,
        locale: entry.locale,
        variant,
      };
      if (store && proposal.system_version) {
        if (!store.exists(attachRef)) {
          return { ok: false, code: "entry_not_found", error: `Draft '${variant}' does not exist for ${entry.contentType}/${entry.slug} (${entry.locale}).` };
        }
        const alloc = store.allocation(attachRef) ?? 0;
        if (alloc > 0) {
          return {
            ok: false,
            code: "variant_has_traffic",
            error: `Variant '${variant}' has ${alloc}% traffic (experiment). Proposals only target drafts (0% traffic).`,
          };
        }
        const structure = store.structureError(attachRef);
        if (structure) {
          return {
            ok: false,
            code: "attached_draft_structure",
            error: `${structure} Drafts of posts that use the shared template may only change fields.`,
          };
        }
      }

      const existingVariant = findOpenProposalForVariant(
        db,
        site,
        entry.contentType,
        entry.slug,
        entry.locale,
        variant,
      );
      if (existingVariant && existingVariant.id !== id) {
        return {
          ok: false,
          code: "proposal_exists",
          error: `An open proposal already references variant '${variant}'`,
          existing_proposal: existingVariant,
        };
      }

      let fingerprint: string | null = null;
      if (deps.readVariantFingerprint) {
        const fp = deps.readVariantFingerprint({
          contentType: entry.contentType,
          slug: entry.slug,
          locale: entry.locale,
          variant,
        });
        if (fp.error) return { ok: false, code: "baseline_failed", error: fp.error };
        fingerprint = fp.fingerprint;
      }

      if (store && proposal.system_version) fingerprint = store.fingerprint(attachRef);
      db.prepare(
        `UPDATE content_proposal_entries SET variant = ?, variant_fingerprint = ?, created_draft = 0 WHERE id = ?`,
      ).run(variant, fingerprint, entry.id);
      if (store && proposal.system_version) {
        store.link(attachRef, linkFor(id, false, fingerprint), caller.username);
      }
      if (caller.promote_on_apply) {
        db.prepare(`UPDATE content_proposals SET promote_on_apply = 1, updated_at = ? WHERE id = ?`).run(now, id);
      } else {
        db.prepare(`UPDATE content_proposals SET updated_at = ? WHERE id = ?`).run(now, id);
      }
      const afterAttach = getRaw(id)!;
      await classifyLive(afterAttach, { refreshSnapshot: true });
      return { ok: true, proposal: get(id)! };
    }

    if (action === "apply") {
      if (proposal.kind !== "edits") {
        return { ok: false, code: "wrong_kind", error: "apply is for edits proposals; use close for notes" };
      }
      if (
        fourEyesBlockedForCaller(
          policy(),
          proposal.proposer_username,
          proposal.proposer_actor,
          caller.username,
          caller.actor,
        )
      ) {
        return {
          ok: false,
          code: "four_eyes",
          error: "Four-eyes: a different agent role (or staff UI) must apply",
        };
      }
      if (proposal.co_authors.some((c) => sameUsername(c.username, caller.username))) {
        return {
          ok: false,
          code: "four_eyes_co_author",
          error:
            "Four-eyes: you edited this proposal's draft (co-author), so someone else must review and approve it.",
        };
      }
      // Only v1.0 previews write nothing; legacy apply has no dry_run path.
      const previewOnly = Boolean(caller.dry_run && store && proposal.system_version);
      if (proposal.open_blocker_count > 0 && !previewOnly) {
        return {
          ok: false,
          code: "proposal_blocked",
          error: `Cannot apply while ${proposal.open_blocker_count} open blocker(s) remain`,
          proposal: enrichRecentActivity(proposal),
        };
      }
      if (!caller.dry_run) {
        const chainGate = predecessorGate(db, proposal);
        if (!chainGate.ok) {
          return { ...chainGate, proposal: enrichRecentActivity(proposal) };
        }
      }

      const reviewForApply = await classifyLive(proposal);
      if (reviewForApply?.block_apply) {
        return {
          ok: false,
          code: "target_missing",
          error:
            "The page this proposal edits no longer exists — apply is blocked. Reject or withdraw, or restore the page and file a fresh proposal.",
          proposal: enrichRecentActivity(proposal),
          review_context: reviewForApply,
        };
      }

      const work = proposal.entries.filter((e) => e.status === "pending" || e.status === "failed");
      if (work.length > 0) {
        const activityResult = runResolveActivity({
          entries: work.map((e) => ({
            contentType: e.contentType,
            slug: e.slug,
            locale: e.locale,
            variant: e.variant,
          })),
          excludeAgentSessionId: caller.agent_session_id,
          excludeProposalApplies: proposal.entries
            .filter((e) => e.status === "done")
            .map((e) => ({
              contentType: e.contentType,
              slug: e.slug,
              locale: e.locale,
              variant: e.variant,
              applied_at: e.applied_at,
              applied_by: e.applied_by,
            })),
        });
        if (!activityResult.ok) {
          return {
            ok: false,
            code: "activity_unavailable",
            error:
              activityResult.error ||
              "Could not load recent entry activity. Retry when activity history is available.",
            proposal: enrichRecentActivity(proposal),
          };
        }
        if (activityResult.gateWriteCount > 0 && !caller.confirm_recent_activity) {
          return {
            ok: false,
            code: "confirm_recent_activity",
            error:
              "Linked entries have recent writes. Inspect get_entry_activity first. " +
              "Same-field SERP churn + live not broken → reject duplicate_weaker (title/description-only) or revise_entries to drop SERP ops then apply (mixed); do not confirm. " +
              "Pass confirm_recent_activity: true only if this proposal is still needed and distinct from those writes.",
            activity: activityResult.activity,
            proposal: enrichRecentActivity({
              ...proposal,
              recent_activity: activityResult.activity,
            }),
          };
        }
      }

      if (store && proposal.system_version) {
        return applyV1(proposal, work, caller, reviewForApply);
      }

      for (const entry of work) {
        if (proposal.promote_on_apply) {
          if (!entry.variant) {
            db.prepare(
              `UPDATE content_proposal_entries SET status = 'failed', last_error = ? WHERE id = ?`,
            ).run("promote_on_apply requires an attached variant", entry.id);
            continue;
          }
          if (deps.readVariantFingerprint && entry.variant_fingerprint) {
            const fp = deps.readVariantFingerprint({
              contentType: entry.contentType,
              slug: entry.slug,
              locale: entry.locale,
              variant: entry.variant,
            });
            if (fp.error || fp.fingerprint !== entry.variant_fingerprint) {
              db.prepare(
                `UPDATE content_proposal_entries SET status = 'failed', last_error = ? WHERE id = ?`,
              ).run(
                fp.error
                  ? `context_stale: ${fp.error}`
                  : "context_stale: variant file contents changed since the proposal was created",
                entry.id,
              );
              continue;
            }
          }
          if (!deps.promoteEntry) {
            db.prepare(
              `UPDATE content_proposal_entries SET status = 'failed', last_error = ? WHERE id = ?`,
            ).run("promote not configured", entry.id);
            continue;
          }
          const promoted = await deps.promoteEntry(entry, caller.username, {
            confirm_end_experiment: caller.confirm_end_experiment,
          });
          if (!promoted.ok) {
            if (promoted.code === "confirm_end_experiment") {
              return {
                ok: false,
                code: "confirm_end_experiment",
                error: promoted.error ?? "confirm_end_experiment required",
                traffic_siblings: promoted.traffic_siblings,
                proposal,
              };
            }
            db.prepare(
              `UPDATE content_proposal_entries SET status = 'failed', last_error = ? WHERE id = ?`,
            ).run(promoted.error ?? "promote failed", entry.id);
            continue;
          }
          db.prepare(
            `UPDATE content_proposal_entries SET status = 'done', last_error = NULL, applied_at = ?, applied_by = ? WHERE id = ?`,
          ).run(Date.now(), caller.username, entry.id);
          continue;
        }

        // Soft apply (live or into variant)
        if (!entry.ops.length) {
          db.prepare(
            `UPDATE content_proposal_entries SET status = 'done', last_error = NULL, applied_at = ?, applied_by = ? WHERE id = ?`,
          ).run(Date.now(), caller.username, entry.id);
          continue;
        }

        if (entry.baseline_context.creates_entry && !entry.variant) {
          const exNow = resolveExistence({
            contentType: entry.contentType,
            slug: entry.slug,
            locale: entry.locale,
          });
          if (exNow.live !== "exists") {
            const failEntry = (message: string) => {
              db.prepare(
                `UPDATE content_proposal_entries SET status = 'failed', last_error = ? WHERE id = ?`,
              ).run(message, entry.id);
            };
            if (!deps.prepareCreatesEntry) {
              failEntry("create not configured");
              continue;
            }
            let seedFunnel: IdeaFunnel | null = null;
            let seoSeedOps: FieldUpdate[] = [];
            if (proposal.implements_proposal_id) {
              const idea = loadProposal(db, proposal.implements_proposal_id);
              if (idea?.idea_seo_target) {
                const ov = checkSeoTargetOverride(idea, [{ updates: entry.ops }], proposal.seo_target_override);
                if (!ov.ok) {
                  failEntry(`${ov.code}: ${ov.error}`);
                  continue;
                }
                const seed = ideaSeoSeed(idea, entry);
                if (!seed.ok) {
                  failEntry(`${seed.code}: ${seed.error}`);
                  continue;
                }
                seoSeedOps = Object.entries(seed.seo ?? {}).map(
                  ([k, v]) => ({ field_path: `seo.${k}`, value: v }) as FieldUpdate,
                );
              }
              const locked = idea?.idea_funnel ?? null;
              if (locked && ideaFunnelComplete(locked)) {
                const fromOps = funnelFromFieldOps(entry.ops);
                if (fromOps && !ideaFunnelsEqual(fromOps, locked)) {
                  failEntry(
                    `${IDEA_FUNNEL_CONFLICT}: ops funnel does not match the accepted idea's frozen idea_funnel (stage=${locked.stage}).`,
                  );
                  continue;
                }
                if (hasFunnelFieldOps(entry.ops) && !fromOps) {
                  failEntry(
                    `${IDEA_FUNNEL_CONFLICT}: incomplete funnel.* ops — must match the accepted idea's idea_funnel or omit funnel fields to auto-seed.`,
                  );
                  continue;
                }
                if (!fromOps) seedFunnel = locked;
              }
            }
            const prepared = await deps.prepareCreatesEntry(entry, {
              confirmNewValues: caller.confirm_new_values === true,
              author: caller.username,
              ideaFunnel: seedFunnel,
            });
            if (!prepared.ok && prepared.code === "confirm_new_values") {
              return {
                ok: false,
                code: "confirm_new_values",
                error: prepared.error ?? "confirm_new_values required",
                proposal: get(id)!,
              };
            }
            if (!prepared.ok) {
              if (prepared.seeded) deps.discardSeededEntry?.(entry);
              failEntry(prepared.error ?? "create failed");
              continue;
            }
            const appliedCreate = await deps.applyUpdates(
              seoSeedOps.length ? { ...entry, ops: [...seoSeedOps, ...entry.ops] } : entry,
              caller.username,
            );
            if (!appliedCreate.ok) {
              if (prepared.seeded) deps.discardSeededEntry?.(entry);
              failEntry(appliedCreate.error ?? "apply failed");
              continue;
            }
            if (deps.stampPublishedAt) {
              const stamped = deps.stampPublishedAt(entry, caller.username);
              if (!stamped.ok) {
                if (prepared.seeded) deps.discardSeededEntry?.(entry);
                failEntry(stamped.error ?? "published_at stamp failed");
                continue;
              }
            }
            db.prepare(
              `UPDATE content_proposal_entries SET status = 'done', last_error = NULL, applied_at = ?, applied_by = ? WHERE id = ?`,
            ).run(Date.now(), caller.username, entry.id);
            continue;
          }
        }

        // First write for a locked idea funnel without creates_entry auto-seed (e.g. DB types).
        if (proposal.implements_proposal_id && !entry.baseline_context.creates_entry) {
          const idea = loadProposal(db, proposal.implements_proposal_id);
          const locked = idea?.idea_funnel ?? null;
          if (locked && ideaFunnelComplete(locked)) {
            const fromOps = funnelFromFieldOps(entry.ops);
            if (fromOps && !ideaFunnelsEqual(fromOps, locked)) {
              db.prepare(
                `UPDATE content_proposal_entries SET status = 'failed', last_error = ? WHERE id = ?`,
              ).run(
                `${IDEA_FUNNEL_CONFLICT}: ops funnel does not match the accepted idea's frozen idea_funnel.`,
                entry.id,
              );
              continue;
            }
            const liveNow = resolveExistence({
              contentType: entry.contentType,
              slug: entry.slug,
              locale: entry.locale,
              variant: entry.variant,
            });
            if (liveNow.live !== "exists" && (!fromOps || !ideaFunnelsEqual(fromOps, locked))) {
              db.prepare(
                `UPDATE content_proposal_entries SET status = 'failed', last_error = ? WHERE id = ?`,
              ).run(
                `${IDEA_FUNNEL_REQUIRED}: this implements an accepted idea with idea_funnel — include matching funnel.stage + funnel.products ops on the first write.`,
                entry.id,
              );
              continue;
            }
          }
        }

        if (entry.variant && deps.readVariantFingerprint && entry.variant_fingerprint) {
          const fp = deps.readVariantFingerprint({
            contentType: entry.contentType,
            slug: entry.slug,
            locale: entry.locale,
            variant: entry.variant,
          });
          if (fp.error || fp.fingerprint !== entry.variant_fingerprint) {
            db.prepare(
              `UPDATE content_proposal_entries SET status = 'failed', last_error = ? WHERE id = ?`,
            ).run(
              fp.error
                ? `context_stale: ${fp.error}`
                : "context_stale: variant file contents changed since the proposal was created",
              entry.id,
            );
            continue;
          }
        }

        const live = deps.captureBaseline({
          contentType: entry.contentType,
          slug: entry.slug,
          locale: entry.locale,
          variant: entry.variant || undefined,
          updates: entry.ops,
        });
        if (live.error) {
          db.prepare(
            `UPDATE content_proposal_entries SET status = 'failed', last_error = ? WHERE id = ?`,
          ).run(live.error, entry.id);
          continue;
        }
        const stalePaths: string[] = [];
        for (const op of entry.ops) {
          const was = entry.baseline_context.values[op.field_path];
          const nowVal = live.values[op.field_path];
          if (!valuesEqual(was, nowVal)) stalePaths.push(op.field_path);
        }
        if (stalePaths.length) {
          db.prepare(
            `UPDATE content_proposal_entries SET status = 'failed', last_error = ? WHERE id = ?`,
          ).run(`context_stale: ${stalePaths.join(", ")}`, entry.id);
          continue;
        }
        const applied = await deps.applyUpdates(entry, caller.username);
        if (!applied.ok) {
          db.prepare(
            `UPDATE content_proposal_entries SET status = 'failed', last_error = ? WHERE id = ?`,
          ).run(applied.error ?? "apply failed", entry.id);
          continue;
        }
        db.prepare(
          `UPDATE content_proposal_entries SET status = 'done', last_error = NULL, applied_at = ?, applied_by = ? WHERE id = ?`,
        ).run(Date.now(), caller.username, entry.id);
      }
      const updated = get(id)!;
      const next = persistRollup(db, updated, { closedBy: caller.username });
      const fresh = get(id)!;
      emitProposalEvent(site, "proposal_applied_progress", id, caller.username, {
        status: next,
        done: fresh.entries.filter((e) => e.status === "done").length,
        total: fresh.entries.length,
      }, caller.actor);
      if (next === "finished") {
        captureDecisionDebug(proposal, "apply", caller, reviewForApply);
        const released = pageReleasedFollowUp(db, fresh);
        emitProposalEvent(site, "proposal_finished", id, caller.username, waitingIdeasPayload(released), caller.actor);
        if (released) return { ok: true, proposal: fresh, warnings: [released] };
      }
      return { ok: true, proposal: fresh };
    }

    return { ok: false, code: "unknown_action", error: `Unknown action: ${action}` };
  }

  /**
   * One-shot cutover: open/partial proposals without system_version become 1.0.
   * soft → new `draft-p{id6}` with its ops; soft_variant / draft_backed keep their draft
   * (base unknown); ideas / notes only change version. Non-migratable → withdrawn with
   * close_reason legacy_version.
   */
  async function migrateLegacy(opts: { author: string; dry_run?: boolean }): Promise<LegacyMigrationReport> {
    const db = dbFor(site);
    const report: LegacyMigrationReport = { migrated: [], closed: [], touched_entry_dirs: [] };
    if (!store) throw new Error("migrateLegacy requires a draft store");
    const ids = (
      db
        .prepare(
          `SELECT id FROM content_proposals
           WHERE site = ? AND system_version IS NULL AND status IN ('open', 'partial')
           ORDER BY created_at ASC`,
        )
        .all(site) as Array<{ id: string }>
    ).map((r) => r.id);
    const touched = new Set<string>();
    const nowIso = () => new Date().toISOString();

    const closeLegacy = (p: ProposalRecord, reason: string) => {
      report.closed.push({ id: p.id, kind: p.kind, reason });
      if (opts.dry_run) return;
      const now = Date.now();
      db.prepare(
        `UPDATE content_proposals
         SET status = 'withdrawn', claim_json = NULL, updated_at = ?,
             close_reason = 'legacy_version', close_note = ?, closed_by = ?, closed_at = ?
         WHERE id = ?`,
      ).run(now, `Not migrated to proposals 1.0: ${reason}`, opts.author, now, p.id);
      emitProposalEvent(site, "proposal_withdrawn", p.id, opts.author, {
        close_reason: "legacy_version",
        reason,
      });
    };
    const markMigrated = (p: ProposalRecord, detail: Record<string, unknown>) => {
      db.prepare(`UPDATE content_proposals SET system_version = ?, updated_at = ? WHERE id = ?`).run(
        PROPOSAL_SYSTEM_VERSION,
        Date.now(),
        p.id,
      );
      emitProposalEvent(site, "proposal_migrated_v1", p.id, opts.author, { kind: p.kind, ...detail });
    };

    for (const id of ids) {
      const p = loadProposal(db, id);
      if (!p) continue;
      if (p.kind !== "edits") {
        report.migrated.push({ id, kind: p.kind, entries: [] });
        if (!opts.dry_run) markMigrated(p, {});
        continue;
      }
      const work = p.entries.filter((e) => e.status === "pending" || e.status === "failed");
      const groups = new Map<string, { rows: ProposalEntryRow[]; updates: FieldUpdate[] }>();
      for (const e of work) {
        const k = `${attachedCreateKey(e.contentType, e.slug, e.locale)}\0${e.variant ?? ""}`;
        const g = groups.get(k) ?? { rows: [], updates: [] };
        g.rows.push(e);
        g.updates.push(...(e.ops ?? []));
        groups.set(k, g);
      }
      let blocker: string | null = null;
      const newEntryKeys = new Set<string>();
      const inputs: Array<ProposalEntryInput & { updates: FieldUpdate[] }> = [];
      const inputGroups: Array<{ rows: ProposalEntryRow[]; updates: FieldUpdate[] }> = [];
      for (const g of Array.from(groups.values())) {
        const first = g.rows[0]!;
        const where = `${first.contentType}/${first.slug} (${first.locale})`;
        const createsEntry = first.baseline_context?.creates_entry === true && !first.variant;
        if (first.variant) {
          if (!store.exists(refOf(first))) {
            blocker = `draft ${first.variant} of ${where} no longer exists`;
            break;
          }
        } else if (createsEntry) {
          if (!store.entryExists(first.contentType, first.slug)) newEntryKeys.add(attachedCreateKey(first.contentType, first.slug, first.locale));
        } else if (!store.liveExists(first)) {
          blocker = `target_missing: ${where} is not published anymore`;
          break;
        }
        const variant =
          first.variant?.trim() || store.pickVariant(first, p.id, { ownName: true });
        const writeOps = first.variant ? !p.promote_on_apply : true;
        inputGroups.push(g);
        inputs.push({
          contentType: first.contentType,
          slug: first.slug,
          locale: first.locale,
          variant,
          updates: writeOps ? g.updates : [],
        });
      }
      if (blocker) {
        closeLegacy(p, blocker);
        continue;
      }
      if (opts.dry_run) {
        report.migrated.push({
          id,
          kind: p.kind,
          entries: inputs.map((i) => ({ entry_key: makeEntryKey(i.contentType, i.slug), locale: i.locale, variant: i.variant! })),
        });
        continue;
      }
      const prepared = await prepareV1Drafts({
        proposalId: p.id,
        entries: inputs,
        author: opts.author,
        newEntryKeys,
        ideaFunnel: null,
      });
      if (!prepared.ok) {
        closeLegacy(p, `${prepared.code}: ${prepared.error}`);
        continue;
      }
      const stale: Array<{ entry_key: string; locale: string; fields: string[] }> = [];
      const out: LegacyMigrationReport["migrated"][number]["entries"] = [];
      db.transaction(() => {
        prepared.plans.forEach((plan, i) => {
          const g = inputGroups[i]!;
          const [keep, ...drop] = g.rows;
          db.prepare(
            `UPDATE content_proposal_entries
             SET variant = ?, created_draft = ?, variant_fingerprint = ?, ops_json = ?,
                 baseline_context_json = ?, status = 'pending', last_error = NULL
             WHERE id = ?`,
          ).run(
            plan.ref.variant,
            plan.created ? 1 : 0,
            plan.fingerprint,
            JSON.stringify(g.updates),
            JSON.stringify({ values: {} }),
            keep!.id,
          );
          for (const d of drop) db.prepare(`DELETE FROM content_proposal_entries WHERE id = ?`).run(d.id);
          const diff = store.authorDiff(plan.ref);
          const changedFields: string[] = [];
          for (const u of g.updates) {
            const baseline = keep!.baseline_context?.values ?? {};
            if (!(u.field_path in baseline)) continue;
            const change = diff?.changes.find((c) => c.field_path === u.field_path);
            const liveNow = change ? change.before : u.value;
            if (JSON.stringify(liveNow) !== JSON.stringify(baseline[u.field_path])) changedFields.push(u.field_path);
          }
          if (changedFields.length) stale.push({ entry_key: keep!.entry_key, locale: plan.ref.locale, fields: changedFields });
          out.push({ entry_key: keep!.entry_key, locale: plan.ref.locale, variant: plan.ref.variant, created_draft: plan.created });
          touched.add(path.relative(process.cwd(), path.dirname(store.pathOf(plan.ref))));
        });
        markMigrated(p, { entries: out });
      })();
      for (const plan of prepared.plans) store.link(plan.ref, linkFor(p.id, plan.created, plan.fingerprint), opts.author);
      if (stale.length) {
        db.prepare(`UPDATE content_proposals SET stale_since = ? WHERE id = ?`).run(nowIso(), p.id);
        emitProposalEvent(site, "proposal_needs_author", p.id, opts.author, {
          reason: "context_stale",
          migrated: true,
          entries: stale,
        });
      }
      report.migrated.push({ id, kind: p.kind, entries: out, ...(stale.length ? { stale } : {}) });
    }
    report.touched_entry_dirs = Array.from(touched).sort();
    return report;
  }

  /**
   * "Revert this proposal": a new v1.0 proposal (reverts_proposal_id) whose draft puts back
   * the values from before the apply. Fields changed on live since then are conflicts and
   * are left out. Never writes live; the revert follows four-eyes like any proposal.
   */
  async function revertProposal(proposal: ProposalRecord, caller: ProposalUpdateCaller) {
    if (!store || !proposal.system_version) {
      return { ok: false as const, code: "legacy_version", error: "Only proposals v1.0 record what they published, so only they can be reverted." };
    }
    if (proposal.kind !== "edits" || (proposal.status !== "finished" && proposal.status !== "partial")) {
      return { ok: false as const, code: "not_applied", error: "Only applied (finished or partial) edits proposals can be reverted.", proposal };
    }
    const conflicts: RevertConflict[] = [];
    const entries: ProposalEntryInput[] = [];
    for (const e of proposal.entries) {
      if (e.status !== "done" || !e.published_diff?.length) continue;
      const updates: FieldUpdate[] = [];
      for (const c of e.published_diff) {
        const now = store.liveValue(e, c.field_path);
        if (!sameValue(now, c.after)) {
          conflicts.push({ entry_key: e.entry_key, locale: e.locale, field_path: c.field_path, published: c.after, live: now });
          continue;
        }
        updates.push(
          c.before === undefined
            ? { field_path: c.field_path, op: "remove", reset: true }
            : { field_path: c.field_path, value: c.before },
        );
      }
      if (updates.length) entries.push({ contentType: e.contentType, slug: e.slug, locale: e.locale, updates });
    }
    if (!entries.length) {
      return {
        ok: false as const,
        code: conflicts.length ? "revert_conflicts" : "nothing_to_revert",
        error: conflicts.length
          ? "Every field this proposal published was changed again on live since, so there is nothing safe to put back."
          : "This proposal has no recorded published changes to revert.",
        proposal,
        ...(conflicts.length ? { conflicting_fields: conflicts } : {}),
      };
    }
    const created = await create(
      {
        category: proposal.category,
        title: `Revert: ${proposal.title}`.slice(0, 200),
        summary: `Puts back the values that were live before proposal ${proposal.id} was applied (${proposal.title}). Fields changed on live since that apply are left out.`,
        rationale: caller.body?.trim() || undefined,
        entries,
        reverts_proposal_id: proposal.id,
        agent_session_id: caller.agent_session_id,
      },
      { username: caller.username, actor: caller.actor },
    );
    if (!created.ok) return { ...created, ok: false as const };
    emitProposalEvent(site, "proposal_reverted", proposal.id, caller.username, {
      revert_proposal_id: created.proposal.id,
      conflicting_fields: conflicts.length,
    }, caller.actor);
    return {
      ok: true as const,
      proposal: created.proposal,
      reverted_from: proposal.id,
      ...(conflicts.length ? { conflicting_fields: conflicts } : {}),
      ...(created.warnings?.length ? { warnings: created.warnings } : {}),
    };
  }

  /**
   * Daily: flag v1.0 proposals whose drafts fell behind live / their translation source.
   * 10 days stale without activity → proposal_stale_flagged; 30 → closed abandoned_stale
   * (drafts the proposal created are deleted; pre-existing drafts are only unlinked).
   */
  async function staleSweep(opts: { author?: string; now?: number } = {}): Promise<StaleSweepReport> {
    const report: StaleSweepReport = { checked: 0, marked: [], cleared: [], flagged: [], closed: [] };
    if (!store) return report;
    const db = dbFor(site);
    const now = opts.now ?? Date.now();
    const author = opts.author ?? "system:proposal-stale-sweep";
    const ids = (
      db
        .prepare(
          `SELECT id FROM content_proposals
           WHERE site = ? AND system_version IS NOT NULL AND kind = 'edits' AND status IN ('open', 'partial')`,
        )
        .all(site) as Array<{ id: string }>
    ).map((r) => r.id);
    for (const id of ids) {
      const p = loadProposal(db, id);
      if (!p) continue;
      report.checked++;
      const work = p.entries.filter((e) => e.variant && (e.status === "pending" || e.status === "failed"));
      const drifted = work.filter((e) => {
        const ref = refOf(e);
        return !store.exists(ref) || store.checkBase(ref).status === "stale" || store.checkSource(ref).status === "changed";
      });
      if (drifted.length && !p.stale_since) {
        markStale(id, "drift", { entries: drifted.map((e) => ({ entry_key: e.entry_key, locale: e.locale })) }, author);
        report.marked.push(id);
        continue;
      }
      if (!drifted.length && p.stale_since) {
        clearStale(id);
        report.cleared.push(id);
        continue;
      }
      if (!p.stale_since) continue;
      const lastActivity = Math.max(
        Date.parse(p.stale_since) || 0,
        p.updated_at || 0,
        p.author_content_at ?? 0,
        p.reviewer_action_at ?? 0,
      );
      const idle = now - lastActivity;
      if (idle >= STALE_CLOSE_DAYS * DAY_MS) {
        db.prepare(
          `UPDATE content_proposals
           SET status = 'withdrawn', claim_json = NULL, updated_at = ?,
               close_reason = 'abandoned_stale', close_note = ?, closed_by = ?, closed_at = ?
           WHERE id = ?`,
        ).run(
          now,
          `Closed automatically: the draft was out of date for ${STALE_CLOSE_DAYS} days without activity.`,
          author,
          now,
          id,
        );
        const released = await releaseV1Drafts(id, p.entries, author);
        emitProposalEvent(site, "proposal_closed_abandoned_stale", id, author, {
          stale_since: p.stale_since,
          drafts: released.map((r) => r.code),
        });
        blockDependentsOnClose(db, { ...p, status: "withdrawn" }, now);
        report.closed.push(id);
      } else if (idle >= STALE_FLAG_DAYS * DAY_MS && !p.stale_flagged_at) {
        db.prepare(`UPDATE content_proposals SET stale_flagged_at = ? WHERE id = ?`).run(new Date(now).toISOString(), id);
        emitProposalEvent(site, "proposal_stale_flagged", id, author, {
          stale_since: p.stale_since,
          closes_at: new Date(lastActivity + STALE_CLOSE_DAYS * DAY_MS).toISOString(),
        });
        report.flagged.push(id);
      }
    }
    return report;
  }

  /**
   * Daily: open|partial proposals (any kind) with open blockers and no real work.
   * Activity = newest open blocker, author rewrite / author-marked fix, reviewer action.
   * Claim / release do not count. BLOCKED_FLAG_DAYS idle → proposal_blocked_flagged;
   * BLOCKED_CLOSE_DAYS → withdrawn abandoned_blocked (no prior flag required).
   * Escalated rows are skipped; rows with zero open blockers only get their flag cleared.
   */
  async function blockedSweep(opts: { author?: string; now?: number } = {}): Promise<BlockedSweepReport> {
    const report: BlockedSweepReport = { checked: 0, flagged: [], cleared: [], closed: [] };
    const db = dbFor(site);
    const now = opts.now ?? Date.now();
    const author = opts.author ?? "system:proposal-blocked-sweep";
    const ids = (
      db
        .prepare(
          `SELECT p.id FROM content_proposals p
           WHERE p.site = ? AND p.status IN ('open', 'partial')
             AND (p.blocked_flagged_at IS NOT NULL OR EXISTS (
               SELECT 1 FROM content_proposal_blockers b WHERE b.proposal_id = p.id AND b.status = 'open'
             ))`,
        )
        .all(site) as Array<{ id: string }>
    ).map((r) => r.id);
    const clearFlag = db.prepare(`UPDATE content_proposals SET blocked_flagged_at = NULL WHERE id = ?`);
    for (const id of ids) {
      const p = loadProposal(db, id);
      if (!p || (p.status !== "open" && p.status !== "partial")) continue;
      if (p.escalated) continue;
      report.checked++;
      const openBlockers = p.blockers.filter((b) => b.status === "open");
      if (!openBlockers.length) {
        if (p.blocked_flagged_at) {
          clearFlag.run(id);
          report.cleared.push(id);
        }
        continue;
      }
      const lastActivity = Math.max(
        ...openBlockers.map((b) => b.created_at || 0),
        p.author_content_at ?? 0,
        p.reviewer_action_at ?? 0,
      );
      let flaggedAt = p.blocked_flagged_at;
      if (flaggedAt && lastActivity > (Date.parse(flaggedAt) || 0)) {
        clearFlag.run(id);
        report.cleared.push(id);
        flaggedAt = null;
      }
      const idle = now - lastActivity;
      if (idle >= BLOCKED_CLOSE_DAYS * DAY_MS) {
        const note =
          `Closed automatically: change requests stayed open for ${BLOCKED_CLOSE_DAYS} days without activity.` +
          (p.status === "partial" ? " Pages already published stay live; only pending pages were dropped." : "");
        db.prepare(
          `UPDATE content_proposals
           SET status = 'withdrawn', claim_json = NULL, updated_at = ?,
               close_reason = 'abandoned_blocked', close_note = ?, closed_by = ?, closed_at = ?
           WHERE id = ?`,
        ).run(now, note, author, now, id);
        const released = p.system_version ? await releaseV1Drafts(id, p.entries, author) : [];
        emitProposalEvent(site, "proposal_closed_abandoned_blocked", id, author, {
          open_blocker_count: openBlockers.length,
          last_activity_at: new Date(lastActivity).toISOString(),
          was_partial: p.status === "partial",
          drafts: released.map((r) => r.code),
        });
        blockDependentsOnClose(db, { ...p, status: "withdrawn" }, now);
        report.closed.push(id);
      } else if (idle >= BLOCKED_FLAG_DAYS * DAY_MS && !flaggedAt) {
        db.prepare(`UPDATE content_proposals SET blocked_flagged_at = ? WHERE id = ?`).run(
          new Date(now).toISOString(),
          id,
        );
        emitProposalEvent(site, "proposal_blocked_flagged", id, author, {
          open_blocker_count: openBlockers.length,
          last_activity_at: new Date(lastActivity).toISOString(),
          closes_at: new Date(lastActivity + BLOCKED_CLOSE_DAYS * DAY_MS).toISOString(),
        });
        report.flagged.push(id);
      }
    }
    return report;
  }

  /**
   * Daily: open|partial dependents whose applies_after predecessor finished more than
   * DEPENDENT_OVERDUE_HOURS ago → dependent_overdue_flagged_at + proposal_dependent_overdue.
   * Flag only: never escalates (that pauses agents) and never closes (the hub would lose the link).
   */
  function dependentOverdueSweep(opts: { author?: string; now?: number } = {}): DependentOverdueSweepReport {
    const report: DependentOverdueSweepReport = { checked: 0, flagged: [], cleared: [] };
    const db = dbFor(site);
    const now = opts.now ?? Date.now();
    const author = opts.author ?? "system:proposal-dependent-overdue";
    const thresholdMs = DEPENDENT_OVERDUE_HOURS * 60 * 60 * 1000;
    let rows: Array<{
      id: string;
      status: ProposalStatus;
      dependent_overdue_flagged_at: string | null;
      pred_id: string | null;
      pred_status: ProposalStatus | null;
      pred_closed_at: number | null;
      pred_updated_at: number | null;
    }> = [];
    try {
      rows = db
        .prepare(
          `SELECT p.id, p.status, p.dependent_overdue_flagged_at,
                  q.id AS pred_id, q.status AS pred_status, q.closed_at AS pred_closed_at, q.updated_at AS pred_updated_at
           FROM content_proposals p
           LEFT JOIN content_proposals q ON q.id = p.applies_after_proposal_id
           WHERE p.site = ? AND (p.applies_after_proposal_id IS NOT NULL OR p.dependent_overdue_flagged_at IS NOT NULL)`,
        )
        .all(site) as typeof rows;
    } catch {
      return report;
    }
    const clear = db.prepare(`UPDATE content_proposals SET dependent_overdue_flagged_at = NULL WHERE id = ?`);
    for (const row of rows) {
      const open = row.status === "open" || row.status === "partial";
      const predDone = row.pred_status === "finished";
      if (!open || !predDone) {
        if (row.dependent_overdue_flagged_at) {
          clear.run(row.id);
          report.cleared.push(row.id);
        }
        continue;
      }
      report.checked++;
      if (row.dependent_overdue_flagged_at) continue;
      const appliedAt = row.pred_closed_at ?? row.pred_updated_at ?? now;
      if (now - appliedAt < thresholdMs) continue;
      db.prepare(`UPDATE content_proposals SET dependent_overdue_flagged_at = ? WHERE id = ?`).run(
        new Date(now).toISOString(),
        row.id,
      );
      emitProposalEvent(site, "proposal_dependent_overdue", row.id, author, {
        predecessor_id: row.pred_id,
        predecessor_applied_at: new Date(appliedAt).toISOString(),
        overdue_hours: DEPENDENT_OVERDUE_HOURS,
      });
      report.flagged.push(row.id);
    }
    return report;
  }

  /**
   * Daily link check (live server only — production owns every proposal): a draft whose
   * `_draft.proposal` is missing or closed in this database gets orphan_since; after 7 days the
   * link is removed (the draft is deleted only when the proposal created it and nobody edited it).
   */
  async function verifyDraftLinks(opts: {
    author?: string;
    now?: number;
  } = {}): Promise<LinkCheckReport> {
    const report: LinkCheckReport = { checked: 0, orphaned: [], cleaned: [], unverified: [], restored: [] };
    if (!store) return report;
    const db = dbFor(site);
    const now = opts.now ?? Date.now();
    const iso = new Date(now).toISOString();
    const author = opts.author ?? "system:draft-link-check";
    for (const { ref, link } of store.listLinkedDrafts()) {
      report.checked++;
      const where = `${ref.contentType}/${ref.slug} ${ref.variant}.${ref.locale}`;
      const local = loadProposal(db, link.id);
      const status: "open" | "closed" =
        local && (local.status === "open" || local.status === "partial") ? "open" : "closed";

      if (status === "open") {
        if (link.orphan_since || link.unverified_since) {
          const { orphan_since: _o, unverified_since: _u, ...clean } = link;
          store.link(ref, clean, author);
          report.restored.push(where);
        }
        continue;
      }
      if (!link.orphan_since) {
        const { unverified_since: _u, ...rest } = link;
        store.link(ref, { ...rest, orphan_since: iso }, author);
        report.orphaned.push(where);
        continue;
      }
      if (now - (Date.parse(link.orphan_since) || now) < ORPHAN_CLEANUP_DAYS * DAY_MS) continue;
      const untouched = link.created_by_proposal === true && !!link.created_fingerprint && store.fingerprint(ref) === link.created_fingerprint;
      if (untouched) await store.remove(ref, author);
      else store.link(ref, null, author);
      emitProposalEvent(site, "draft_orphan_cleaned", link.id, author, {
        ...ref,
        env: link.env,
        orphan_since: link.orphan_since,
        draft_deleted: untouched,
      });
      report.cleaned.push({ draft: where, deleted: untouched });
    }
    return report;
  }

  function deletion(id: string): ProposalDeletion | null {
    return findProposalDeletion(dbFor(site), site, id);
  }

  /** Referenced proposal ids (implements / supersedes / replaced_by / reverts) that no longer exist. */
  function referencedProposals(p: ProposalRecord): {
    missing: string[];
    byId: Record<string, ReferencedProposalSummary>;
  } {
    const refs = Array.from(
      new Set(
        [
          p.implements_proposal_id,
          p.supersedes_proposal_id,
          p.replaced_by_proposal_id,
          p.reverts_proposal_id,
        ].filter((v): v is string => typeof v === "string" && v.length > 0),
      ),
    );
    if (!refs.length) return { missing: [], byId: {} };
    const db = dbFor(site);
    const rows = db
      .prepare(
        `SELECT id, title, summary, status, kind FROM content_proposals WHERE site = ? AND id IN (${refs.map(() => "?").join(",")})`,
      )
      .all(site, ...refs) as Array<{ id: string } & ReferencedProposalSummary>;
    const byId: Record<string, ReferencedProposalSummary> = {};
    for (const r of rows) {
      byId[r.id] = { title: r.title, summary: r.summary, status: r.status, kind: r.kind };
    }
    return { missing: refs.filter((id) => !byId[id]), byId };
  }

  async function deleteProposals(
    ids: string[],
    caller: { username: string; actor?: EventActor },
  ): Promise<{ results: ProposalDeleteResult[] }> {
    const db = dbFor(site);
    const selected = new Set(ids);
    const results: ProposalDeleteResult[] = [];
    for (const id of Array.from(selected)) {
      const empty = { drafts_removed: [], drafts_unlinked: [], drafts_kept: [] };
      const row = db
        .prepare(`SELECT * FROM content_proposals WHERE id = ? AND site = ?`)
        .get(id, site) as ProposalRow | undefined;
      if (!row) {
        results.push({ id, status: "not_found", reason: "Proposal not found", ...empty });
        continue;
      }
      if (row.kind === "idea") {
        const dependents = (
          db
            .prepare(
              `SELECT id, title FROM content_proposals
               WHERE site = ? AND implements_proposal_id = ? AND status IN ('open', 'partial')`,
            )
            .all(site, id) as Array<{ id: string; title: string }>
        ).filter((d) => !selected.has(d.id));
        if (dependents.length) {
          results.push({
            id,
            status: "blocked_dependents",
            reason: `${dependents.length} open proposal(s) implement this idea. Select them too to delete the idea.`,
            dependents,
            ...empty,
          });
          continue;
        }
      }

      const snapshot = exportProposalRow(db, row);
      const removed: string[] = [];
      const unlinked: string[] = [];
      const kept: string[] = [];
      try {
        const released = await releaseV1Drafts(id, snapshot.entries, caller.username, {
          forDelete: { keepCreated: hasPersonCoAuthor(snapshot.co_authors) },
        });
        for (const r of released) {
          if (!r.path) continue;
          if (r.code === "draft_deleted") removed.push(r.path);
          else if (r.code === "draft_kept") unlinked.push(r.path);
          else if (r.code === "draft_kept_co_authors") kept.push(r.path);
        }
      } catch (err) {
        results.push({
          id,
          status: "error",
          reason: `Could not remove a draft: ${err instanceof Error ? err.message : String(err)}`,
          drafts_removed: removed,
          drafts_unlinked: unlinked,
          drafts_kept: kept,
        });
        continue;
      }

      db.transaction(() => {
        db.prepare(`DELETE FROM content_proposal_blockers WHERE proposal_id = ?`).run(id);
        db.prepare(`DELETE FROM content_proposal_entries WHERE proposal_id = ?`).run(id);
        db.prepare(`DELETE FROM content_proposals WHERE id = ?`).run(id);
      })();
      emitProposalEvent(
        site,
        "proposal_deleted",
        id,
        caller.username,
        {
          title: snapshot.title,
          kind: snapshot.kind,
          status: snapshot.status,
          drafts_removed: removed,
          drafts_unlinked: unlinked,
          drafts_kept: kept,
          snapshot,
        },
        caller.actor,
      );
      results.push({
        id,
        status: "deleted",
        drafts_removed: removed,
        drafts_unlinked: unlinked,
        drafts_kept: kept,
      });
    }
    return { results };
  }

  return {
    get,
    deletion,
    deleteProposals,
    referencedProposals,
    migrateLegacy,
    staleSweep,
    blockedSweep,
    dependentOverdueSweep,
    verifyDraftLinks,
    list,
    stats,
    kpiHistory,
    listRecentProposers,
    listRecentReviewers,
    exportAll,
    create,
    update,
    classifyLive,
    contentTypeStrategiesFor,
  };
}

export type RevertConflict = {
  entry_key: string;
  locale: string;
  field_path: string;
  /** What the reverted proposal published. */
  published: unknown;
  /** What live shows today. */
  live: unknown;
};

export const STALE_FLAG_DAYS = 10;
export const STALE_CLOSE_DAYS = 30;
export const BLOCKED_FLAG_DAYS = 10;
export const BLOCKED_CLOSE_DAYS = 30;
export const ORPHAN_CLEANUP_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export type StaleSweepReport = {
  checked: number;
  marked: string[];
  cleared: string[];
  flagged: string[];
  closed: string[];
};

export type BlockedSweepReport = {
  checked: number;
  flagged: string[];
  cleared: string[];
  closed: string[];
};

/** Hours after the predecessor is applied before an open dependent is flagged overdue. */
export const DEPENDENT_OVERDUE_HOURS = 48;

export type DependentOverdueSweepReport = {
  checked: number;
  flagged: string[];
  cleared: string[];
};

export type LinkCheckReport = {
  checked: number;
  orphaned: string[];
  cleaned: Array<{ draft: string; deleted: boolean }>;
  unverified: string[];
  restored: string[];
};

export type LegacyMigrationReport = {
  migrated: Array<{
    id: string;
    kind: ProposalKind;
    entries: Array<{ entry_key: string; locale: string; variant: string; created_draft?: boolean }>;
    stale?: Array<{ entry_key: string; locale: string; fields: string[] }>;
  }>;
  closed: Array<{ id: string; kind: ProposalKind; reason: string }>;
  /** Entry folders (relative to cwd) whose drafts / versioning.yml changed — push these. */
  touched_entry_dirs: string[];
};

/** Full site dump for production → local pull (includes entries + blockers). */
export function exportAllProposals(site: string): ProposalRecord[] {
  const db = dbFor(site);
  const rows = db
    .prepare(`SELECT * FROM content_proposals WHERE site = ? ORDER BY updated_at DESC, id ASC`)
    .all(site) as ProposalRow[];
  return rows.map((r) => exportProposalRow(db, r));
}

function syncAutoincrement(db: Database.Database, table: string): void {
  const row = db.prepare(`SELECT MAX(id) AS m FROM ${table}`).get() as { m: number | null };
  const max = Number(row?.m) || 0;
  try {
    if (max <= 0) {
      db.prepare(`DELETE FROM sqlite_sequence WHERE name = ?`).run(table);
      return;
    }
    const existing = db
      .prepare(`SELECT seq FROM sqlite_sequence WHERE name = ?`)
      .get(table) as { seq: number } | undefined;
    if (existing) {
      db.prepare(`UPDATE sqlite_sequence SET seq = ? WHERE name = ?`).run(max, table);
    } else {
      db.prepare(`INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)`).run(table, max);
    }
  } catch {
    /* sqlite_sequence may be absent until first AUTOINCREMENT write */
  }
}

/**
 * Dev-only helper: wipe this site's proposals and insert a production snapshot.
 * Remaps `site` to the local content root; preserves proposal / entry / blocker ids.
 */
export function replaceProposalsFromSnapshot(site: string, proposals: ProposalRecord[]): number {
  const db = dbFor(site);
  const insertProposal = db.prepare(
    `INSERT INTO content_proposals (
      id, site, fingerprint, status, kind, category, title, summary, rationale,
      documentation_json, related_issue_ids_json, proposer_username, proposer_actor_json,
      created_at, updated_at, claim_json, tags_json, search_text,
      created_agent_session_id, promote_on_apply, no_auto_retry,
      close_reason, close_note, closed_by, closed_at, related_entries_json,
      review_context_snapshot_json, supersedes_proposal_id, replaced_by_proposal_id,
      escalated, escalated_at, escalated_by, escalated_note, decision_debug_json,
      review_situations_json, accepted_entry_json, implements_proposal_id,
      author_content_at, reviewer_action_at, idea_funnel_json,
      outcome_review, outcome_review_note, outcome_review_expected, outcome_review_at,
      outcome_review_by, outcome_review_history_json, outcome_lesson_captured_at,
      outcome_lesson_captured_by, outcome_lesson_note,
      reviewer_action_by, reviewer_action_by_actor_json,
      system_version, co_authors_json, all_or_nothing, reverts_proposal_id,
      stale_since, stale_flagged_at, idea_seo_target_json, seo_target_override_json,
      blocked_flagged_at, applies_after_proposal_id, dependent_overdue_flagged_at,
      url_slug_override_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const insertEntry = db.prepare(
    `INSERT INTO content_proposal_entries (
      id, proposal_id, entry_key, locale, variant, status, ops_json, baseline_context_json,
      last_error, applied_at, applied_by, variant_fingerprint,
      created_draft, derived_ops_json, published_diff_json, pre_apply_snapshot_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const insertBlocker = db.prepare(
    `INSERT INTO content_proposal_blockers (
      id, proposal_id, kind, body, staff_summary, status, author, created_at, resolved_at, resolved_by,
      resolve_note, agent_session_id, author_actor_json, resolved_by_actor_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );

  const run = db.transaction((rows: ProposalRecord[]) => {
    db.prepare(
      `DELETE FROM content_proposal_blockers
       WHERE proposal_id IN (SELECT id FROM content_proposals WHERE site = ?)`,
    ).run(site);
    db.prepare(
      `DELETE FROM content_proposal_entries
       WHERE proposal_id IN (SELECT id FROM content_proposals WHERE site = ?)`,
    ).run(site);
    db.prepare(`DELETE FROM content_proposals WHERE site = ?`).run(site);

    for (const p of rows) {
      insertProposal.run(
        p.id,
        site,
        p.fingerprint,
        p.status,
        p.kind,
        p.category,
        p.title,
        p.summary,
        p.rationale,
        JSON.stringify(p.documentation ?? {}),
        JSON.stringify(p.related_issue_ids ?? []),
        p.proposer_username,
        JSON.stringify(p.proposer_actor ?? {}),
        p.created_at,
        p.updated_at,
        p.claim ? JSON.stringify(p.claim) : null,
        JSON.stringify(p.tags ?? []),
        p.search_text ?? "",
        p.created_agent_session_id ?? null,
        p.promote_on_apply ? 1 : 0,
        p.no_auto_retry ? 1 : 0,
        p.close_reason ?? null,
        p.close_note ?? null,
        p.closed_by ?? null,
        p.closed_at ?? null,
        JSON.stringify(p.related_entries ?? []),
        p.review_context_snapshot ? JSON.stringify(p.review_context_snapshot) : null,
        p.supersedes_proposal_id ?? null,
        p.replaced_by_proposal_id ?? null,
        p.escalated ? 1 : 0,
        p.escalated_at ?? null,
        p.escalated_by ?? null,
        p.escalated_note ?? null,
        p.decision_debug ? JSON.stringify(p.decision_debug) : null,
        JSON.stringify(p.review_situations ?? []),
        p.accepted_entry ? JSON.stringify(p.accepted_entry) : null,
        p.implements_proposal_id ?? null,
        p.author_content_at ?? null,
        p.reviewer_action_at ?? null,
        p.idea_funnel ? JSON.stringify(p.idea_funnel) : null,
        p.outcome_review ?? null,
        p.outcome_review_note ?? null,
        p.outcome_review_expected ?? null,
        p.outcome_review_at ?? null,
        p.outcome_review_by ?? null,
        JSON.stringify(p.outcome_review_history ?? []),
        p.outcome_lesson_captured_at ?? null,
        p.outcome_lesson_captured_by ?? null,
        p.outcome_lesson_note ?? null,
        p.reviewer_action_by ?? null,
        p.reviewer_action_by ? JSON.stringify(p.reviewer_action_by_actor ?? {}) : null,
        p.system_version ?? null,
        JSON.stringify(p.co_authors ?? []),
        p.all_or_nothing ? 1 : 0,
        p.reverts_proposal_id ?? null,
        p.stale_since ?? null,
        p.stale_flagged_at ?? null,
        p.idea_seo_target ? JSON.stringify(p.idea_seo_target) : null,
        p.seo_target_override ? JSON.stringify(p.seo_target_override) : null,
        p.blocked_flagged_at ?? null,
        p.applies_after_proposal_id ?? null,
        p.dependent_overdue_flagged_at ?? null,
        p.url_slug_override ? JSON.stringify(p.url_slug_override) : null,
      );
      for (const e of p.entries ?? []) {
        insertEntry.run(
          e.id,
          p.id,
          e.entry_key || makeEntryKey(e.contentType, e.slug),
          e.locale,
          e.variant ?? null,
          e.status,
          JSON.stringify((p.system_version ? e.requested_ops : undefined) ?? e.ops ?? []),
          JSON.stringify(e.baseline_context ?? { values: {} }),
          e.last_error ?? null,
          e.applied_at ?? null,
          e.applied_by ?? null,
          e.variant_fingerprint ?? null,
          e.created_draft ? 1 : 0,
          null,
          e.published_diff ? JSON.stringify(e.published_diff) : null,
          e.pre_apply_snapshot ? JSON.stringify(e.pre_apply_snapshot) : null,
        );
      }
      for (const b of p.blockers ?? []) {
        insertBlocker.run(
          b.id,
          p.id,
          b.kind || "blocker",
          b.body,
          b.staff_summary ?? null,
          b.status,
          b.author,
          b.created_at,
          b.resolved_at ?? null,
          b.resolved_by ?? null,
          b.resolve_note ?? null,
          b.agent_session_id ?? null,
          blockerActorColumn(b.author_actor),
          blockerActorColumn(b.resolved_by_actor),
        );
      }
    }

    syncAutoincrement(db, "content_proposal_entries");
    syncAutoincrement(db, "content_proposal_blockers");
    return rows.length;
  });

  const n = run(proposals);
  invalidateKpiCache(site);
  return n;
}

function inferCategory(entries: ProposalEntryInput[]): ProposalCategory {
  const seo = entries.some((e) =>
    (e.updates ?? []).some((u) => u.field_path.startsWith("meta.") || u.field_path.startsWith("seo.")),
  );
  return seo ? "content.seo" : "content.field";
}

export function captureBaselineFromSite(ctx: SiteContext, entry: ProposalEntryInput): {
  values: Record<string, unknown>;
  error?: string;
} {
  const loaded = getContentForEdit(
    entry.contentType,
    entry.slug,
    entry.locale,
    entry.variant,
    undefined,
    ctx.contentIndex,
  );
  if (!loaded.content) {
    return { values: {}, error: loaded.error || "Content not found" };
  }
  const values: Record<string, unknown> = {};
  for (const u of entry.updates ?? []) {
    const read = readFieldValueAtPath({
      contentType: entry.contentType,
      slug: entry.slug,
      locale: entry.locale,
      variant: entry.variant,
      field_path: u.field_path,
      contentRoot: ctx.contentRoot,
      ci: ctx.contentIndex,
    });
    values[u.field_path] = read.value;
  }
  return { values };
}

export function readVariantFingerprintFromSite(
  ctx: SiteContext,
  entry: { contentType: string; slug: string; locale: string; variant: string },
): { fingerprint: string; error?: string } {
  const resolved = resolveWritableVersioningTarget(entry.contentType, entry.slug, ctx.contentRoot);
  if (!resolved.ok) {
    return { fingerprint: "", error: resolved.error };
  }
  const filePath = ctx.versioningManager.getVariantFilePath(
    entry.contentType,
    resolved.slug,
    entry.variant,
    entry.locale,
  );
  if (!fs.existsSync(filePath)) {
    return { fingerprint: "", error: "Variant file not found" };
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  return { fingerprint: hashVariantFileContents(raw) };
}

export async function applyUpdatesOnSite(
  ctx: SiteContext,
  entry: ProposalEntryRow,
  author: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!entry.ops.length) return { ok: true };
  const result = await applyFieldUpdates({
    contentType: entry.contentType,
    slug: entry.slug,
    locale: entry.locale,
    variant: entry.variant || undefined,
    updates: entry.ops.map((u) => ({
      field_path: u.field_path,
      value: u.value,
      reset: u.reset === true,
    })),
    author,
    contentRoot: ctx.contentRoot,
    contentRootName: ctx.contentRootName,
    ci: ctx.contentIndex,
    skipSharedLayoutFanOut: true,
  });
  if (!result.ok) return { ok: false, error: result.error || "Write failed" };
  return { ok: true };
}

export async function promoteEntryOnSite(
  ctx: SiteContext,
  entry: ProposalEntryRow,
  author: string,
  opts: PromoteEntryOpts,
): Promise<PromoteEntryResult> {
  if (!entry.variant)
    return {
      ok: false,
      code: "variant_required",
      error: "variant required for promote",
    };
  const { promoteVariantWithOptionalTeardown } =
    await import("../versioning/promote-with-teardown");
  const resolved = resolveWritableVersioningTarget(
    entry.contentType,
    entry.slug,
    ctx.contentRoot,
  );
  if (!resolved.ok) {
    return { ok: false, code: "not_found", error: resolved.error };
  }
  const folder = getFolder(entry.contentType);
  const result = await promoteVariantWithOptionalTeardown({
    contentType: entry.contentType,
    slug: resolved.slug,
    locale: entry.locale,
    variantSlug: entry.variant,
    author,
    contentRoot: ctx.contentRoot,
    contentRootName: ctx.contentRootName,
    folder,
    templateMode: resolved.templateMode,
    versioningManager: ctx.versioningManager,
    ci: ctx.contentIndex,
    cache: ctx.validationCache,
    confirmEndExperiment: opts.confirm_end_experiment,
    endExperimentMode: true,
    viaProposalApply: true,
    confirmOverwriteNewerLive: opts.confirm_base_unknown === true,
    callerIsMcp: opts.caller_is_mcp === true,
    confirmTextLimits: opts.confirm_text_limits === true,
    dryRun: opts.dry_run === true,
    seoStandaloneReason: opts.seo_standalone_reason ?? null,
  });
  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      error: result.error,
      traffic_siblings: result.traffic_siblings,
      details: result.details,
    };
  }
  return {
    ok: true,
    warnings: result.warnings,
    rebuilt: result.rebuilt,
    published_diff: result.publishedDiff,
    pre_apply_snapshot: result.preApplySnapshot,
    dry_run: result.dryRun === true,
  };
}

function proposalCollection(site: string): string {
  return `cms_proposals_${site.replace(/[^\w-]+/g, "-")}`;
}

async function indexProposalSearch(site: string, proposal: ProposalRecord): Promise<void> {
  const { upsertItem } = await import("../vector-search");
  await upsertItem(
    proposalCollection(site),
    {
      id: proposal.id,
      slug: proposal.id,
      title: proposal.title,
      summary: proposal.summary,
      rationale: proposal.rationale ?? "",
      tags: proposal.tags.join(" "),
      search_text: proposal.search_text,
      status: proposal.status,
    },
    ["title", "summary", "rationale", "tags", "search_text"],
  );
}

async function findSimilarProposals(site: string, query: string): Promise<SimilarProposal[]> {
  const { search } = await import("../vector-search");
  const hits = await search(proposalCollection(site), query, 8);
  return hits.map((h) => ({ id: h.slug, title: h.slug, score: h.score }));
}

export function resolveExistenceFromSite(
  ctx: SiteContext,
  entry: { contentType: string; slug: string; locale: string; variant?: string | null },
): { live: ExistenceState; draftExists: boolean } {
  const liveLoaded = getContentForEdit(
    entry.contentType,
    entry.slug,
    entry.locale,
    undefined,
    undefined,
    ctx.contentIndex,
  );
  let live: ExistenceState = "missing";
  if (liveLoaded.content) live = "exists";
  else if (liveLoaded.error && !/not found/i.test(liveLoaded.error)) live = "unknown";

  let draftExists = false;
  if (entry.variant?.trim()) {
    const draftLoaded = getContentForEdit(
      entry.contentType,
      entry.slug,
      entry.locale,
      entry.variant.trim(),
      undefined,
      ctx.contentIndex,
    );
    draftExists = Boolean(draftLoaded.content);
  }
  return { live, draftExists };
}

export function inspectMissingTargetFromSite(
  ctx: SiteContext,
  entry: { contentType: string; slug: string },
): MissingTargetShape {
  const config = getContentTypeConfig(entry.contentType, ctx.contentRoot);
  if (!config) return { shape: "other" };
  if (config.database?.slug) return { shape: "database" };
  if (isTemplateVersioningSlug(entry.slug)) return { shape: "other" };
  if (!config.single_template) {
    return {
      shape: "page_file",
      requiredFields: listRequiredEditorFields(config.editor, { isSharedLayout: false, isDetached: false }),
    };
  }
  if (isEntryDetached(entry.contentType, entry.slug, ctx.contentRoot)) return { shape: "other" };
  const requiredFields = listRequiredEditorFields(config.editor, {
    isSharedLayout: true,
    isDetached: false,
  });
  return { shape: "attached_file", requiredFields };
}

export async function prepareCreatesEntryOnSite(
  ctx: SiteContext,
  entry: ProposalEntryRow,
  opts: {
    confirmNewValues?: boolean;
    author: string;
    ideaFunnel?: IdeaFunnel | null;
  },
): Promise<{ ok: boolean; error?: string; code?: string; seeded?: boolean }> {
  const config = getContentTypeConfig(entry.contentType, ctx.contentRoot);
  if (!config || config.database?.slug || !config.single_template) {
    return { ok: false, code: "not_attached_file", error: "This page is not a file-based attached post." };
  }
  const requiredFields = listRequiredEditorFields(config.editor, {
    isSharedLayout: true,
    isDetached: false,
  });
  const missing = missingRequiredFromOps(requiredFields, entry.ops);
  if (missing.length) {
    return {
      ok: false,
      code: "required_fields_missing",
      error: `This new post is missing required fields: ${missing.join(", ")}.`,
    };
  }
  const params = listExtraUrlPatternParams(config.url_pattern);
  const proposed: Record<string, string> = {};
  for (const op of entry.ops) {
    if (op.reset) continue;
    const head = op.field_path.split(".")[0] ?? op.field_path;
    const key = params.includes(op.field_path) ? op.field_path : params.includes(head) ? head : "";
    if (!key) continue;
    const slug = extractParamSlug(op.value);
    if (slug) proposed[key] = slug;
  }
  const peer = validateUrlParamPeerValues(
    ctx.contentRoot,
    entry.contentType,
    config,
    { [entry.locale]: proposed },
    opts.confirmNewValues,
  );
  if (peer) {
    return {
      ok: false,
      code: "confirm_new_values",
      error:
        `New ${peer.param} "${peer.proposed_value}" is not an existing ${peer.locale} value. ` +
        `Observed: ${peer.observed_values.slice(0, 20).join(", ")}. ` +
        "Pass confirm_new_values: true on apply after principal approval, or pick an observed value.",
    };
  }
  seedAttachedLocaleFiles({
    contentType: entry.contentType,
    slug: entry.slug,
    locale: entry.locale,
    contentRoot: ctx.contentRoot,
    author: opts.author,
    funnel: opts.ideaFunnel ? ideaFunnelToYamlBlock(opts.ideaFunnel) : null,
  });
  ctx.contentIndex.refresh();
  return { ok: true, seeded: true };
}

export function discardSeededEntryOnSite(ctx: SiteContext, entry: ProposalEntryRow): void {
  discardSeededAttachedEntry({
    contentType: entry.contentType,
    slug: entry.slug,
    locale: entry.locale,
    contentRoot: ctx.contentRoot,
  });
  ctx.contentIndex.refresh();
}

export function stampPublishedAtOnSite(
  ctx: SiteContext,
  entry: ProposalEntryRow,
  author: string,
): { ok: boolean; error?: string } {
  const stamped = ensurePublishedAtOnce(entry.contentType, entry.slug, {
    author,
    contentRoot: ctx.contentRoot,
  });
  if (stamped.error) return { ok: false, error: stamped.error };
  return { ok: true };
}

export function proposalServiceForSite(ctx: SiteContext) {
  const site = ctx.contentRootName;
  return createProposalService({
    site,
    issueExists: (id) => Boolean(ctx.validationCache.getIssueById(id)),
    captureBaseline: (entry) => captureBaselineFromSite(ctx, entry),
    applyUpdates: (entry, author) => applyUpdatesOnSite(ctx, entry, author),
    readVariantFingerprint: (entry) => readVariantFingerprintFromSite(ctx, entry),
    promoteEntry: (entry, author, opts) => promoteEntryOnSite(ctx, entry, author, opts),
    findSimilar: (q) => findSimilarProposals(site, q),
    indexSearch: (p) => indexProposalSearch(site, p),
    resolveExistence: (entry) => resolveExistenceFromSite(ctx, entry),
    inspectMissingTarget: (entry) => inspectMissingTargetFromSite(ctx, entry),
    resolveLayoutOwner: (entry) => layoutInfoForEntry(entry.contentType, entry.slug, ctx.contentRoot),
    scanTemplatePlaceholders: (entry) => scanTemplatePlaceholdersOnSite({ ...entry, contentRoot: ctx.contentRoot }),
    validateSections: (sections) => validateSectionsForProposal(sections, ctx.contentRootName),
    prepareCreatesEntry: (entry, opts) => prepareCreatesEntryOnSite(ctx, entry, opts),
    discardSeededEntry: (entry) => discardSeededEntryOnSite(ctx, entry),
    stampPublishedAt: (entry, author) => stampPublishedAtOnSite(ctx, entry, author),
    getProposalSettings: () => loadProposalSettingsFromDisk(ctx.contentRoot),
    draftStore: draftStoreForSite(ctx),
    seoTarget: ideaSeoTargetDepsForSite(ctx),
    strategyForContentType: (contentType) =>
      parseContentTypeStrategy(getContentTypeConfig(contentType, ctx.contentRoot)?.strategy),
    knownContentTypes: () => getAllTypes(ctx.contentRoot),
    variableDefinitions: () => ctx.variableManager.getDefinitions(),
    localeUrlSlug: localeUrlSlugDepsForSite(ctx),
  });
}

export function localeUrlSlugDepsForSite(ctx: SiteContext): LocaleUrlSlugDeps {
  const ci = ctx.contentIndex;
  return {
    liveLocales: (contentType, slug) => ci.getAvailableLocalesOrVariants(ci.normalizeType(contentType), slug),
    urlPattern: (contentType) => getContentTypeConfig(contentType, ctx.contentRoot)?.url_pattern ?? null,
    ownerOf: (contentType, urlSlug, locale) => {
      const type = ci.normalizeType(contentType);
      const folder = ci.resolveBaseSlug(urlSlug, type);
      const live = ci.getAvailableLocalesOrVariants(type, folder);
      if (!live.includes(locale)) return null;
      return ci.getLocaleSlug(folder, type, locale) === urlSlug ? folder : null;
    },
  };
}

export function ideaSeoTargetDepsForSite(ctx: SiteContext): IdeaSeoTargetDeps {
  const indexRow = (path: string) => {
    const index = readSeoIndexFile(ctx.contentRoot);
    if (!index) return null;
    const want = normalizePath(path);
    return Object.values(index.entries).find((r) => normalizePath(r.path || "") === want) ?? null;
  };
  return {
    isMonitored: (contentType) => isSeoMonitoringEnabled(contentType, ctx.contentRoot),
    resolveHub: (pillarPath, locale) => {
      const canon = canonicalizePillarPath(pillarPath, locale, ctx.contentIndex);
      const row = indexRow(canon.path);
      const prefix = canon.path.split("/").filter(Boolean)[0] ?? "";
      return {
        path: canon.path,
        live: canon.live,
        locale: row?.locale ?? (/^[a-z]{2}$/.test(prefix) ? prefix : null),
        is_hub: row ? row.is_pillar === true : null,
        entry: row ? { contentType: row.content_type, slug: row.slug, locale: row.locale } : null,
      };
    },
    keywordOwner: (keyword, exclude) => {
      const r = assertMainKeywordAvailable({ contentRoot: ctx.contentRoot, keyword, ...exclude });
      if (r.ok) return null;
      if (r.code === "seo_index_unavailable") return "unavailable";
      return {
        path: r.owner?.path?.trim() || (r.owner ? `${r.owner.content_type}/${r.owner.slug}/${r.owner.locale}` : "?"),
      };
    },
    selfPath: (contentType, slug, locale) => entryCanonicalPath(contentType, slug, locale, ctx.contentIndex),
    memberInfo: (contentType, slug, locale) => {
      const live = resolveExistenceFromSite(ctx, { contentType, slug, locale }).live === "exists";
      const index = readSeoIndexFile(ctx.contentRoot);
      const row = index?.entries[seoEntryId(contentType, slug, locale)];
      return {
        live,
        monitored: isSeoMonitoringEnabled(contentType, ctx.contentRoot),
        pillar_path: row?.pillar_path ?? null,
      };
    },
  };
}
