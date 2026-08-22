import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  diffSitesYmlStructure,
  getSitesYmlLocalPath,
  mergeMissingAliases,
  loadSitesYmlFromBucket,
  readSitesYmlLocal,
  renameSiteDomain,
  saveSitesYml,
  writeSitesYmlLocal,
} from "./sites-yml-store";
import { getSiteConfigs, hasMultipleSites, resetSiteConfigs, SitesYmlRequiredError } from "./site-config";

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sites-yml-store-test-"));
  process.chdir(tempDir);
  resetSiteConfigs();
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  resetSiteConfigs();
  vi.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("sites-yml-store", () => {
  it("readSitesYmlLocal returns null when file is missing", () => {
    expect(readSitesYmlLocal()).toBeNull();
  });

  it("writeSitesYmlLocal and readSitesYmlLocal round-trip", () => {
    const content = "example.com:\n  content_folder: site_example\n";
    writeSitesYmlLocal(content);
    expect(readSitesYmlLocal()).toBe(content);
    expect(fs.realpathSync(getSitesYmlLocalPath())).toBe(
      fs.realpathSync(path.join(tempDir, "sites.yml")),
    );
  });

  it("saveSitesYml writes local file in development", () => {
    process.env.NODE_ENV = "development";
    const content = "example.com:\n  content_folder: site_example\n";
    saveSitesYml(content);
    expect(fs.readFileSync(path.join(tempDir, "sites.yml"), "utf-8")).toBe(content);
  });

  it("loadSitesYmlFromBucket requires local file in development", async () => {
    process.env.NODE_ENV = "development";
    await expect(loadSitesYmlFromBucket()).rejects.toThrow(SitesYmlRequiredError);
  });

  it("loadSitesYmlFromBucket succeeds in development when local file exists", async () => {
    process.env.NODE_ENV = "development";
    writeSitesYmlLocal("example.com:\n  content_folder: site_example\n");
    await expect(loadSitesYmlFromBucket()).resolves.toBeUndefined();
  });

  it("loadSitesYmlFromBucket clears stale site-config cache after resolving sites.yml", async () => {
    process.env.NODE_ENV = "development";
    writeSitesYmlLocal(`old.example.com:
  content_folder: site_old
`);
    expect(getSiteConfigs()).toHaveLength(1);
    expect(hasMultipleSites()).toBe(false);

    writeSitesYmlLocal(`a.example.com:
  content_folder: site_a
b.example.com:
  content_folder: site_b
`);
    await loadSitesYmlFromBucket();

    expect(getSiteConfigs()).toHaveLength(2);
    expect(hasMultipleSites()).toBe(true);
  });

  it("renameSiteDomain updates the domain key and preserves nested fields", () => {
    const content = [
      "# header comment",
      "bucket_name: test-bucket",
      "",
      "example.com:",
      "  content_folder: site_example",
      "  github_repo_url: https://github.com/org/repo",
    ].join("\n");
    writeSitesYmlLocal(content);

    renameSiteDomain("example.com", "new-example.com");

    const updated = readSitesYmlLocal();
    expect(updated).toContain("# header comment");
    expect(updated).toContain("new-example.com:");
    expect(updated).not.toMatch(/^example\.com:/m);
    expect(updated).toContain("content_folder: site_example");
    expect(updated).toContain("github_repo_url: https://github.com/org/repo");
  });
});

