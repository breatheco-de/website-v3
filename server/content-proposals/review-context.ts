/**
 * Deterministic proposal review classifier.
 * Compute on read (and at create for snapshot). Same inputs → same output.
 */

import type { ProposalCategory, ProposalEntryRow, ProposalKind, ProposalRecord, ReviewMode } from "./service";
import type { LayoutOwner } from "../layout-owner";
import { isTemplateVersioningSlug } from "@shared/sharedLayoutPaths";
import { isSectionFieldPath } from "./attached-entry-gate";
import { isStructuralSectionsChange } from "./sections-summary";
import {
  DAMAGE_CLASS_META,
  THINK_TEMPLATES,
  UNDO_COPY,
  MIXED_SERP_AND_BODY,
  TITLE_DESCRIPTION_STAFF_NOTE,
  INTERNAL_LINKS_STAFF_NOTE,
  FUNNEL_CLASSIFICATION_STAFF_NOTE,
  LOCALE_TRANSLATION_STAFF_NOTE,
  IDEA_OPPORTUNITY_HARM_STAFF_NOTE,
  ANTICIPATED_DEMAND_STAFF_NOTE,
  EXISTING_DEMAND_STAFF_NOTE,
  FAST_DECAY_NEWS_STAFF_NOTE,
  BROKEN_URL_STAFF_NOTE,
  worseDamageClass,
  hasTitleDescriptionOps,
  isTitleDescriptionOnlyOps,
  type ChecklistId,
  type DamageClass,
  type ExistenceState,
  type UndoCost,
  type ThinkTemplate,
} from "./proposal-review-rules";
import {
  checklistIdsForSituations,
  inferSituationsFromOps,
  mergeSituations,
  staffNotesForSituations,
  IDEA_DEFAULT_SITUATION_ID,
  isIdeaAuthorSituationId,
  looksLikeExistingDemandPitch,
  EXISTING_DEMAND_UNDECLARED,
  type ReviewSituationId,
  type SituationSource,
} from "./review-situations";
import {
  IDEA_FUNNEL_MISSING_WARN,
  ideaFunnelComplete,
  ideaRequiresStructuredFunnel,
} from "./idea-funnel";
import { reviewIdeaContentTypes, type IdeaContentTypeStrategy } from "./idea-content-type";
import {
  IDEA_SEO_TARGET_METRICS_MISSING_WARN,
  IDEA_SEO_TARGET_MISSING_WARN,
  describeIdeaSeoTarget,
  ideaSeoTargetComplete,
  ideaSeoTargetHasMetrics,
  seoTargetDiff,
  type IdeaSeoTarget,
} from "./idea-seo-target";
import {
  collectClaimCueTextFromOps,
  evaluateClaimCues,
  hasClaimRelevantPendingOps,
  type ClaimCueVerdict,
} from "./claim-cues";
import {
  DECISION_ID_TOUCHES_OUTCOME_FIGURES,
  type TouchesOutcomeFiguresOutcome,
} from "../ai/decisions";
import type { VariableDefinition } from "../variable-manager";
import {
  collectPendingOpValueText,
  findFactVariableTokens,
  findFigureVariableTokens,
  summarizeFigureVariables,
  type FigureVariableSummary,
  type VariableTokenHit,
} from "./figure-variable-tokens";

export type ReviewWarning = { code: string; message: string };

export type ReviewEntryContext = {
  contentType: string;
  slug: string;
  locale: string;
  existence: ExistenceState;
  damage_class: DamageClass;
  /** True when live is gone and no draft — blocks apply. */
  target_missing?: boolean;
  /** Who owns this entry's layout today (see agent-conventions layout_owner table). */
  layout_owner?: LayoutOwner;
  detached?: true;
  is_shared_template?: true;
};

export type RelatedOpenProposal = {
  id: string;
  title?: string;
  kind: ProposalKind;
  shared_issue_ids: string[];
};

export type UndoCostReason =
  | "locale_fields"
  | "seo_or_url"
  | "page_level_fields"
  | "sections"
  | "first_publish"
  | "shared_template";

export type ReviewContext = {
  undo_cost: UndoCost;
  /** v1.0: which draft change set the undo cost (from author_diff). */
  undo_cost_reason?: UndoCostReason;
  damage_class: DamageClass;
  review_mode_operative: boolean;
  active_checklists: ChecklistId[];
  /** Live merged review situations (author ∪ inferred). */
  review_situations: ReviewSituationId[];
  /** Filed author-declared situations (may be empty). */
  filed_review_situations: ReviewSituationId[];
  situation_source: SituationSource;
  entries: ReviewEntryContext[];
  related_open_proposals?: RelatedOpenProposal[];
  summary: string;
  staff_summary: {
    badge_label: string;
    situation_description: string;
    risk: string;
    undo: string;
    related?: string;
  };
  agent_preview: {
    think_items: Array<{ id: string; title: string; why: string; look_for: string[] }>;
    warnings: ReviewWarning[];
  };
  /** Apply must fail when any remaining entry has this. */
  block_apply: boolean;
  situation_changed_since_filed?: boolean;
  filed_damage_class?: string;
  /**
   * Ambiguous claim cues — caller should run Jev and re-classify with claimCueJevOutcome.
   * Sync classify never attaches figures for this alone.
   */
  needs_jev_claim_check?: boolean;
  /** Text sent / to send to Jev for outcome-figure detection. */
  claim_cue_text?: string;
  /** Soft Count-as-lead form caution (never alone attaches figures). */
  counts_as_lead_hint?: boolean;
  /** Ideas: target page types with their content-types.yml strategy (pitched / accepted). */
  content_type_strategies?: IdeaContentTypeStrategy[];
  /** Figure-category variable tokens in the proposed values (turn on outcome figures). */
  figure_variables?: FigureVariableSummary[];
  /** Fact-category variable tokens in the proposed values (site-facts discovery names). */
  fact_variable_names?: string[];
  /** A fact-sensitive checklist is active and no site-facts check was passed — caller asks Jev and re-classifies. */
  needs_site_facts_check?: boolean;
  /** Jev site-facts check result (categories the proposal touches). */
  site_facts?: SiteFactsCheck;
  /** Persisted when Jev enrichment ran. */
  jev?: {
    called: true;
    outcome: TouchesOutcomeFiguresOutcome;
    decision_id: string;
    at: string;
  };
};

