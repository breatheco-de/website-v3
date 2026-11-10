import { describe, expect, it } from "vitest";
import {
  assertCreateRedirectIfRequired,
  assertLocaleUrlAvailable,
  checkAcceptedUrlSlug,
  checkNewLocaleUrlSlug,
  entryAgeHours,
  findSingleAddressSlugConflicts,
  isSingleAddressPattern,
  resolveLocaleUrlSlug,
  singleAddressConflictResult,
  wouldConflict,
  urlPatternUsesSlug,
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

describe("checkNewLocaleUrlSlug", () => {
  const base = {
    entryIdentity: "what-is-manus-ai",
    contentType: "blog",
    locale: "es",
    urlPattern: { es: "/es/blog/:category/:slug" },
  };

  it("refuses a new language without its own slug", () => {
    const r = checkNewLocaleUrlSlug({ ...base, draftOwnData: { title: "T" } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("locale_url_slug_required");
    expect(r.details.current_slug).toBe("what-is-manus-ai");
  });

  it("accepts a localized slug or the same word set explicitly", () => {
    expect(checkNewLocaleUrlSlug({ ...base, draftOwnData: { slug: "que-es-manus-ia" } }).ok).toBe(true);
    expect(checkNewLocaleUrlSlug({ ...base, draftOwnData: { slug: "what-is-manus-ai" } }).ok).toBe(true);
  });

  it("skips types whose URL has no :slug", () => {
    expect(
      checkNewLocaleUrlSlug({ ...base, urlPattern: { es: "/es/precios" }, draftOwnData: {} }).ok,
    ).toBe(true);
  });
});

describe("urlPatternUsesSlug", () => {
  it("reads the locale pattern, then default", () => {
    expect(urlPatternUsesSlug({ es: "/es/blog/:category/:slug" }, "es")).toBe(true);
    expect(urlPatternUsesSlug({ default: "/:locale/about" }, "es")).toBe(false);
    expect(urlPatternUsesSlug(undefined, "es")).toBe(true);
  });
});

describe("checkAcceptedUrlSlug", () => {
  const free = () => null;

  it("requires url_slug for a new language of an existing page", () => {
    const r = checkAcceptedUrlSlug({
      contentType: "blog",
      folderSlug: "what-is-manus-ai",
      locale: "es",
      isNewLanguage: true,
      ownerOf: free,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("url_slug_required");
  });

  it("accepts a fitting url_slug for a new language", () => {
    expect(
      checkAcceptedUrlSlug({
        contentType: "blog",
        folderSlug: "what-is-manus-ai",
        locale: "es",
        urlSlug: "que-es-manus-ia",
        isNewLanguage: true,
        ownerOf: free,
      }).ok,
    ).toBe(true);
  });

  it("refuses a wrong-language folder name on a brand-new page unless acknowledged", () => {
    const opts = {
      contentType: "blog",
      folderSlug: "what-is-grok",
      locale: "es",
      isNewLanguage: false,
      ownerOf: free,
    };
    const r = checkAcceptedUrlSlug(opts);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("slug_locale_mismatch");
    expect(r.details.markers).toEqual(["what", "is"]);
    expect(checkAcceptedUrlSlug({ ...opts, ack: true }).ok).toBe(true);
  });

  it("refuses an address another page already uses", () => {
    const r = checkAcceptedUrlSlug({
      contentType: "blog",
      folderSlug: "manus-ai",
      locale: "es",
      urlSlug: "que-es-manus-ia",
      isNewLanguage: true,
      ownerOf: () => "what-is-manus-ai",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("slug_already_owned_by_other_entry");
  });

  it("refuses a malformed address", () => {
    const r = checkAcceptedUrlSlug({
      contentType: "blog",
      folderSlug: "x",
      locale: "es",
      urlSlug: "Qué Es",
      isNewLanguage: true,
      ownerOf: free,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("invalid_locale_slug");
  });
});

describe("validateLocaleUrlSlugFormat", () => {
  it("rejects invalid slugs", () => {
    expect(validateLocaleUrlSlugFormat("Bad Slug")).not.toBeNull();
    expect(validateLocaleUrlSlugFormat("good-slug")).toBeNull();
  });
});

describe("one-address slug conflicts", () => {
  const slugs: Record<string, Record<string, string>> = {
    promo: { en: "promo", es: "promocion" },
    clash: { en: "clash", es: "clash" },
  };
  const fakeCi = (pattern: Record<string, string>) =>
    ({
      normalizeType: (t: string) => t,
      getContentTypeConfig: () => ({ url_pattern: pattern }),
      getAvailableLocalesOrVariants: (_t: string, folder: string) => [...Object.keys(slugs[folder] ?? {}), "draft.es"],
      getLocaleSlug: (folder: string, _t: string, loc: string) => slugs[folder]![loc]!,
    }) as unknown as ContentIndex;
  const landing = fakeCi({ default: "/landing/:slug" });
  const perLocale = fakeCi({ en: "/en/:slug", es: "/es/:slug" });

  it("isSingleAddressPattern only for default-only patterns without :locale", () => {
    expect(isSingleAddressPattern({ default: "/landing/:slug" })).toBe(true);
    expect(isSingleAddressPattern({ en: "/en/:slug", es: "/es/:slug" })).toBe(false);
    expect(isSingleAddressPattern({ default: "/:locale/x/:slug" })).toBe(false);
    expect(isSingleAddressPattern({ default: "/x/:slug", es: "/es/x/:slug" })).toBe(false);
  });

  it("finds languages sharing one address, ignoring drafts", () => {
    expect(findSingleAddressSlugConflicts(landing, "landing", "promo")).toEqual([]);
    expect(findSingleAddressSlugConflicts(landing, "landing", "clash")).toEqual([{ slug: "clash", locales: ["en", "es"] }]);
    expect(findSingleAddressSlugConflicts(perLocale, "page", "clash")).toEqual([]);
  });

  it("refuses a slug another language already uses, with a plain message", () => {
    const r = singleAddressConflictResult({ ci: landing, contentType: "landing", folderSlug: "promo", locale: "es", newSlug: "promo" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("locale_url_slug_conflict");
    expect(r.error).toContain("/landing/promo");
    expect(r.details).toMatchObject({ address: "/landing/promo", locales: ["en", "es"], property_path: "slug" });
    expect(singleAddressConflictResult({ ci: landing, contentType: "landing", folderSlug: "promo", locale: "es", newSlug: "promocion-2" }).ok).toBe(true);
    expect(wouldConflict(perLocale, "page", "promo", "es", "promo")).toEqual([]);
  });
});
