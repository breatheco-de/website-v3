import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SectionRenderErrorBoundary,
  SectionRenderErrorFallback,
} from "./SectionRenderErrorBoundary";

describe("SectionRenderErrorBoundary", () => {
  it("getDerivedStateFromError stores the thrown error", () => {
    const err = new Error("section boom");
    expect(SectionRenderErrorBoundary.getDerivedStateFromError(err)).toEqual({ error: err });
  });

  it("fallback card shows framing, Edit YAML, and advanced details when open", () => {
    const onEditYaml = vi.fn();
    const html = renderToStaticMarkup(
      <SectionRenderErrorFallback
        sectionType="hero"
        sectionId="hero-1"
        error={new Error("section boom")}
        onEditYaml={onEditYaml}
        onRetry={() => {}}
      />,
    );
    expect(html).toContain("This section failed to render");
    expect(html).toContain("The rest of the page is still here");
    expect(html).toContain('data-testid="button-section-error-edit-yaml"');
    expect(html).toContain("Edit YAML");
    expect(html).toContain("Read more (advanced)");
    // Advanced block is collapsed by default
    expect(html).not.toContain("section boom");
  });

  it("omits Edit YAML when callback is not provided", () => {
    const html = renderToStaticMarkup(
      <SectionRenderErrorFallback
        sectionType="faq"
        error={new Error("x")}
        onRetry={() => {}}
      />,
    );
    expect(html).not.toContain('data-testid="button-section-error-edit-yaml"');
  });
});