export type SiteFactsCheck = {
  outcome: "ok" | "unavailable";
  categories: string[];
};

/** Checklists that ask reviewers to catch wrong stats — they get the site-facts discovery item. */
export const SITE_FACT_CHECKLISTS: ReadonlySet<ChecklistId> = new Set<ChecklistId>([
  "verify_copy",
  "title_description_ctr",
  "locale_translation",
  "new_content_brand",
  "idea_opportunity_harm",
]);

/** Text the site-facts Jev check reads: pending op values (edits) or the brief (ideas). */
export function siteFactsInputText(
  proposal: Pick<ProposalRecord, "kind" | "entries" | "title" | "summary">,
  promoteDraftText?: string | null,
): string {
  if (proposal.kind === "idea") {
    return [proposal.title, proposal.summary].filter((s) => typeof s === "string" && s.trim()).join("\n");
  }
  if (proposal.kind !== "edits") return "";
  const work = proposal.entries.filter((e) => !e.status || e.status === "pending" || e.status === "failed");
  const opText = collectPendingOpValueText(work.length ? work : proposal.entries);
  return [opText, promoteDraftText ?? ""].filter((s) => s.trim()).join("\n");
}

export type EntryExistenceLookup = {
  contentType: string;
  slug: string;
  locale: string;
  variant?: string | null;
  existence: ExistenceState;
  /** Draft file exists when variant was requested. */
  draftExists?: boolean;
  /** Who owns the entry's layout today. Absent → unknown (no owner-aware copy). */
  layout_owner?: LayoutOwner;
  detached?: true;
  is_shared_template?: true;
  /** Owner recorded when the entry was filed / revised (v1.0). Absent on older rows. */
  layout_owner_at_filing?: LayoutOwner;
};

export type ClassifyProposalReviewOpts = {
  proposal: Pick<
    ProposalRecord,
    | "id"
    | "kind"
    | "status"
    | "category"
    | "review_mode"
    | "related_issue_ids"
    | "related_entries"
    | "entries"
    | "summary"
    | "title"
    | "promote_on_apply"
    | "review_situations"
  > & {
    system_version?: ProposalRecord["system_version"];
    accepted_entry?: ProposalRecord["accepted_entry"];
    idea_funnel?: ProposalRecord["idea_funnel"];
    idea_seo_target?: ProposalRecord["idea_seo_target"];
    seo_target_override?: ProposalRecord["seo_target_override"];
    affected_entries?: ProposalRecord["affected_entries"];
    created_at?: ProposalRecord["created_at"];
  };
  /** Per entry / related target existence. */
  lookups: EntryExistenceLookup[];
  /** Content type has SEO monitoring on. Absent → no idea_seo_target_missing warning. */
  ideaSeoTargetMonitored?: (contentType: string) => boolean;
  /** Edits implementing an idea: that idea's locked keyword + cluster. */
  implementedIdeaSeoTarget?: IdeaSeoTarget | null;
  relatedOpen?: RelatedOpenProposal[];
  /** Snapshot from DB for change detection. */
  snapshot?: { damage_class?: string } | null;
  /**
   * Extra text to scan for claim cues (e.g. promote draft body loaded by caller).
   * Combined with pending claim-relevant op values.
   */
  promoteDraftText?: string | null;
  /**
   * When claim cues were ambiguous, pass Jev result so classify can attach figures.
   * Omit on first pass — sets needs_jev_claim_check instead.
   */
  claimCueJevOutcome?: TouchesOutcomeFiguresOutcome | null;
  /** Best-effort: page has a Count-as-lead conversion form (soft hint only). */
  countsAsLeadForm?: boolean;
  /** Ideas: resolved page-type strategies. Absent → no content_type_fit think item. */
  contentTypeStrategies?: IdeaContentTypeStrategy[] | null;
  /** Ideas: content-types.yml keys. Absent → related types are not checked. */
  knownContentTypes?: string[] | null;
  /** Site variables — enables figure/fact token detection. Absent (tests) → no token checks. */
  variableDefinitions?: Record<string, VariableDefinition> | null;
  /** Jev site-facts check result. Omit on first pass — sets needs_site_facts_check instead. */
  siteFactsCheck?: SiteFactsCheck | null;
};

const MAX_THINK = 6;

type ThinkItem = ReviewContext["agent_preview"]["think_items"][number];

/** Second slot so discovery_path (first 6 think items) always keeps it. */
function withContentTypeFitThink(items: ThinkItem[], fit: ThinkItem | null): ThinkItem[] {
  if (!fit) return items;
  const out = [...items];
  out.splice(Math.min(1, out.length), 0, fit);
  return out;
}

/** Prefer situation packs + disposition over adjacent when over the think cap. */
function selectThinkTemplates(checklists: Set<ChecklistId>): ThinkTemplate[] {
  const all = [...checklists]
    .map((id) => THINK_TEMPLATES[id])
    .filter((t): t is ThinkTemplate => Boolean(t));
  if (all.length <= MAX_THINK) {
    return all.sort((a, b) => a.priority - b.priority);
  }
  const defer = new Set<ChecklistId>([
    "adjacent_findings",
    "review_mode_inert",
    "dedup_coordinate",
  ]);
  const primary = all
    .filter((t) => !defer.has(t.id))
    .sort((a, b) => a.priority - b.priority);
  const secondary = all
    .filter((t) => defer.has(t.id))
    .sort((a, b) => a.priority - b.priority);
  if (primary.length >= MAX_THINK) {
    return primary.slice(0, MAX_THINK);
  }
  return [...primary, ...secondary].slice(0, MAX_THINK);
}

