/**
 * Variant health: how old a draft/A-B variant is, whether anyone is working on it,
 * and whether deleting it is likely safe. Pure — the server gathers the facts, the
 * Versions panel popover and MCP list_variants / delete_variant read the verdict.
 */

/** A variant created and last edited longer ago than this is stale; tests that ended within it still count. */
export const VARIANT_STALE_DAYS = 30;

/** Daily cleanup of drafts not linked to a proposal (live server only). */
export const DRAFT_CLEANUP_SAFE_DAYS = 30;
export const DRAFT_CLEANUP_FLAG_DAYS = 60;
export const DRAFT_CLEANUP_DELETE_DAYS = 90;
/** A flagged draft is never deleted sooner than this after the flag. */
export const DRAFT_CLEANUP_MIN_WARNING_DAYS = 30;

const DAY_MS = 86_400_000;

export type VariantVerdict = "cannot_delete" | "check_first" | "probably_safe";
export type VariantAgeState = "new" | "active" | "stale" | "unknown";
export type VariantProposalState = "open" | "closed" | "orphan" | "unverified" | "none";
export type VariantTestState = "running" | "ended_recently" | "ended_long_ago" | "never" | "unknown";

export type VariantReasonCode =
  | "has_traffic"
  | "recently_created"
  | "recently_edited"
  | "recently_kept"
  | "age_unknown"
  | "proposal_open"
  | "proposal_unverified"
  | "test_running"
  | "test_ended_recently"
  | "test_history_unavailable"
  | "changes_not_on_live"
  | "last_draft_of_unpublished_page";

export type VariantNoteCode =
  | "behind_live"
  | "test_history_ignored_off_production"
  | "proposal_orphan"
  | "identical_to_live";

/** Bookkeeping dates: a variant that differs from live only in these has no content changes. */
export const VARIANT_DATE_FIELDS: ReadonlySet<string> = new Set(["updated_at", "_updated_at", "published_at"]);

/** Changed field paths minus the date fields (`meta.updated_at` style paths are not dates). */
export function contentChangePaths(paths: readonly string[]): string[] {
  return paths.filter((p) => !VARIANT_DATE_FIELDS.has(p));
}

/** Reasons agents can never override through MCP; staff delete those from the Versions panel. */
export const NON_OVERRIDABLE_VARIANT_REASONS: readonly VariantReasonCode[] = ["proposal_open"];

export interface VariantProposalFact {
  state: VariantProposalState;
  title?: string | null;
  status?: string | null;
  proposer?: string | null;
  /** When the daily link check found it closed everywhere (state "orphan"). */
  orphan_since?: string | null;
}

export interface VariantTestFact {
  state: VariantTestState;
  experiment_id?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
}

export interface VariantFacts {
  allocation: number;
  /** `_draft.created_at`, written once when the variant was created. */
  created_at: string | null;
  /** `_draft.based_on.at` (last time it was based on live; fallback for created). */
  based_on_at: string | null;
  /** The variant file's own editorial `updated_at`. */
  updated_at: string | null;
  proposal: VariantProposalFact;
  test: VariantTestFact;
  on_live_server: boolean;
  /** A live file exists for this locale. */
  has_live: boolean;
  /** Field changes vs live, date fields excluded; null when there is no live file. */
  changes_vs_live: number | null;
  behind_live: boolean;
  behind_since?: string | null;
  /** Deleting this file removes the whole (unpublished) page. */
  is_last_draft_of_unpublished: boolean;
  translated_from?: string | null;
  /** `_draft.kept_at`: staff pressed "Keep for now". */
  kept_at?: string | null;
  /** When the live server first saw this draft's content change (any source). */
  content_changed_at?: string | null;
  /** When the live server first saw this draft; stands in for a missing creation date. */
  first_seen_at?: string | null;
  /** `_draft.cleanup`: flagged for deletion by the daily cleanup. */
  cleanup?: { flagged_at: string; deletes_at: string } | null;
}

export type DraftCleanupTier = "nothing_to_lose" | "has_work";

/** Set when the daily cleanup flagged this draft for deletion. */
export interface VariantCleanupState {
  tier: DraftCleanupTier;
  flagged_at: string;
  deletes_at: string;
}

