/**
 * Author-declared / inferred review situations.
 * Each id owns a guide + checklist pack + discovery overlays for Proposal Reviewer.
 */

import {
  isTitleDescriptionFieldPath,
  type ChecklistId,
  type DamageClass,
} from "./proposal-review-rules.js";

export const REVIEW_SITUATION_IDS = [
  "internal_links",
  "serp_title_description",
  "funnel_classification",
  "body_copy_edit",
  "selling_figures",
  "new_public_content",
  "promote_draft",
  "locale_translation",
  "idea_opportunity_harm",
] as const;

export type ReviewSituationId = (typeof REVIEW_SITUATION_IDS)[number];

/** Default-on for every open idea — not author-declared; not used on edits. */
export const IDEA_DEFAULT_SITUATION_ID: ReviewSituationId = "idea_opportunity_harm";

export type SituationSource = "author" | "inferred" | "merged";

export type ReviewSituationDef = {
  id: ReviewSituationId;
  label: string;
  when_to_use: string;
  /** Hub topic for explain_site (usually "proposals"). */
  explain_topic: string;
  /** Optional playbook under explain hub (e.g. proposals + translations). */
  explain_subtopic?: string;
  checklist_ids: ChecklistId[];
  staff_note: string;
  /** Extra discovery look_for lines for get_entry_content when this situation is active. */
  discovery_content_look_for: string[];
  author_summary_hints: string[];
};

export const SITUATION_OPS_MISMATCH = "situation_ops_mismatch";
export const SITUATION_INFERRED_BODY = "situation_inferred_body";

const INTERNAL_LINK_INTENT_RE =
  /\b(internal\s*links?|hub\s*links?|pillar|cluster\s*visibility|inbound\s*links?|linking\s*gaps?)\b/i;

/** Summary/title cues that a promote packet is a locale translation (infer fallback). */
const TRANSLATION_INTENT_RE =
  /\b(translat(e|ion|ed|ing)|locale\s+variant|from\s+[a-z]{2}\s*(→|->|to)\s*[a-z]{2}|en\s*(→|->)\s*es|es\s*(→|->)\s*en)\b/i;

export const SITUATION_LOCALE_TRANSLATION_UNDECLARED = "locale_translation_undeclared";

