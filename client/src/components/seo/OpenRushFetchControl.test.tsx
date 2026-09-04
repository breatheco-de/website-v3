import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OpenRushFetchControl } from "@/components/seo/OpenRushFetchControl";
import { formatOpenRushFetchedAge } from "@/components/seo/openrushFetchAge";

describe("formatOpenRushFetchedAge", () => {
  it("returns empty when missing", () => {
    expect(formatOpenRushFetchedAge(null)).toBe("");
    expect(formatOpenRushFetchedAge(undefined)).toBe("");
  });

  it("marks stale", () => {
    expect(formatOpenRushFetchedAge(new Date().toISOString(), true)).toBe("stale");
  });
});

describe("OpenRushFetchControl", () => {
  it("renders Download affordance and OpenRush label", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <OpenRushFetchControl
          kind="serp"
          openrushConfigured
          onConfirm={async () => {}}
          data-testid="button-openrush-smoke"
        />
      </QueryClientProvider>,
    );
    expect(html).toContain("OpenRush");
    expect(html).toContain('data-testid="button-openrush-smoke"');
  });
});
