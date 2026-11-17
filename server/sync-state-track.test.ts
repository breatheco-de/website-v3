import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectPendingChanges,
  getAllContentFiles,
  markFileAsModified,
  shouldTrackFile,
} from "./sync-state";

const ROOT = "site_test";

describe("shouldTrackFile", () => {
  it("skips derived indexes rebuilt by the server", () => {
    for (const f of ["seo-index.json", "link-index.json", "relation-index.json", "validation-cache.json"]) {
      expect(shouldTrackFile(`${ROOT}/${f}`, undefined, ROOT), f).toBe(false);
    }
  });

  it("tracks content YAML and the ads history backup", () => {
    for (const f of ["pages/home/en.yml", "ads-history/meta.json", "ads-history/changes/meta-2026-10.json"]) {
      expect(shouldTrackFile(`${ROOT}/${f}`, undefined, ROOT), f).toBe(true);
    }
  });

  it("tracks llms template and regenerate prompt markdown at site root", () => {
    expect(shouldTrackFile(`${ROOT}/llms.template.md`, undefined, ROOT)).toBe(true);
    expect(shouldTrackFile(`${ROOT}/llms.regenerate-prompt.md`, undefined, ROOT)).toBe(true);
  });

  it("still skips other markdown files", () => {
    expect(shouldTrackFile(`${ROOT}/README.md`, undefined, ROOT)).toBe(false);
    expect(shouldTrackFile(`${ROOT}/docs/notes.md`, undefined, ROOT)).toBe(false);
  });
});

describe("getAllContentFiles / detectPendingChanges llms markdown", () => {
  const ORIGINAL_CWD = process.cwd();
  let tempDir: string;
  let contentRoot: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-llms-md-"));
    contentRoot = path.join(tempDir, ROOT);
    fs.mkdirSync(contentRoot, { recursive: true });
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(ORIGINAL_CWD);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("walks llms markdown at site root and skips other .md", () => {
    fs.writeFileSync(path.join(contentRoot, "llms.regenerate-prompt.md"), "Use {{products}}\n");
    fs.writeFileSync(path.join(contentRoot, "llms.template.md"), "# Site\n");
    fs.writeFileSync(path.join(contentRoot, "README.md"), "# skip\n");
    fs.mkdirSync(path.join(contentRoot, "docs"), { recursive: true });
    fs.writeFileSync(path.join(contentRoot, "docs", "notes.md"), "skip\n");
    fs.writeFileSync(path.join(contentRoot, "settings.yml"), "llms_txt:\n  enabled: false\n");

    const files = getAllContentFiles(contentRoot);
    expect(files).toContain(`${ROOT}/llms.regenerate-prompt.md`);
    expect(files).toContain(`${ROOT}/llms.template.md`);
    expect(files).toContain(`${ROOT}/settings.yml`);
    expect(files).not.toContain(`${ROOT}/README.md`);
    expect(files).not.toContain(`${ROOT}/docs/notes.md`);
  });

  it("lists a new regenerate prompt as pending added", () => {
    const rel = `${ROOT}/llms.regenerate-prompt.md`;
    fs.writeFileSync(path.join(contentRoot, "llms.regenerate-prompt.md"), "Use {{pages}}\n");
    markFileAsModified(rel, "staff", undefined, contentRoot);

    const pending = detectPendingChanges(contentRoot);
    const row = pending.find((c) => c.file === rel);
    expect(row).toMatchObject({ file: rel, status: "added", source: "local" });
  });
});
