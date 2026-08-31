import { describe, expect, it } from "vitest";
import {
  buildRawFileExplain,
  localeFromYamlFilename,
  rawFileRole,
} from "./raw-file-explain";

describe("localeFromYamlFilename", () => {
  it("reads locale from live, variant, and template names", () => {
    expect(localeFromYamlFilename("en.yml")).toBe("en");
    expect(localeFromYamlFilename("single.es.yml")).toBe("es");
    expect(localeFromYamlFilename("single.seo-fix.en.yml")).toBe("en");
    expect(localeFromYamlFilename("seo-fix.en.yml")).toBe("en");
    expect(localeFromYamlFilename("_common.yml")).toBeNull();
    expect(localeFromYamlFilename("_common.template.yml")).toBeNull();
  });
});

describe("rawFileRole", () => {
  it("maps template and entry files", () => {
    expect(rawFileRole({ isTemplate: true, isCommon: true })).toBe("template_common");
    expect(rawFileRole({ isTemplate: true, isCommon: false })).toBe("template_live");
    expect(rawFileRole({ isTemplate: true, isCommon: false, variantSlug: "seo-fix" })).toBe(
      "template_variant",
    );
    expect(rawFileRole({ isTemplate: false, isCommon: true })).toBe("entry_common");
    expect(rawFileRole({ isTemplate: false, isCommon: false })).toBe("entry_live");
    expect(rawFileRole({ isTemplate: false, isCommon: false, variantSlug: "seo-fix" })).toBe(
      "entry_variant",
    );
  });
});

describe("buildRawFileExplain", () => {
  const base = {
    contentRootName: "site_4geeks-com",
    folder: "blog",
    contentType: "blog",
    slug: "how-to-become-an-ai-engineer",
    requestedLocale: "es",
    displayedLocale: null as string | null,
    localeFallback: false,
  };

  it("marks attached missing locale as shared_template", () => {
    const ctx = buildRawFileExplain({
      ...base,
      isTemplate: false,
      isSharedLayout: true,
      detached: false,
      hasLocaleFile: false,
    });
    expect(ctx.missing).toEqual([
      {
        name: "es.yml",
        path: "site_4geeks-com/blog/how-to-become-an-ai-engineer/es.yml",
        reason: "shared_template",
        templatePath: "site_4geeks-com/blog/template.es.yml",
      },
    ]);
  });

  it("marks detached missing locale as detached_missing", () => {
    const ctx = buildRawFileExplain({
      ...base,
      isTemplate: false,
      isSharedLayout: true,
      detached: true,
      hasLocaleFile: false,
    });
    expect(ctx.missing[0]?.reason).toBe("detached_missing");
    expect(ctx.missing[0]?.path).toBe(
      "site_4geeks-com/blog/how-to-become-an-ai-engineer/es.yml",
    );
  });

  it("sets localeFallback for missing template variant locale", () => {
    const ctx = buildRawFileExplain({
      ...base,
      slug: "_common.template",
      isTemplate: true,
      isSharedLayout: true,
      detached: false,
      variantSlug: "seo-fix",
      localeFallback: true,
      displayedLocale: "en",
      hasLocaleFile: true,
    });
    expect(ctx.localeFallback).toBe(true);
    expect(ctx.missing).toEqual([
      {
        name: "template.seo-fix.es.yml",
        path: "site_4geeks-com/blog/template.seo-fix.es.yml",
        reason: "variant_locale_missing",
      },
    ]);
  });

  it("returns empty missing when a landing has both files", () => {
    const ctx = buildRawFileExplain({
      contentRootName: "site_4geeks-com",
      folder: "landings",
      contentType: "landing",
      slug: "ai-bootcamp-with-job-placement",
      isTemplate: false,
      isSharedLayout: false,
      detached: false,
      requestedLocale: "en",
      displayedLocale: "en",
      localeFallback: false,
      hasLocaleFile: true,
    });
    expect(ctx.missing).toEqual([]);
  });

  it("marks not_created when a non-shared locale file is missing", () => {
    const ctx = buildRawFileExplain({
      contentRootName: "site_4geeks-com",
      folder: "landings",
      contentType: "landing",
      slug: "ai-bootcamp-with-job-placement",
      isTemplate: false,
      isSharedLayout: false,
      detached: false,
      requestedLocale: "es",
      displayedLocale: null,
      localeFallback: false,
      hasLocaleFile: false,
    });
    expect(ctx.missing[0]?.reason).toBe("not_created");
  });
});
