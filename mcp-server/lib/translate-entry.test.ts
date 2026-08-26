import { describe, expect, it } from "vitest";
import type { ContentTypeConfig } from "./content";
import {
  resolveTranslateMode,
  splitTranslateContent,
  filterAllowedFields,
  buildTranslateLocaleData,
  listLiveLocaleFiles,
} from "./translate-entry";

const authorsConfig = {
  directory: "authors",
  single_template: true,
  field_mapping: {
    name: "name",
    bio: "bio",
    job_title: "job_title",
  },
  editor: {
    name: { type: "text", required: true },
    bio: { type: "textarea" },
    job_title: { type: "text" },
  },
} as ContentTypeConfig;

const blogConfig = {
  directory: "blog",
  single_template: true,
  field_mapping: {
    title: "title",
    description: "description",
    content: "content",
  },
  editor: {
    title: { type: "text", required: true },
    description: { type: "textarea", required: true },
    content: { type: "markdown", required: true },
  },
} as ContentTypeConfig;

describe("resolveTranslateMode", () => {
  it("uses attached_fields when shared-layout and not detached", () => {
    expect(resolveTranslateMode({ sharedLayout: true, detached: false })).toBe("attached_fields");
  });
  it("uses detached_sections when detached or classic", () => {
    expect(resolveTranslateMode({ sharedLayout: true, detached: true })).toBe("detached_sections");
    expect(resolveTranslateMode({ sharedLayout: false, detached: false })).toBe("detached_sections");
  });
});

describe("splitTranslateContent / filterAllowedFields", () => {
  it("splits meta sections and fields", () => {
    const split = splitTranslateContent({
      bio: "hola",
      meta: { page_title: "t" },
      sections: [],
      slug: "x",
    });
    expect(split.fields).toEqual({ bio: "hola" });
    expect(split.meta).toEqual({ page_title: "t" });
    expect(split.reservedUrlKeys).toEqual(["content.slug"]);
  });

  it("filters to safe editor fields", () => {
    const { allowed, rejected } = filterAllowedFields(
      { bio: "x", evil: 1, name: "n" },
      authorsConfig,
    );
    expect(allowed).toEqual({ bio: "x", name: "n" });
    expect(rejected).toContain("evil");
  });
});

describe("buildTranslateLocaleData attached_fields", () => {
  it("writes new draft with sections []", () => {
    const built = buildTranslateLocaleData({
      mode: "attached_fields",
      localeUrlSlug: "ada",
      targetLocale: "es",
      allowedFields: { bio: "bio es" },
      existing: null,
      writeAsDraft: true,
      mergeIntoExisting: false,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.localeData.sections).toEqual([]);
    expect(built.localeData.bio).toBe("bio es");
    expect(built.merge).toBe(false);
  });

  it("rejects non-empty sections when attached", () => {
    const built = buildTranslateLocaleData({
      mode: "attached_fields",
      localeUrlSlug: "ada",
      targetLocale: "es",
      sections: [{ type: "hero" }],
      allowedFields: { bio: "x" },
      existing: null,
      writeAsDraft: true,
      mergeIntoExisting: false,
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.code).toBe("shared_layout_sections_must_be_empty");
  });

  it("merges live refresh and preserves legacy sections + unrelated keys", () => {
    const built = buildTranslateLocaleData({
      mode: "attached_fields",
      localeUrlSlug: "ada",
      targetLocale: "es",
      allowedFields: { bio: "nuevo" },
      meta: { page_title: "ES" },
      existing: {
        slug: "ada",
        bio: "old",
        custom_keep: true,
        sections: [{ type: "breadcrumb", id: "b1" }],
        meta: { description: "keep-me" },
      },
      writeAsDraft: false,
      mergeIntoExisting: true,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.merge).toBe(true);
    expect(built.localeData.bio).toBe("nuevo");
    expect(built.localeData.custom_keep).toBe(true);
    expect(built.localeData.sections).toEqual([{ type: "breadcrumb", id: "b1" }]);
    expect((built.localeData.meta as Record<string, unknown>).description).toBe("keep-me");
    expect((built.localeData.meta as Record<string, unknown>).page_title).toBe("ES");
  });
});

describe("buildTranslateLocaleData detached_sections", () => {
  it("requires sections or content for new draft", () => {
    const built = buildTranslateLocaleData({
      mode: "detached_sections",
      localeUrlSlug: "p",
      targetLocale: "es",
      allowedFields: {},
      sections: [],
      existing: null,
      writeAsDraft: true,
      mergeIntoExisting: false,
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.code).toBe("detached_sections_required");
  });

  it("allows content-only new draft for blog body", () => {
    const built = buildTranslateLocaleData({
      mode: "detached_sections",
      localeUrlSlug: "p",
      targetLocale: "es",
      allowedFields: { title: "T", content: "# hola" },
      existing: null,
      writeAsDraft: true,
      mergeIntoExisting: false,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.localeData.content).toBe("# hola");
  });

  it("fields-only merge preserves existing sections", () => {
    const built = buildTranslateLocaleData({
      mode: "detached_sections",
      localeUrlSlug: "p",
      targetLocale: "es",
      allowedFields: { title: "Nuevo" },
      existing: {
        localeUrlSlug: "p",
        title: "Old",
        sections: [{ type: "hero", version: "v1.0" }],
      },
      writeAsDraft: false,
      mergeIntoExisting: true,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.localeData.title).toBe("Nuevo");
    expect(built.localeData.sections).toEqual([{ type: "hero", version: "v1.0" }]);
  });

  it("rejects clearing sections on non-empty detached live", () => {
    const built = buildTranslateLocaleData({
      mode: "detached_sections",
      localeUrlSlug: "p",
      targetLocale: "es",
      allowedFields: {},
      sections: [],
      existing: {
        localeUrlSlug: "p",
        sections: [{ type: "hero" }],
      },
      writeAsDraft: false,
      mergeIntoExisting: true,
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.code).toBe("detached_sections_clear_rejected");
  });

  it("accepts full sections replace", () => {
    const built = buildTranslateLocaleData({
      mode: "detached_sections",
      localeUrlSlug: "p",
      targetLocale: "es",
      sections: [{ type: "hero", version: "v1.0", data: { title: "H" } }],
      allowedFields: { title: "T" },
      existing: null,
      writeAsDraft: true,
      mergeIntoExisting: false,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect((built.localeData.sections as unknown[]).length).toBe(1);
  });
});

describe("listLiveLocaleFiles", () => {
  it("lists only live locale stems", () => {
    const locales = listLiveLocaleFiles("/x", () => [
      "en.yml",
      "es.yaml",
      "draft.es.yml",
      "_common.yml",
      "versioning.yml",
      "seo-fix.en.yml",
    ]);
    expect(locales.sort()).toEqual(["en", "es"]);
  });
});

describe("blogConfig filter smoke", () => {
  it("allows blog body fields", () => {
    const { allowed } = filterAllowedFields(
      { title: "a", description: "b", content: "c" },
      blogConfig,
    );
    expect(Object.keys(allowed).sort()).toEqual(["content", "description", "title"]);
  });
});
