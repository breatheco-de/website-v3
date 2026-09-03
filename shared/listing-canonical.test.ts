import { describe, expect, it } from "vitest";
import {
  buildListingCanonicalHref,
  buildListingCanonicalPath,
} from "./listing-canonical";

describe("buildListingCanonicalPath", () => {
  it("returns clean path for page 1 / missing page", () => {
    expect(buildListingCanonicalPath("/en/blog")).toBe("/en/blog");
    expect(buildListingCanonicalPath("/en/blog", 1)).toBe("/en/blog");
    expect(buildListingCanonicalPath("/en/blog", "taxonomy=ai-tools")).toBe("/en/blog");
    expect(buildListingCanonicalPath("/en/blog", "page=1")).toBe("/en/blog");
  });

  it("appends ?page=N when page > 1", () => {
    expect(buildListingCanonicalPath("/en/blog", 2)).toBe("/en/blog?page=2");
    expect(buildListingCanonicalPath("/en/blog", "page=3")).toBe("/en/blog?page=3");
    expect(buildListingCanonicalPath("/en/blog", new URLSearchParams("page=2"))).toBe(
      "/en/blog?page=2",
    );
  });

  it("strips taxonomy, q, and UTMs while keeping page", () => {
    expect(
      buildListingCanonicalPath(
        "/en/blog",
        "taxonomy=ai-tools&page=2&q=agents&utm_source=x",
      ),
    ).toBe("/en/blog?page=2");
    expect(
      buildListingCanonicalPath("/en/blog?taxonomy=x", "taxonomy=ai-tools&utm_campaign=y"),
    ).toBe("/en/blog");
  });

  it("normalizes pathname noise", () => {
    expect(buildListingCanonicalPath("/en/blog?foo=1#hash", 2)).toBe("/en/blog?page=2");
    expect(buildListingCanonicalPath("en/blog", 2)).toBe("/en/blog?page=2");
  });
});

describe("buildListingCanonicalHref", () => {
  it("keeps absolute origin and applies page from request URL", () => {
    expect(
      buildListingCanonicalHref(
        "https://4geeks.com/en/blog",
        "/en/blog?taxonomy=ai-tools&page=2",
      ),
    ).toBe("https://4geeks.com/en/blog?page=2");
  });

  it("strips junk from request with no page", () => {
    expect(
      buildListingCanonicalHref(
        "https://4geeks.com/en/blog",
        "/en/blog?taxonomy=ai-tools&utm_source=careerkarma",
      ),
    ).toBe("https://4geeks.com/en/blog");
  });

  it("works with relative base", () => {
    expect(buildListingCanonicalHref("/es/blog", "?page=2&taxonomy=x")).toBe(
      "/es/blog?page=2",
    );
  });

  it("ignores empty base gracefully", () => {
    expect(buildListingCanonicalHref("", "?page=2")).toBe("/?page=2");
  });
});
