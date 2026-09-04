import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import {
  buildGithubCommitFileUrl,
  normalizeGithubRepoHttpsUrl,
  sha256HexUtf8,
} from "./github-commit-file-url";

describe("sha256HexUtf8", () => {
  it("matches Node crypto for UTF-8 strings", () => {
    for (const s of ["", "a", "README.md", "site_4geeks-com/blog/foo/en.yml"]) {
      const expected = createHash("sha256").update(s, "utf8").digest("hex");
      expect(sha256HexUtf8(s)).toBe(expected);
    }
  });
});

describe("normalizeGithubRepoHttpsUrl", () => {
  it("normalizes common repo URL shapes", () => {
    expect(normalizeGithubRepoHttpsUrl("https://github.com/org/repo.git")).toBe(
      "https://github.com/org/repo",
    );
    expect(normalizeGithubRepoHttpsUrl("git@github.com:org/repo.git")).toBe(
      "https://github.com/org/repo",
    );
    expect(normalizeGithubRepoHttpsUrl("org/repo")).toBe("https://github.com/org/repo");
  });
});

describe("buildGithubCommitFileUrl", () => {
  it("builds commit URL with #diff-sha256(path)", () => {
    const path = "site_demo/blog/hello/en.yml";
    const sha = "abc123def456";
    const url = buildGithubCommitFileUrl({
      repoUrl: "https://github.com/acme/content.git",
      commitSha: sha,
      path,
    });
    expect(url).toBe(
      `https://github.com/acme/content/commit/${sha}#diff-${createHash("sha256").update(path, "utf8").digest("hex")}`,
    );
  });

  it("returns null when inputs are incomplete", () => {
    expect(buildGithubCommitFileUrl({ repoUrl: "", commitSha: "x", path: "a.yml" })).toBeNull();
    expect(
      buildGithubCommitFileUrl({
        repoUrl: "https://github.com/a/b",
        commitSha: "",
        path: "a.yml",
      }),
    ).toBeNull();
    expect(
      buildGithubCommitFileUrl({
        repoUrl: "https://github.com/a/b",
        commitSha: "x",
        path: "",
      }),
    ).toBeNull();
  });
});
