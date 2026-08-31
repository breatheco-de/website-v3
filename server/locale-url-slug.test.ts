import { describe, expect, it } from "vitest";
import {
  assertCreateRedirectIfRequired,
  assertLocaleUrlAvailable,
  entryAgeHours,
  resolveLocaleUrlSlug,
  validateLocaleUrlSlugFormat,
} from "./locale-url-slug";
import type { ContentIndex } from "./content-index";

describe("resolveLocaleUrlSlug", () => {
  it("prefers urlSlug then existing then entry identity", () => {
    expect(
      resolveLocaleUrlSlug({ urlSlug: "custom", existingSlug: "old", entryIdentity: "entry" }),
    ).toBe("custom");
    expect(resolveLocaleUrlSlug({ existingSlug: "old", entryIdentity: "entry" })).toBe("old");
    expect(resolveLocaleUrlSlug({ entryIdentity: "entry" })).toBe("entry");
  });
});

describe("assertCreateRedirectIfRequired", () => {
  it("requires create_redirect when entry is 24h+ and policy enforced", () => {
    const fail = assertCreateRedirectIfRequired({
      ageHours: 25,
      createRedirect: false,
      isLiveSlugChange: true,
      enforceRedirectPolicy: true,
    });
    expect(fail.ok).toBe(false);
    if (fail.ok) return;
    expect(fail.code).toBe("create_redirect_required");
  });

  it("allows young entries without create_redirect", () => {
    expect(
      assertCreateRedirectIfRequired({
        ageHours: 2,
        createRedirect: false,
        isLiveSlugChange: true,
        enforceRedirectPolicy: true,
      }).ok,
    ).toBe(true);
  });
});

describe("assertLocaleUrlAvailable", () => {
  it("rejects when URL owned by another entry", () => {
    const ci = {
      normalizeType: (t: string) => t,
      getContentTypeConfig: () => ({ url_pattern: { es: "/es/:slug" } }),
      buildUrl: () => "/es/taken",
      resolveUrl: () => ({ contentType: "blog", slug: "other-entry" }),
      resolveBaseSlug: (_s: string) => "my-entry",
      contentRoot: "/tmp",
    } as unknown as ContentIndex;

    const result = assertLocaleUrlAvailable({
      contentType: "blog",
      entryIdentity: "my-entry",
      locale: "es",
      mergedPageData: { slug: "taken", title: "T" },
      ci,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("slug_already_owned_by_other_entry");
  });
});

describe("entryAgeHours", () => {
  it("returns null for missing published_at", () => {
    expect(entryAgeHours(undefined)).toBeNull();
  });

  it("computes hours from ISO string", () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    expect(entryAgeHours(twoDaysAgo)).toBeGreaterThan(47);
  });
});

describe("validateLocaleUrlSlugFormat", () => {
  it("rejects invalid slugs", () => {
    expect(validateLocaleUrlSlugFormat("Bad Slug")).not.toBeNull();
    expect(validateLocaleUrlSlugFormat("good-slug")).toBeNull();
  });
});
