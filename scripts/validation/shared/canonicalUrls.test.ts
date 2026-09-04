import { describe, expect, it } from "vitest";
import { matchContentFilesForUrl, normalizeUrl } from "./canonicalUrls";
import type { ContentFile } from "./types";

function file(overrides: Partial<ContentFile> & Pick<ContentFile, "slug" | "type" | "locale" | "url">): ContentFile {
  return {
    title: overrides.slug,
    filePath: `site/programs/${overrides.slug}/draft.${overrides.locale}.yml`,
    isDraft: true,
    ...overrides,
  };
}

describe("matchContentFilesForUrl", () => {
  const draft = file({
    slug: "ai-engineering-bootcamp-chile",
    type: "program",
    locale: "es",
    url: "/es/coding-bootcamps/ai-engineering-bootcamp-chile",
  });

  const live: ContentFile = {
    slug: "foo",
    title: "Foo",
    type: "landing",
    locale: "es",
    url: "/landing/foo",
    filePath: "site/landings/foo/es.yml",
  };
  const publishedVariant: ContentFile = {
    ...live,
    variant: "draft",
    filePath: "site/landings/foo/draft.es.yml",
  };

  it("matches a public canonical URL", () => {
    expect(
      matchContentFilesForUrl([draft], "/es/coding-bootcamps/ai-engineering-bootcamp-chile"),
    ).toEqual([draft]);
  });

  it("matches a draft preview URL via parsed type/slug/locale", () => {
    expect(
      matchContentFilesForUrl(
        [draft],
        "/private/preview/program/ai-engineering-bootcamp-chile?locale=es",
        { contentType: "program", slug: "ai-engineering-bootcamp-chile", locale: "es" },
      ),
    ).toEqual([draft]);
  });

  it("prefers live over published variant when no variant requested", () => {
    expect(
      matchContentFilesForUrl([live, publishedVariant], "/landing/foo"),
    ).toEqual([live]);
  });

  it("returns published variant when variant is requested", () => {
    expect(
      matchContentFilesForUrl([live, publishedVariant], "/landing/foo", null, "draft"),
    ).toEqual([publishedVariant]);
  });

  it("returns empty when requested variant is not loaded (unpublished)", () => {
    expect(
      matchContentFilesForUrl([live], "/landing/foo", null, "draft"),
    ).toEqual([]);
  });
});

describe("normalizeUrl", () => {
  it("strips query strings and hashes for path lookup", () => {
    expect(normalizeUrl("/en/payment-component?program=ai-fluency")).toBe(
      "/en/payment-component",
    );
    expect(normalizeUrl("/en/payment-component#cta")).toBe("/en/payment-component");
    expect(normalizeUrl("/en/payment-component/?program=ai-flex&plan=pro")).toBe(
      "/en/payment-component",
    );
  });
});