export const REVIEW_SITUATION_CATALOG: Record<ReviewSituationId, ReviewSituationDef> = {
  internal_links: {
    id: "internal_links",
    label: "Hub / internal links",
    when_to_use:
      "Body edits whose point is adding same-locale hub or cluster links without rewriting facts or SERP fields.",
    explain_topic: "proposals",
    explain_subtopic: "internal-links",
    checklist_ids: ["internal_links"],
    staff_note:
      "Also check hub links — facts and locale targets intact, not punchier prose.",
    discovery_content_look_for: [
      "list added [text](href) vs live; confirm each new href exists and matches article locale",
      "no dropped figures, years, employers, or sources to make room for links",
      "anchors on existing phrases — not new sales CTAs minted only to hang the link",
      "hub / pillar / in-cluster sibling fit — not money-page spray",
    ],
    author_summary_hints: [
      "Add same-locale internal links to the cluster hub. Content field only. Live figures stay as-is. No title or description changes.",
    ],
  },
  serp_title_description: {
    id: "serp_title_description",
    label: "Search title / description",
    when_to_use:
      "Changes to search title or meta description on a live page — honest vs live, not punchier-copy coaching.",
    explain_topic: "proposals",
    explain_subtopic: "serp-title-description",
    checklist_ids: ["title_description_ctr"],
    staff_note:
      "Also check search title/description — honest and not worse than live.",
    discovery_content_look_for: [],
    author_summary_hints: [
      "Fix search title and/or description vs live. Claims must stay honest. No body rewrite in this packet.",
    ],
  },
  funnel_classification: {
    id: "funnel_classification",
    label: "Funnel stage / products",
    when_to_use:
      "Changes to funnel.stage or funnel.products — match buyer persona → product → stage, not whether the article feels broad.",
    explain_topic: "proposals",
    explain_subtopic: "funnel-classification",
    checklist_ids: ["funnel_persona_product_stage"],
    staff_note:
      "Also check funnel — who the buyer is, which product owns them, then how ready they are (not whether the article feels broad).",
    discovery_content_look_for: [
      "content intent vs product personas (list_products → get_product) — not topical breadth alone",
      "proposed funnel.products bindings (or all) follow persona → product fit; all never carries personas",
      "proposed funnel.stage matches readiness even if only stage or only products moved",
      "do not map broad/company-wide topic to products:all or a non-fitting product without persona fit",
    ],
    author_summary_hints: [
      "Classify funnel.stage and/or funnel.products only. Intent matches persona → product → stage. Soft batch ≤10 related posts. No body or SERP in this packet.",
    ],
  },
  body_copy_edit: {
    id: "body_copy_edit",
    label: "Body / field edit",
    when_to_use:
      "General copy or field updates on an existing page that are not link-only or SERP-only packs.",
    explain_topic: "proposals",
    explain_subtopic: "situations",
    checklist_ids: ["verify_copy"],
    staff_note: "Check proposed fields against live — catch breakage and invented claims.",
    discovery_content_look_for: [
      "proposed fields vs live copy",
      "no invented stats in the proposed text",
    ],
    author_summary_hints: [
      "Update body or fields for accuracy or clarity. Intent + why only in summary; ops own the values.",
    ],
  },
  selling_figures: {
    id: "selling_figures",
    label: "Selling-page figures",
    when_to_use:
      "Edits on a program or landing page where hire rates, salaries, prices, or outcome claims may move.",
    explain_topic: "proposals",
    explain_subtopic: "situations",
    checklist_ids: ["selling_page_figures"],
    staff_note:
      "This page sells — verify every outcome figure against an approved source before apply.",
    discovery_content_look_for: [
      "proposed number vs approved source",
      "locale of the figure",
    ],
    author_summary_hints: [
      "Update selling-page outcome figures with sources. Confirm every hire rate, salary, or price.",
    ],
  },
  new_public_content: {
    id: "new_public_content",
    label: "New public content",
    when_to_use:
      "New or draft-backed public page — judge angle, facts, and funnel, not only whether apply is easy.",
    explain_topic: "proposals",
    explain_subtopic: "situations",
    checklist_ids: ["new_content_brand"],
    staff_note:
      "New public content — clear the brand gate (angle, facts, real program CTA).",
    discovery_content_look_for: [
      "defensible technical or educational angle",
      "facts checked against the product",
      "CTA or link to a real program",
    ],
    author_summary_hints: [
      "New public page or draft promote path. Angle, facts, and funnel CTA must be defensible.",
    ],
  },
  promote_draft: {
    id: "promote_draft",
    label: "Promote draft",
    when_to_use:
      "Go-live / promote a named draft with empty or minimal field updates — why this draft should become live.",
    explain_topic: "proposals",
    explain_subtopic: "situations",
    checklist_ids: ["verify_copy", "disposition"],
    staff_note: "Promote writes the draft to live — confirm the draft is the intended public version.",
    discovery_content_look_for: [
      "why this draft should become live",
      "preview owns exact copy — summary is intent only",
    ],
    author_summary_hints: [
      "Promote this draft to live. Summary explains why the draft should become public.",
    ],
  },
  locale_translation: {
    id: "locale_translation",
    label: "Locale translation",
    when_to_use:
      "Promote a translated locale variant (optional field ops) — fidelity to source locale before go-live, not soft-only polish without promote.",
    explain_topic: "proposals",
    explain_subtopic: "translations",
    checklist_ids: ["locale_translation"],
    staff_note:
      "Also check locale translation — draft matches source meaning and facts before go-live, not punchier copy vs live.",
    discovery_content_look_for: [
      "draft (locale + variant) vs source locale meaning and facts — same years, employers, sources",
      "required fields ready on the variant; url_slug locale-fitting",
      "shell still from template.{locale}.yml unless detached intentionally",
      "apply promotes the variant — does not AI-translate or invent sibling locales",
    ],
    author_summary_hints: [
      "Translated from en → es. Promote draft.{locale} — facts match source; slug locale-fitting. review_situations:[locale_translation] + promote_on_apply.",
    ],
  },
  idea_opportunity_harm: {
    id: "idea_opportunity_harm",
    label: "Idea opportunity vs harm",
    when_to_use:
      "Every idea brief — score whether the opportunity is real and whether accepting would harm the site. Default-on; not author-declared.",
    explain_topic: "proposals",
    explain_subtopic: "idea-opportunity-harm",
    checklist_ids: ["idea_opportunity_harm"],
    staff_note:
      "Brief to greenlight or decline — accepting does not publish. Score whether the opportunity is real and whether accepting would harm the site.",
    discovery_content_look_for: [
      "90-day goal cite/rank/assist — not fill a cluster hole",
      "query evidence or SERP set in the brief",
      "named siblings / cannibal risk",
      "kill criterion; link budget; locale doubling",
      "wrong vehicle (funnel/SERP/links-only) → close and refile as edits",
    ],
    author_summary_hints: [
      "Pitch a new URL or structural brief with goal, evidence, cannibal check, kill line, and link budget. Accept is greenlight only — no YAML.",
    ],
  },
};

