import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  LIVE_SHELL_BASENAME_RE,
  VARIANT_SHELL_BASENAME_RE,
  TEMPLATE_VERSIONING_SLUG,
  LEGACY_TEMPLATE_VERSIONING_SLUG,
  isTemplateVersioningSlug,
  isTypeLayoutTarget,
  migrateShellBasename,
  liveTemplateBasename,
  commonTemplateBasename,
} from "@shared/sharedLayoutPaths";
import {
  resolveTemplateLocalePath,
  resolveCommonTemplatePath,
  hasLiveTemplateLocale,
  bothShellNamingWarnings,
  listAllLiveShellPaths,
} from "../server/shared-layout-paths";

describe("sharedLayoutPaths", () => {
  it("emits canonical template basenames", () => {
    expect(liveTemplateBasename("en")).toBe("template.en.yml");
    expect(commonTemplateBasename()).toBe("_common.template.yml");
    expect(TEMPLATE_VERSIONING_SLUG).toBe("template");
    expect(LEGACY_TEMPLATE_VERSIONING_SLUG).toBe("single");
  });

  it("accepts both versioning slugs and layout targets", () => {
    expect(isTemplateVersioningSlug("template")).toBe(true);
    expect(isTemplateVersioningSlug("single")).toBe(true);
    expect(isTemplateVersioningSlug("blog-post")).toBe(false);
    expect(isTypeLayoutTarget("type_template")).toBe(true);
    expect(isTypeLayoutTarget("type_single")).toBe(true);
    expect(isTypeLayoutTarget("entry")).toBe(false);
  });

  it("migrates legacy shell basenames", () => {
    expect(migrateShellBasename("single.en.yml")).toBe("template.en.yml");
    expect(migrateShellBasename("single.draft.es.yml")).toBe("template.draft.es.yml");
    expect(migrateShellBasename("_common.single.yml")).toBe("_common.template.yml");
    expect(migrateShellBasename("en.yml")).toBeNull();
  });

  it("regexes match live and variant shells for both namings", () => {
    expect(LIVE_SHELL_BASENAME_RE.test("template.en.yml")).toBe(true);
    expect(LIVE_SHELL_BASENAME_RE.test("single.es.yml")).toBe(true);
    expect(LIVE_SHELL_BASENAME_RE.test("template.draft.en.yml")).toBe(false);
    expect(VARIANT_SHELL_BASENAME_RE.test("template.draft.en.yml")).toBe(true);
    expect(VARIANT_SHELL_BASENAME_RE.test("single.ctr-fix.en.yml")).toBe(true);
  });
});

describe("shared-layout-paths resolve", () => {
  function tmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "shell-paths-"));
  }

  it("prefers template.* over single.*", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "single.en.yml"), "sections: []\n");
    fs.writeFileSync(path.join(dir, "template.en.yml"), "sections: [prefer]\n");
    const resolved = resolveTemplateLocalePath(dir, "en", { fallbackLocale: "" });
    expect(path.basename(resolved)).toBe("template.en.yml");
    expect(bothShellNamingWarnings(dir).length).toBeGreaterThan(0);
  });

  it("falls back to single.* when template.* missing", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "single.es.yml"), "sections: []\n");
    const resolved = resolveTemplateLocalePath(dir, "es", { fallbackLocale: "" });
    expect(path.basename(resolved)).toBe("single.es.yml");
    expect(hasLiveTemplateLocale(dir, "es")).toBe(true);
  });

  it("forWrite always returns template.*", () => {
    const dir = tmpDir();
    const p = resolveTemplateLocalePath(dir, "en", { forWrite: true });
    expect(path.basename(p)).toBe("template.en.yml");
    const common = resolveCommonTemplatePath(dir, { forWrite: true });
    expect(path.basename(common)).toBe("_common.template.yml");
  });

  it("lists prefer template when both exist", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "single.en.yml"), "x\n");
    fs.writeFileSync(path.join(dir, "template.en.yml"), "y\n");
    fs.writeFileSync(path.join(dir, "single.es.yml"), "z\n");
    const paths = listAllLiveShellPaths(dir).map((p) => path.basename(p)).sort();
    expect(paths).toEqual(["single.es.yml", "template.en.yml"]);
  });
});
