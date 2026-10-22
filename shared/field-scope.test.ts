import { describe, expect, it } from "vitest";
import {
  COMMON_META_KEYS,
  DEFAULT_FIELD_SCOPE,
  FIELD_SCOPE,
  LOCALE_META_KEYS,
  fieldScope,
  splitByFieldScope,
} from "./field-scope";

describe("fieldScope", () => {
  it.each(Object.entries(FIELD_SCOPE))("%s → %s", (fieldPath, scope) => {
    expect(fieldScope(fieldPath)).toBe(scope);
  });

  it("uses the longest listed prefix for nested paths", () => {
    expect(fieldScope("funnel.stage")).toBe("common");
    expect(fieldScope("meta.robots")).toBe("locale");
    expect(fieldScope("seo.main_keyword")).toBe("locale");
    expect(fieldScope("authors.0")).toBe("common");
  });

  it("defaults to locale", () => {
    expect(DEFAULT_FIELD_SCOPE).toBe("locale");
    expect(fieldScope("meta.page_title")).toBe("locale");
    expect(fieldScope("meta.custom_key")).toBe("locale");
    expect(fieldScope("sections.0.title")).toBe("locale");
    expect(fieldScope("brand_new_field")).toBe("locale");
  });

  it("keeps URL params locale-scoped", () => {
    expect(fieldScope("category", { urlParams: ["category"] })).toBe("locale");
    expect(fieldScope("authors", { urlParams: ["authors"] })).toBe("locale");
  });

  it("derives meta key sets from the table: search settings are per language", () => {
    expect([...COMMON_META_KEYS]).toEqual([]);
    expect([...LOCALE_META_KEYS].sort()).toEqual(["change_frequency", "priority", "robots"]);
  });
});

describe("splitByFieldScope", () => {
  it("splits meta key-by-key and top-level keys by scope", () => {
    const { common, locale } = splitByFieldScope({
      title: "T",
      authors: ["a"],
      meta: { robots: "noindex", page_title: "P" },
      funnel: { stage: "awareness" },
    });
    expect(common).toEqual({ authors: ["a"], funnel: { stage: "awareness" } });
    expect(locale).toEqual({ title: "T", meta: { robots: "noindex", page_title: "P" } });
  });
});