export function isReviewSituationId(value: string): value is ReviewSituationId {
  return (REVIEW_SITUATION_IDS as readonly string[]).includes(value);
}

export function parseReviewSituationIds(
  raw: unknown,
): { ok: true; ids: ReviewSituationId[] } | { ok: false; error: string; unknown?: string[] } {
  if (raw == null) return { ok: true, ids: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, error: "review_situations must be an array of situation ids" };
  }
  const unknown: string[] = [];
  const ids: ReviewSituationId[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string" || !item.trim()) {
      return { ok: false, error: "review_situations entries must be non-empty strings" };
    }
    const id = item.trim();
    if (!isReviewSituationId(id)) {
      unknown.push(id);
      continue;
    }
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  if (unknown.length) {
    return {
      ok: false,
      error: `Unknown review_situations: ${unknown.join(", ")}. Valid: ${REVIEW_SITUATION_IDS.join(", ")}`,
      unknown,
    };
  }
  return { ok: true, ids };
}

export type OpsEntryForSituation = {
  status?: string | null;
  contentType?: string;
  /** Named non-public layer (required for promote_on_apply / locale_translation shape). */
  variant?: string | null;
  ops?: Array<{ field_path?: string } | null> | null;
  updates?: Array<{ field_path?: string } | null> | null;
};

function pendingFieldPaths(entries: OpsEntryForSituation[]): string[] {
  const out: string[] = [];
  for (const e of entries) {
    if (e.status && e.status !== "pending" && e.status !== "failed") continue;
    const ops = e.ops ?? e.updates ?? [];
    for (const op of ops) {
      if (op && typeof op.field_path === "string" && op.field_path.trim()) {
        out.push(op.field_path.trim());
      }
    }
  }
  return out;
}

function isBodyFieldPath(fieldPath: string): boolean {
  const p = fieldPath.trim();
  if (isTitleDescriptionFieldPath(p)) return false;
  if (isFunnelFieldPath(p)) return false;
  if (p === "content" || p.startsWith("content.")) return true;
  if (p === "sections" || p.startsWith("sections[")) return true;
  if (p.includes(".content") || p.endsWith("content")) return true;
  return false;
}

/** Funnel targeting fields on `_common.yml` (locale-agnostic). */
export function isFunnelFieldPath(fieldPath: string): boolean {
  const p = fieldPath.trim();
  return p === "funnel" || p.startsWith("funnel.");
}

function isNonFunnelOtherPath(fieldPath: string): boolean {
  return (
    !isTitleDescriptionFieldPath(fieldPath) &&
    !isBodyFieldPath(fieldPath) &&
    !isFunnelFieldPath(fieldPath)
  );
}

