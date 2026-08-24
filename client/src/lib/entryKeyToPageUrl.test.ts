import { describe, expect, it } from "vitest";
import { buildEntryKey, entryKeyToPageUrl, entryPartsToPageUrl } from "@/lib/entryKeyToPageUrl";

const contentTypes = {
  page: { url_pattern: { en: "/:slug", es: "/es/:slug" } },
  blog: { url_pattern: { en: "/blog/:slug", es: "/es/blog/:slug" } },
};

describe("buildEntryKey", () => {
  it("builds a base entry key", () => {
    expect(
      buildEntryKey({ contentType: "blog", slug: "hello-world", locale: "en" }),
    ).toBe("blog/hello-world/en");
  });

  it("appends variant when present", () => {
    expect(
      buildEntryKey({ contentType: "page", slug: "foo", locale: "en", variant: "draft" }),
    ).toBe("page/foo/en@draft");
  });
});

describe("entryPartsToPageUrl", () => {
  it("builds a page URL from entry parts", () => {
    expect(
      entryPartsToPageUrl(
        { contentType: "blog", slug: "hello-world", locale: "en" },
        contentTypes,
      ),
    ).toBe("/blog/hello-world");
  });
});

describe("entryKeyToPageUrl", () => {
  it("builds a page URL from entry key", () => {
    expect(entryKeyToPageUrl("page/how-long-does-it-take-to-learn-python/en", contentTypes)).toBe(
      "/how-long-does-it-take-to-learn-python",
    );
  });

  it("includes variant query param when present", () => {
    expect(entryKeyToPageUrl("page/foo/en@draft", contentTypes)).toBe("/foo?variant=draft");
  });

  it("returns null for invalid entry keys", () => {
    expect(entryKeyToPageUrl("invalid", contentTypes)).toBeNull();
  });
});
