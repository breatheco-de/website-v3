/**
 * Variant health: how old a draft/A-B variant is, whether anyone is working on it,
 * and whether deleting it is likely safe. Pure — the server gathers the facts, the
 * Versions panel popover and MCP list_variants / delete_variant read the verdict.
 */

/** A variant created and last edited longer ago than this is stale; tests that ended within it still count. */
export const VARIANT_STALE_DAYS = 30;

const DAY_MS = 86_400_000;

export type VariantVerdict = "cannot_delete" | "check_first" | "probably_safe";
export type VariantAgeState = "new" | "active" | "stale" | "unknown";
export type VariantProposalState = "open" | "closed" | "orphan" | "unverified" | "none";
export type VariantTestState = "running" | "ended_recently" | "ended_long_ago" | "never" | "unknown";

export type VariantReasonCode =
  | "has_traffic"
  | "recently_created"
  | "recently_edited"
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
  /** created_at, else based_on_at, else null. */
  created_at: string | null;
  created_source: "created_at" | "based_on" | null;
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

  const created = facts.created_at ?? facts.based_on_at;
  const createdSource = facts.created_at ? "created_at" : facts.based_on_at ? "based_on" : null;
  const lastActivity = newer(created, facts.updated_at);

  let age: VariantAgeState;
  if (created && within(created, now)) {
    age = "new";
    reasons.push({ code: "recently_created", message: `Created ${when(created, now)}. Someone may still be working on it.` });
  } else if (within(facts.updated_at, now)) {
    age = "active";
    reasons.push({ code: "recently_edited", message: `Edited ${when(facts.updated_at, now)}.` });
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
  };
}

/** Reasons a delete_variant caller would be overriding with confirm_variant_in_use. */
export function overridableVariantReasons(health: Pick<VariantHealth, "reasons">): VariantReason[] {
  return health.reasons.filter(
    (r) => r.code !== "has_traffic" && !NON_OVERRIDABLE_VARIANT_REASONS.includes(r.code),
  );
}