export function damageClassForTarget(opts: {
  contentType: string;
  category?: ProposalCategory;
  existence: ExistenceState;
  /** Live missing but draft present, or a reserved attached create → new content path. */
  draftExists?: boolean;
  /** Edits that will create a file-based attached entry on apply. */
  createsEntry?: boolean;
  /** For ideas: missing slug is new public content (any type). */
  forIdea?: boolean;
}): DamageClass {
  if (opts.existence === "missing") {
    if (opts.draftExists || opts.createsEntry) return "new_public_content";
    if (opts.forIdea) return "new_public_content";
    // Edits with missing live and no draft — caller marks target_missing; never new_public
    return opts.category === "content.seo" ? "existing_metadata" : "existing_content";
  }

  if (opts.existence === "unknown") {
    return opts.category === "content.seo" ? "existing_metadata" : "existing_content";
  }

  // exists — outcome figures upgrade happens in classify after claim-cue eval
  if (opts.category === "content.seo") {
    return "existing_metadata";
  }
  return "existing_content";
}

/**
 * Whether outcome-figures checklist should attach (sync path).
 * Ambiguous without claimCueJevOutcome → needs Jev (caller re-classifies).
 */
export function resolveOutcomeFiguresAttachment(opts: {
  entries: Array<{
    status?: string | null;
    ops?: Array<{ field_path?: string; value?: unknown }> | null;
  }>;
  reviewSituations?: string[] | null;
  promoteDraftText?: string | null;
  claimCueJevOutcome?: TouchesOutcomeFiguresOutcome | null;
  /** Figure-category variable tokens in the new values — any hit turns figures on. */
  figureVariables?: VariableTokenHit[] | null;
}): {
  figuresActive: boolean;
  needsJev: boolean;
  claimCueText: string;
  verdict: ClaimCueVerdict;
} {
  const declared = (opts.reviewSituations ?? []).includes("selling_figures");
  const opText = collectClaimCueTextFromOps(opts.entries);
  const promote = typeof opts.promoteDraftText === "string" ? opts.promoteDraftText : "";
  const claimCueText = [opText, promote].filter((s) => s.trim()).join("\n");
  const hasRelevant =
    declared ||
    hasClaimRelevantPendingOps(opts.entries) ||
    Boolean(promote.trim());

  if (declared || (opts.figureVariables?.length ?? 0) > 0) {
    return {
      figuresActive: true,
      needsJev: false,
      claimCueText,
      verdict: "clear_yes",
    };
  }

  if (!hasRelevant && !claimCueText.trim()) {
    return {
      figuresActive: false,
      needsJev: false,
      claimCueText,
      verdict: "clear_no",
    };
  }

  const verdict = evaluateClaimCues(claimCueText);
  if (verdict === "clear_yes") {
    return { figuresActive: true, needsJev: false, claimCueText, verdict };
  }
  if (verdict === "clear_no") {
    return { figuresActive: false, needsJev: false, claimCueText, verdict };
  }
  // ambiguous
  if (opts.claimCueJevOutcome === "yes") {
    return { figuresActive: true, needsJev: false, claimCueText, verdict };
  }
  if (opts.claimCueJevOutcome === "no" || opts.claimCueJevOutcome === "unavailable") {
    return { figuresActive: false, needsJev: false, claimCueText, verdict };
  }
  return { figuresActive: false, needsJev: true, claimCueText, verdict };
}

export function undoCostFor(kind: ProposalKind, reviewMode: ReviewMode): UndoCost {
  if (kind === "notes" || kind === "idea") return "none";
  if (reviewMode === "soft_variant") return "low";
  if (reviewMode === "draft_backed") return "high";
  return "medium"; // soft
}

const UNDO_RANK: Record<UndoCost, number> = { none: 0, low: 1, medium: 2, high: 3 };

