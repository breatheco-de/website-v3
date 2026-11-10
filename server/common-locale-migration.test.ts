import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetRegistry } from "./content-types";
import { findCommonLocaleFiles, removeCommonLocaleLine, runCommonLocaleMigration } from "./common-locale-migration";

describe("removeCommonLocaleLine", () => {
  it("removes only the top-level locale line and keeps every other byte", () => {
    const before = 'slug: promo\nlocale: es\nprograms:\n  - x\nnote: Hola {{ global.rate | 84 }}%\nmeta:\n  locale: keep\n';
    const { text, changed } = removeCommonLocaleLine(before);
    expect(changed).toBe(true);
    expect(text).toBe('slug: promo\nprograms:\n  - x\nnote: Hola {{ global.rate | 84 }}%\nmeta:\n  locale: keep\n');
  });

  it("is a no-op without a top-level locale line", () => {
    expect(removeCommonLocaleLine("slug: a\nmeta:\n  locale: en\n")).toEqual({ text: "slug: a\nmeta:\n  locale: en\n", changed: false });
  });
});

describe("runCommonLocaleMigration", () => {
  let cwd = "";
  let prevCwd = "";
  const site = "site_test";

  function write(rel: string, body: string) {
    const abs = path.join(cwd, site, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, "utf-8");
  }

  beforeEach(() => {
    prevCwd = process.cwd();
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "common-locale-mig-"));
    process.chdir(cwd);
    write(
      "content-types.yml",
      [
        "landing:",
        "  directory: landings",
        "  url_pattern:",
        "    default: /landing/:slug",
        "page:",
        "  directory: pages",
        "  url_pattern:",
        "    en: /en/:slug",
        "    es: /es/:slug",
        "",
      ].join("\n"),
    );
    write("landings/a/_common.yml", "slug: a\nlocale: es\nprograms:\n  - x\n");
    write("landings/a/es.yml", "title: A\n");
    write("landings/b/_common.yml", "slug: b\n");
    write("pages/about/_common.yml", "slug: about\nlocale: en\n");
    resetRegistry();
  });

  afterEach(() => {
    process.chdir(prevCwd);
    fs.rmSync(cwd, { recursive: true, force: true });
    resetRegistry();
  });

  function deps(pushes: Array<{ files: string[] }>, pushOk = true) {
    return {
      sites: () => [{ name: site, contentRoot: site }],
      pending: () => [] as string[],
      markModified: () => {},
      push: async (_s: string, files: string[]) => {
        pushes.push({ files });
        return pushOk ? { success: true, commitHash: "abc123" } : { success: false, error: "boom" };
      },
    };
  }

  it("finds only one-address types that still set locale", () => {
    expect(findCommonLocaleFiles(site, path.join(cwd, site))).toEqual([`${site}/landings/a/_common.yml`]);
  });

  it("dry run lists files and writes nothing", async () => {
    const pushes: Array<{ files: string[] }> = [];
    const r = await runCommonLocaleMigration({ dryRun: true, deps: deps(pushes), log: () => {} });
    expect(r).toEqual({ failed: false, changed: [`${site}/landings/a/_common.yml`] });
    expect(pushes).toEqual([]);
    expect(fs.readFileSync(path.join(cwd, site, "landings/a/_common.yml"), "utf-8")).toContain("locale: es");
  });

  it("apply removes the line, pushes once, and a second run is a no-op", async () => {
    const pushes: Array<{ files: string[] }> = [];
    const first = await runCommonLocaleMigration({ dryRun: false, deps: deps(pushes), log: () => {} });
    expect(first.failed).toBe(false);
    expect(fs.readFileSync(path.join(cwd, site, "landings/a/_common.yml"), "utf-8")).toBe("slug: a\nprograms:\n  - x\n");
    expect(fs.readFileSync(path.join(cwd, site, "pages/about/_common.yml"), "utf-8")).toContain("locale: en");
    expect(pushes).toEqual([{ files: [`${site}/landings/a/_common.yml`] }]);
    const second = await runCommonLocaleMigration({ dryRun: false, deps: deps(pushes), log: () => {} });
    expect(second).toEqual({ failed: false, changed: [] });
    expect(pushes).toHaveLength(1);
  });

  it("fails the run when the push fails", async () => {
    const r = await runCommonLocaleMigration({ dryRun: false, deps: deps([], false), log: () => {}, error: () => {} });
    expect(r.failed).toBe(true);
  });
});
