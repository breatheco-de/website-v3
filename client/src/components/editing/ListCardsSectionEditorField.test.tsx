import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ListCardsSectionEditorField } from "./ListCardsSectionEditorField";

vi.mock("@/hooks/useContentTypes", () => ({
  useContentTypesRaw: () => ({
    data: [
      {
        name: "blog",
        label: "Blog",
        directory: "blog",
        url_pattern: { en: "/blog/{slug}" },
        has_database: false,
        database_slug: null,
        single_template: false,
        has_field_mapping: true,
        unique_fields: ["slug"],
        field_mapping_keys: ["locale", "title", "category", "slug"],
        static_entry_count: 10,
        database_entry_count: null,
      },
    ],
  }),
}));

function renderField(props: React.ComponentProps<typeof ListCardsSectionEditorField>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ListCardsSectionEditorField {...props} />
    </QueryClientProvider>,
  );
}

const baseProps = {
  locale: "en",
  searchEnabled: false,
  onSearchEnabledChange: () => {},
  onSearchPlaceholderChange: () => {},
  searchFields: [] as string[],
  onSearchFieldsChange: () => {},
  sectionSearchPhrase: "",
  onSectionSearchChange: () => {},
  permanentFilters: [] as Array<{ item_property_slug: string; value: unknown }>,
  onPermanentFiltersChange: () => {},
  onLimitChange: () => {},
};

describe("ListCardsSectionEditorField", () => {
  it("renders static-only message when dynamic_entries missing", () => {
    const html = renderField({ ...baseProps, hasDynamicEntries: false });
    expect(html).toContain("dynamic_entries");
  });

  it("shows no-db indicator on visitor search icon when database missing", () => {
    const html = renderField({
      ...baseProps,
      hasDynamicEntries: true,
      contentType: "blog",
      database: null,
    });
    expect(html).toContain('data-testid="badge-list-cards-search-no-db"');
    expect(html).toContain('data-testid="button-list-cards-visitor-search"');
  });

  it("renders permanent filters icon when dynamic_entries present", () => {
    const html = renderField({
      ...baseProps,
      hasDynamicEntries: true,
      contentType: "blog",
      database: null,
    });
    expect(html).toContain('data-testid="button-list-cards-permanent-filters"');
  });

  it("shows filter count badge when permanent filters exist", () => {
    const html = renderField({
      ...baseProps,
      hasDynamicEntries: true,
      contentType: "blog",
      database: null,
      permanentFilters: [{ item_property_slug: "locale", value: "en" }],
    });
    expect(html).toContain('data-testid="button-list-cards-permanent-filters"');
    expect(html).toContain('title="Permanent filters (1)"');
  });

  it("does not render permanent filters block in card body", () => {
    const html = renderField({
      ...baseProps,
      hasDynamicEntries: true,
      contentType: "blog",
      database: null,
      permanentFilters: [{ item_property_slug: "locale", value: "en" }],
    });
    expect(html).not.toContain("Permanent filters define the subset");
  });
});
