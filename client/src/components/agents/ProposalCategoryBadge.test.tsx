import React from "react";
import { beforeAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { proposalCategoryExplain as ExplainFn } from "@/components/agents/ProposalExplainBadges";
import type { ProposalCategoryTags as TagsComponent } from "@/components/agents/ProposalListCard";

let proposalCategoryExplain: typeof ExplainFn;
let ProposalCategoryTags: typeof TagsComponent;
beforeAll(async () => {
  // Vitest compiles JSX with the classic runtime; these modules rely on the automatic one.
  (globalThis as { React?: typeof React }).React = React;
  ({ proposalCategoryExplain } = await import("@/components/agents/ProposalExplainBadges"));
  ({ ProposalCategoryTags } = await import("@/components/agents/ProposalListCard"));
});

function renderTags(kind: string, category = "content.field", tags?: string[]) {
  return renderToStaticMarkup(
    <ProposalCategoryTags category={category} kind={kind} tags={tags} testIdPrefix="proposal-detail" />,
  );
}

describe("ProposalCategoryTags", () => {
  it("labels the category badge on Edits proposals", () => {
    const html = renderTags("edits");
    expect(html).toContain("Category:");
    expect(html).toContain("Page content");
    expect(html).toContain('data-testid="badge-proposal-category-proposal-detail"');
    expect(html).toContain('data-testid="proposal-detail-category"');
    expect(html).toContain('aria-label="Category: Page content — what this means"');

    expect(renderTags("edits", "content.seo")).toContain("SEO");
  });

  it("hides the category on Ideas and Handoffs", () => {
    expect(renderTags("idea")).toBe("");
    expect(renderTags("notes")).toBe("");

    const withTags = renderTags("notes", "content.field", ["blocked"]);
    expect(withTags).toContain("blocked");
    expect(withTags).not.toContain("Category:");
  });
});

describe("proposalCategoryExplain", () => {
  it("explains each category in plain English with advanced details", () => {
    const field = proposalCategoryExplain("content.field");
    expect(field.title).toBe("Changes the page content");
    expect(field.body).toMatch(/does not change what Approve does/);
    expect(field.advanced.join(" ")).toContain("content.field");

    const seo = proposalCategoryExplain("content.seo");
    expect(seo.label).toBe("SEO");
    expect(seo.title).toBe("Changes how the page shows up in search");
    expect(seo.advanced.join(" ")).toContain("meta.*");
  });

  it("falls back for unknown categories", () => {
    const other = proposalCategoryExplain("other");
    expect(other.label).toBe("other");
    expect(other.advanced).toEqual([]);
  });
});
