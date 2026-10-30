/**
 * Unit tests for proposal review classifier (no sqlite).
 */
import { describe, expect, it } from "vitest";
import {
  classifyProposalReview,
  collectDamageClassesForMixedCheck,
  damageClassForTarget,
  isMixedRiskBundle,
  undoCostFor,
  undoCostFromDiff,
} from "./review-context";
import type { ProposalRecord } from "./service";
import * as sectionsHelpers from "./sections-summary";

function baseProposal(
  overrides: Partial<ProposalRecord> & Pick<ProposalRecord, "kind">,
): ProposalRecord {
  return {
    id: "p1",
    site: "test",
    fingerprint: "fp",
    status: "open",
    category: "content.field",
    title: "T",
    summary: "x".repeat(80),
    rationale: null,
    documentation: {},
    related_issue_ids: [],
    proposer_username: "a",
    proposer_actor: {},
    created_at: 1,
    updated_at: 1,
    claim: null,
    tags: [],
    search_text: "",
    created_agent_session_id: null,
    promote_on_apply: false,
    review_mode: "soft",
    open_blocker_count: 0,
    no_auto_retry: false,
    escalated: false,
    escalated_at: null,
    escalated_by: null,
    escalated_note: null,
    close_reason: null,
    close_note: null,
    closed_by: null,
    closed_at: null,
    related_entries: [],
    entries: [],
    blockers: [],
    review_situations: [],
    review_context_snapshot: null,
    decision_debug: null,
    supersedes_proposal_id: null,
    replaced_by_proposal_id: null,
    accepted_entry: null,
    implements_proposal_id: null,
    idea_funnel: null,
    author_content_at: null,
    reviewer_action_at: null,
    reviewer_action_by: null,
    reviewer_action_by_actor: {},
    outcome_review: null,
    outcome_review_note: null,
    outcome_review_expected: null,
    outcome_review_at: null,
    outcome_review_by: null,
    outcome_review_history: [],
    outcome_lesson_captured_at: null,
    outcome_lesson_captured_by: null,
    outcome_lesson_note: null,
    ...overrides,
  };
}

describe("damageClassForTarget", () => {
  it("live missing + draft → new_public_content", () => {
    expect(
      damageClassForTarget({
        contentType: "blog",
        existence: "missing",
        draftExists: true,
      }),
    ).toBe("new_public_content");
  });

  it("existing seo blog → existing_metadata", () => {
    expect(
      damageClassForTarget({
        contentType: "blog",
        category: "content.seo",
        existence: "exists",
      }),
    ).toBe("existing_metadata");
  });

  it("landing exists is not selling by type alone", () => {
    expect(
      damageClassForTarget({
        contentType: "landing",
        category: "content.seo",
        existence: "exists",
      }),
    ).toBe("existing_metadata");
  });

  it("idea missing program → new_public_content", () => {
    expect(
      damageClassForTarget({
        contentType: "program",
        existence: "missing",
        forIdea: true,
      }),
    ).toBe("new_public_content");
  });
});

describe("undoCostFor", () => {
  it("orders soft_variant < soft < draft_backed", () => {
    expect(undoCostFor("edits", "soft_variant")).toBe("low");
    expect(undoCostFor("edits", "soft")).toBe("medium");
    expect(undoCostFor("edits", "draft_backed")).toBe("high");
    expect(undoCostFor("notes", "soft")).toBe("none");
  });
});

describe("undoCostFromDiff (v1.0)", () => {
  const change = (field_path: string, scope: "locale" | "common" = "locale") => ({
    field_path,
    before: "a",
    after: "b",
    scope,
  });
  it("rates by what the draft touches", () => {
    expect(undoCostFromDiff([{ slug: "hello", author_diff: [change("title")] }])).toEqual({
      cost: "low",
      reason: "locale_fields",
    });
    expect(undoCostFromDiff([{ slug: "hello", author_diff: [change("title"), change("meta.page_title")] }])).toEqual({
      cost: "medium",
      reason: "seo_or_url",
    });
    expect(undoCostFromDiff([{ slug: "hello", author_diff: [change("funnel.stage", "common")] }]).cost).toBe("high");
    expect(undoCostFromDiff([{ slug: "hello", author_diff: [change("sections")] }]).reason).toBe("sections");
    expect(undoCostFromDiff([{ slug: "hello", author_diff: [change("title")], liveMissing: true }]).reason).toBe(
      "first_publish",
    );
    expect(undoCostFromDiff([{ slug: "template", author_diff: [change("title")] }]).reason).toBe("shared_template");
  });
});

describe("collectDamageClassesForMixedCheck", () => {
  it("detects mixed outcome figures + blog meta", () => {
    const classes = collectDamageClassesForMixedCheck([
      { contentType: "landing", existence: "exists", outcomeFigures: true },
      { contentType: "blog", category: "content.seo", existence: "exists" },
    ]);
    expect(isMixedRiskBundle(classes)).toBe(true);
  });

  it("allows existing_metadata + existing_content together", () => {
    const classes = collectDamageClassesForMixedCheck([
      { contentType: "blog", category: "content.field", existence: "exists" },
      { contentType: "blog", category: "content.seo", existence: "exists" },
    ]);
    expect(isMixedRiskBundle(classes)).toBe(false);
  });

  it("landing without figures is not mixed with blog meta", () => {
    const classes = collectDamageClassesForMixedCheck([
      { contentType: "landing", existence: "exists" },
      { contentType: "blog", category: "content.seo", existence: "exists" },
    ]);
    expect(isMixedRiskBundle(classes)).toBe(false);
  });
});

