import { describe, expect, it } from "vitest";
import {
  normalizeListingSearchConfig,
  LISTING_SEARCH_MIN_CHARS,
} from "./listing-search-config";

describe("normalizeListingSearchConfig", () => {
  it("prefers search.enabled over legacy show_search", () => {
    expect(
      normalizeListingSearchConfig({
        search: { enabled: false },
        show_search: true,
      }).enabled,
    ).toBe(false);
  });

  it("falls back to show_search when search.enabled omitted", () => {
    expect(
      normalizeListingSearchConfig({ show_search: true }).enabled,
    ).toBe(true);
  });

  it("defaults enabled to false", () => {
    expect(normalizeListingSearchConfig({}).enabled).toBe(false);
  });

  it("merges placeholder from legacy search_placeholder", () => {
    expect(
      normalizeListingSearchConfig({ search_placeholder: "Find items…" }).placeholder,
    ).toBe("Find items…");
  });
});

describe("LISTING_SEARCH_MIN_CHARS", () => {
  it("is 3", () => {
    expect(LISTING_SEARCH_MIN_CHARS).toBe(3);
  });
});
