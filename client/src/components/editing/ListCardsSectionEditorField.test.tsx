import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ListCardsSectionEditorField } from "./ListCardsSectionEditorField";

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
});