describe("classifyProposalReview", () => {
  it("marks target_missing and block_apply when live gone and no draft", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "edits",
        entries: [
          {
            id: 1,
            proposal_id: "p1",
            entry_key: "blog/hello",
            locale: "en",
            variant: null,
            variant_fingerprint: null,
            status: "pending",
            ops: [],
            baseline_context: { values: {} },
            last_error: null,
            applied_at: null,
            applied_by: null,
            contentType: "blog",
            slug: "hello",
          },
        ],
      }),
      lookups: [
        {
          contentType: "blog",
          slug: "hello",
          locale: "en",
          existence: "missing",
          draftExists: false,
        },
      ],
    });
    expect(ctx.block_apply).toBe(true);
    expect(ctx.active_checklists).toContain("target_missing");
    expect(ctx.damage_class).not.toBe("new_public_content");
  });

  it("does not block apply when the packet was filed as creates_entry", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "edits",
        entries: [
          {
            id: 1,
            proposal_id: "p1",
            entry_key: "blog/what-is-grok",
            locale: "en",
            variant: null,
            variant_fingerprint: null,
            status: "pending",
            ops: [{ field_path: "title", value: "What is Grok" }],
            baseline_context: { values: {}, creates_entry: true },
            last_error: null,
            applied_at: null,
            applied_by: null,
            contentType: "blog",
            slug: "what-is-grok",
          },
        ],
      }),
      lookups: [
        {
          contentType: "blog",
          slug: "what-is-grok",
          locale: "en",
          existence: "missing",
          draftExists: false,
        },
      ],
    });
    expect(ctx.block_apply).toBe(false);
    expect(ctx.active_checklists).not.toContain("target_missing");
    expect(ctx.damage_class).toBe("new_public_content");
    expect(ctx.staff_summary.situation_description).toContain("Applying creates this post");
    expect(ctx.agent_preview.warnings.some((w) => w.code === "creates_attached_entry")).toBe(true);
  });

  it("treats outcome figures plus a creates_entry post as a mixed risk bundle", () => {
    const classes = collectDamageClassesForMixedCheck([
      { contentType: "program", existence: "exists", outcomeFigures: true },
      { contentType: "blog", existence: "missing", createsEntry: true },
    ]);
    expect(isMixedRiskBundle(classes)).toBe(true);
  });

  it("classifies new page via draft as new_public_content without block_apply", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "edits",
        review_mode: "soft_variant",
        entries: [
          {
            id: 1,
            proposal_id: "p1",
            entry_key: "blog/new-post",
            locale: "en",
            variant: "draft-a",
            variant_fingerprint: "x",
            status: "pending",
            ops: [],
            baseline_context: { values: {} },
            last_error: null,
            applied_at: null,
            applied_by: null,
            contentType: "blog",
            slug: "new-post",
          },
        ],
      }),
      lookups: [
        {
          contentType: "blog",
          slug: "new-post",
          locale: "en",
          variant: "draft-a",
          existence: "missing",
          draftExists: true,
        },
      ],
    });
    expect(ctx.damage_class).toBe("new_public_content");
    expect(ctx.block_apply).toBe(false);
    expect(ctx.undo_cost).toBe("low");
  });

  it("adds dedup_fix_pending when notes has edits sibling", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "notes",
        related_issue_ids: ["iss1"],
      }),
      lookups: [],
      relatedOpen: [
        {
          id: "p-edits",
          title: "Fix",
          kind: "edits",
          shared_issue_ids: ["iss1"],
        },
      ],
    });
    expect(ctx.active_checklists).toContain("dedup_fix_pending");
  });

  it("sets situation_changed_since_filed when snapshot differs", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "edits",
        category: "content.seo",
        entries: [
          {
            id: 1,
            proposal_id: "p1",
            entry_key: "blog/hello",
            locale: "en",
            variant: null,
            variant_fingerprint: null,
            status: "pending",
            ops: [],
            baseline_context: { values: {} },
            last_error: null,
            applied_at: null,
            applied_by: null,
            contentType: "blog",
            slug: "hello",
          },
        ],
      }),
      lookups: [
        {
          contentType: "blog",
          slug: "hello",
          locale: "en",
          existence: "exists",
        },
      ],
      snapshot: { damage_class: "selling_page" },
    });
    expect(ctx.situation_changed_since_filed).toBe(true);
    expect(ctx.damage_class).toBe("existing_metadata");
  });

  it("adds adjacent_findings for existing_metadata edits and keeps ≤6 think items", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "edits",
        category: "content.seo",
        entries: [
          {
            id: 1,
            proposal_id: "p1",
            entry_key: "blog/hello",
            locale: "en",
            variant: null,
            variant_fingerprint: null,
            status: "pending",
            ops: [],
            baseline_context: { values: {} },
            last_error: null,
            applied_at: null,
            applied_by: null,
            contentType: "blog",
            slug: "hello",
          },
        ],
      }),
      lookups: [
        {
          contentType: "blog",
          slug: "hello",
          locale: "en",
          existence: "exists",
        },
      ],
    });
    expect(ctx.damage_class).toBe("existing_metadata");
    expect(ctx.active_checklists).toContain("adjacent_findings");
    expect(ctx.active_checklists).toContain("verify_copy");
    expect(ctx.active_checklists).toContain("disposition");
    expect(ctx.agent_preview.think_items.length).toBeLessThanOrEqual(6);
    expect(ctx.agent_preview.think_items.some((t) => t.id === "adjacent_findings")).toBe(true);
  });

  it("adds adjacent_findings for outcome-figure edits", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "edits",
        entries: [
          {
            id: 1,
            proposal_id: "p1",
            entry_key: "landing/ai",
            locale: "en",
            variant: null,
            variant_fingerprint: null,
            status: "pending",
            ops: [{ field_path: "content", value: "Our hire rate is 90%" }],
            baseline_context: { values: {} },
            last_error: null,
            applied_at: null,
            applied_by: null,
            contentType: "landing",
            slug: "ai",
          },
        ],
      }),
      lookups: [
        {
          contentType: "landing",
          slug: "ai",
          locale: "en",
          existence: "exists",
        },
      ],
    });
    expect(ctx.damage_class).toBe("selling_page");
    expect(ctx.staff_summary.badge_label).toBe("Outcome figures");
    expect(ctx.active_checklists).toContain("adjacent_findings");
    expect(ctx.active_checklists).toContain("selling_page_figures");
    expect(ctx.agent_preview.think_items.length).toBeLessThanOrEqual(6);
  });

  it("skips adjacent_findings when target_missing blocks apply", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "edits",
        entries: [
          {
            id: 1,
            proposal_id: "p1",
            entry_key: "blog/hello",
            locale: "en",
            variant: null,
            variant_fingerprint: null,
            status: "pending",
            ops: [],
            baseline_context: { values: {} },
            last_error: null,
            applied_at: null,
            applied_by: null,
            contentType: "blog",
            slug: "hello",
          },
        ],
      }),
      lookups: [
        {
          contentType: "blog",
          slug: "hello",
          locale: "en",
          existence: "missing",
          draftExists: false,
        },
      ],
    });
    expect(ctx.block_apply).toBe(true);
    expect(ctx.active_checklists).not.toContain("adjacent_findings");
  });

  it("idea with no related_entries → none damage, opportunity harm situation", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({ kind: "idea" }),
      lookups: [],
    });
    expect(ctx.damage_class).toBe("none");
    expect(ctx.review_situations).toEqual(["idea_opportunity_harm"]);
    expect(ctx.filed_review_situations).toEqual([]);
    expect(ctx.situation_source).toBe("inferred");
    expect(ctx.active_checklists).toContain("idea_accept");
    expect(ctx.active_checklists).toContain("idea_opportunity_harm");
    expect(ctx.active_checklists).not.toContain("new_content_brand");
    expect(ctx.staff_summary.badge_label).toBe("Idea brief");
  });

  it("idea with anticipated_demand stacks default + demand label", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "idea",
        review_situations: ["anticipated_demand"],
        title: "New AI tutor product",
        summary: "Launch of tutor product; lasting how-to queries after hype fades.",
      }),
      lookups: [],
    });
    expect(ctx.review_situations).toEqual(["idea_opportunity_harm", "anticipated_demand"]);
    expect(ctx.filed_review_situations).toEqual(["anticipated_demand"]);
    expect(ctx.situation_source).toBe("author");
    expect(ctx.active_checklists).toContain("idea_opportunity_harm");
    expect(ctx.active_checklists).toContain("anticipated_demand");
    expect(ctx.staff_summary.situation_description).toMatch(/lasting questions/i);
  });

  it("idea with broken_url stacks default + broken_url checklist", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "idea",
        review_situations: ["broken_url"],
        summary: "404 /en/old-path still requested; proof from get_runtime_issues.",
      }),
      lookups: [],
    });
    expect(ctx.review_situations).toEqual(["idea_opportunity_harm", "broken_url"]);
    expect(ctx.active_checklists).toContain("broken_url");
    expect(ctx.active_checklists).toContain("idea_opportunity_harm");
    expect(ctx.staff_summary.situation_description).toMatch(/redirect|missing address/i);
  });

  it("idea does not infer demand labels from title/summary keywords", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "idea",
        title: "Broken URL redirect for launch news",
        summary:
          "404 on /en/pricing after product launch; anticipated demand and fast decay news mentioned only in prose.",
      }),
      lookups: [],
    });
    expect(ctx.review_situations).toEqual(["idea_opportunity_harm"]);
    expect(ctx.filed_review_situations).toEqual([]);
    expect(ctx.active_checklists).not.toContain("broken_url");
    expect(ctx.active_checklists).not.toContain("anticipated_demand");
    expect(ctx.active_checklists).not.toContain("fast_decay_news");
  });

  it("idea with missing public related → new_public_content damage without brand checklist", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "idea",
        related_entries: [{ contentType: "blog", slug: "new-spoke", locale: "en" }],
      }),
      lookups: [
        {
          contentType: "blog",
          slug: "new-spoke",
          locale: "en",
          existence: "missing",
          draftExists: false,
        },
      ],
    });
    expect(ctx.damage_class).toBe("new_public_content");
    expect(ctx.review_situations).toEqual(["idea_opportunity_harm"]);
    expect(ctx.active_checklists).toContain("idea_opportunity_harm");
    expect(ctx.active_checklists).toContain("idea_accept");
    expect(ctx.active_checklists).not.toContain("new_content_brand");
    expect(ctx.active_checklists).not.toContain("selling_page_figures");
  });

  it("title/description only → title_description_ctr without verify_copy", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "edits",
        category: "content.seo",
        entries: [
          {
            id: 1,
            proposal_id: "p1",
            entry_key: "blog/hello",
            locale: "en",
            variant: null,
            variant_fingerprint: null,
            status: "pending",
            ops: [
              { field_path: "meta.page_title", value: "New" },
              { field_path: "meta.description", value: "Desc" },
            ],
            baseline_context: { values: {} },
            last_error: null,
            applied_at: null,
            applied_by: null,
            contentType: "blog",
            slug: "hello",
          },
        ],
      }),
      lookups: [{ contentType: "blog", slug: "hello", locale: "en", existence: "exists" }],
    });
    expect(ctx.active_checklists).toContain("title_description_ctr");
    expect(ctx.active_checklists).not.toContain("verify_copy");
    expect(ctx.agent_preview.think_items.some((t) => t.id === "title_description_ctr")).toBe(true);
    expect(ctx.staff_summary.situation_description).toMatch(/search title\/description/i);
    const tpl = ctx.agent_preview.think_items.find((t) => t.id === "title_description_ctr");
    expect(tpl?.why.toLowerCase()).not.toMatch(/punchier|invite the click/);
    expect(tpl?.look_for.some((l) => /get_entry_activity/i.test(l))).toBe(true);
    expect(tpl?.look_for.some((l) => /duplicate_weaker|revise/i.test(l))).toBe(true);
    const disp = ctx.agent_preview.think_items.find((t) => t.id === "disposition");
    expect(disp?.look_for.some((l) => /same-field SERP churn/i.test(l))).toBe(true);
  });

  it("declared internal_links on content → internal_links checklist without verify_copy", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "edits",
        review_situations: ["internal_links"],
        summary: "Add same-locale internal links to the cluster hub without changing figures.",
        entries: [
          {
            id: 1,
            proposal_id: "p1",
            entry_key: "blog/hello",
            locale: "en",
            variant: null,
            variant_fingerprint: null,
            status: "pending",
            ops: [{ field_path: "content", value: "body with [hub](/en/hub)" }],
            baseline_context: { values: {} },
            last_error: null,
            applied_at: null,
            applied_by: null,
            contentType: "blog",
            slug: "hello",
          },
        ],
      }),
      lookups: [{ contentType: "blog", slug: "hello", locale: "en", existence: "exists" }],
    });
    expect(ctx.review_situations).toContain("internal_links");
    expect(ctx.active_checklists).toContain("internal_links");
    expect(ctx.active_checklists).not.toContain("verify_copy");
    expect(ctx.agent_preview.think_items.some((t) => t.id === "internal_links")).toBe(true);
  });

  it("empty situations + content without link keywords → body_copy_edit inferred", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "edits",
        review_situations: [],
        summary: "Clarify the opening paragraph for accuracy.",
        entries: [
          {
            id: 1,
            proposal_id: "p1",
            entry_key: "blog/hello",
            locale: "en",
            variant: null,
            variant_fingerprint: null,
            status: "pending",
            ops: [{ field_path: "content", value: "updated" }],
            baseline_context: { values: {} },
            last_error: null,
            applied_at: null,
            applied_by: null,
            contentType: "blog",
            slug: "hello",
          },
        ],
      }),
      lookups: [{ contentType: "blog", slug: "hello", locale: "en", existence: "exists" }],
    });
    expect(ctx.review_situations).toContain("body_copy_edit");
    expect(ctx.situation_source).toBe("inferred");
    expect(ctx.active_checklists).toContain("verify_copy");
  });

  it("funnel.* only → funnel_persona_product_stage without verify_copy", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "edits",
        review_situations: [],
        summary:
          "Classify funnel for career-outcomes intent to ai-engineering awareness. Funnel fields only.",
        entries: [
          {
            id: 1,
            proposal_id: "p1",
            entry_key: "blog/outcomes",
            locale: "en",
            variant: null,
            variant_fingerprint: null,
            status: "pending",
            ops: [
              { field_path: "funnel.stage", value: "awareness" },
              {
                field_path: "funnel.products",
                value: [{ product: "ai-engineering", persona: "the-career-changer" }],
              },
            ],
            baseline_context: { values: {} },
            last_error: null,
            applied_at: null,
            applied_by: null,
            contentType: "blog",
            slug: "outcomes",
          },
        ],
      }),
      lookups: [{ contentType: "blog", slug: "outcomes", locale: "en", existence: "exists" }],
    });
    expect(ctx.review_situations).toContain("funnel_classification");
    expect(ctx.review_situations).not.toContain("body_copy_edit");
    expect(ctx.active_checklists).toContain("funnel_persona_product_stage");
    expect(ctx.active_checklists).not.toContain("verify_copy");
    expect(ctx.agent_preview.think_items.some((t) => t.id === "funnel_persona_product_stage")).toBe(
      true,
    );
    expect(ctx.staff_summary.situation_description).toMatch(/buyer|funnel|product/i);
    const tpl = ctx.agent_preview.think_items.find((t) => t.id === "funnel_persona_product_stage");
    expect(tpl?.look_for.some((l) => /Persona/i.test(l))).toBe(true);
    expect(tpl?.look_for.some((l) => /products:all|breadth/i.test(l))).toBe(true);
  });

  it("title/description mixed with body → both checklists + mixed_serp_and_body", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "edits",
        entries: [
          {
            id: 1,
            proposal_id: "p1",
            entry_key: "blog/hello",
            locale: "en",
            variant: null,
            variant_fingerprint: null,
            status: "pending",
            ops: [
              { field_path: "meta.page_title", value: "New" },
              { field_path: "sections.0.data.title", value: "Body" },
            ],
            baseline_context: { values: {} },
            last_error: null,
            applied_at: null,
            applied_by: null,
            contentType: "blog",
            slug: "hello",
          },
        ],
      }),
      lookups: [{ contentType: "blog", slug: "hello", locale: "en", existence: "exists" }],
    });
    expect(ctx.active_checklists).toContain("title_description_ctr");
    expect(ctx.active_checklists).toContain("verify_copy");
    expect(ctx.agent_preview.warnings.some((w) => w.code === "mixed_serp_and_body")).toBe(true);
  });

  it("seo.main_keyword only → no title_description_ctr", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "edits",
        category: "content.seo",
        entries: [
          {
            id: 1,
            proposal_id: "p1",
            entry_key: "blog/hello",
            locale: "en",
            variant: null,
            variant_fingerprint: null,
            status: "pending",
            ops: [{ field_path: "seo.main_keyword", value: "x" }],
            baseline_context: { values: {} },
            last_error: null,
            applied_at: null,
            applied_by: null,
            contentType: "blog",
            slug: "hello",
          },
        ],
      }),
      lookups: [{ contentType: "blog", slug: "hello", locale: "en", existence: "exists" }],
    });
    expect(ctx.active_checklists).not.toContain("title_description_ctr");
    expect(ctx.active_checklists).toContain("verify_copy");
  });

  it("landing + title/desc without claim cues → title_description_ctr only", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "edits",
        entries: [
          {
            id: 1,
            proposal_id: "p1",
            entry_key: "landing/ai",
            locale: "en",
            variant: null,
            variant_fingerprint: null,
            status: "pending",
            ops: [{ field_path: "meta.description", value: "New desc" }],
            baseline_context: { values: {} },
            last_error: null,
            applied_at: null,
            applied_by: null,
            contentType: "landing",
            slug: "ai",
          },
        ],
      }),
      lookups: [{ contentType: "landing", slug: "ai", locale: "en", existence: "exists" }],
    });
    expect(ctx.damage_class).not.toBe("selling_page");
    expect(ctx.active_checklists).not.toContain("selling_page_figures");
    expect(ctx.active_checklists).toContain("title_description_ctr");
  });

  it("blog body with salary → selling_page_figures", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "edits",
        entries: [
          {
            id: 1,
            proposal_id: "p1",
            entry_key: "blog/hello",
            locale: "en",
            variant: null,
            variant_fingerprint: null,
            status: "pending",
            ops: [{ field_path: "content", value: "Average salary is $85,000" }],
            baseline_context: { values: {} },
            last_error: null,
            applied_at: null,
            applied_by: null,
            contentType: "blog",
            slug: "hello",
          },
        ],
      }),
      lookups: [{ contentType: "blog", slug: "hello", locale: "en", existence: "exists" }],
    });
    expect(ctx.damage_class).toBe("selling_page");
    expect(ctx.active_checklists).toContain("selling_page_figures");
    expect(ctx.needs_jev_claim_check).toBeFalsy();
    expect(ctx.review_situations).toContain("selling_figures");
  });

  it("blog body typo without cues → no figures", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "edits",
        entries: [
          {
            id: 1,
            proposal_id: "p1",
            entry_key: "blog/hello",
            locale: "en",
            variant: null,
            variant_fingerprint: null,
            status: "pending",
            ops: [{ field_path: "content", value: "Fixed a typo in the intro." }],
            baseline_context: { values: {} },
            last_error: null,
            applied_at: null,
            applied_by: null,
            contentType: "blog",
            slug: "hello",
          },
        ],
      }),
      lookups: [{ contentType: "blog", slug: "hello", locale: "en", existence: "exists" }],
    });
    expect(ctx.active_checklists).not.toContain("selling_page_figures");
    expect(ctx.damage_class).toBe("existing_content");
  });

  it("landing funnel-only → no figures", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "edits",
        entries: [
          {
            id: 1,
            proposal_id: "p1",
            entry_key: "landing/ai",
            locale: "en",
            variant: null,
            variant_fingerprint: null,
            status: "pending",
            ops: [{ field_path: "funnel.stage", value: "consideration" }],
            baseline_context: { values: {} },
            last_error: null,
            applied_at: null,
            applied_by: null,
            contentType: "landing",
            slug: "ai",
          },
        ],
      }),
      lookups: [{ contentType: "landing", slug: "ai", locale: "en", existence: "exists" }],
    });
    expect(ctx.active_checklists).not.toContain("selling_page_figures");
    expect(ctx.review_situations).toContain("funnel_classification");
  });

  it("ambiguous cues + Jev yes → figures", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "edits",
        entries: [
          {
            id: 1,
            proposal_id: "p1",
            entry_key: "blog/hello",
            locale: "en",
            variant: null,
            variant_fingerprint: null,
            status: "pending",
            ops: [{ field_path: "content", value: "About 50% of the chapter covers recursion." }],
            baseline_context: { values: {} },
            last_error: null,
            applied_at: null,
            applied_by: null,
            contentType: "blog",
            slug: "hello",
          },
        ],
      }),
      lookups: [{ contentType: "blog", slug: "hello", locale: "en", existence: "exists" }],
      claimCueJevOutcome: "yes",
    });
    expect(ctx.active_checklists).toContain("selling_page_figures");
    expect(ctx.jev?.outcome).toBe("yes");
  });

  it("ambiguous cues without Jev → needs_jev_claim_check", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "edits",
        entries: [
          {
            id: 1,
            proposal_id: "p1",
            entry_key: "blog/hello",
            locale: "en",
            variant: null,
            variant_fingerprint: null,
            status: "pending",
            ops: [{ field_path: "content", value: "About 50% of the chapter covers recursion." }],
            baseline_context: { values: {} },
            last_error: null,
            applied_at: null,
            applied_by: null,
            contentType: "blog",
            slug: "hello",
          },
        ],
      }),
      lookups: [{ contentType: "blog", slug: "hello", locale: "en", existence: "exists" }],
    });
    expect(ctx.needs_jev_claim_check).toBe(true);
    expect(ctx.active_checklists).not.toContain("selling_page_figures");
  });

  it("promoteDraftText with salary → figures", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "edits",
        promote_on_apply: true,
        entries: [
          {
            id: 1,
            proposal_id: "p1",
            entry_key: "blog/hello",
            locale: "en",
            variant: "draft.es",
            variant_fingerprint: "fp",
            status: "pending",
            ops: [],
            baseline_context: { values: {} },
            last_error: null,
            applied_at: null,
            applied_by: null,
            contentType: "blog",
            slug: "hello",
          },
        ],
      }),
      lookups: [
        {
          contentType: "blog",
          slug: "hello",
          locale: "en",
          variant: "draft.es",
          existence: "exists",
          draftExists: true,
        },
      ],
      promoteDraftText: "Graduates report an average salary of $72,000.",
    });
    expect(ctx.active_checklists).toContain("selling_page_figures");
  });

  it("countsAsLeadForm soft hint without figures", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "edits",
        entries: [
          {
            id: 1,
            proposal_id: "p1",
            entry_key: "landing/ai",
            locale: "en",
            variant: null,
            variant_fingerprint: null,
            status: "pending",
            ops: [{ field_path: "title", value: "AI course" }],
            baseline_context: { values: {} },
            last_error: null,
            applied_at: null,
            applied_by: null,
            contentType: "landing",
            slug: "ai",
          },
        ],
      }),
      lookups: [{ contentType: "landing", slug: "ai", locale: "en", existence: "exists" }],
      countsAsLeadForm: true,
    });
    expect(ctx.counts_as_lead_hint).toBe(true);
    expect(ctx.active_checklists).not.toContain("selling_page_figures");
    expect(ctx.agent_preview.warnings.some((w) => w.code === "counts_as_lead_form")).toBe(true);
  });

  it("done title ops do not keep title_description_ctr when only body remains", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "edits",
        entries: [
          {
            id: 1,
            proposal_id: "p1",
            entry_key: "blog/hello",
            locale: "en",
            variant: null,
            variant_fingerprint: null,
            status: "done",
            ops: [{ field_path: "meta.page_title", value: "Shipped" }],
            baseline_context: { values: {} },
            last_error: null,
            applied_at: 1,
            applied_by: "a",
            contentType: "blog",
            slug: "hello",
          },
          {
            id: 2,
            proposal_id: "p1",
            entry_key: "blog/hello",
            locale: "es",
            variant: null,
            variant_fingerprint: null,
            status: "pending",
            ops: [{ field_path: "sections.0.data.title", value: "Body" }],
            baseline_context: { values: {} },
            last_error: null,
            applied_at: null,
            applied_by: null,
            contentType: "blog",
            slug: "hello",
          },
        ],
      }),
      lookups: [
        { contentType: "blog", slug: "hello", locale: "es", existence: "exists" },
      ],
    });
    expect(ctx.active_checklists).not.toContain("title_description_ctr");
    expect(ctx.active_checklists).toContain("verify_copy");
  });

  it("declared locale_translation promote packet → locale_translation checklist without verify_copy", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "edits",
        promote_on_apply: true,
        review_mode: "draft_backed",
        review_situations: ["locale_translation"],
        summary:
          "Translated from en → es. Promote draft.es for how-much — facts match source; slug locale-fitting.",
        entries: [
          {
            id: 1,
            proposal_id: "p1",
            entry_key: "blog/how-much",
            locale: "es",
            variant: "draft",
            variant_fingerprint: "x",
            status: "pending",
            ops: [],
            baseline_context: { values: {} },
            last_error: null,
            applied_at: null,
            applied_by: null,
            contentType: "blog",
            slug: "how-much",
          },
        ],
      }),
      lookups: [
        {
          contentType: "blog",
          slug: "how-much",
          locale: "es",
          variant: "draft",
          existence: "exists",
          draftExists: true,
        },
      ],
    });
    expect(ctx.review_situations).toContain("locale_translation");
    expect(ctx.active_checklists).toContain("locale_translation");
    expect(ctx.active_checklists).not.toContain("verify_copy");
    expect(ctx.staff_summary.situation_description).toMatch(/locale translation/i);
    expect(ctx.agent_preview.think_items.some((t) => t.id === "locale_translation")).toBe(true);
  });

  it("warns undeclared existing_demand and stacks staff note when labeled", () => {
    const unlabeled = classifyProposalReview({
      proposal: baseProposal({
        kind: "idea",
        title: "Rank for what is machine learning",
        summary:
          "We want to rank and get cited for what is machine learning with a new explainer. ".repeat(2),
      }),
    });
    expect(unlabeled.agent_preview.warnings.some((w) => w.code === "existing_demand_undeclared")).toBe(true);

    const labeled = classifyProposalReview({
      proposal: baseProposal({
        kind: "idea",
        title: "Rank for what is machine learning",
        summary:
          "We want to rank and get cited for what is machine learning with a new explainer. ".repeat(2),
        review_situations: ["existing_demand"],
      }),
    });
    expect(labeled.review_situations).toContain("existing_demand");
    expect(labeled.agent_preview.warnings.some((w) => w.code === "existing_demand_undeclared")).toBe(false);
    expect(labeled.staff_summary.situation_description).toMatch(/search demand|SERP|weight/i);
  });

  it("warns idea_funnel_missing for new-URL ideas without structured funnel", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "idea",
        title: "New article about Grok",
        summary: "Create a page that explains Grok for beginners searching the query. ".repeat(2),
        related_entries: [{ contentType: "blog", slug: "what-is-grok", locale: "en" }],
      }),
      lookups: [
        {
          contentType: "blog",
          slug: "what-is-grok",
          locale: "en",
          existence: "missing",
          draftExists: false,
        },
      ],
    });
    expect(ctx.agent_preview.warnings.some((w) => w.code === "idea_funnel_missing")).toBe(true);

    const withFunnel = classifyProposalReview({
      proposal: baseProposal({
        kind: "idea",
        title: "New article about Grok",
        summary: "Create a page that explains Grok for beginners searching the query. ".repeat(2),
        related_entries: [{ contentType: "blog", slug: "what-is-grok", locale: "en" }],
        idea_funnel: { stage: "awareness", products: "all" },
      }),
      lookups: [
        {
          contentType: "blog",
          slug: "what-is-grok",
          locale: "en",
          existence: "missing",
          draftExists: false,
        },
      ],
    });
    expect(withFunnel.agent_preview.warnings.some((w) => w.code === "idea_funnel_missing")).toBe(false);
  });

  it("warns idea_content_type_missing on ideas with no related_entries", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "idea",
        title: "Reshape the AI hub",
        summary: "Restructure the AI hub so spokes are easier to find for beginners. ".repeat(2),
      }),
      knownContentTypes: ["blog", "landing"],
    });
    expect(ctx.agent_preview.warnings.some((w) => w.code === "idea_content_type_missing")).toBe(true);
  });

  it("adds content_type_fit think item and exposes content_type_strategies for ideas", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "idea",
        title: "New landing for AI bootcamp",
        summary: "Create a landing that converts paid traffic for the AI bootcamp in Miami. ".repeat(2),
        related_entries: [{ contentType: "landing", slug: "ai-miami", locale: "en" }],
      }),
      lookups: [
        { contentType: "landing", slug: "ai-miami", locale: "en", existence: "missing", draftExists: false },
      ],
      knownContentTypes: ["blog", "landing"],
      contentTypeStrategies: [
        { contentType: "landing", role: "pitched", purpose: "Convert paid traffic", constraints: ["One CTA"] },
      ],
    });
    expect(ctx.content_type_strategies?.[0].contentType).toBe("landing");
    const ids = ctx.agent_preview.think_items.map((t) => t.id);
    expect(ids.indexOf("content_type_fit")).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf("content_type_fit")).toBeLessThanOrEqual(1);
    expect(ctx.agent_preview.warnings.some((w) => w.code === "idea_content_type_missing")).toBe(false);
  });

  it("does not add content-type warnings to edits proposals", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({ kind: "edits" }),
      knownContentTypes: ["blog"],
      contentTypeStrategies: [{ contentType: "blog", role: "pitched", purpose: "Teach" }],
    });
    const codes = ctx.agent_preview.warnings.map((w) => w.code);
    expect(codes).not.toContain("idea_content_type_missing");
    expect(ctx.content_type_strategies).toBeUndefined();
    expect(ctx.agent_preview.think_items.some((t) => t.id === "content_type_fit")).toBe(false);
  });
});

