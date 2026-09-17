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
} from "./review-context";
import type { ProposalRecord } from "./service";

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
    ...overrides,
  };
}

describe("damageClassForTarget", () => {
  it("selling type wins over seo category", () => {
    expect(
      damageClassForTarget({
        contentType: "landing",
        category: "content.seo",
        existence: "exists",
      }),
    ).toBe("selling_page");
  });

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
});

describe("undoCostFor", () => {
  it("orders soft_variant < soft < draft_backed", () => {
    expect(undoCostFor("edits", "soft_variant")).toBe("low");
    expect(undoCostFor("edits", "soft")).toBe("medium");
    expect(undoCostFor("edits", "draft_backed")).toBe("high");
    expect(undoCostFor("notes", "soft")).toBe("none");
  });
});

describe("collectDamageClassesForMixedCheck", () => {
  it("detects mixed selling + blog meta", () => {
    const classes = collectDamageClassesForMixedCheck([
      { contentType: "landing", existence: "exists" },
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

  it("adds adjacent_findings for selling_page edits", () => {
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
            ops: [],
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

  it("landing + title/desc → selling_page_figures and title_description_ctr", () => {
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
    expect(ctx.damage_class).toBe("selling_page");
    expect(ctx.active_checklists).toContain("selling_page_figures");
    expect(ctx.active_checklists).toContain("title_description_ctr");
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
});