function isSeoOrUrlField(fieldPath: string): boolean {
  const head = fieldPath.split(/[.[]/)[0] ?? "";
  return head === "seo" || head === "meta" || head === "slug" || /(^|\.)slug$/.test(fieldPath);
}

/**
 * v1.0 undo cost from what the draft actually changes (author_diff), not review_mode.
 * low: locale text/image · medium: seo / meta / slug · high: page-level (common) fields,
 * sections, first publish of a locale, or any shared template.
 */
export function undoCostFromDiff(
  entries: Array<Pick<ProposalEntryRow, "slug" | "author_diff"> & { liveMissing?: boolean }>,
): { cost: UndoCost; reason?: UndoCostReason } {
  let cost: UndoCost = "none";
  let reason: UndoCostReason | undefined;
  const bump = (next: UndoCost, why: UndoCostReason) => {
    if (UNDO_RANK[next] > UNDO_RANK[cost]) {
      cost = next;
      reason = why;
    }
  };
  for (const e of entries) {
    if (isTemplateVersioningSlug(e.slug)) bump("high", "shared_template");
    if (e.liveMissing) bump("high", "first_publish");
    for (const c of e.author_diff ?? []) {
      if (c.scope === "common") bump("high", "page_level_fields");
      else if (c.field_path === "sections" || c.field_path.startsWith("sections.") || c.field_path.startsWith("sections["))
        bump("high", "sections");
      else if (isSeoOrUrlField(c.field_path)) bump("medium", "seo_or_url");
      else bump("low", "locale_fields");
    }
  }
  return reason ? { cost, reason } : { cost };
}

function lookupKey(contentType: string, slug: string, locale: string, variant?: string | null) {
  return `${contentType}\0${slug}\0${locale}\0${variant?.trim() || ""}`;
}

function findLookup(
  lookups: EntryExistenceLookup[],
  contentType: string,
  slug: string,
  locale: string,
  variant?: string | null,
): EntryExistenceLookup | undefined {
  const exact = lookups.find(
    (l) =>
      l.contentType === contentType &&
      l.slug === slug &&
      l.locale === locale &&
      (l.variant?.trim() || "") === (variant?.trim() || ""),
  );
  if (exact) return exact;
  return lookups.find(
    (l) => l.contentType === contentType && l.slug === slug && l.locale === locale,
  );
}

export function classifyProposalReview(opts: ClassifyProposalReviewOpts): ReviewContext {
  const {
    proposal,
    lookups,
    relatedOpen = [],
    snapshot,
    promoteDraftText,
    claimCueJevOutcome,
    countsAsLeadForm,
  } = opts;
  const warnings: ReviewWarning[] = [];
  const checklists = new Set<ChecklistId>();
  const entryContexts: ReviewEntryContext[] = [];
  let block_apply = false;
  let liveSituations: ReviewSituationId[] = [];
  let filedReviewSituations: ReviewSituationId[] = [];
  let situationSource: SituationSource = "inferred";
  let needs_jev_claim_check = false;
  let claim_cue_text: string | undefined;
  let figuresActive = false;
  let figureHits: VariableTokenHit[] = [];
  let factHits: VariableTokenHit[] = [];
  const defs = opts.variableDefinitions ?? null;
  let contentTypeFitThink: { id: string; title: string; why: string; look_for: string[] } | null = null;

  const review_mode_operative = proposal.kind === "edits";
  let undo_cost = undoCostFor(proposal.kind, proposal.review_mode);
  let undo_cost_reason: UndoCostReason | undefined;
  if (proposal.kind === "edits" && proposal.system_version) {
    const fromDiff = undoCostFromDiff(
      proposal.entries.map((e) => ({
        slug: e.slug,
        author_diff: e.author_diff,
        liveMissing: findLookup(lookups, e.contentType, e.slug, e.locale, e.variant)?.existence === "missing",
      })),
    );
    undo_cost = fromDiff.cost === "none" ? "low" : fromDiff.cost;
    undo_cost_reason = fromDiff.reason;
  }

  if (proposal.kind === "notes") {
    checklists.add("notes_close");
    checklists.add("review_mode_inert");
  }
  if (proposal.kind === "idea") {
    checklists.add("idea_accept");
    checklists.add("review_mode_inert");
  }

  let damage_class: DamageClass = "none";
  let createsAttached = false;
  /** New page / language (or legacy create) whose layout the entry owns. */
  let createsPage = false;
  let layoutStructural = false;
  let layoutOwnerEntryStructural = false;
  let layoutSwitched = false;
  let allFieldsOnly = false;
  const templateLocales = new Set<string>();

  if (proposal.kind === "edits") {
    const workEntries = proposal.entries.filter(
      (e) => !e.status || e.status === "pending" || e.status === "failed",
    );
    const toClassify = workEntries.length ? workEntries : proposal.entries;
    allFieldsOnly = toClassify.length > 0;

    const locked = opts.implementedIdeaSeoTarget;
    if (locked) {
      const diff = seoTargetDiff(
        toClassify.flatMap((e) => e.ops ?? []),
        locked,
      );
      if (diff.differs) {
        warnings.push({
          code: "idea_seo_target_override",
          message:
            `Locked SEO target: ${describeIdeaSeoTarget(locked)}. These edits change the ${diff.fields.join(" and ")}` +
            ` (proposed: ${JSON.stringify(diff.proposed)}). Override reason: ${proposal.seo_target_override?.reason ?? "(none)"}. Reviewer: is the reason credible?`,
        });
      } else {
        warnings.push({
          code: "idea_seo_target_locked",
          message: `Implements an idea with locked SEO target ${describeIdeaSeoTarget(locked)}; the new page's draft is seeded with it.`,
        });
      }
    }

    for (const e of toClassify) {
      const lu = findLookup(lookups, e.contentType, e.slug, e.locale, e.variant);
      const existence: ExistenceState = lu?.existence ?? "unknown";
      const draftExists = Boolean(e.variant?.trim() && lu?.draftExists);
      const liveMissing = existence === "missing";
      const createsEntry =
        e.baseline_context?.creates_entry === true && !e.variant?.trim();
      if (createsEntry && liveMissing) createsAttached = true;
      const target_missing = liveMissing && !draftExists && !createsEntry;
      const owner = lu?.layout_owner;
      const isTemplate = Boolean(lu?.is_shared_template) || isTemplateVersioningSlug(e.slug);
      if (owner !== "shared_template" || isTemplate) allFieldsOnly = false;
      if (isTemplate) {
        templateLocales.add(e.locale);
        checklists.add("template_blast_radius");
      }
      const createdLayout = liveMissing && (draftExists || createsEntry) && (owner === "entry" || isTemplate);
      if (createdLayout || isStructuralSectionsChange(e.sections_summary)) {
        layoutStructural = true;
        if (owner === "entry" && !isTemplate) layoutOwnerEntryStructural = true;
      }
      if (
        lu?.layout_owner_at_filing === "entry" &&
        owner === "shared_template" &&
        !isTemplate &&
        (e.author_diff ?? []).some((c) => isSectionFieldPath(c.field_path))
      ) {
        layoutSwitched = true;
        warnings.push({
          code: "layout_owner_changed",
          message: `${e.contentType}/${e.slug} (${e.locale}) now uses the shared template (reattached); the draft's sections would be ignored. Author: revise to fields only or withdraw. Apply refuses with context_stale (reason layout_owner_changed).`,
        });
      }

      let dc = damageClassForTarget({
        contentType: e.contentType,
        category: proposal.category,
        existence,
        draftExists,
        createsEntry: createsEntry && liveMissing,
      });
      if (liveMissing && (draftExists || createsEntry) && owner === "entry" && !isTemplate) {
        createsPage = true;
        warnings.push({
          code: "creates_page_entry",
          message: `Applying publishes ${e.contentType}/${e.slug} (${e.locale}) from its draft, including its full layout (layout_owner: entry).`,
        });
      } else if (createsEntry && liveMissing) {
        warnings.push({
          code: "creates_attached_entry",
          message: `Applying creates ${e.contentType}/${e.slug} (${e.locale}). No draft. The shared template does not change.`,
        });
      }
      if (target_missing) {
        // Never label deleted target as new public content
        if (dc === "new_public_content") {
          dc = "existing_content";
        }
        block_apply = true;
        checklists.add("target_missing");
        warnings.push({
          code: "target_missing",
          message: `Entry ${e.contentType}/${e.slug} (${e.locale}) no longer exists — apply is blocked. Reject or withdraw, or restore the page and file fresh.`,
        });
      }
      if (liveMissing && draftExists) {
        dc = "new_public_content";
      }
      if (existence === "unknown") {
        checklists.add("existence_unknown");
        warnings.push({
          code: "existence_unknown",
          message: `Could not confirm whether ${e.contentType}/${e.slug} (${e.locale}) exists — verify before trusting this situation label.`,
        });
      }

      entryContexts.push({
        contentType: e.contentType,
        slug: e.slug,
        locale: e.locale,
        existence,
        damage_class: dc,
        ...(target_missing ? { target_missing: true } : {}),
        ...(owner ? { layout_owner: owner } : {}),
        ...(lu?.detached ? { detached: true as const } : {}),
        ...(isTemplate ? { is_shared_template: true as const } : {}),
      });
      damage_class = worseDamageClass(damage_class, dc);
    }
    if (layoutStructural) checklists.add("layout_structure");

    if (defs) {
      const valueText = [collectPendingOpValueText(toClassify), promoteDraftText ?? ""]
        .filter((t) => t.trim())
        .join("\n");
      figureHits = findFigureVariableTokens(valueText, defs);
      factHits = findFactVariableTokens(valueText, defs);
    }
    const figures = resolveOutcomeFiguresAttachment({
      entries: toClassify,
      reviewSituations: proposal.review_situations,
      promoteDraftText,
      claimCueJevOutcome,
      figureVariables: figureHits,
    });
    claim_cue_text = figures.claimCueText || undefined;
    needs_jev_claim_check = figures.needsJev;
    figuresActive = figures.figuresActive;

    if (figuresActive) {
      checklists.add("selling_page_figures");
      if (damage_class !== "new_public_content") {
        damage_class = worseDamageClass(damage_class, "selling_page");
        for (const ec of entryContexts) {
          if (ec.damage_class !== "new_public_content" && !ec.target_missing) {
            ec.damage_class = worseDamageClass(ec.damage_class, "selling_page");
          }
        }
      }
    }
    if (damage_class === "new_public_content") checklists.add("new_content_brand");

    if (figureHits.length) {
      warnings.push({
        code: "figure_variable_tokens",
        message: `Outcome figures turned on by variable tokens: ${figureHits.map((h) => h.name).join(", ")}. Check each is the right fact with list_variables.`,
      });
    }

    if (needs_jev_claim_check) {
      warnings.push({
        code: "claim_cue_ambiguous",
        message:
          "Proposed text may contain outcome figures (hire rate, salary, tuition, price) but local cues were inconclusive — awaiting automated claim check.",
      });
    }
    if (claimCueJevOutcome === "yes" || claimCueJevOutcome === "no") {
      warnings.push({
        code: "jev_claim_cue",
        message:
          claimCueJevOutcome === "yes"
            ? "Automated claim check (Jev) flagged outcome figures — verify sources before apply."
            : "Automated claim check (Jev) did not treat this as an outcome-figure change.",
      });
    } else if (claimCueJevOutcome === "unavailable") {
      warnings.push({
        code: "jev_claim_cue_unavailable",
        message:
          "Automated claim check was unavailable — figures checklist left off (fail-open). Authors may declare review_situations:[\"selling_figures\"] if needed.",
      });
    }

    if (countsAsLeadForm) {
      warnings.push({
        code: "counts_as_lead_form",
        message:
          "This page has a form whose conversion counts as a lead — treat commercial claims carefully. This hint alone does not require the outcome-figures checklist.",
      });
    }

    const workForOps = toClassify;
    const hasSerp = hasTitleDescriptionOps(workForOps);
    const serpOnly = isTitleDescriptionOnlyOps(workForOps);

    const filedSituations = (proposal.review_situations ?? []) as ReviewSituationId[];
    const inferred = inferSituationsFromOps(workForOps, {
      summary: proposal.summary,
      title: proposal.title,
      promoteOnApply: proposal.promote_on_apply,
      damageClass: damage_class === "none" ? null : damage_class,
      outcomeFigures: figuresActive,
    });
    const mergedSit = mergeSituations(filedSituations, inferred, workForOps, {
      promoteOnApply: proposal.promote_on_apply,
      damageClass: damage_class === "none" ? null : damage_class,
      outcomeFigures: figuresActive,
    });
    liveSituations = mergedSit.situations;
    filedReviewSituations = filedSituations;
    situationSource = mergedSit.source;
    warnings.push(...mergedSit.warnings);

    for (const c of checklistIdsForSituations(mergedSit.situations)) {
      checklists.add(c);
    }

    const linkOnly =
      mergedSit.situations.includes("internal_links") &&
      !mergedSit.situations.includes("body_copy_edit");
    const funnelOnly =
      mergedSit.situations.includes("funnel_classification") &&
      !mergedSit.situations.includes("body_copy_edit") &&
      !mergedSit.situations.includes("internal_links");
    const translationOnly =
      mergedSit.situations.includes("locale_translation") &&
      !mergedSit.situations.includes("body_copy_edit") &&
      !mergedSit.situations.includes("internal_links");

    if (hasSerp) {
      checklists.add("title_description_ctr");
      if (!serpOnly) {
        if (!linkOnly && !funnelOnly && !translationOnly) checklists.add("verify_copy");
        warnings.push({
          code: MIXED_SERP_AND_BODY,
          message:
            "This proposal mixes search title/description with other field updates. Prefer separate proposals next time; for now run both the title/description harm scorecard and body packs. Create still succeeds. Per-situation ship: drop failing SERP ops via revise_entries before apply.",
        });
      }
    } else if (!linkOnly && !funnelOnly && !translationOnly) {
      checklists.add("verify_copy");
    }

    if (
      !block_apply &&
      (damage_class === "existing_metadata" ||
        damage_class === "existing_content" ||
        damage_class === "selling_page")
    ) {
      checklists.add("adjacent_findings");
    }
    checklists.add("disposition");
  } else if (proposal.kind === "idea") {
    const filedRaw = (proposal.review_situations ?? []) as string[];
    const filedDemand = filedRaw.filter(isIdeaAuthorSituationId) as ReviewSituationId[];
    liveSituations = [IDEA_DEFAULT_SITUATION_ID, ...filedDemand];
    filedReviewSituations = filedDemand;
    situationSource = filedDemand.length ? "author" : "inferred";
    for (const c of checklistIdsForSituations(liveSituations)) {
      checklists.add(c);
    }

    if (
      filedDemand.length === 0 &&
      looksLikeExistingDemandPitch(proposal.title, proposal.summary)
    ) {
      warnings.push({
        code: EXISTING_DEMAND_UNDECLARED,
        message:
          "This brief looks like a current-demand rank/cite pitch. Retag with set_review_situations:[\"existing_demand\"] (or change the goal to assist-only). existing_demand is not auto-attached.",
      });
    }

    const related = proposal.related_entries ?? [];
    const relatedWithEx = related.map((r) => {
      const locale = r.locale?.trim() || "en";
      const lu = findLookup(lookups, r.contentType, r.slug, locale);
      return {
        contentType: r.contentType,
        slug: r.slug,
        locale,
        existence: (lu?.existence ?? "unknown") as ExistenceState,
      };
    });
    const needsIdeaFunnel = ideaRequiresStructuredFunnel({
      title: proposal.title,
      summary: proposal.summary,
      related_entries: relatedWithEx,
      accepted_entry: proposal.accepted_entry
        ? {
            ...proposal.accepted_entry,
            existence:
              findLookup(
                lookups,
                proposal.accepted_entry.contentType,
                proposal.accepted_entry.slug,
                proposal.accepted_entry.locale,
              )?.existence ?? "missing",
          }
        : null,
    });
    if (needsIdeaFunnel && !ideaFunnelComplete(proposal.idea_funnel)) {
      warnings.push({
        code: IDEA_FUNNEL_MISSING_WARN,
        message:
          "New-URL idea is missing structured idea_funnel (stage + products). Create still succeeds — set via set_idea_funnel before accept. Reviewer: add_blocker until the author fills it. products \"all\" only with stage awareness.",
      });
    }
    const seoMonitored = opts.ideaSeoTargetMonitored;
    const targetTypes = proposal.accepted_entry
      ? [proposal.accepted_entry.contentType]
      : relatedWithEx.filter((r) => r.existence === "missing").map((r) => r.contentType);
    if (
      needsIdeaFunnel &&
      seoMonitored &&
      targetTypes.some((ct) => seoMonitored(ct)) &&
      !ideaSeoTargetComplete(proposal.idea_seo_target)
    ) {
      warnings.push({
        code: IDEA_SEO_TARGET_MISSING_WARN,
        message:
          "New-URL idea on an SEO-monitored type is missing idea_seo_target (main_keyword + cluster: join a live hub, become a hub with named members, or standalone for news/broken-URL only). Create still succeeds — set via set_idea_seo_target before accept.",
      });
    }
    if (proposal.idea_seo_target) {
      warnings.push({
        code: "idea_seo_target",
        message: `SEO target: ${describeIdeaSeoTarget(proposal.idea_seo_target)}. Reviewer: keyword matches the brief, hub fits the topic, members are real posts, standalone reason is credible.`,
      });
      if (!ideaSeoTargetHasMetrics(proposal.idea_seo_target)) {
        warnings.push({
          code: IDEA_SEO_TARGET_METRICS_MISSING_WARN,
          message:
            "idea_seo_target has no kw_monthly_volume and/or kw_difficulty. Accept still works. Reviewer: add_blocker asking the author to copy both numbers from their keyword research into set_idea_seo_target (volume claimed only in the brief text is not enough). Metrics stay on the idea and are not written to the page.",
        });
      }
    }

    const typeReview = reviewIdeaContentTypes({
      related,
      known: opts.knownContentTypes ?? null,
      strategies: opts.contentTypeStrategies ?? null,
      createdAt: proposal.created_at ?? null,
    });
    warnings.push(...typeReview.warnings);
    contentTypeFitThink = typeReview.think;

    if (related.length === 0) {
      damage_class = "none";
    } else {
      for (const r of relatedWithEx) {
        const existence = r.existence;
        const dc = damageClassForTarget({
          contentType: r.contentType,
          existence,
          forIdea: true,
          draftExists: false,
        });
        // Missing → new_public_content (any type)
        const resolved = existence === "missing" ? "new_public_content" : dc;
        const rlu = findLookup(lookups, r.contentType, r.slug, r.locale);
        entryContexts.push({
          contentType: r.contentType,
          slug: r.slug,
          locale: r.locale,
          existence,
          damage_class: resolved,
          ...(rlu?.layout_owner ? { layout_owner: rlu.layout_owner } : {}),
          ...(rlu?.detached ? { detached: true as const } : {}),
          ...(rlu?.is_shared_template ? { is_shared_template: true as const } : {}),
        });
        damage_class = worseDamageClass(damage_class === "none" ? resolved : damage_class, resolved);
        if (existence === "unknown") {
          checklists.add("existence_unknown");
        }
      }
      // Brand / selling-figure ship gates stay on follow-up edits — not on idea accept.
    }
  }

  // Sibling dedup
  const siblings = relatedOpen.filter((s) => s.id !== proposal.id);
  if (siblings.length) {
    warnings.push({
      code: "shared_issue_id",
      message: `Open proposal(s) share related issue id(s): ${siblings.map((s) => s.id).join(", ")}.`,
    });
    const hasNotesSibling = siblings.some((s) => s.kind === "notes" || s.kind === "idea");
    const hasEditsSibling = siblings.some((s) => s.kind === "edits");
    if (proposal.kind === "edits" && hasNotesSibling) checklists.add("dedup_coordinate");
    if (proposal.kind === "edits" && hasEditsSibling) checklists.add("dedup_competing_edits");
    if (proposal.kind === "notes" && hasEditsSibling) checklists.add("dedup_fix_pending");
    if (proposal.kind === "notes" && hasNotesSibling) checklists.add("dedup_coordinate");
  }

  if (!review_mode_operative) {
    // already added review_mode_inert
  }

  const orderedIds = selectThinkTemplates(checklists);

  const factChecklistActive = orderedIds.some((t) => SITE_FACT_CHECKLISTS.has(t.id));
  const siteFactsCheck = factChecklistActive ? opts.siteFactsCheck ?? null : null;
  const needs_site_facts_check =
    factChecklistActive && !siteFactsCheck && siteFactsInputText(proposal, promoteDraftText).trim() !== "";
  if (siteFactsCheck?.outcome === "unavailable") {
    warnings.push({
      code: "jev_unavailable",
      message:
        "Automated fact check unavailable; discovery shows all site facts (list_variables facts_only). Check every stat against the catalog.",
    });
  }

  const meta = DAMAGE_CLASS_META[damage_class];
  let relatedStaff: string | undefined;
  if (siblings.length) {
    if (proposal.kind === "edits" && siblings.some((s) => s.kind === "notes")) {
      relatedStaff =
        "Related notes share an issue — if this is the fix, apply then close the notes. Do not reject only because notes exist.";
    } else if (proposal.kind === "edits" && siblings.some((s) => s.kind === "edits")) {
      relatedStaff =
        "Another open edits proposal overlaps — compare updates; do not apply both without comparing.";
    } else if (proposal.kind === "notes" && siblings.some((s) => s.kind === "edits")) {
      relatedStaff =
        "An open edits proposal may already be the fix — check it before closing this notes handoff.";
    } else {
      relatedStaff = `Related open proposals: ${siblings.map((s) => s.id).join(", ")}.`;
    }
  }

  const situation_changed_since_filed = Boolean(
    snapshot?.damage_class && snapshot.damage_class !== damage_class,
  );
  if (situation_changed_since_filed) {
    warnings.push({
      code: "situation_changed",
      message: `Situation changed since filed (was ${snapshot!.damage_class}, now ${damage_class}).`,
    });
  }
  if (block_apply && !situation_changed_since_filed && snapshot?.damage_class) {
    // still flag change when target went missing
  }

  const summaryParts = [meta.situation_description];
  if (proposal.kind === "idea") {
    if (liveSituations.includes("broken_url")) {
      summaryParts[0] = BROKEN_URL_STAFF_NOTE;
    } else if (liveSituations.includes("existing_demand")) {
      summaryParts[0] = EXISTING_DEMAND_STAFF_NOTE;
    } else if (liveSituations.includes("anticipated_demand")) {
      summaryParts[0] = ANTICIPATED_DEMAND_STAFF_NOTE;
    } else if (liveSituations.includes("fast_decay_news")) {
      summaryParts[0] = FAST_DECAY_NEWS_STAFF_NOTE;
    } else {
      summaryParts[0] = IDEA_OPPORTUNITY_HARM_STAFF_NOTE;
    }
  }
  if (block_apply) summaryParts.push("Apply is blocked — target no longer exists.");
  if (situation_changed_since_filed) {
    summaryParts.push(`Changed since filed (was ${snapshot!.damage_class}).`);
  }
  const hasTitleDescChecklist = orderedIds.some((t) => t.id === "title_description_ctr");
  const hasInternalLinksChecklist = orderedIds.some((t) => t.id === "internal_links");
  const hasFunnelChecklist = orderedIds.some((t) => t.id === "funnel_persona_product_stage");
  const hasLocaleTranslationChecklist = orderedIds.some((t) => t.id === "locale_translation");
  if (hasTitleDescChecklist && !block_apply) {
    summaryParts.push(TITLE_DESCRIPTION_STAFF_NOTE);
  }
  if (hasInternalLinksChecklist && !block_apply) {
    summaryParts.push(INTERNAL_LINKS_STAFF_NOTE);
  }
  if (hasFunnelChecklist && !block_apply) {
    summaryParts.push(FUNNEL_CLASSIFICATION_STAFF_NOTE);
  }
  if (hasLocaleTranslationChecklist && !block_apply) {
    summaryParts.push(LOCALE_TRANSLATION_STAFF_NOTE);
  }
  for (const note of staffNotesForSituations(liveSituations)) {
    if (
      !block_apply &&
      note !== TITLE_DESCRIPTION_STAFF_NOTE &&
      note !== INTERNAL_LINKS_STAFF_NOTE &&
      note !== FUNNEL_CLASSIFICATION_STAFF_NOTE &&
      note !== LOCALE_TRANSLATION_STAFF_NOTE &&
      note !== IDEA_OPPORTUNITY_HARM_STAFF_NOTE &&
      note !== ANTICIPATED_DEMAND_STAFF_NOTE &&
      note !== EXISTING_DEMAND_STAFF_NOTE &&
      note !== FAST_DECAY_NEWS_STAFF_NOTE &&
      note !== BROKEN_URL_STAFF_NOTE &&
      !summaryParts.includes(note)
    ) {
      summaryParts.push(note);
    }
  }

  const templateCount = proposal.affected_entries?.count;
  const templateStaff = templateLocales.size
    ? `This changes the shared layout for ${templateCount ?? "every attached"} page${templateCount === 1 ? "" : "s"} in ${[...templateLocales].sort().join(", ")}. Pages with their own layout (detached) are not affected.`
    : null;
  let staffSituation = block_apply
    ? "The page this proposal edits no longer exists — apply is blocked; reject or withdraw, or restore the page and file fresh."
    : createsPage
      ? "Applying publishes this new page from its draft, including its full layout. Judge angle, facts, and funnel — not only whether apply is easy."
    : createsAttached
      ? "Applying creates this post. The slug was reserved by the accepted idea. The shared template does not change."
      : templateStaff
        ? templateStaff
      : proposal.kind === "idea"
        ? liveSituations.includes("broken_url")
          ? BROKEN_URL_STAFF_NOTE
          : liveSituations.includes("existing_demand")
            ? EXISTING_DEMAND_STAFF_NOTE
            : liveSituations.includes("anticipated_demand")
              ? ANTICIPATED_DEMAND_STAFF_NOTE
              : liveSituations.includes("fast_decay_news")
                ? FAST_DECAY_NEWS_STAFF_NOTE
                : IDEA_OPPORTUNITY_HARM_STAFF_NOTE
        : meta.situation_description;
  if (hasTitleDescChecklist && !block_apply) {
    staffSituation = `${staffSituation} ${TITLE_DESCRIPTION_STAFF_NOTE}`;
  }
  if (hasInternalLinksChecklist && !block_apply) {
    staffSituation = `${staffSituation} ${INTERNAL_LINKS_STAFF_NOTE}`;
  }
  if (hasFunnelChecklist && !block_apply) {
    staffSituation = `${staffSituation} ${FUNNEL_CLASSIFICATION_STAFF_NOTE}`;
  }
  if (hasLocaleTranslationChecklist && !block_apply) {
    staffSituation = `${staffSituation} ${LOCALE_TRANSLATION_STAFF_NOTE}`;
  }
  if (layoutSwitched && !block_apply) {
    staffSituation = `${staffSituation} This page now uses the shared layout, so the proposed layout would be ignored. The author needs to update the proposal.`;
  }
  if (templateStaff && !block_apply && staffSituation !== templateStaff && !staffSituation.includes(templateStaff)) {
    staffSituation = `${staffSituation} ${templateStaff}`;
  }
  if (liveSituations.length && !block_apply) {
    staffSituation = `${staffSituation} Review situations: ${liveSituations.join(", ")}.`;
  }

  return {
    undo_cost,
    ...(undo_cost_reason ? { undo_cost_reason } : {}),
    damage_class,
    review_mode_operative,
    active_checklists: orderedIds.map((t) => t.id),
    review_situations: liveSituations,
    filed_review_situations: filedReviewSituations,
    situation_source: situationSource,
    entries: entryContexts,
    ...(siblings.length ? { related_open_proposals: siblings } : {}),
    summary: summaryParts.join(" "),
    staff_summary: {
      badge_label: block_apply
        ? "Target missing"
        : proposal.kind === "idea"
          ? "Idea brief"
          : meta.badge_label,
      situation_description: staffSituation,
      risk: block_apply
        ? "Apply blocked — target gone."
        : proposal.kind === "idea"
          ? "Accept locks a brief only — no live YAML until a later edits proposal."
          : meta.risk,
      undo: UNDO_COPY[undo_cost],
      ...(relatedStaff ? { related: relatedStaff } : {}),
    },
    ...(proposal.kind === "idea" && opts.contentTypeStrategies
      ? { content_type_strategies: opts.contentTypeStrategies }
      : {}),
    agent_preview: {
      think_items: withContentTypeFitThink(orderedIds.map((t) => ({
        id: t.id,
        title: t.title,
        why: t.why,
        look_for: (() => {
          const base = [...t.look_for];
          if (t.id === "layout_structure") {
            if (layoutOwnerEntryStructural) {
              base.unshift("layout_owner: entry — this draft is the whole page; review the layout, not only the fields");
            } else if (templateLocales.size) {
              base.unshift("is_shared_template — this draft is the shared layout for every attached entry in that language");
            }
          }
          if (t.id === "verify_copy" && allFieldsOnly) {
            base.push("layout_owner: shared_template — the template is unaffected; review fields only");
          }
          if (
            countsAsLeadForm &&
            (t.id === "selling_page_figures" || t.id === "disposition" || t.id === "verify_copy")
          ) {
            base.push(
              "soft: page has a Count-as-lead conversion form — commercial caution only; does not alone require figure verification",
            );
          }
          return base;
        })(),
      })), contentTypeFitThink),
      warnings,
    },
    block_apply,
    ...(situation_changed_since_filed
      ? { situation_changed_since_filed: true, filed_damage_class: snapshot!.damage_class }
      : {}),
    ...(needs_jev_claim_check ? { needs_jev_claim_check: true } : {}),
    ...(claim_cue_text ? { claim_cue_text } : {}),
    ...(figureHits.length && defs ? { figure_variables: summarizeFigureVariables(figureHits, defs) } : {}),
    ...(factHits.length ? { fact_variable_names: factHits.map((h) => h.name) } : {}),
    ...(needs_site_facts_check ? { needs_site_facts_check: true } : {}),
    ...(siteFactsCheck ? { site_facts: siteFactsCheck } : {}),
    ...(countsAsLeadForm ? { counts_as_lead_hint: true } : {}),
    ...(claimCueJevOutcome
      ? {
          jev: {
            called: true as const,
            outcome: claimCueJevOutcome,
            decision_id: DECISION_ID_TOUCHES_OUTCOME_FIGURES,
            at: new Date().toISOString(),
          },
        }
      : {}),
  };
}

/** Distinct damage classes across targets — for mixed_risk_bundle refuse. */
export function collectDamageClassesForMixedCheck(
  targets: Array<{
    contentType: string;
    category?: ProposalCategory;
    existence: ExistenceState;
    draftExists?: boolean;
    forIdea?: boolean;
    createsEntry?: boolean;
    /** When true, existing targets count as selling_page (outcome figures). */
    outcomeFigures?: boolean;
  }>,
): DamageClass[] {
  const set = new Set<DamageClass>();
  for (const t of targets) {
    let dc = damageClassForTarget(t);
    if (t.forIdea && t.existence === "missing") {
      dc = "new_public_content";
    }
    if (t.existence === "missing" && (t.draftExists || t.createsEntry)) {
      dc = "new_public_content";
    }
    if (t.outcomeFigures && dc !== "new_public_content") {
      dc = "selling_page";
    }
    set.add(dc);
  }
  return [...set];
}

/**
 * Mixed-risk refuse: selling or new-public must not share a proposal with a different class.
 * existing_metadata + existing_content on the same non-selling types is allowed.
 */
export function isMixedRiskBundle(classes: DamageClass[]): boolean {
  const buckets = new Set(
    classes.map((c) =>
      c === "existing_metadata" || c === "existing_content" ? "existing" : c,
    ),
  );
  buckets.delete("none");
  return buckets.size > 1;
}

export function snapshotFromReviewContext(ctx: ReviewContext): Record<string, unknown> {
  return {
    damage_class: ctx.damage_class,
    undo_cost: ctx.undo_cost,
    ...(ctx.undo_cost_reason ? { undo_cost_reason: ctx.undo_cost_reason } : {}),
    badge_label: ctx.staff_summary.badge_label,
    situation_description: ctx.staff_summary.situation_description,
    active_checklists: ctx.active_checklists,
    block_apply: ctx.block_apply,
    review_situations: ctx.review_situations,
    filed_review_situations: ctx.filed_review_situations,
    situation_source: ctx.situation_source,
    ...(ctx.jev ? { jev: ctx.jev } : {}),
    ...(ctx.counts_as_lead_hint ? { counts_as_lead_hint: true } : {}),
  };
}

export function parseReviewSnapshot(raw: string | null | undefined): {
  damage_class?: string;
  badge_label?: string;
} | null {
  if (!raw || raw === "null") return null;
  try {
    const o = JSON.parse(raw) as { damage_class?: string; badge_label?: string };
    if (!o || typeof o !== "object") return null;
    return o;
  } catch {
    return null;
  }
}

/** @internal test helper */
export function _lookupKeyForTests(...args: Parameters<typeof lookupKey>) {
  return lookupKey(...args);
}
