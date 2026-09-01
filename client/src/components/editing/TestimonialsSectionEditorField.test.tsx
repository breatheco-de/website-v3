import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("./TestimonialsItemsPicker", () => ({
  TestimonialsItemsPicker: () => null,
}));

import { TestimonialsSectionEditorField } from "./TestimonialsSectionEditorField";

function renderField(
  props: React.ComponentProps<typeof TestimonialsSectionEditorField>,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <TestimonialsSectionEditorField {...props} />
    </QueryClientProvider>,
  );
}

const baseProps = {
  topics: [] as string[],
  onTopicsChange: () => {},
  locale: "en",
  sectionType: "testimonials_slide" as const,
  onSearchChange: () => {},
  onLimitChange: () => {},
  onSortChange: () => {},
};

describe("TestimonialsSectionEditorField", () => {
  it("renders sort button when onSortChange is provided", () => {
    const html = renderField(baseProps);
    expect(html).toContain('data-testid="button-testimonials-sort"');
  });

  it("shows default priority-first label when sort is omitted", () => {
    const html = renderField(baseProps);
    expect(html).toContain("Priority (1 first)");
    expect(html).toContain('data-testid="badge-testimonials-sort"');
  });

  it("shows custom sort label when sort prop is set", () => {
    const html = renderField({ ...baseProps, sort: "-rating" });
    expect(html).toContain("Rating (highest first)");
  });
});
