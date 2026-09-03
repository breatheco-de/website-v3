import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ISSUE_CONTEXT_MAX_BYTES,
  readIssueContext,
  readStaffContextForAgent,
  writeIssueContext,
} from "./validation-issue-context";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmpRoot(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "issue-ctx-"));
  dirs.push(d);
  return d;
}

describe("validation-issue-context", () => {
  it("reads missing file as empty", () => {
    const root = tmpRoot();
    const r = readIssueContext(root, "seo-cluster", "ORPHAN_PAGE", "site_x");
    expect(r.exists).toBe(false);
    expect(r.content).toBe("");
    expect(r.path).toBe("site_x/validation-issue-context/seo-cluster/ORPHAN_PAGE.md");
    expect(readStaffContextForAgent(root, "seo-cluster", "ORPHAN_PAGE")).toBeUndefined();
  });

  it("writes on save and returns staff_context when non-empty", () => {
    const root = tmpRoot();
    writeIssueContext(root, "seo-cluster", "ORPHAN_PAGE", "Never create new pillars.\n", "site_x");
    const r = readIssueContext(root, "seo-cluster", "ORPHAN_PAGE", "site_x");
    expect(r.exists).toBe(true);
    expect(r.content).toContain("Never create");
    expect(readStaffContextForAgent(root, "seo-cluster", "ORPHAN_PAGE")).toContain("Never create");
  });

  it("omits staff_context when only whitespace", () => {
    const root = tmpRoot();
    writeIssueContext(root, "seo-cluster", "ORPHAN_PAGE", "  \n  ");
    expect(readStaffContextForAgent(root, "seo-cluster", "ORPHAN_PAGE")).toBeUndefined();
  });

  it("rejects oversize content", () => {
    const root = tmpRoot();
    const big = "x".repeat(ISSUE_CONTEXT_MAX_BYTES + 1);
    expect(() => writeIssueContext(root, "seo-cluster", "ORPHAN_PAGE", big)).toThrow(/exceed/);
  });

  it("rejects unknown catalog codes", () => {
    const root = tmpRoot();
    expect(() => readIssueContext(root, "seo-cluster", "NOT_A_REAL_CODE")).toThrow();
  });
});
