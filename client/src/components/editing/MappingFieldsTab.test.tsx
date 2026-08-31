import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NOT_META_FIELD_COPY, NotMetaFieldBadge } from "@/components/editing/NotMetaFieldBadge";

describe("NotMetaFieldBadge", () => {
  it("renders Not meta title badge for title field", () => {
    const html = renderToStaticMarkup(<NotMetaFieldBadge field="title" />);
    expect(html).toContain('data-testid="badge-not-meta-title"');
    expect(html).toContain("Not meta title");
  });

  it("renders Not meta description badge for description field", () => {
    const html = renderToStaticMarkup(<NotMetaFieldBadge field="description" />);
    expect(html).toContain('data-testid="badge-not-meta-description"');
    expect(html).toContain("Not meta description");
  });

  it("documents external meta keys for title and description", () => {
    expect(NOT_META_FIELD_COPY.title.metaKey).toBe("meta.page_title");
    expect(NOT_META_FIELD_COPY.description.metaKey).toBe("meta.description");
    expect(NOT_META_FIELD_COPY.title.singleVar).toBe("{{ entry.title }}");
  });

  it("includes SEO Meta CTA test id when onOpenSeoMeta is provided", () => {
    const html = renderToStaticMarkup(
      <NotMetaFieldBadge field="title" onOpenSeoMeta={() => {}} />,
    );
    expect(html).toContain('data-testid="badge-not-meta-title"');
  });
});