function hasAnyPendingOps(entries: OpsEntryForSituation[]): boolean {
  return pendingFieldPaths(entries).length > 0;
}

function isPromoteOnly(entries: OpsEntryForSituation[], promoteOnApply?: boolean): boolean {
  if (!promoteOnApply) return false;
  return !hasAnyPendingOps(entries);
}

function hasNamedVariant(entries: OpsEntryForSituation[]): boolean {
  return entries.some((e) => typeof e.variant === "string" && e.variant.trim().length > 0);
}

/** promote_on_apply + named variant — soft-only (no promote) is never locale_translation. */
export function isLocaleTranslationShape(
  entries: OpsEntryForSituation[],
  promoteOnApply?: boolean,
): boolean {
  return Boolean(promoteOnApply) && hasNamedVariant(entries);
}

function hasTranslationIntent(title?: string | null, summary?: string | null): boolean {
  return TRANSLATION_INTENT_RE.test(`${title ?? ""} ${summary ?? ""}`);
}

/** Which situations still “own” at least one remaining pending field path. */
export function situationsRelevantToOps(
  ids: ReviewSituationId[],
  entries: OpsEntryForSituation[],
  opts?: { promoteOnApply?: boolean; damageClass?: DamageClass | null },
): ReviewSituationId[] {
  const paths = pendingFieldPaths(entries);
  const hasSerp = paths.some(isTitleDescriptionFieldPath);
  const hasBody = paths.some(isBodyFieldPath);
  const hasFunnel = paths.some(isFunnelFieldPath);
  const hasOther = paths.some(isNonFunnelOtherPath);
  const promoteOnly = isPromoteOnly(entries, opts?.promoteOnApply);
  const translationShape = isLocaleTranslationShape(entries, opts?.promoteOnApply);
  const damage = opts?.damageClass ?? null;

  return ids.filter((id) => {
    switch (id) {
      case "serp_title_description":
        return hasSerp;
      case "internal_links":
        return hasBody;
      case "funnel_classification":
        return hasFunnel;
      case "body_copy_edit":
        return hasBody || hasOther;
      case "selling_figures":
        return damage === "selling_page" || paths.length > 0;
      case "new_public_content":
        return damage === "new_public_content" || paths.length > 0;
      case "promote_draft":
        return promoteOnly || (opts?.promoteOnApply === true && paths.length === 0);
      case "locale_translation":
        return translationShape;
      case "idea_opportunity_harm":
        return false;
      default:
        return false;
    }
  });
}

export type InferSituationsOpts = {
  summary?: string | null;
  title?: string | null;
  promoteOnApply?: boolean;
  damageClass?: DamageClass | null;
};

/**
 * Infer situations from pending ops (+ optional summary keywords for internal_links /
 * locale_translation). Empty/unknown → body_copy_edit (or promote_draft when promote-only).
 */
export function inferSituationsFromOps(
  entries: OpsEntryForSituation[],
  opts: InferSituationsOpts = {},
): ReviewSituationId[] {
  const paths = pendingFieldPaths(entries);
  const text = `${opts.title ?? ""} ${opts.summary ?? ""}`;
  const linkIntent = INTERNAL_LINK_INTENT_RE.test(text);
  const translationShape = isLocaleTranslationShape(entries, opts.promoteOnApply);
  const translationIntent = hasTranslationIntent(opts.title, opts.summary);
  const out = new Set<ReviewSituationId>();

  const hasSerp = paths.some(isTitleDescriptionFieldPath);
  const hasBody = paths.some(isBodyFieldPath);
  const hasFunnel = paths.some(isFunnelFieldPath);
  const hasOther = paths.some(isNonFunnelOtherPath);

  if (translationShape && translationIntent) {
    out.add("locale_translation");
    if (hasSerp) out.add("serp_title_description");
    if (hasFunnel) out.add("funnel_classification");
    if (opts.damageClass === "selling_page") out.add("selling_figures");
    if (opts.damageClass === "new_public_content") out.add("new_public_content");
    return [...out];
  }

  if (isPromoteOnly(entries, opts.promoteOnApply)) {
    out.add("promote_draft");
    return [...out];
  }

  if (hasSerp) out.add("serp_title_description");
  if (hasFunnel) out.add("funnel_classification");

  if (hasBody && linkIntent) {
    out.add("internal_links");
  } else if (hasBody || hasOther) {
    out.add("body_copy_edit");
  }

  if (opts.damageClass === "selling_page") out.add("selling_figures");
  if (opts.damageClass === "new_public_content") out.add("new_public_content");

  if (out.size === 0) {
    out.add("body_copy_edit");
  }

  return [...out];
}

