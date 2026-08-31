import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureSiteScaffold } from "./site-scaffold";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "site-scaffold-"));
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("ensureSiteScaffold", () => {
  it("writes folder-layout pages, not flat locale files", () => {
    ensureSiteScaffold({
      contentFolder: "site_test",
      displayName: "Test Site",
      includeSampleContent: true,
    });

    const root = path.join(tempDir, "site_test");
    expect(fs.existsSync(path.join(root, "pages", "home", "en.yml"))).toBe(true);
    expect(fs.existsSync(path.join(root, "pages", "home", "_common.yml"))).toBe(true);
    expect(fs.existsSync(path.join(root, "pages", "about", "en.yml"))).toBe(true);
    expect(fs.existsSync(path.join(root, "pages", "home.en.yml"))).toBe(false);
    expect(fs.existsSync(path.join(root, "pages", "about.en.yml"))).toBe(false);

    expect(fs.existsSync(path.join(root, "blog", "sample-post", "en.yml"))).toBe(true);
    expect(fs.existsSync(path.join(root, "blog", "sample-post.en.yml"))).toBe(false);
    expect(fs.existsSync(path.join(root, "blog", "template.en.yml"))).toBe(true);
    expect(fs.existsSync(path.join(root, "blog", "_common.template.yml"))).toBe(true);

    const ct = fs.readFileSync(path.join(root, "content-types.yml"), "utf-8");
    expect(ct).toContain("blog:");
    expect(ct).toContain("/en/blog/:slug");

    const settings = fs.readFileSync(path.join(root, "settings.yml"), "utf-8");
    expect(settings).toContain("home_page:");
    expect(settings).toContain("slug: home");

    expect(fs.existsSync(path.join(root, "component-registry"))).toBe(false);

    const home = fs.readFileSync(path.join(root, "pages", "home", "en.yml"), "utf-8");
    expect(home).toContain("type: hero");
    expect(home).toContain("variant: singleColumn");
    expect(home).toContain("/en/home");
  });

  it("skips sample blog when includeSampleContent is false", () => {
    ensureSiteScaffold({
      contentFolder: "site_minimal",
      displayName: "Minimal",
      includeSampleContent: false,
    });
    const root = path.join(tempDir, "site_minimal");
    expect(fs.existsSync(path.join(root, "pages", "home", "en.yml"))).toBe(true);
    expect(fs.existsSync(path.join(root, "pages", "about"))).toBe(false);
    expect(fs.existsSync(path.join(root, "blog"))).toBe(false);
    const ct = fs.readFileSync(path.join(root, "content-types.yml"), "utf-8");
    expect(ct).not.toContain("blog:");
  });
});
