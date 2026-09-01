import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const previewMock = vi.hoisted(() => ({
  data: {
    items: [
      {
        student_name: "Alice DB",
        student_thumb: "https://example.com/a.jpg",
        excerpt: "Quote A",
        priority: 1,
        slug: "alice-db",
      },
      {
        student_name: "Bob DB",
        student_thumb: "https://example.com/b.jpg",
        excerpt: "Quote B",
        priority: 2,
      },
    ],
    total: 2,
    hardcodedCount: 0,
  },
  isLoading: false,
  isFetching: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: () => previewMock,
  };
});

import { TestimonialsItemsPicker } from "./TestimonialsItemsPicker";

function renderPicker(
  props: Partial<React.ComponentProps<typeof TestimonialsItemsPicker>> = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onIgnoredEntriesChange = vi.fn();
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <TestimonialsItemsPicker
        sectionType="testimonials_slide"
        locale="en"
        permanentFilters={[]}
        limit={20}
        ignoredEntries={[]}
        onIgnoredEntriesChange={onIgnoredEntriesChange}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { html, onIgnoredEntriesChange };
}

describe("TestimonialsItemsPicker", () => {
  it("renders preview item count from the staff API", () => {
    const { html } = renderPicker();
    expect(html).toContain("Items (2)");
    expect(html).toContain("Alice DB");
    expect(html).toContain("Bob DB");
    expect(html).toContain('data-testid="button-testimonial-item-hide-db:alice-db:0"');
  });

  it("lists hidden entries with restore controls", () => {
    const { html } = renderPicker({
      ignoredEntries: ["alice-db"],
    });
    expect(html).toContain("Hidden on this section (1)");
    expect(html).toContain('data-testid="button-restore-testimonial-alice-db"');
  });

  it("shows explicit error UI when preview fails", () => {
    previewMock.isError = true;
    previewMock.error = new Error("500: boom");
    previewMock.data = undefined as never;
    const { html } = renderPicker();
    expect(html).toContain("Couldn’t load preview");
    expect(html).toContain('data-testid="button-testimonials-preview-retry"');
    previewMock.isError = false;
    previewMock.error = null;
    previewMock.data = {
      items: [
        {
          student_name: "Alice DB",
          student_thumb: "https://example.com/a.jpg",
          excerpt: "Quote A",
          priority: 1,
          slug: "alice-db",
        },
      ],
      total: 1,
      hardcodedCount: 0,
    };
  });
});