describe("mergeMissingAliases", () => {
  const repo = [
    "bucket_name: bkt",
    "",
    "4geeks.com:",
    "  content_folder: site_4geeks-com",
    "  aliases:",
    "    - www.4geeks.com",
    "",
    "fl.4geeksacademy.com:",
    "  content_folder: site_4geeks-florida",
  ].join("\n");

  it("adds missing aliases to the canonical copy, preserving comments and other fields", () => {
    const canonical = [
      "# canonical comment",
      "bucket_name: bkt",
      "",
      "4geeks.com:",
      "  content_folder: site_4geeks-com-prod-edited",
      "",
      "fl.4geeksacademy.com:",
      "  content_folder: site_4geeks-florida",
    ].join("\n");

    const result = mergeMissingAliases(repo, canonical);
    expect(result.changed).toBe(true);
    expect(result.added).toEqual({ "4geeks.com": ["www.4geeks.com"] });
    expect(result.content).toContain("# canonical comment");
    expect(result.content).toContain("content_folder: site_4geeks-com-prod-edited");
    expect(result.content).toMatch(/4geeks\.com:\n  aliases:\n    - www\.4geeks\.com/);
    // Parses and validates cleanly
    const parsed = mergeMissingAliases(repo, result.content);
    expect(parsed.changed).toBe(false);
  });

  it("appends to an existing aliases list without duplicating", () => {
    const canonical = [
      "4geeks.com:",
      "  content_folder: site_4geeks-com",
      "  aliases:",
      "    - old.4geeks.com",
      "",
      "fl.4geeksacademy.com:",
      "  content_folder: site_4geeks-florida",
    ].join("\n");
    const result = mergeMissingAliases(repo, canonical);
    expect(result.changed).toBe(true);
    expect(result.content).toMatch(/aliases:\n    - old\.4geeks\.com\n    - www\.4geeks\.com/);
  });

  it("is a no-op when aliases already present", () => {
    const result = mergeMissingAliases(repo, repo);
    expect(result.changed).toBe(false);
    expect(result.content).toBe(repo);
  });

  it("skips aliases that are configured domains in the canonical copy (loop guard)", () => {
    const canonical = [
      "4geeks.com:",
      "  content_folder: site_a",
      "www.4geeks.com:",
      "  content_folder: site_b",
    ].join("\n");
    const result = mergeMissingAliases(repo, canonical);
    expect(result.changed).toBe(false);
  });

  it("skips aliases claimed by another site in the canonical copy", () => {
    const canonical = [
      "4geeks.com:",
      "  content_folder: site_a",
      "other.com:",
      "  content_folder: site_c",
      "  aliases:",
      "    - www.4geeks.com",
    ].join("\n");
    const result = mergeMissingAliases(repo, canonical);
    expect(result.changed).toBe(false);
  });

  it("does not add sites that only exist in the repo copy", () => {
    const canonical = "fl.4geeksacademy.com:\n  content_folder: site_4geeks-florida\n";
    const result = mergeMissingAliases(repo, canonical);
    expect(result.changed).toBe(false);
  });

  it("returns no-op on unparseable input", () => {
    expect(mergeMissingAliases("::: not yaml [", repo).changed).toBe(false);
    expect(mergeMissingAliases(repo, "- just\n- a list\n").changed).toBe(false);
  });
});

describe("diffSitesYmlStructure", () => {
  it("reports alias, field, domain, and bucket differences", () => {
    const repo = [
      "bucket_name: bkt-a",
      "4geeks.com:",
      "  content_folder: site_x",
      "  aliases:",
      "    - www.4geeks.com",
      "new.com:",
      "  content_folder: site_new",
    ].join("\n");
    const gcs = [
      "bucket_name: bkt-b",
      "4geeks.com:",
      "  content_folder: site_y",
      "old.com:",
      "  content_folder: site_old",
    ].join("\n");
    const diffs = diffSitesYmlStructure(repo, gcs);
    expect(diffs.some((d) => d.includes('"new.com" exists in repo'))).toBe(true);
    expect(diffs.some((d) => d.includes('"old.com" exists in the GCS copy'))).toBe(true);
    expect(diffs.some((d) => d.includes('"content_folder" differs'))).toBe(true);
    expect(diffs.some((d) => d.includes("aliases differ"))).toBe(true);
    expect(diffs.some((d) => d.includes("bucket_name differs"))).toBe(true);
  });

  it("returns empty for identical content", () => {
    const c = "4geeks.com:\n  content_folder: site_x\n";
    expect(diffSitesYmlStructure(c, c)).toEqual([]);
  });
});