export type MergeSituationsResult = {
  situations: ReviewSituationId[];
  source: SituationSource;
  warnings: Array<{ code: string; message: string }>;
};

/**
 * Author declared ∪ inferred. Soft mismatch when declared ids are not implied by ops.
 */
export function mergeSituations(
  declared: ReviewSituationId[],
  inferred: ReviewSituationId[],
  entries: OpsEntryForSituation[],
  opts?: { promoteOnApply?: boolean; damageClass?: DamageClass | null },
): MergeSituationsResult {
  const warnings: Array<{ code: string; message: string }> = [];
  const inferredSet = new Set(inferred);

  if (!declared.length) {
    const situations = inferred.length ? inferred : (["body_copy_edit"] as ReviewSituationId[]);
    if (situations.includes("locale_translation")) {
      warnings.push({
        code: SITUATION_LOCALE_TRANSLATION_UNDECLARED,
        message:
          "Inferred locale_translation from promote_on_apply + variant + summary translation cues. Prefer declaring review_situations:[\"locale_translation\"] on propose_change so the scorecard is explicit.",
      });
    } else if (situations.length === 1 && situations[0] === "body_copy_edit" && !inferred.includes("body_copy_edit")) {
      warnings.push({
        code: SITUATION_INFERRED_BODY,
        message:
          "No review_situations filed and ops did not match a specific pack — inferred as general body/field edit. Retag with set_review_situations if wrong.",
      });
    } else {
      warnings.push({
        code: SITUATION_INFERRED_BODY,
        message: `No review_situations filed — inferred: ${situations.join(", ")}. Authors may declare via propose_change or set_review_situations.`,
      });
    }
    return { situations, source: "inferred", warnings };
  }

  const relevantDeclared = situationsRelevantToOps(declared, entries, opts);
  const stale = declared.filter((d) => !relevantDeclared.includes(d) && !inferredSet.has(d));
  // Keep author intent even if soft-stale; still union inferred
  const merged = new Set<ReviewSituationId>([...declared, ...inferred]);
  const situations = [...merged];

  const impliedByOps = new Set(
    inferSituationsFromOps(entries, {
      promoteOnApply: opts?.promoteOnApply,
      damageClass: opts?.damageClass,
      // do not use link/translation keywords for mismatch — ops shape only
      summary: "",
      title: "",
    }),
  );
  // Re-infer with keywords for richer implied set when comparing mismatch
  const impliedRich = new Set(inferred);

  const undeclaredExtras = inferred.filter((i) => !declared.includes(i));
  const declaredNotImplied = declared.filter((d) => {
    if (d === "internal_links") return !pathsSuggestBody(entries);
    if (d === "serp_title_description") return !pathsSuggestSerp(entries);
    if (d === "funnel_classification") return !pathsSuggestFunnel(entries);
    if (d === "promote_draft") return !isPromoteOnly(entries, opts?.promoteOnApply);
    if (d === "locale_translation") {
      return !isLocaleTranslationShape(entries, opts?.promoteOnApply);
    }
    if (d === "selling_figures") return opts?.damageClass !== "selling_page" && !hasAnyPendingOps(entries);
    if (d === "new_public_content") {
      return opts?.damageClass !== "new_public_content" && !hasAnyPendingOps(entries);
    }
    // body_copy_edit is broad — mismatch only if no pending ops at all
    if (d === "body_copy_edit") return !hasAnyPendingOps(entries) && !opts?.promoteOnApply;
    return !impliedByOps.has(d) && !impliedRich.has(d);
  });

  if (undeclaredExtras.length || declaredNotImplied.length || stale.length) {
    warnings.push({
      code: SITUATION_OPS_MISMATCH,
      message:
        `Declared review_situations [${declared.join(", ")}] and pending ops imply [${inferred.join(", ")}]. ` +
        `Using union [${situations.join(", ")}]. Prefer aligning the label or splitting packets. Create still succeeds.`,
    });
  }

  if (
    undeclaredExtras.includes("locale_translation") &&
    !declared.includes("locale_translation")
  ) {
    warnings.push({
      code: SITUATION_LOCALE_TRANSLATION_UNDECLARED,
      message:
        "Pending ops/summary imply locale_translation but it was not declared. Prefer review_situations:[\"locale_translation\"] with variant + promote_on_apply.",
    });
  }

  const source: SituationSource =
    undeclaredExtras.length || declaredNotImplied.length ? "merged" : "author";

  return { situations, source, warnings };
}

