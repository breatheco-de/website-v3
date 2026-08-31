import { describe, expect, it } from "vitest";
import { rawFileCaption, type RawFileExplainContext } from "./rawFileCaption";

function blogTemplate(over: Partial<RawFileExplainContext> = {}): RawFileExplainContext {
  return {
    contentType: "blog",
    typeLabel: "blog",
    folder: "blog",
    contentRootName: "site_4geeks-com",
    slug: "_common.template",
    isTemplate: true,
    isSharedLayout: true,
    detached: false,
    requestedLocale: "en",
    displayedLocale: "en",
    localeFallback: false,
    hasLocaleFile: true,
    missing: [],
    ...over,
  };
}

function blogEntry(over: Partial<RawFileExplainContext> = {}): RawFileExplainContext {
  return {
    contentType: "blog",
    typeLabel: "blog",
    folder: "blog",
    contentRootName: "site_4geeks-com",
    slug: "how-to-become-an-ai-engineer",
    isTemplate: false,
    isSharedLayout: true,
    detached: false,
    requestedLocale: "es",
    displayedLocale: null,
    localeFallback: false,
    hasLocaleFile: false,
    missing: [],
    ...over,
  };
}

function landing(over: Partial<RawFileExplainContext> = {}): RawFileExplainContext {
  return {
    contentType: "landing",
    typeLabel: "landing",
    folder: "landings",
    contentRootName: "site_4geeks-com",
    slug: "ai-bootcamp-with-job-placement",
    isTemplate: false,
    isSharedLayout: false,
    detached: false,
    requestedLocale: "en",
    displayedLocale: "en",
    localeFallback: false,
    hasLocaleFile: true,
    missing: [],
    ...over,
  };
}

function nonEffect(caption: ReturnType<typeof rawFileCaption>): string {
  return caption.advanced.find((a) => a.label === "Non-effect")?.text ?? "";
}

