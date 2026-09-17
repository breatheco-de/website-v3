/**
 * Declarative proposal review rule catalog.
 * Stable IDs for audit/tests; staff copy in plain English.
 * Selling allowlist is a v1 stopgap — long-term: content-type strategy flag.
 */

export type DamageClass =
  | "none"
  | "existing_metadata"
  | "existing_content"
  | "selling_page"
  | "new_public_content";

export type UndoCost = "none" | "low" | "medium" | "high";

export type ExistenceState = "exists" | "missing" | "unknown";

export type ChecklistId =
  | "selling_page_figures"
  | "new_content_brand"
  | "dedup_coordinate"
  | "dedup_competing_edits"
  | "dedup_fix_pending"
  | "idea_opportunity_harm"
  | "idea_accept"
  | "notes_close"
  | "review_mode_inert"
  | "title_description_ctr"
  | "internal_links"
  | "funnel_persona_product_stage"
  | "locale_translation"
  | "verify_copy"
  | "adjacent_findings"
  | "disposition"
  | "existence_unknown"
  | "target_missing";

/** Staff always-visible line when idea_opportunity_harm is active. */
export const IDEA_OPPORTUNITY_HARM_STAFF_NOTE =
  "Brief to greenlight or decline — accepting does not publish. Score whether the opportunity is real and whether accepting would harm the site.";

/** SERP title/description field paths that attach the title_description_ctr checklist. */
export const TITLE_DESCRIPTION_FIELD_PATHS = new Set([
  "meta.page_title",
  "meta.description",
]);

export const MIXED_SERP_AND_BODY = "mixed_serp_and_body";

/** Staff always-visible line when title_description_ctr is active (no "CTR" wording). */
export const TITLE_DESCRIPTION_STAFF_NOTE =
  "Also check search title/description — honest and not worse than live.";

/** Staff always-visible line when internal_links checklist is active. */
export const INTERNAL_LINKS_STAFF_NOTE =
  "Also check hub links — facts and locale targets intact, not punchier prose.";

/** Staff always-visible line when funnel_persona_product_stage is active. */
export const FUNNEL_CLASSIFICATION_STAFF_NOTE =
  "Also check funnel — who the buyer is, which product owns them, then how ready they are (not whether the article feels broad).";

/** Staff always-visible line when locale_translation is active. */
export const LOCALE_TRANSLATION_STAFF_NOTE =
  "Also check locale translation — draft matches source meaning and facts before go-live, not punchier copy vs live.";

/** v1 stopgap — extend until strategy.selling (or similar) exists. */
export const SELLING_CONTENT_TYPES = new Set([
  "landing",
  "landings",
  "program",
  "programs",
]);

export const PUBLIC_CONTENT_TYPES = new Set(["blog", "blogs", "article", "articles"]);

export type DamageClassMeta = {
  id: DamageClass;
  badge_label: string;
  situation_description: string;
  risk: string;
};

export const DAMAGE_CLASS_META: Record<DamageClass, DamageClassMeta> = {
  none: {
    id: "none",
    badge_label: "Handoff",
    situation_description:
      "Reminder or wall — closing does not change the live site.",
    risk: "No live content change on close or accept.",
  },
  existing_metadata: {
    id: "existing_metadata",
    badge_label: "Metadata fix",
    situation_description:
      "Small change on an existing page (title, description, etc.). Easy to undo; still check the copy is accurate.",
    risk: "Low — metadata on a page that already exists.",
  },
  existing_content: {
    id: "existing_content",
    badge_label: "Content edit",
    situation_description:
      "Changes copy or fields on a page that already exists. Confirm the edit matches the summary before apply.",
    risk: "Medium — body or field changes on a live page.",
  },
  selling_page: {
    id: "selling_page",
    badge_label: "Selling page",
    situation_description:
      "This proposal changes a page that sells a program or offer. Wrong outcome claims (hire rate, salary, price) can cost real leads — verify figures before apply.",
    risk: "High — selling page; outcome claims affect leads.",
  },
  new_public_content: {
    id: "new_public_content",
    badge_label: "New public content",
    situation_description:
      "New or proposed public page. Judge angle, facts, and funnel — not only whether apply is easy.",
    risk: "High — brand and spam risk for new public content.",
  },
};