describe("layout_owner review signals", () => {
  type Entry = ProposalRecord["entries"][number];
  const hero = { type: "hero", title: "Old" };
  const cta = { type: "cta_banner", title: "Go" };

  function sectionsEntry(
    overrides: Partial<Entry> & { before?: unknown[]; after?: unknown[] } = {},
  ): Entry {
    const { before = [hero], after = [hero], ...rest } = overrides;
    const { summarizeSectionsChange } = sectionsHelpers;
    return {
      id: 1,
      proposal_id: "p1",
      entry_key: "landing/ai",
      locale: "en",
      variant: "draft",
      variant_fingerprint: null,
      status: "pending",
      ops: [{ field_path: "sections", value: after }],
      baseline_context: { values: { sections: before } },
      author_diff: [{ field_path: "sections", before, after, scope: "locale" }],
      sections_summary: summarizeSectionsChange(before, after),
      last_error: null,
      applied_at: null,
      applied_by: null,
      contentType: "landing",
      slug: "ai",
      ...rest,
    };
  }

  const liveLookup = (extra: Record<string, unknown> = {}) => ({
    contentType: "landing",
    slug: "ai",
    locale: "en",
    existence: "exists" as const,
    draftExists: true,
    layout_owner: "entry" as const,
    ...extra,
  });

  it("new entry-owned page: creates_page_entry + page copy + owner line first", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({ kind: "edits", entries: [sectionsEntry({ before: [], after: [hero, cta] })] }),
      lookups: [liveLookup({ existence: "missing" })],
    });
    expect(ctx.agent_preview.warnings.map((w) => w.code)).toContain("creates_page_entry");
    expect(ctx.agent_preview.warnings.map((w) => w.code)).not.toContain("creates_attached_entry");
    expect(ctx.staff_summary.situation_description).toContain("including its full layout");
    expect(ctx.active_checklists).toContain("layout_structure");
    const item = ctx.agent_preview.think_items.find((t) => t.id === "layout_structure")!;
    expect(item.look_for[0]).toMatch(/^layout_owner: entry/);
    expect(ctx.entries[0]).toMatchObject({ layout_owner: "entry" });
  });

  it("attached (shared_template) create keeps the attached copy", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "edits",
        entries: [
          {
            ...sectionsEntry(),
            entry_key: "blog/what-is-grok",
            contentType: "blog",
            slug: "what-is-grok",
            variant: null,
            ops: [{ field_path: "title", value: "What is Grok" }],
            author_diff: undefined,
            sections_summary: undefined,
            baseline_context: { values: {}, creates_entry: true },
          },
        ],
      }),
      lookups: [
        {
          contentType: "blog",
          slug: "what-is-grok",
          locale: "en",
          existence: "missing",
          draftExists: false,
          layout_owner: "shared_template",
        },
      ],
    });
    expect(ctx.agent_preview.warnings.map((w) => w.code)).toContain("creates_attached_entry");
    expect(ctx.agent_preview.warnings.map((w) => w.code)).not.toContain("creates_page_entry");
    expect(ctx.staff_summary.situation_description).toContain("Applying creates this post");
    expect(ctx.active_checklists).not.toContain("layout_structure");
  });

  it("layout_structure fires on structural changes (co-author reorder too), not on a text edit in one section", () => {
    const added = classifyProposalReview({
      proposal: baseProposal({ kind: "edits", entries: [sectionsEntry({ before: [hero], after: [hero, cta] })] }),
      lookups: [liveLookup()],
    });
    expect(added.active_checklists).toContain("layout_structure");

    const reordered = classifyProposalReview({
      proposal: baseProposal({
        kind: "edits",
        entries: [
          sectionsEntry({
            before: [hero, cta],
            after: [cta, hero],
            requested_ops: [{ field_path: "sections[0].title", value: "New" }],
          }),
        ],
      }),
      lookups: [liveLookup()],
    });
    expect(reordered.active_checklists).toContain("layout_structure");

    const tweak = classifyProposalReview({
      proposal: baseProposal({
        kind: "edits",
        entries: [sectionsEntry({ before: [hero, cta], after: [{ ...hero, title: "New" }, cta] })],
      }),
      lookups: [liveLookup()],
    });
    expect(tweak.active_checklists).not.toContain("layout_structure");
  });

  it("fields-only edits on shared_template entries add the template-unaffected line", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "edits",
        entries: [
          {
            ...sectionsEntry(),
            entry_key: "blog/hello",
            contentType: "blog",
            slug: "hello",
            ops: [{ field_path: "content", value: "Body text" }],
            author_diff: [{ field_path: "content", before: "Old", after: "Body text", scope: "locale" }],
            sections_summary: undefined,
          },
        ],
      }),
      lookups: [{ contentType: "blog", slug: "hello", locale: "en", existence: "exists", layout_owner: "shared_template" }],
    });
    const verify = ctx.agent_preview.think_items.find((t) => t.id === "verify_copy");
    expect(verify?.look_for.at(-1)).toMatch(/^layout_owner: shared_template/);
  });

  it("template entries: template_blast_radius stacks with layout_structure and staff copy names the count", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({
        kind: "edits",
        affected_entries: { count: 12, sample: [] },
        entries: [
          sectionsEntry({
            entry_key: "blog/template",
            contentType: "blog",
            slug: "template",
            locale: "es",
            before: [hero],
            after: [hero, cta],
          }),
        ],
      }),
      lookups: [
        {
          contentType: "blog",
          slug: "template",
          locale: "es",
          existence: "exists",
          draftExists: true,
          layout_owner: "shared_template",
          is_shared_template: true,
        },
      ],
    });
    expect(ctx.active_checklists).toEqual(expect.arrayContaining(["template_blast_radius", "layout_structure"]));
    expect(ctx.staff_summary.situation_description).toContain("This changes the shared layout for 12 pages in es");
    expect(ctx.staff_summary.situation_description).toContain("(detached) are not affected");
    expect(ctx.entries[0]).toMatchObject({ is_shared_template: true });
  });

  it("layout_owner_changed only for entry → shared_template with a sections draft", () => {
    const reattached = classifyProposalReview({
      proposal: baseProposal({ kind: "edits", entries: [sectionsEntry({ before: [hero], after: [hero, cta] })] }),
      lookups: [liveLookup({ layout_owner: "shared_template", layout_owner_at_filing: "entry" })],
    });
    expect(reattached.agent_preview.warnings.map((w) => w.code)).toContain("layout_owner_changed");
    expect(reattached.staff_summary.situation_description).toContain("now uses the shared layout");

    const detached = classifyProposalReview({
      proposal: baseProposal({ kind: "edits", entries: [sectionsEntry({ before: [hero], after: [hero, cta] })] }),
      lookups: [liveLookup({ layout_owner: "entry", layout_owner_at_filing: "shared_template" })],
    });
    expect(detached.agent_preview.warnings.map((w) => w.code)).not.toContain("layout_owner_changed");

    const legacy = classifyProposalReview({
      proposal: baseProposal({ kind: "edits", entries: [sectionsEntry({ before: [hero], after: [hero, cta] })] }),
      lookups: [liveLookup({ layout_owner: "shared_template" })],
    });
    expect(legacy.agent_preview.warnings.map((w) => w.code)).not.toContain("layout_owner_changed");
  });
});