export interface VariantReason<C extends string = VariantReasonCode> {
  code: C;
  message: string;
}

export interface VariantPurpose {
  kind: "proposal" | "translation" | "none";
  text: string;
}

export interface VariantHealth {
  verdict: VariantVerdict;
  age_state: VariantAgeState;
  /** created_at, else based_on_at, else first_seen_at, else null. */
  created_at: string | null;
  created_source: "created_at" | "based_on" | "first_seen" | null;
  updated_at: string | null;
  /** Newer of created and last edited. */
  last_activity_at: string | null;
  /** Why the verdict is not probably_safe (empty when it is). */
  reasons: VariantReason[];
  /** Facts shown whatever the verdict (behind live, ignored test history, ...). */
  notes: VariantReason<VariantNoteCode>[];
  purpose: VariantPurpose;
  /** One plain-English line for the top of the popover. */
  summary: string;
  /** Scheduled for deletion by the daily cleanup (null when not flagged). */
  cleanup: VariantCleanupState | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** "Oct 1, 2026" (UTC, so server and browser agree). */
export function formatVariantDay(iso: string | null | undefined): string | null {
  const ms = parseMs(iso);
  if (ms === null) return null;
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** "today", "yesterday", "5 days ago". Future dates (clock skew) read as "today". */
export function relativeVariantDays(iso: string | null | undefined, now: number): string | null {
  const ms = parseMs(iso);
  if (ms === null) return null;
  const days = Math.max(0, Math.floor((now - ms) / DAY_MS));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function within(iso: string | null | undefined, now: number, days = VARIANT_STALE_DAYS): boolean {
  const ms = parseMs(iso);
  return ms !== null && now - ms < days * DAY_MS;
}

function when(iso: string | null | undefined, now: number): string {
  const rel = relativeVariantDays(iso, now);
  const day = formatVariantDay(iso);
  return rel && day ? `${rel} (${day})` : "at an unknown date";
}

function newer(a: string | null, b: string | null): string | null {
  const am = parseMs(a);
  const bm = parseMs(b);
  if (am === null) return bm === null ? null : b;
  if (bm === null) return a;
  return bm > am ? b : a;
}

export function variantPurpose(facts: Pick<VariantFacts, "proposal" | "translated_from">): VariantPurpose {
  const p = facts.proposal;
  if (p.state !== "none") {
    const title = p.title?.trim() ? `"${p.title.trim()}"` : "a content proposal";
    const status =
      p.state === "open" ? "open" : p.state === "unverified" ? "status unknown" : p.status ? p.status : "closed";
    return { kind: "proposal", text: `Created for proposal ${title} (${status}).` };
  }
  if (facts.translated_from) {
    return { kind: "translation", text: `Translated from the ${facts.translated_from.toUpperCase()} page.` };
  }
  return { kind: "none", text: "No reason recorded." };
}

export function variantVerdict(facts: VariantFacts, now: number = Date.now()): VariantHealth {
  const reasons: VariantReason[] = [];
  const notes: VariantReason<VariantNoteCode>[] = [];

  const { created, source: createdSource } = createdOf(facts);
  const lastActivity = lastActivityOf(facts);
  const lastEdit = newer(facts.updated_at, facts.content_changed_at ?? null);

  let age: VariantAgeState;
  if (created && within(created, now)) {
    age = "new";
    reasons.push({
      code: "recently_created",
      message:
        createdSource === "first_seen"
          ? `First seen ${when(created, now)}; we don't know when it was made. Someone may still be working on it.`
          : `Created ${when(created, now)}. Someone may still be working on it.`,
    });
  } else if (within(lastEdit, now)) {
    age = "active";
    reasons.push({ code: "recently_edited", message: `Edited ${when(lastEdit, now)}.` });
  } else if (within(facts.kept_at, now)) {
    age = "active";
    reasons.push({ code: "recently_kept", message: `Someone chose to keep it ${when(facts.kept_at, now)}.` });
  } else if (!created) {
    age = "unknown";
    reasons.push({ code: "age_unknown", message: "We don't know when this version was made." });
  } else {
    age = "stale";
  }

  if (facts.proposal.state === "open") {
    const title = facts.proposal.title?.trim() ? `"${facts.proposal.title.trim()}"` : "a proposal";
    reasons.push({ code: "proposal_open", message: `Linked to open proposal ${title}. Someone is reviewing this work.` });
  } else if (facts.proposal.state === "unverified") {
    reasons.push({ code: "proposal_unverified", message: "Linked to a proposal we couldn't check from here." });
  } else if (facts.proposal.state === "orphan") {
    const since = formatVariantDay(facts.proposal.orphan_since);
    notes.push({
      code: "proposal_orphan",
      message: `The proposal it came from is no longer open${since ? ` (since ${since})` : ""}.`,
    });
  }

  switch (facts.test.state) {
    case "running":
      reasons.push({ code: "test_running", message: "Part of an A/B test that is running now." });
      break;
    case "ended_recently":
      reasons.push({
        code: "test_ended_recently",
        message: `Was in an A/B test that ended ${when(facts.test.ended_at, now)}. Results may still be under review.`,
      });
      break;
    case "unknown":
      if (facts.on_live_server) {
        reasons.push({ code: "test_history_unavailable", message: "Test history isn't available, so we can't tell if it was tested." });
      } else {
        notes.push({
          code: "test_history_ignored_off_production",
          message: "Test history isn't available here; this verdict ignores tests.",
        });
      }
      break;
    default:
      break;
  }

  if (facts.has_live && facts.changes_vs_live !== null) {
    if (facts.changes_vs_live > 0) {
      const n = facts.changes_vs_live;
      reasons.push({
        code: "changes_not_on_live",
        message: `Has ${n} change${n === 1 ? "" : "s"} that ${n === 1 ? "isn't" : "aren't"} on the live page. Deleting loses ${n === 1 ? "it" : "them"}.`,
      });
    } else {
      notes.push({ code: "identical_to_live", message: "Same content as the live page; deleting it loses nothing." });
    }
  }

  if (facts.is_last_draft_of_unpublished) {
    reasons.push({
      code: "last_draft_of_unpublished_page",
      message: "This is the page's only draft and the page isn't published. Deleting it removes the whole page.",
    });
  }

  if (facts.behind_live) {
    const since = formatVariantDay(facts.behind_since);
    notes.push({
      code: "behind_live",
      message: `The live page changed since this version was made${since ? ` (${since})` : ""}. Publishing it would undo those newer changes.`,
    });
  }

  let verdict: VariantVerdict;
  if (facts.allocation > 0) {
    verdict = "cannot_delete";
    reasons.unshift({
      code: "has_traffic",
      message: `It gets ${facts.allocation}% of visitors. Set its traffic to 0% before deleting it.`,
    });
  } else {
    verdict = reasons.length > 0 ? "check_first" : "probably_safe";
  }

  const summary =
    verdict === "probably_safe"
      ? `Probably safe to delete: no one has edited it since ${formatVariantDay(lastActivity) ?? "a long time ago"}, and it isn't shown to visitors.`
      : reasons[0].message;

  return {
    verdict,
    age_state: age,
    created_at: created,
    created_source: createdSource,
    updated_at: facts.updated_at,
    last_activity_at: lastActivity,
    reasons,
    notes,
    purpose: variantPurpose(facts),
    summary,
    cleanup: facts.cleanup ? { tier: cleanupTierOf(facts), ...facts.cleanup } : null,
  };
}

function createdOf(facts: VariantFacts): { created: string | null; source: VariantHealth["created_source"] } {
  if (facts.created_at) return { created: facts.created_at, source: "created_at" };
  if (facts.based_on_at) return { created: facts.based_on_at, source: "based_on" };
  if (facts.first_seen_at) return { created: facts.first_seen_at, source: "first_seen" };
  return { created: null, source: null };
}

/** Newest of created (or first seen), editorial updated_at, content change seen, and kept. */
function lastActivityOf(facts: VariantFacts): string | null {
  let out = createdOf(facts).created;
  for (const d of [facts.updated_at, facts.content_changed_at ?? null, facts.kept_at ?? null]) out = newer(out, d);
  return out;
}

/** Identical to live (dates ignored) loses nothing; anything else holds unpublished work. */
export function cleanupTierOf(facts: Pick<VariantFacts, "has_live" | "changes_vs_live">): DraftCleanupTier {
  return facts.has_live && facts.changes_vs_live === 0 ? "nothing_to_lose" : "has_work";
}

export type DraftCleanupAction = "keep" | "flag" | "clear_flag" | "delete";

export type DraftCleanupReason =
  | "proposal"
  | "has_traffic"
  | "test_running"
  | "test_ended_recently"
  | "test_history_unavailable"
  | "last_draft_of_unpublished_page"
  | "age_unknown"
  | "active"
  | "activity_since_flag"
  | "flag_waiting"
  | "idle";

export interface DraftCleanupDecision {
  action: DraftCleanupAction;
  tier: DraftCleanupTier;
  reason: DraftCleanupReason;
  last_activity_at: string | null;
  /** For "flag": when it will be deleted; for a waiting flag: the existing date. */
  deletes_at: string | null;
}

/**
 * What the daily cleanup does with one draft that is not linked to a proposal.
 * Nothing to lose: deleted after DRAFT_CLEANUP_SAFE_DAYS idle, no flag. Has work: flagged at
 * DRAFT_CLEANUP_FLAG_DAYS idle, deleted at DRAFT_CLEANUP_DELETE_DAYS but never sooner than
 * DRAFT_CLEANUP_MIN_WARNING_DAYS after the flag. Activity newer than the flag clears it.
 */
export function draftCleanupDecision(facts: VariantFacts, now: number = Date.now()): DraftCleanupDecision {
  const tier = cleanupTierOf(facts);
  const lastActivity = lastActivityOf(facts);
  const flag = facts.cleanup ?? null;
  const out = (action: DraftCleanupAction, reason: DraftCleanupReason, deletesAt: string | null = flag?.deletes_at ?? null) => ({
    action,
    tier,
    reason,
    last_activity_at: lastActivity,
    deletes_at: deletesAt,
  });

  let blocked: DraftCleanupReason | null = null;
  if (facts.proposal.state !== "none") blocked = "proposal";
  else if (facts.allocation > 0) blocked = "has_traffic";
  else if (facts.test.state === "running") blocked = "test_running";
  else if (facts.test.state === "ended_recently") blocked = "test_ended_recently";
  else if (facts.test.state === "unknown" && facts.on_live_server) blocked = "test_history_unavailable";
  else if (facts.is_last_draft_of_unpublished) blocked = "last_draft_of_unpublished_page";
  else if (!lastActivity) blocked = "age_unknown";
  if (blocked) return flag ? out("clear_flag", blocked, null) : out("keep", blocked, null);

  const lastMs = parseMs(lastActivity)!;
  const flaggedMs = parseMs(flag?.flagged_at);
  if (flag && (flaggedMs === null || lastMs > flaggedMs)) return out("clear_flag", "activity_since_flag", null);

  const idle = now - lastMs;
  if (tier === "nothing_to_lose") {
    if (idle >= DRAFT_CLEANUP_SAFE_DAYS * DAY_MS) return out("delete", "idle");
    return out("keep", flag ? "flag_waiting" : "active");
  }
  if (flag) {
    const deletesMs = parseMs(flag.deletes_at);
    if (deletesMs !== null && now >= deletesMs) return out("delete", "idle");
    return out("keep", "flag_waiting");
  }
  if (idle >= DRAFT_CLEANUP_FLAG_DAYS * DAY_MS) {
    const deletesMs = Math.max(lastMs + DRAFT_CLEANUP_DELETE_DAYS * DAY_MS, now + DRAFT_CLEANUP_MIN_WARNING_DAYS * DAY_MS);
    return out("flag", "idle", new Date(deletesMs).toISOString());
  }
  return out("keep", "active", null);
}

/** Reasons a delete_variant caller would be overriding with confirm_variant_in_use. */
export function overridableVariantReasons(health: Pick<VariantHealth, "reasons">): VariantReason[] {
  return health.reasons.filter(
    (r) => r.code !== "has_traffic" && !NON_OVERRIDABLE_VARIANT_REASONS.includes(r.code),
  );
}
