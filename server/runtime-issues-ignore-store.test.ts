import { mkdtempSync, rmSync } from "fs";
import os from "os";
import { afterEach, describe, expect, it } from "vitest";
import {
  _resetRuntimeIssuesIgnoreForTests,
  addIgnoreRules,
  isPathIgnored,
  listIgnoreRules,
  removeIgnoreRules,
} from "./runtime-issues-ignore-store";
import { BUILTIN_IGNORE_RULE_INPUTS } from "@shared/runtime-issues-ignore";

const BUILTIN_RULE_COUNT = BUILTIN_IGNORE_RULE_INPUTS.length;

describe("runtime-issues-ignore-store", () => {
  let tmp: string;

  afterEach(() => {
    _resetRuntimeIssuesIgnoreForTests();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  function root() {
    tmp = mkdtempSync(os.tmpdir() + "/runtime-issues-ignore-");
    return tmp;
  }

  it("adds a locales rule and matches both locales", () => {
    const contentRoot = root();
    addIgnoreRules(
      "site_test",
      [{ kind: "locales", locales: ["us", "es"], rest: "/gone", label: "twins" }],
      { contentRoot },
    );
    expect(isPathIgnored("site_test", "/us/gone", contentRoot)).toBe(true);
    expect(isPathIgnored("site_test", "/es/gone", contentRoot)).toBe(true);
    expect(isPathIgnored("site_test", "/us/keep", contentRoot)).toBe(false);
    expect(listIgnoreRules("site_test", contentRoot)).toHaveLength(BUILTIN_RULE_COUNT + 1);
  });

  it("removes by id", () => {
    const contentRoot = root();
    const { added } = addIgnoreRules(
      "site_test",
      [{ kind: "exact", path: "/us/old" }],
      { contentRoot },
    );
    expect(added).toHaveLength(1);
    const userRule = added[0]!;
    removeIgnoreRules("site_test", [userRule.id], contentRoot);
    expect(listIgnoreRules("site_test", contentRoot)).toHaveLength(BUILTIN_RULE_COUNT);
    expect(isPathIgnored("site_test", "/us/old", contentRoot)).toBe(false);
  });
});