describe("site facts: figure variable tokens and site-facts check", () => {
  const DEFS = {
    "global.price_fullstack": { description: "Full price", category: "price", default: "16,999" },
    "global.campus_phone": { description: "Phone", category: "contact", default: "+1 555" },
    "global.tagline": { description: "Tagline", category: "copy", default: "Hi" },
  };
  const entry = (value: string, field_path = "content") => ({
    id: 1,
    proposal_id: "p1",
    entry_key: "landing/x",
    locale: "en",
    variant: null,
    variant_fingerprint: null,
    status: "pending" as const,
    ops: [{ field_path, value }],
    baseline_context: { values: {} },
    last_error: null,
    applied_at: null,
    applied_by: null,
    contentType: "landing",
    slug: "x",
  });
  const lookups = [{ contentType: "landing", slug: "x", locale: "en", existence: "exists" as const }];

  it("figure-category token turns on outcome figures with figure_variables + warning", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({ kind: "edits", entries: [entry("Only {{ global.price_fullstack | 16,999 }} today")] }),
      lookups,
      variableDefinitions: DEFS,
    });
    expect(ctx.active_checklists).toContain("selling_page_figures");
    expect(ctx.figure_variables).toEqual([
      { name: "global.price_fullstack", category: "price", default: "16,999", varies_by: [], deprecated: false },
    ]);
    expect(ctx.agent_preview.warnings.map((w) => w.code)).toContain("figure_variable_tokens");
  });

  it("tokens in any field path count; non-figure tokens do not turn figures on", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({ kind: "edits", entries: [entry("{{ global.tagline }} {{ global.campus_phone }}", "cta.label")] }),
      lookups,
      variableDefinitions: DEFS,
    });
    expect(ctx.figure_variables).toBeUndefined();
    expect(ctx.active_checklists).not.toContain("selling_page_figures");
    expect(ctx.fact_variable_names).toEqual(["global.campus_phone"]);
  });

  it("without variableDefinitions no token checks run", () => {
    const ctx = classifyProposalReview({
      proposal: baseProposal({ kind: "edits", entries: [entry("{{ global.price_fullstack }}")] }),
      lookups,
    });
    expect(ctx.figure_variables).toBeUndefined();
  });

  it("asks for a site-facts check when a fact checklist is active, then carries the result", () => {
    const proposal = baseProposal({ kind: "edits", entries: [entry("We have 3 campuses")] });
    const first = classifyProposalReview({ proposal, lookups, variableDefinitions: DEFS });
    expect(first.active_checklists).toContain("verify_copy");
    expect(first.needs_site_facts_check).toBe(true);

    const ok = classifyProposalReview({
      proposal,
      lookups,
      variableDefinitions: DEFS,
      siteFactsCheck: { outcome: "ok", categories: ["company_fact"] },
    });
    expect(ok.needs_site_facts_check).toBeUndefined();
    expect(ok.site_facts).toEqual({ outcome: "ok", categories: ["company_fact"] });

    const down = classifyProposalReview({
      proposal,
      lookups,
      siteFactsCheck: { outcome: "unavailable", categories: [] },
    });
    expect(down.agent_preview.warnings.map((w) => w.code)).toContain("jev_unavailable");
  });
});