function pathsSuggestSerp(entries: OpsEntryForSituation[]): boolean {
  return pendingFieldPaths(entries).some(isTitleDescriptionFieldPath);
}

function pathsSuggestBody(entries: OpsEntryForSituation[]): boolean {
  return pendingFieldPaths(entries).some(isBodyFieldPath);
}

function pathsSuggestFunnel(entries: OpsEntryForSituation[]): boolean {
  return pendingFieldPaths(entries).some(isFunnelFieldPath);
}

/**
 * After revise_entries: keep author tags that still own remaining ops; re-add inferred for leftovers.
 */
export function refreshSituationsAfterRevise(
  declared: ReviewSituationId[],
  entries: OpsEntryForSituation[],
  opts: InferSituationsOpts = {},
): MergeSituationsResult {
  const inferred = inferSituationsFromOps(entries, opts);
  const keptDeclared = situationsRelevantToOps(declared, entries, {
    promoteOnApply: opts.promoteOnApply,
    damageClass: opts.damageClass,
  });
  return mergeSituations(keptDeclared, inferred, entries, {
    promoteOnApply: opts.promoteOnApply,
    damageClass: opts.damageClass,
  });
}

/** Checklist ids to force from active situations (before MAX_THINK slice). */
export function checklistIdsForSituations(situations: ReviewSituationId[]): ChecklistId[] {
  const out: ChecklistId[] = [];
  const seen = new Set<ChecklistId>();
  for (const id of situations) {
    const def = REVIEW_SITUATION_CATALOG[id];
    if (!def) continue;
    for (const c of def.checklist_ids) {
      if (!seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
  }
  return out;
}

export function staffNotesForSituations(situations: ReviewSituationId[]): string[] {
  const notes: string[] = [];
  const seen = new Set<string>();
  for (const id of situations) {
    const note = REVIEW_SITUATION_CATALOG[id]?.staff_note;
    if (note && !seen.has(note)) {
      seen.add(note);
      notes.push(note);
    }
  }
  return notes;
}

export function discoveryContentLookForForSituations(
  situations: ReviewSituationId[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of situations) {
    for (const line of REVIEW_SITUATION_CATALOG[id]?.discovery_content_look_for ?? []) {
      if (!seen.has(line)) {
        seen.add(line);
        out.push(line);
      }
    }
  }
  return out;
}

export function catalogPublicIndex(): Array<{
  id: ReviewSituationId;
  label: string;
  when_to_use: string;
  explain_topic: string;
  explain_subtopic?: string;
}> {
  return REVIEW_SITUATION_IDS.map((id) => {
    const d = REVIEW_SITUATION_CATALOG[id];
    return {
      id: d.id,
      label: d.label,
      when_to_use: d.when_to_use,
      explain_topic: d.explain_topic,
      ...(d.explain_subtopic ? { explain_subtopic: d.explain_subtopic } : {}),
    };
  });
}
