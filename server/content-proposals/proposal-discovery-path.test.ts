import { describe, expect, it } from "vitest";
import { TOOL_GATES } from "../../shared/mcp-tool-catalog.js";
import {
  buildProposalDiscoveryPath,
  proposalDiscoveryToolNames,
} from "./proposal-discovery-path.js";

const catalog = new Set(Object.keys(TOOL_GATES));

function assertCatalogToolNames(
  toolNames: string[],
  catalogNames: ReadonlySet<string>,
): { ok: true } | { ok: false; unknown: string[] } {
  const unknown = [...new Set(toolNames.filter((t) => !catalogNames.has(t)))];
  return unknown.length === 0 ? { ok: true } : { ok: false, unknown };
}

const baseEdits = {
  id: "p1",
  status: "open",
  kind: "edits",
  title: "Fix CTA",
  summary: "Update the primary CTA copy on the landing page to match the offer.",
  open_blocker_count: 0,
  entries: [
    { contentType: "landing", slug: "ai-course", locale: "en", status: "pending" },
    { contentType: "landing", slug: "ai-course", locale: "es", status: "pending" },
  ],
};

describe("buildProposalDiscoveryPath", () => {
  it("returns think-only path and warning when escalated", () => {
    const { discovery_path, warnings } = buildProposalDiscoveryPath({
      proposal: {
        ...baseEdits,
        escalated: true,
        escalated_note: "Agent invented a blocker that invents product claims we do not make.",
      },
      allowedTools: catalog,
    });
    expect(discovery_path?.items).toHaveLength(1);
    expect(discovery_path?.items[0]).toMatchObject({ kind: "think", id: "steward_hold" });
    expect(warnings.some((w) => w.code === "proposal_escalated")).toBe(true);
  });

  it("returns null for finished/rejected/withdrawn", () => {
    for (const status of ["finished", "rejected", "withdrawn"] as const) {
      const { discovery_path } = buildProposalDiscoveryPath({
        proposal: { ...baseEdits, status },
        allowedTools: catalog,
      });
      expect(discovery_path).toBeNull();
    }
  });

  it("builds edits path with think-before-tools and ≤6 thinks", () => {
    const { discovery_path, warnings } = buildProposalDiscoveryPath({
      proposal: baseEdits,
      allowedTools: catalog,
      reviewContext: {
        summary: "Selling page edit",
        damage_class: "selling_page",
        agent_preview: {
          think_items: [
            {
              id: "selling_page_figures",
              title: "Verify figures",
              why: "Selling page",
              look_for: ["hire rate"],
            },
            {
              id: "adjacent_findings",
              title: "Park out-of-scope live-page defects",
              why: "Park debt",
              look_for: ["same entry, ops do not touch → notes"],
            },
            {
              id: "disposition",
              title: "Choose a disposition",
              why: "Decide",
              look_for: ["apply only when you would ship"],
            },
          ],
        },
      },
    });
    expect(discovery_path).not.toBeNull();
    const items = discovery_path!.items;
    const thinks = items.filter((i) => i.kind === "think");
    const tools = items.filter((i) => i.kind === "tool");
    expect(thinks.length).toBeGreaterThan(0);
    expect(thinks.length).toBeLessThanOrEqual(6);
    // core 4 + organic + funnel analytics (selling_page) = 6; not the full catalog union
    expect(tools.length).toBe(6);
    const toolIds = tools.map((t) => (t.kind === "tool" ? t.id : ""));
    expect(toolIds).toContain("traffic_risk");
    expect(toolIds).toContain("journey_metrics");
    expect(toolIds).not.toContain("site_ga");
    const firstToolIdx = items.findIndex((i) => i.kind === "tool");
    const lastThinkIdx = items.map((i) => i.kind).lastIndexOf("think");
    expect(lastThinkIdx).toBeLessThan(firstToolIdx);
    expect(tools.every((t) => t.kind === "tool" && t.available)).toBe(true);
    expect(warnings).toEqual([]);

    const figures = thinks.find((t) => t.id === "selling_page_figures");
    expect(figures?.kind).toBe("think");
    const adjacent = thinks.find((t) => t.id === "adjacent_findings");
    expect(adjacent?.kind).toBe("think");

    const toolNames = tools.map((t) => (t.kind === "tool" ? t.tool : "")).filter(Boolean);
    expect(assertCatalogToolNames(toolNames, catalog)).toEqual({ ok: true });

    const previewContent = tools.find((t) => t.kind === "tool" && t.id === "preview_content");
    expect(previewContent?.kind).toBe("tool");
    if (previewContent?.kind === "tool") {
      expect(previewContent.look_for.some((l) => /adjacent_findings|notes/i.test(l))).toBe(true);
      expect(previewContent.look_for.some((l) => /not default add_blocker/i.test(l))).toBe(true);
    }
  });

  it("marks tools unavailable and warns when grants are thin", () => {
    const { discovery_path, warnings } = buildProposalDiscoveryPath({
      proposal: baseEdits,
      allowedTools: new Set(["get_entry_content", "get_entry_activity"]),
    });
    expect(discovery_path).not.toBeNull();
    const tools = discovery_path!.items.filter((i) => i.kind === "tool");
    const capped = tools.filter((t) => t.kind === "tool" && !t.available);
    expect(capped.length).toBeGreaterThan(0);
    expect(capped.every((t) => t.kind === "tool" && t.hint)).toBe(true);
    expect(warnings.some((w) => w.code === "discovery_tool_capped")).toBe(true);
    // think items still present
    expect(discovery_path!.items.some((i) => i.kind === "think")).toBe(true);
  });

  it("passes adjacent_findings think items from agent_preview", () => {
    const { discovery_path } = buildProposalDiscoveryPath({
      proposal: baseEdits,
      allowedTools: catalog,
      reviewContext: {
        agent_preview: {
          think_items: [
            {
              id: "adjacent_findings",
              title: "Park out-of-scope live-page defects",
              why: "Park",
              look_for: ["other entry → notes"],
            },
            {
              id: "verify_copy",
              title: "Check copy",
              why: "Verify",
              look_for: ["proposed value vs live"],
            },
          ],
        },
      },
    });
    const adjacent = discovery_path!.items.find(
      (i) => i.kind === "think" && i.id === "adjacent_findings",
    );
    expect(adjacent?.kind).toBe("think");
  });

  it("uses agent_preview think items when provided", () => {
    const { discovery_path } = buildProposalDiscoveryPath({
      proposal: baseEdits,
      allowedTools: catalog,
      reviewContext: {
        agent_preview: {
          think_items: [
            {
              id: "verify_copy",
              title: "Check copy",
              why: "Verify",
              look_for: ["proposed vs live"],
            },
          ],
        },
      },
    });
    const verify = discovery_path!.items.find((i) => i.kind === "think" && i.id === "verify_copy");
    expect(verify?.kind).toBe("think");
  });

  it("builds idea path with explain tool and no related page tools", () => {
    const { discovery_path, warnings } = buildProposalDiscoveryPath({
      proposal: {
        id: "i1",
        status: "open",
        kind: "idea",
        summary: "We should write a new spoke about X with a clear funnel CTA.",
      },
      allowedTools: catalog,
      reviewContext: {
        review_situations: ["idea_opportunity_harm"],
        agent_preview: {
          think_items: [
            {
              id: "idea_opportunity_harm",
              title: "Score opportunity vs site harm",
              why: "Accept greenlights a brief only.",
              look_for: ["Goal", "Evidence"],
            },
          ],
        },
      },
    });
    expect(discovery_path).not.toBeNull();
    expect(discovery_path!.goal.toLowerCase()).toMatch(/accept/);
    const tools = discovery_path!.items.filter((i) => i.kind === "tool");
    expect(tools.map((t) => (t.kind === "tool" ? t.tool : ""))).toEqual(["explain_site"]);
    expect(tools.every((t) => t.kind === "tool" && t.available)).toBe(true);
    const explain = tools[0];
    if (explain?.kind === "tool") {
      expect(explain.args_hint).toMatchObject({
        topic: "proposals",
        subtopic: "idea-opportunity-harm",
      });
    }
    expect(warnings).toEqual([]);
  });

  it("builds idea path with related tools; unavailable when caps empty", () => {
    const { discovery_path, warnings } = buildProposalDiscoveryPath({
      proposal: {
        id: "i2",
        status: "open",
        kind: "idea",
        summary: "Delete a low-traffic hub after confirming spokes are dead.",
        related_entries: [{ contentType: "blog", slug: "ai-tools-hub", locale: "en" }],
      },
      allowedTools: new Set(),
      reviewContext: {
        review_situations: ["idea_opportunity_harm"],
        agent_preview: {
          think_items: [
            {
              id: "idea_opportunity_harm",
              title: "Score opportunity vs site harm",
              why: "x",
              look_for: ["y"],
            },
          ],
        },
      },
    });
    expect(discovery_path).not.toBeNull();
    const tools = discovery_path!.items.filter((i) => i.kind === "tool");
    expect(tools.length).toBeGreaterThanOrEqual(2);
    expect(tools.every((t) => t.kind === "tool" && t.available === false)).toBe(true);
    expect(warnings.some((w) => w.code === "discovery_tool_capped")).toBe(true);
    expect(discovery_path!.non_effects.join(" ")).toMatch(/optional/i);
  });

  it("builds short notes path without apply-research tools", () => {
    const { discovery_path, warnings } = buildProposalDiscoveryPath({
      proposal: {
        id: "n1",
        status: "partial",
        kind: "notes",
        summary: "Tried X and Y; need human decision on Z.",
      },
      allowedTools: new Set(),
    });
    expect(discovery_path).not.toBeNull();
    expect(discovery_path!.items.every((i) => i.kind === "think")).toBe(true);
    expect(discovery_path!.items.length).toBeLessThanOrEqual(5);
    expect(warnings).toEqual([]);
    expect(discovery_path!.goal.toLowerCase()).toMatch(/close/);
  });

  it("edits discovery tools are all catalog members", () => {
    expect(assertCatalogToolNames(proposalDiscoveryToolNames(), catalog)).toEqual({ ok: true });
  });

  it("caps traffic tools: existing_content gets organic + site GA, not funnel analytics", () => {
    const { discovery_path } = buildProposalDiscoveryPath({
      proposal: baseEdits,
      allowedTools: catalog,
      reviewContext: { damage_class: "existing_content" },
    });
    const tools = discovery_path!.items.filter((i) => i.kind === "tool");
    const ids = tools.map((t) => (t.kind === "tool" ? t.id : ""));
    expect(ids).toContain("traffic_risk");
    expect(ids).toContain("site_ga");
    expect(ids).not.toContain("journey_metrics");
    const siteGa = tools.find((t) => t.kind === "tool" && t.id === "site_ga");
    expect(siteGa?.kind).toBe("tool");
    if (siteGa?.kind === "tool") {
      expect(siteGa.args_hint).toMatchObject({
        report: "page_detail",
        content_type: "landing",
        slug: "ai-course",
      });
    }
  });

  it("funnel field ops prefer journey metrics over site GA", () => {
    const { discovery_path } = buildProposalDiscoveryPath({
      proposal: {
        ...baseEdits,
        entries: [
          {
            contentType: "landing",
            slug: "ai-course",
            locale: "en",
            status: "pending",
            ops: [{ field_path: "funnel.stage" }],
          },
        ],
      },
      allowedTools: catalog,
      reviewContext: { damage_class: "existing_content" },
    });
    const ids = discovery_path!.items
      .filter((i) => i.kind === "tool")
      .map((t) => (t.kind === "tool" ? t.id : ""));
    expect(ids).toContain("journey_metrics");
    expect(ids).not.toContain("site_ga");
  });

  it("SERP ops elevate get_entry_activity to first tool even with zero writes", () => {
    const { discovery_path, warnings } = buildProposalDiscoveryPath({
      proposal: {
        ...baseEdits,
        entries: [
          {
            contentType: "blog",
            slug: "how-much",
            locale: "en",
            status: "pending",
            ops: [
              { field_path: "meta.page_title", value: "New" },
              { field_path: "meta.description", value: "Desc" },
            ],
          },
        ],
      },
      allowedTools: catalog,
      reviewContext: { damage_class: "existing_metadata" },
      recentActivity: [],
    });
    const tools = discovery_path!.items.filter((i) => i.kind === "tool");
    expect(tools[0]).toMatchObject({ kind: "tool", id: "recent_writes", tool: "get_entry_activity" });
    if (tools[0]?.kind === "tool") {
      expect(tools[0].args_hint).toMatchObject({
        contentType: "blog",
        slug: "how-much",
        locale: "en",
      });
      expect(tools[0].look_for.some((l) => /duplicate_weaker|revise_entries/i.test(l))).toBe(true);
    }
    expect(warnings.some((w) => w.code === "recent_entry_writes")).toBe(false);
    const researchIds = tools
      .filter((t) => t.kind === "tool")
      .map((t) => (t.kind === "tool" ? t.id : ""));
    expect(researchIds).toContain("seo_research_serp");
    expect(researchIds).toContain("seo_research_ideas");
    const serp = tools.find((t) => t.kind === "tool" && t.id === "seo_research_serp");
    expect(serp?.kind).toBe("tool");
    if (serp?.kind === "tool") {
      expect(serp.tool).toBe("get_or_refresh_seo_research");
      expect(serp.args_hint).toMatchObject({ action: "serp", contentType: "blog", slug: "how-much" });
      expect(serp.available).toBe(true);
    }
  });

  it("SEO research discovery tools are unavailable without seo_edit", () => {
    const allowed = new Set(
      [...catalog].filter((t) => t !== "get_or_refresh_seo_research"),
    );
    const { discovery_path, warnings } = buildProposalDiscoveryPath({
      proposal: {
        ...baseEdits,
        entries: [
          {
            contentType: "blog",
            slug: "how-much",
            locale: "en",
            status: "pending",
            ops: [{ field_path: "meta.page_title", value: "New" }],
          },
        ],
      },
      allowedTools: allowed,
      reviewContext: {
        damage_class: "existing_metadata",
        review_situations: ["serp_title_description"],
      },
    });
    const serp = discovery_path!.items.find(
      (i) => i.kind === "tool" && i.id === "seo_research_serp",
    );
    expect(serp?.kind).toBe("tool");
    if (serp?.kind === "tool") {
      expect(serp.available).toBe(false);
      expect(serp.hint).toBeTruthy();
    }
    expect(warnings.some((w) => w.code === "discovery_tool_capped")).toBe(true);
  });

  it("no SERP + zero filtered writes keeps preview_content before recent_writes", () => {
    const { discovery_path } = buildProposalDiscoveryPath({
      proposal: {
        ...baseEdits,
        entries: [
          {
            contentType: "landing",
            slug: "ai-course",
            locale: "en",
            status: "pending",
            ops: [{ field_path: "call_to_action.title", value: "Go" }],
          },
        ],
      },
      allowedTools: catalog,
      reviewContext: { damage_class: "existing_content" },
      recentActivity: [{ entryKey: "landing/ai-course/en", writeCount: 0, windowDays: 14 }],
    });
    const tools = discovery_path!.items.filter((i) => i.kind === "tool");
    const ids = tools.map((t) => (t.kind === "tool" ? t.id : ""));
    expect(ids.indexOf("preview_content")).toBeLessThan(ids.indexOf("recent_writes"));
  });

  it("filtered writes without SERP elevate activity + warn listing pending entries", () => {
    const { discovery_path, warnings } = buildProposalDiscoveryPath({
      proposal: {
        ...baseEdits,
        entries: [
          {
            contentType: "landing",
            slug: "ai-course",
            locale: "en",
            status: "pending",
            ops: [{ field_path: "call_to_action.title", value: "Go" }],
          },
          {
            contentType: "landing",
            slug: "other",
            locale: "en",
            status: "pending",
            ops: [{ field_path: "sections.0.data.title", value: "X" }],
          },
        ],
      },
      allowedTools: catalog,
      reviewContext: { damage_class: "existing_content" },
      recentActivity: [
        { entryKey: "landing/other/en", writeCount: 3, windowDays: 14 },
        { entryKey: "landing/ai-course/en", writeCount: 1, windowDays: 14 },
      ],
    });
    const tools = discovery_path!.items.filter((i) => i.kind === "tool");
    expect(tools[0]).toMatchObject({ id: "recent_writes", tool: "get_entry_activity" });
    if (tools[0]?.kind === "tool") {
      // Hottest pending entry wins args_hint
      expect(tools[0].args_hint).toMatchObject({
        contentType: "landing",
        slug: "other",
        locale: "en",
      });
    }
    const warn = warnings.find((w) => w.code === "recent_entry_writes");
    expect(warn).toBeTruthy();
    expect(warn!.message).toMatch(/landing\/other\/en/);
    expect(warn!.message).toMatch(/landing\/ai-course\/en/);
  });

  it("title_description_ctr look_for mentions get_entry_activity churn when preview thinks are used", () => {
    const { discovery_path } = buildProposalDiscoveryPath({
      proposal: {
        ...baseEdits,
        entries: [
          {
            contentType: "blog",
            slug: "x",
            locale: "en",
            status: "pending",
            ops: [{ field_path: "meta.page_title", value: "T" }],
          },
        ],
      },
      allowedTools: catalog,
      reviewContext: {
        damage_class: "existing_metadata",
        agent_preview: {
          think_items: [
            {
              id: "title_description_ctr",
              title: "Block bad SERP",
              why: "SERP",
              look_for: [
                "when SERP ops or recent writes: get_entry_activity first — same-field title/description churn",
              ],
            },
            {
              id: "disposition",
              title: "Choose",
              why: "Decide",
              look_for: ["same-field SERP churn after recent title/description writes"],
            },
          ],
        },
      },
    });
    const serp = discovery_path!.items.find((i) => i.kind === "think" && i.id === "title_description_ctr");
    expect(serp?.kind).toBe("think");
    if (serp?.kind === "think") {
      expect(serp.look_for.some((l) => /get_entry_activity/i.test(l))).toBe(true);
    }
  });

  it("internal_links situation prepends href look_for on get_entry_content", () => {
    const { discovery_path } = buildProposalDiscoveryPath({
      proposal: {
        ...baseEdits,
        entries: [
          {
            contentType: "blog",
            slug: "x",
            locale: "en",
            status: "pending",
            ops: [{ field_path: "content", value: "linked" }],
          },
        ],
      },
      allowedTools: catalog,
      reviewContext: {
        damage_class: "existing_content",
        review_situations: ["internal_links"],
        agent_preview: {
          think_items: [
            {
              id: "internal_links",
              title: "Hub links",
              why: "Facts and locale",
              look_for: ["facts intact"],
            },
          ],
        },
      },
    });
    const preview = discovery_path!.items.find((i) => i.kind === "tool" && i.id === "preview_content");
    expect(preview?.kind).toBe("tool");
    if (preview?.kind === "tool") {
      expect(preview.look_for.some((l) => /added \[text\]\(href\)/i.test(l))).toBe(true);
      expect(preview.look_for.some((l) => /locale/i.test(l))).toBe(true);
    }
  });

  it("funnel_classification includes list_products and get_product; prioritizes activity", () => {
    const { discovery_path } = buildProposalDiscoveryPath({
      proposal: {
        ...baseEdits,
        entries: [
          {
            contentType: "blog",
            slug: "outcomes-report",
            locale: "en",
            status: "pending",
            ops: [
              { field_path: "funnel.stage", value: "awareness" },
              { field_path: "funnel.products", value: [{ product: "ai-engineering" }] },
            ],
          },
        ],
      },
      allowedTools: catalog,
      reviewContext: {
        damage_class: "existing_content",
        review_situations: ["funnel_classification"],
        agent_preview: {
          think_items: [
            {
              id: "funnel_persona_product_stage",
              title: "Check persona → product → stage",
              why: "Buyer fit",
              look_for: ["Persona / Product / Stage"],
            },
          ],
        },
      },
    });
    const tools = (discovery_path!.items.filter((i) => i.kind === "tool") as Array<{ id: string; tool: string }>).map(
      (t) => t.tool,
    );
    expect(tools).toContain("list_products");
    expect(tools).toContain("get_product");
    expect(tools[0]).toBe("get_entry_activity");
    const preview = discovery_path!.items.find((i) => i.kind === "tool" && i.id === "preview_content");
    expect(preview?.kind).toBe("tool");
    if (preview?.kind === "tool") {
      expect(preview.look_for.some((l) => /persona/i.test(l))).toBe(true);
    }
  });

  it("locale_translation adds playbook + list_variants and variant on preview args_hint", () => {
    const { discovery_path } = buildProposalDiscoveryPath({
      proposal: {
        id: "t1",
        status: "open",
        kind: "edits",
        title: "Translate blog",
        summary: "Translated from en → es. Promote draft.",
        open_blocker_count: 0,
        entries: [
          {
            contentType: "blog",
            slug: "how-much",
            locale: "es",
            variant: "draft",
            status: "pending",
          },
        ],
      },
      allowedTools: catalog,
      reviewContext: {
        damage_class: "existing_content",
        review_situations: ["locale_translation"],
        agent_preview: {
          think_items: [
            {
              id: "locale_translation",
              title: "Locale draft vs source before promote",
              why: "Fidelity",
              look_for: ["Fidelity / Completeness"],
            },
          ],
        },
      },
    });
    const tools = discovery_path!.items.filter((i) => i.kind === "tool");
    const ids = tools.map((t) => (t.kind === "tool" ? t.id : ""));
    expect(ids[0]).toBe("translation_playbook");
    expect(ids).toContain("variant_layers");
    const playbook = tools.find((t) => t.kind === "tool" && t.id === "translation_playbook");
    if (playbook?.kind === "tool") {
      expect(playbook.args_hint).toMatchObject({
        topic: "proposals",
        subtopic: "translations",
      });
    }
    const preview = tools.find((t) => t.kind === "tool" && t.id === "preview_content");
    if (preview?.kind === "tool") {
      expect(preview.args_hint).toMatchObject({
        contentType: "blog",
        slug: "how-much",
        locale: "es",
        variant: "draft",
      });
      expect(preview.look_for.some((l) => /source locale/i.test(l))).toBe(true);
    }
  });
});

describe("assertCatalogToolNames", () => {
  it("flags unknown tools", () => {
    expect(assertCatalogToolNames(["get_entry_content", "validate_content"], catalog)).toEqual({
      ok: false,
      unknown: ["validate_content"],
    });
  });
});