describe("third-party evidence", () => {
  const evidenceProposal = (value: string, baseline: Record<string, unknown> = {}) =>
    baseProposal({
      kind: "edits",
      entries: [
        {
          id: 1,
          proposal_id: "p1",
          entry_key: "landing/ai",
          locale: "en",
          variant: null,
          variant_fingerprint: null,
          status: "pending",
          ops: [{ field_path: "content", value }],
          baseline_context: { values: baseline },
          last_error: null,
          applied_at: null,
          applied_by: null,
          contentType: "landing",
          slug: "ai",
        },
      ],
    });
  const lookups = [{ contentType: "landing", slug: "ai", locale: "en", existence: "exists" as const }];
  const row = {
    site: "site_a",
    domain: "a.com",
    database: "press_mentions",
    index: 0,
    label: "Bahamas",
    link: "https://x",
    archive_status: "archived" as const,
    archive_url: "https://web.archive.org/web/1/https://x",
  };

  it("a sourced claim without an archived copy warns evidence_not_archived (never blocks)", () => {
    const ctx = classifyProposalReview({
      proposal: evidenceProposal("Chosen alongside Harvard and Oxford."),
      lookups,
      evidenceCheck: {
        outcome: "ok",
        claims: [
          { name: "Harvard", status: "sourced", row: { ...row, archive_status: "pending", archive_url: null }, row_status: "sourced" },
          { name: "Oxford", status: "sourced", row, row_status: "sourced" },
        ],
        blocking: [],
        databases: [],
      },
    });
    const warning = ctx.agent_preview.warnings.find((w) => w.code === "evidence_not_archived");
    expect(warning?.message).toContain("Harvard");
    expect(warning?.message).not.toContain("Oxford");
    expect(ctx.evidence_block).toBeUndefined();
  });

  it("asks for an evidence check when a relationship cue appears", () => {
    const ctx = classifyProposalReview({
      proposal: evidenceProposal("Chosen alongside Harvard and Oxford."),
      lookups,
    });
    expect(ctx.needs_evidence_check).toBe(true);
    expect(ctx.active_checklists).toContain("third_party_evidence");
    expect(ctx.evidence_block).toBeUndefined();
  });

  it("no cue → no evidence checklist", () => {
    const ctx = classifyProposalReview({ proposal: evidenceProposal("Learn Python fast."), lookups });
    expect(ctx.needs_evidence_check).toBeUndefined();
    expect(ctx.active_checklists).not.toContain("third_party_evidence");
  });

  it("blocking names set evidence_block and warn; unsourced / already_live only warn", () => {
    const ctx = classifyProposalReview({
      proposal: evidenceProposal("Chosen alongside Harvard, MIT and Oxford."),
      lookups,
      evidenceCheck: {
        outcome: "ok",
        claims: [
          { name: "Harvard", status: "sourced", row, row_status: "sourced" },
          { name: "MIT", status: "no_evidence" },
          { name: "Oxford", status: "unsourced", row: { ...row, link: null }, row_status: "unsourced" },
          { name: "Columbia", status: "already_live" },
        ],
        blocking: ["MIT"],
        databases: [{ site: "site_a", domain: "a.com", database: "press_mentions", label: "Press", proves: ["press_coverage"] }],
      },
    });
    expect(ctx.evidence_block).toBe(true);
    expect(ctx.block_apply).toBe(false);
    const codes = ctx.agent_preview.warnings.map((w) => w.code);
    expect(codes).toEqual(expect.arrayContaining(["evidence_missing", "evidence_unsourced", "evidence_already_live"]));
    expect(ctx.staff_summary.situation_description).toContain("no proof on file");
  });

  it("no blocking names → no evidence_block", () => {
    const ctx = classifyProposalReview({
      proposal: evidenceProposal("Chosen alongside Harvard."),
      lookups,
      evidenceCheck: {
        outcome: "ok",
        claims: [{ name: "Stanford", status: "dismissed", dismissal: { name: "Stanford", reason: "example only", by: "s", at: 1 } }],
        blocking: [],
        databases: [],
      },
    });
    expect(ctx.evidence_block).toBeUndefined();
    expect(ctx.evidence?.claims[0]?.status).toBe("dismissed");
  });
});
