import { describe, expect, it } from "vitest";
import { parseEntryKey } from "@/lib/parseEntryKey";

describe("parseEntryKey", () => {
  it("parses standard entry keys", () => {
    expect(parseEntryKey("page/my-slug/en")).toEqual({
      contentType: "page",
      slug: "my-slug",
      locale: "en",
    });
  });

  it("parses nested content types", () => {
    expect(parseEntryKey("blog/category/post-slug/es")).toEqual({
      contentType: "blog/category",
      slug: "post-slug",
      locale: "es",
    });
  });

  it("parses @draft variant suffix", () => {
    expect(parseEntryKey("page/my-slug/en@draft")).toEqual({
      contentType: "page",
      slug: "my-slug",
      locale: "en",
      variant: "draft",
    });
  });

  it("returns null for invalid keys", () => {
    expect(parseEntryKey("")).toBeNull();
    expect(parseEntryKey("page/slug-only")).toBeNull();
  });
});