export type ThinkTemplate = {
  id: ChecklistId;
  title: string;
  why: string;
  look_for: string[];
  /** Sort priority (lower = earlier). Cap at MAX_THINK in review-context. */
  priority: number;
};

export const THINK_TEMPLATES: Record<ChecklistId, ThinkTemplate> = {
  selling_page_figures: {
    id: "selling_page_figures",
    title: "Verify every outcome figure",
    why: "This page sells. A wrong hire rate, salary, or price is not cosmetic.",
    look_for: [
      "proposed number vs approved source",
      "locale of the figure",
      "reject or block if the source is missing",
      "optional: get_product_funnel_analytics for conversion context — not required to apply",
    ],
    priority: 10,
  },
  new_content_brand: {
    id: "new_content_brand",
    title: "Clear the new-public-content gate",
    why: "Cheap to file; expensive if spammy or generic.",
    look_for: [
      "defensible technical or educational angle",
      "facts checked against the product",
      "CTA or link to a real program",
      "reject or add_blocker if any of the three fails",
    ],
    priority: 10,
  },
  dedup_coordinate: {
    id: "dedup_coordinate",
    title: "Coordinate with related proposals",
    why: "Another open proposal shares an issue — same problem, not independent work.",
    look_for: [
      "if this edits proposal is the fix, apply then close the related notes",
      "do not reject solely because related notes exist",
    ],
    priority: 20,
  },
  dedup_competing_edits: {
    id: "dedup_competing_edits",
    title: "Competing edits on the same problem",
    why: "Another open edits proposal overlaps — do not apply both blind.",
    look_for: [
      "compare field updates with the sibling edits proposal",
      "join, fold, or reject the weaker duplicate",
      "do not apply both without comparing",
    ],
    priority: 15,
  },
  dedup_fix_pending: {
    id: "dedup_fix_pending",
    title: "An edits proposal may already be the fix",
    why: "Open edits share this issue — check them before parking this notes handoff.",
    look_for: [
      "open the related edits proposal before closing as wont_fix",
      "close notes as fixed_elsewhere only after the fix is applied or tracked",
    ],
    priority: 20,
  },
  idea_opportunity_harm: {
    id: "idea_opportunity_harm",
    title: "Score opportunity vs site harm",
    why: "Accept greenlights a brief only. A weak idea that later ships becomes a lasting URL — stop dilution, thin pages, and unjustified locks here.",
    look_for: [
      "Goal: one 90-day outcome — cite, rank, or assist a real program (not fill a cluster hole)",
      "Evidence: query/GSC/SERP set or traffic proof in the brief — missing → add_blocker",
      "Fit: not a dupe of a sibling; locale justified; wrong vehicle (funnel/SERP/hub-links-only) → close and refile as edits",
      "Brand: educational angle, checkable facts, real program CTA — invent/endorsement without source → reject or close",
      "Dilution: if this ships and gets ~0 visits, would we still tax hubs, crawl, freshness, inventory?",
      "Kill criterion named; refresh_tier:fast needs owner + recrawl trigger; default zero new hub links",
      "Dilution improvement alone ≠ pass (e.g. hub deletion still needs visit/redirect evidence)",
      "Disposition: accept | add_blocker | close | reject — never apply or revise_entries",
    ],
    priority: 3,
  },
  idea_accept: {
    id: "idea_accept",
    title: "Accept greenlights a brief only",
    why: "Accept does not create pages or write YAML. The build is a later edits proposal.",
    look_for: [
      "accepted_entry required (contentType, slug, locale) — locks that page+locale",
      "next_step is concrete (min 20 characters)",
      "follow-up edits use implements_proposal_id matching this idea",
      "do not report the page as live after accept",
      "close/park means no — not yes",
    ],
    priority: 5,
  },
  notes_close: {
    id: "notes_close",
    title: "Close disposition",
    why: "Notes do not change YAML on close. Closing parks the wall.",
    look_for: [
      "wont_fix vs fixed_elsewhere vs tracked_elsewhere",
      "closing does not re-queue when no_auto_retry is set",
    ],
    priority: 5,
  },
  review_mode_inert: {
    id: "review_mode_inert",
    title: "Ignore review mode here",
    why: "On notes and ideas, review_mode does nothing.",
    look_for: ["do not reason about soft vs draft for this proposal kind"],
    priority: 40,
  },
  title_description_ctr: {
    id: "title_description_ctr",
    title: "Block bad or weaker search title/description",
    why: "Stop invented claims and query drops on SERP fields — not a CTR rewrite brief.",
    look_for: [
      "score Query/Specifics/Claims then Ship: up|same|down / ok|bad / yes|no",
      "Claims bad (invented salary/year/employer/superlative vs live body) → block or reject — never apply",
      "Query same/down and Specifics down → block",
      "same/same with no real grammar/accents/year/casing win → leave live (leave live ≠ reject)",
      "leave live on SERP but body should ship → revise_entries to drop or fix title/description ops, then apply (apply is atomic)",
      "Query up may offset Specifics down when Claims ok → apply",
      "ops vs live only — ignore staff summary / Titulo/Meta blurb; never block because blurb ≠ ops",
      "empty or reset title/description vs live — usually block",
      "judge only meta.page_title / meta.description — body breakage is verify_copy / disposition",
      "when SERP ops or recent writes: get_entry_activity first — same-field title/description churn + live not broken → reject duplicate_weaker (SERP-only) or revise to drop SERP ops then apply (mixed); unrelated body/CTA writes alone ≠ reject",
      "non-goal: do not coach punchier copy or CTR tactics",
      "optional: get_organic_traffic mode=paths for the live URL before applying SERP changes",
    ],
    priority: 25,
  },
  internal_links: {
    id: "internal_links",
    title: "Hub / internal links vs live",
    why: "Raise hub visibility with honest same-locale links — not punchier copy. Forced pitch is polish; deleted facts are not.",
    look_for: [
      "score only: facts intact, no new unsupported claims, each new href exists + correct locale + topical hub/pillar/sibling, force (anchors on existing phrases vs minted CTAs)",
      "facts: live numbers, years, employers, sources still present in proposed body",
      "claims: no new salary/ranking/mejor/headcount the live article does not already support",
      "links: destinations exist, same locale as the article, hub/pillar or in-cluster sibling — not broken placeholders or money-page spray",
      "force: one link per idea is fine; sales sentence minted only to carry the link → add_blocker (wrap existing phrase; delete the pitch)",
      "if gates 1–3 pass, apply even if prose is a bit wooden — do not reject as weaker-than-live copy",
      "title/description also pending → leave-live on SERP (revise_entries to drop those ops) then apply body; do not reject the whole packet for the links",
      "ops vs live only — ignore staff summary / Titulo/Meta blurb; never block because summary wording ≠ ops",
      "same-field link churn already shipped + live not broken → leave live or reject duplicate_weaker; unrelated body/CTA writes alone ≠ reject",
      "out-of-scope live defects → adjacent_findings notes; do not block apply",
      "per-situation ship: failing packs' ops must be dropped or fixed via revise_entries before apply (apply is atomic)",
    ],
    priority: 28,
  },
  funnel_persona_product_stage: {
    id: "funnel_persona_product_stage",
    title: "Check persona → product → stage",
    why: "Funnel targeting is buyer fit, not topical breadth. Wrong product or stage misroutes journey membership.",
    look_for: [
      "score Persona / Product / Stage then Ship: pass|fail|warn / pass|fail / pass|fail / yes|no — in that order",
      "Persona: content intent matches a real persona id on a product (list_products → get_product); missing audience → product-only OK with warn (do not invent persona ids); wrong/invented persona → block",
      "Product: proposed bindings follow from that fit; multiple { product, persona? } OK when two+ personas truly fit; products:all only when no single product's personas fit better; breadth/company-report alone ≠ all; all never carries personas",
      "Stage: awareness|consideration|decision|post-enrollment matches readiness — re-check full cascade even if only stage or only products moved",
      "ops vs live funnel + product audience — ignore staff summary / Titulo/Meta blurb; never block because blurb ≠ ops",
      "batch: score each entry row independently; soft prefer ≤10 related posts (no create refuse for larger)",
      "same-field funnel churn + live not broken + no real cascade change → leave live or reject duplicate_weaker; unrelated body writes alone ≠ reject",
      "body/SERP also pending → score packs independently; revise_entries to drop/fix failing pack then apply (atomic)",
      "topical breadth disagreement alone is not reject — add_blocker citing which cascade step fails and what correct binding looks like",
      "out-of-scope live body defects → adjacent_findings notes; do not block funnel apply",
      "optional: get_entry_activity for funnel.* recent writes; get_product_funnel_analytics for journey context",
    ],
    priority: 26,
  },
  locale_translation: {
    id: "locale_translation",
    title: "Locale draft vs source before promote",
    why: "Go-live promotes a translated variant — score fidelity and readiness, not punchier copy vs live English.",
    look_for: [
      "score Fidelity / Completeness / Slug / Shell / Promote honesty then Ship: pass|fail / pass|fail / pass|fail / pass|warn / yes|no",
      "Fidelity: draft meaning and facts match source locale (same years, employers, sources) — invented stats or unsupported claims → block/reject",
      "Completeness: required fields for this content type are ready on the variant; empty required → add_blocker",
      "Slug: url_slug on the variant is locale-fitting (not an English slug left on /es/ by accident)",
      "Shell: attached shared-layout still comes from template.{locale}.yml — detach only if intentional",
      "Promote honesty: apply promotes the named variant — it does not run AI translation or invent sibling locales",
      "Forced awkward phrasing that breaks meaning → add_blocker (fix draft), not reject-as-weaker-copy",
      "Wrong-locale internal links → block; out-of-scope live defects on other pages → adjacent_findings notes",
      "ops/draft vs source locale — ignore staff summary paste; never block because summary ≠ full body",
      "optional: get_entry_content on source locale then target with variant; list_variants; explain_site topic proposals subtopic translations",
    ],
    priority: 27,
  },
  verify_copy: {
    id: "verify_copy",
    title: "Check proposed fields against live",
    why: "Catch breakage and invented claims on the fields this proposal writes — not a rewrite coach.",
    look_for: [
      "proposed value vs live for fields this proposal writes",
      "summary why/scope justified by ops (e.g. content refresh with meta-only → add_blocker)",
      "do not require the summary to paste proposed values",
      "no invented stats in the proposed text",
      "when multiple review situations are active: score each pack's owned fields independently; drop or fix failing packs via revise_entries before apply",
    ],
    priority: 30,
  },
  adjacent_findings: {
    id: "adjacent_findings",
    title: "Park out-of-scope live-page defects",
    why: "Real live defects this proposal does not write must not become default apply-blockers or chat-only.",
    look_for: [
      "invented or stale figures on the live page even if ops do not change them",
      "dead links, duplicate blocks, locale-mismatched related links",
      "title/H1/body disagreement that this proposal does not fix",
      "would I still ship this meta if the article stays as-is?",
      "makes proposed copy false or summary overclaims → add_blocker",
      "same entry, ops do not touch → notes naming this page; link issue only if one exists; do not block apply",
      "other entry → notes naming that page; never blocker on this proposal",
      "existing open notes covering it → join/append; nothing to park → no empty notes",
      "do not leave findings only in chat",
      "lack proposals_create → do not turn park items into blockers; hand off to a create-capable role",
    ],
    priority: 50,
  },
  disposition: {
    id: "disposition",
    title: "Choose a disposition",
    why: "After optional research, decide apply, reject, add_blocker, or park adjacent notes.",
    look_for: [
      "apply only when every in-scope gate is clean and you would ship this yourself",
      "multi-situation: review each pack independently; pass packs wait until failing packs' ops are dropped or fixed via revise_entries, then apply (atomic)",
      "title/description leave-live or block while other ops are fine → revise_entries to drop/fix SERP ops, then apply (no partial-field apply)",
      "same-field SERP churn after recent title/description writes + live not broken → reject duplicate_weaker (SERP-only) or revise_entries to drop SERP ops then apply (mixed); unrelated recent writes alone ≠ reject",
      "add_blocker when the proposed change is wrong or invents claims (then author revise_entries)",
      "out-of-scope live defects → adjacent_findings notes park (same or other page); do not default every finding to add_blocker",
      "reject only for bad/impossible/illegal/harmful/duplicate/target missing — confirm_reject + reject_kind + note",
    ],
    priority: 90,
  },
  existence_unknown: {
    id: "existence_unknown",
    title: "Confirm the page exists",
    why: "The server could not confirm whether the page is on disk.",
    look_for: [
      "verify with get_entry_seo or get_entry_content before trusting this label",
      "do not invent selling-page vs new-content from a failed lookup",
    ],
    priority: 5,
  },
  target_missing: {
    id: "target_missing",
    title: "Target no longer exists",
    why: "The page this proposal edits is gone. Apply is blocked.",
    look_for: [
      "reject or withdraw this proposal",
      "restore the page and file a fresh proposal if the work is still wanted",
      "do not treat this as new public content",
    ],
    priority: 1,
  },
};

