import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clusterResolutionConfirmRequired,
  entryHasOpenClusterGapIssue,
  isRiskyClusterResolutionWrite,
} from "./cluster-resolution-gate";
import { SEO_IS_PILLAR, SEO_PILLAR_PATH } from "./seo-cluster-toggle";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmpRoot(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "cluster-gate-"));
  dirs.push(d);
  return d;
}

function writeCache(
  root: string,
  opts: { entryKey: string; code: string; completed?: boolean },
) {
  const issueId = "iss-1";
  const cache = {
    issues: {
      [issueId]: { code: opts.code, severity: "warning", validator: "seo-cluster" },
    },
    indexes: { byEntry: { [opts.entryKey]: [issueId] } },
    completions: opts.completed ? { [issueId]: { completedBy: "x", completedAt: new Date().toISOString() } } : {},
  };
  fs.writeFileSync(path.join(root, "validation-cache.json"), JSON.stringify(cache));
}

describe("cluster-resolution-gate", () => {
  it("detects risky pillar and opt-out writes", () => {
    expect(isRiskyClusterResolutionWrite([{ field_path: SEO_IS_PILLAR, value: true }])).toBe(true);
    expect(isRiskyClusterResolutionWrite([{ field_path: SEO_PILLAR_PATH, value: null }])).toBe(true);
    expect(
      isRiskyClusterResolutionWrite([{ field_path: SEO_PILLAR_PATH, value: "/en/hub" }]),
    ).toBe(false);
  });

  it("blocks pillar without confirm when orphan open", () => {
    const root = tmpRoot();
    writeCache(root, { entryKey: "blog/foo/en", code: "ORPHAN_PAGE" });
    const r = clusterResolutionConfirmRequired({
      contentPath: root,
      contentType: "blog",
      slug: "foo",
      locale: "en",
      updates: [{ field_path: SEO_IS_PILLAR, value: true }],
    });
    expect(r.blocked).toBe(true);
    if (r.blocked) expect(r.code).toBe("confirm_cluster_resolution");
  });

  it("allows pillar with confirm", () => {
    const root = tmpRoot();
    writeCache(root, { entryKey: "blog/foo/en", code: "ORPHAN_PAGE" });
    const r = clusterResolutionConfirmRequired({
      contentPath: root,
      contentType: "blog",
      slug: "foo",
      locale: "en",
      updates: [{ field_path: SEO_IS_PILLAR, value: true }],
      confirm_cluster_resolution: true,
    });
    expect(r.blocked).toBe(false);
  });

  it("allows join-hub without confirm", () => {
    const root = tmpRoot();
    writeCache(root, { entryKey: "blog/foo/en", code: "ORPHAN_PAGE" });
    const r = clusterResolutionConfirmRequired({
      contentPath: root,
      contentType: "blog",
      slug: "foo",
      locale: "en",
      updates: [{ field_path: SEO_PILLAR_PATH, value: "/en/hub" }],
    });
    expect(r.blocked).toBe(false);
  });

  it("ignores completed cluster-gap issues", () => {
    const root = tmpRoot();
    writeCache(root, { entryKey: "blog/foo/en", code: "ORPHAN_PAGE", completed: true });
    expect(
      entryHasOpenClusterGapIssue({
        contentPath: root,
        contentType: "blog",
        slug: "foo",
        locale: "en",
      }).open,
    ).toBe(false);
  });
});
