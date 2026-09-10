import { describe, expect, it } from "vitest";
import {
  buildEntryKey,
  entryKeyFromContentFile,
  entryKeyLayerLabel,
  isLegacySyntheticEntryKey,
  parseEntryKey,
  urlFromLegacyEntryKey,
} from "./entryKey";
import type { ContentFile } from "./types";

describe("buildEntryKey", () => {
  it("builds live keys without variant", () => {
    expect(buildEntryKey("landing", "foo", "es")).toBe("landing/foo/es");
  });

  it("appends @variant for published variants", () => {
    expect(buildEntryKey("landing", "foo", "es", "draft")).toBe(
      "landing/foo/es@draft",
    );
  });

  it("ignores default variant slug", () => {
    expect(buildEntryKey("landing", "foo", "es", "default")).toBe(
      "landing/foo/es",
    );
  });
});

describe("parseEntryKey", () => {
  it("parses live keys", () => {
    expect(parseEntryKey("landing/foo/es")).toEqual({
      contentType: "landing",
      slug: "foo",
      locale: "es",
    });
  });

  it("parses variant keys", () => {
    expect(parseEntryKey("landing/foo/es@draft")).toEqual({
      contentType: "landing",
      slug: "foo",
      locale: "es",
      variant: "draft",
    });
  });

  it("handles content types with slashes", () => {
    expect(parseEntryKey("a/b/slug/en@v2")).toEqual({
      contentType: "a/b",
      slug: "slug",
      locale: "en",
      variant: "v2",
    });
  });
});

describe("entryKeyFromContentFile", () => {
  it("includes variant when set on ContentFile", () => {
    const file: ContentFile = {
      slug: "foo",
      title: "Foo",
      type: "landing",
      locale: "es",
      filePath: "site/landings/foo/draft.es.yml",
      variant: "draft",
    };
    expect(entryKeyFromContentFile(file)).toBe("landing/foo/es@draft");
  });
});

describe("legacy synthetic entry keys", () => {
  it("detects migration orphans", () => {
    expect(isLegacySyntheticEntryKey("legacy__en__blog__post")).toBe(true);
    expect(isLegacySyntheticEntryKey("blog/post/en")).toBe(false);
  });

  it("reverses legacy URL encoding and collapses empty segments", () => {
    expect(urlFromLegacyEntryKey("legacy__en__blog__best-online-coding-bootcamp")).toBe(
      "/en/blog/best-online-coding-bootcamp",
    );
    expect(
      urlFromLegacyEntryKey("legacy__en__blog____best-online-coding-bootcamp"),
    ).toBe("/en/blog/best-online-coding-bootcamp");
  });
});

describe("entryKeyLayerLabel", () => {
  it("labels live and variant keys", () => {
    expect(entryKeyLayerLabel("landing/foo/es")).toBe("live");
    expect(entryKeyLayerLabel("landing/foo/es@draft")).toBe("variant: draft");
  });
});
