import { describe, expect, it } from "vitest";
import {
  parseJsonQueryParam,
  resolveListingDatabase,
} from "./listing-search";

describe("parseJsonQueryParam", () => {
  it("parses valid JSON", () => {
    expect(parseJsonQueryParam('[{"item_property_slug":"locale","value":"en"}]', "filters")).toEqual([
      { item_property_slug: "locale", value: "en" },
    ]);
  });

  it("returns undefined for empty input", () => {
    expect(parseJsonQueryParam("", "filters")).toBeUndefined();
  });

  it("throws on invalid JSON", () => {
    expect(() => parseJsonQueryParam("{bad", "filters")).toThrow(/Invalid JSON/);
  });
});

describe("resolveListingDatabase", () => {
  it("prefers explicit database slug", () => {
    expect(resolveListingDatabase("blog", "my-db")).toBe("my-db");
  });

  it("returns null when only content type without mapping in test env", () => {
    expect(resolveListingDatabase("nonexistent-content-type-xyz")).toBeNull();
  });
});

describe("searchListingItems no database", () => {
  it("returns no_database fallback", async () => {
    const { searchListingItems } = await import("./listing-search");
    const result = await searchListingItems({
      contentType: "nonexistent-content-type-xyz",
      q: "hello world",
    });
    expect(result.items).toEqual([]);
    expect(result.fallback_reason).toBe("no_database");
  });
});
