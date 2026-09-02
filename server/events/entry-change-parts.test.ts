import { describe, it, expect } from "vitest";
import {
  parseContentFilePath,
  diffEntryLocaleParts,
  diffEntryCommonParts,
  siteRedirectsChanged,
  entryRedirectsChangedWithoutLocaleSave,
} from "./entry-change-parts";

describe("parseContentFilePath", () => {
  it("routes live locale YAML", () => {
    const parsed = parseContentFilePath("site_test/landings/foo/es.yml");
    expect(parsed).toEqual({
      scope: "entry_locale",
      contentType: "landing",
      slug: "foo",
      locale: "es",
      layer: "live",
    });
  });

  it("routes draft variant layer", () => {
    const parsed = parseContentFilePath("site_test/landings/foo/draft.es.yml");
    expect(parsed).toMatchObject({ scope: "entry_locale", layer: "variant", locale: "es" });
  });

  it("routes _common.yml", () => {
    const parsed = parseContentFilePath("site_test/programs/course/_common.yml");
    expect(parsed).toEqual({
      scope: "entry_common",
      contentType: "program",
      slug: "course",
    });
  });

  it("routes custom-redirects.yml", () => {
    expect(parseContentFilePath("site_test/custom-redirects.yml").scope).toBe("site_redirects");
  });

  it("routes registry schema.yml", () => {
    const parsed = parseContentFilePath(
      "site_test/component-registry/hero/v1.0/schema.yml",
    );
    expect(parsed).toMatchObject({ scope: "registry", registryPart: "schema" });
  });
});

describe("diffEntryLocaleParts", () => {
  it("detects meta, sections, seo, and redirects parts", () => {
    const prev = `meta:\n  title: Old\n  redirects:\n    - from: /a\n      to: /b\nseo:\n  pillar_path: /hub\nsections: []\n`;
    const next = `meta:\n  title: New\n  redirects:\n    - from: /a\n      to: /c\nseo:\n  pillar_path: /hub2\nsections:\n  - id: s1\n`;
    const parts = diffEntryLocaleParts(prev, next);
    expect(parts).toContain("meta");
    expect(parts).toContain("sections");
    expect(parts).toContain("seo");
    expect(parts).toContain("redirects");
  });

  it("one-save rule: redirects in locale diff do not need separate entry_redirects_changed", () => {
    const prev = `meta:\n  redirects:\n    - from: /x\n      to: /y\nsections: []\n`;
    const next = `meta:\n  redirects:\n    - from: /x\n      to: /z\nsections: []\n`;
    expect(diffEntryLocaleParts(prev, next)).toContain("redirects");
    expect(entryRedirectsChangedWithoutLocaleSave(prev, next)).toBe(true);
  });
});

describe("diffEntryCommonParts", () => {
  it("detects funnel and identity changes", () => {
    const prev = `slug: course\nfunnel:\n  products: []\n`;
    const next = `slug: course\nfunnel:\n  products: [p1]\ntitle: Course\n`;
    const parts = diffEntryCommonParts(prev, next);
    expect(parts).toContain("funnel");
    expect(parts).toContain("identity");
  });
});

describe("siteRedirectsChanged", () => {
  it("detects custom-redirects.yml changes", () => {
    const prev = "redirects:\n  - from: /a\n    to: /b\n";
    const next = "redirects:\n  - from: /a\n    to: /c\n";
    expect(siteRedirectsChanged(prev, next)).toBe(true);
  });
});