export const UNDO_COPY: Record<UndoCost, string> = {
  none: "No live write on close or accept.",
  low: "Apply writes a draft only — nothing public changes until a later promote.",
  medium: "Apply writes live immediately.",
  high: "Apply publishes a whole draft to live — point of no return for that piece.",
};

export function isSellingContentType(contentType: string): boolean {
  return SELLING_CONTENT_TYPES.has(contentType.trim().toLowerCase());
}

export function isPublicContentType(contentType: string): boolean {
  return PUBLIC_CONTENT_TYPES.has(contentType.trim().toLowerCase());
}

/** Higher = worse for mixed-risk / worst-case. */
export const DAMAGE_CLASS_RANK: Record<DamageClass, number> = {
  none: 0,
  existing_metadata: 1,
  existing_content: 2,
  selling_page: 3,
  new_public_content: 3,
};

export function worseDamageClass(a: DamageClass, b: DamageClass): DamageClass {
  return DAMAGE_CLASS_RANK[a] >= DAMAGE_CLASS_RANK[b] ? a : b;
}

export function isTitleDescriptionFieldPath(fieldPath: string): boolean {
  return TITLE_DESCRIPTION_FIELD_PATHS.has(fieldPath.trim());
}

/** Remaining work entries with at least one title/description op. */
export function hasTitleDescriptionOps(
  entries: Array<{ status?: string | null; ops?: Array<{ field_path?: string }> | null }>,
): boolean {
  for (const e of entries) {
    if (e.status && e.status !== "pending" && e.status !== "failed") continue;
    for (const op of e.ops ?? []) {
      if (typeof op.field_path === "string" && isTitleDescriptionFieldPath(op.field_path)) {
        return true;
      }
    }
  }
  return false;
}

/** Every remaining op is page_title and/or description (non-empty). */
export function isTitleDescriptionOnlyOps(
  entries: Array<{ status?: string | null; ops?: Array<{ field_path?: string }> | null }>,
): boolean {
  let any = false;
  for (const e of entries) {
    if (e.status && e.status !== "pending" && e.status !== "failed") continue;
    const ops = e.ops ?? [];
    if (!ops.length) return false;
    for (const op of ops) {
      if (typeof op.field_path !== "string" || !op.field_path.trim()) return false;
      if (!isTitleDescriptionFieldPath(op.field_path)) return false;
      any = true;
    }
  }
  return any;
}