describe("rawFileCaption", () => {
  it("1 template_live EN is not one article", () => {
    const c = rawFileCaption({
      role: "template_live",
      path: "site_4geeks-com/blog/template.en.yml",
      fileLocale: "en",
      context: blogTemplate(),
    });
    expect(c.visible).toContain("not one article");
    expect(nonEffect(c)).toContain("does not change a post’s `_common.yml`");
  });

  it("2 template_live ES does not auto-sync from English", () => {
    const c = rawFileCaption({
      role: "template_live",
      path: "site_4geeks-com/blog/template.es.yml",
      fileLocale: "es",
      context: blogTemplate({ requestedLocale: "es", displayedLocale: "es" }),
    });
    expect(c.visible).toContain("does not auto-sync from English");
    expect(nonEffect(c)).toContain("does not update `template.en.yml`");
  });

  it("3 template_variant is not an article until promoted", () => {
    const c = rawFileCaption({
      role: "template_variant",
      path: "site_4geeks-com/blog/single.seo-fix.en.yml",
      fileLocale: "en",
      context: blogTemplate({ variantSlug: "seo-fix" }),
    });
    expect(c.visible).toContain("shared template version named “seo-fix”");
    expect(nonEffect(c)).toContain("until you promote");
  });

  it("4 template_common ignores sections", () => {
    const c = rawFileCaption({
      role: "template_common",
      path: "site_4geeks-com/blog/_common.template.yml",
      context: blogTemplate(),
    });
    expect(c.visible).toContain("Sections in this file are ignored");
    expect(nonEffect(c)).toContain("does not render on the page");
    expect(c.advanced.some((a) => a.text.includes("database-single-loader.ts"))).toBe(true);
  });

  it("5 template_variant localeFallback", () => {
    const c = rawFileCaption({
      role: "template_variant",
      path: "site_4geeks-com/blog/single.seo-fix.en.yml",
      fileLocale: "en",
      context: blogTemplate({
        requestedLocale: "es",
        displayedLocale: "en",
        variantSlug: "seo-fix",
        localeFallback: true,
      }),
    });
    expect(c.visible).toContain("You opened ES");
    expect(c.visible).toContain("showing EN");
    expect(nonEffect(c)).toContain("does not create the missing ES file");
  });

  it("6 attached _common.yml locale missing is normal", () => {
    const c = rawFileCaption({
      role: "entry_common",
      path: "site_4geeks-com/blog/how-to-become-an-ai-engineer/_common.yml",
      context: blogEntry(),
    });
    expect(c.visible).toContain("normal while it is attached");
    expect(nonEffect(c)).toContain("does not change the shared template");
  });

  it("7 attached _common.yml with locale overlay tab", () => {
    const c = rawFileCaption({
      role: "entry_common",
      path: "site_4geeks-com/blog/how-to-become-an-ai-engineer/_common.yml",
      context: blogEntry({ hasLocaleFile: true, displayedLocale: "es" }),
    });
    expect(c.visible).toContain("locale overlay on the shared template");
    expect(nonEffect(c)).toContain("does not change `template.es.yml`");
  });

  it("8 attached locale overlay", () => {
    const c = rawFileCaption({
      role: "entry_live",
      path: "site_4geeks-com/blog/how-to-become-an-ai-engineer/en.yml",
      fileLocale: "en",
      context: blogEntry({ requestedLocale: "en", displayedLocale: "en", hasLocaleFile: true }),
    });
    expect(c.visible).toContain("locale overlay on an attached blog");
    expect(nonEffect(c)).toContain("does not update the shared template");
  });

  it("9 detached live locale", () => {
    const c = rawFileCaption({
      role: "entry_live",
      path: "site_4geeks-com/blog/how-to-become-an-ai-engineer/en.yml",
      fileLocale: "en",
      context: blogEntry({
        detached: true,
        requestedLocale: "en",
        displayedLocale: "en",
        hasLocaleFile: true,
      }),
    });
    expect(c.visible).toContain("live EN file for this page only");
    expect(nonEffect(c)).toContain("does not change `blog/template.en.yml`");
  });

  it("10 detached _common.yml with locale tab", () => {
    const c = rawFileCaption({
      role: "entry_common",
      path: "site_4geeks-com/blog/how-to-become-an-ai-engineer/_common.yml",
      context: blogEntry({
        detached: true,
        requestedLocale: "en",
        displayedLocale: "en",
        hasLocaleFile: true,
      }),
    });
    expect(c.visible).toContain("locale tab (`en.yml`)");
    expect(nonEffect(c)).toContain("does not add or remove sections");
  });

  it("11 detached missing locale 404s publicly", () => {
    const c = rawFileCaption({
      role: "entry_common",
      path: "site_4geeks-com/blog/how-to-become-an-ai-engineer/_common.yml",
      context: blogEntry({ detached: true, hasLocaleFile: false }),
    });
    expect(c.visible).toContain("404s publicly");
    expect(c.visible).not.toContain("normal while it is attached");
    expect(nonEffect(c)).toContain("is not used while detached");
  });

  it("12 entry variant does not change live until promote", () => {
    const c = rawFileCaption({
      role: "entry_variant",
      path: "site_4geeks-com/blog/how-to-become-an-ai-engineer/seo-fix.en.yml",
      fileLocale: "en",
      context: blogEntry({
        detached: true,
        variantSlug: "seo-fix",
        requestedLocale: "en",
        displayedLocale: "en",
        hasLocaleFile: false,
      }),
    });
    expect(c.visible).toContain("version “seo-fix”");
    expect(c.visible).toContain("`en.yml` is not in this panel");
    expect(nonEffect(c)).toContain("until you promote");
  });

  it("13 landing live locale has no single template", () => {
    const c = rawFileCaption({
      role: "entry_live",
      path: "site_4geeks-com/landings/ai-bootcamp-with-job-placement/en.yml",
      fileLocale: "en",
      context: landing(),
    });
    expect(c.visible).toContain("live EN file for this page");
    expect(nonEffect(c)).toContain("there is no `template.en.yml` for this type");
  });

  it("14 landing _common.yml with locale tab", () => {
    const c = rawFileCaption({
      role: "entry_common",
      path: "site_4geeks-com/landings/ai-bootcamp-with-job-placement/_common.yml",
      context: landing(),
    });
    expect(c.visible).toContain("Sections live in the locale tab");
    expect(nonEffect(c)).toContain("does not rewrite sections in `en.yml`");
  });

  it("15 landing missing opened locale", () => {
    const c = rawFileCaption({
      role: "entry_common",
      path: "site_4geeks-com/landings/ai-bootcamp-with-job-placement/_common.yml",
      context: landing({
        requestedLocale: "es",
        displayedLocale: null,
        hasLocaleFile: false,
      }),
    });
    expect(c.visible).toContain("There is no `es.yml` for this page");
    expect(c.visible).toContain("not on a shared template");
    expect(nonEffect(c)).toContain("does not create `es.yml`");
  });

  it("16 landing variant matches entry variant copy", () => {
    const c = rawFileCaption({
      role: "entry_variant",
      path: "site_4geeks-com/landings/ai-bootcamp-with-job-placement/seo-fix.en.yml",
      fileLocale: "en",
      context: landing({ variantSlug: "seo-fix" }),
    });
    expect(c.visible).toContain("version “seo-fix”");
    expect(nonEffect(c)).toContain("does not change live `en.yml` until you promote");
  });
});
