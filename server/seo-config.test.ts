import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readClusterPriorities,
  writeClusterPriority,
  seoConfigPath,
} from "./seo-config";

vi.mock("./sync-state", () => ({
  markFileAsModified: vi.fn(),
}));

let tempDir: string;
let contentRoot: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-config-test-"));
  contentRoot = path.join(tempDir, "site_test");
  fs.mkdirSync(contentRoot, { recursive: true });
  fs.writeFileSync(
    path.join(contentRoot, "seo-config.yml"),
    `intents:
  awareness:
    label: Learn
    description: Desc
intent_defaults: {}
focus_features: {}
`,
    "utf-8",
  );
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("seo-config cluster_priority", () => {
  it("writes and reads priority without dropping other keys", () => {
    const set = writeClusterPriority({
      hubId: "blog/hub/en",
      priority: 1,
      contentRoot,
      mark: false,
    });
    expect(set.success).toBe(true);
    expect(readClusterPriorities(contentRoot)).toEqual({ "blog/hub/en": 1 });

    const raw = fs.readFileSync(seoConfigPath(contentRoot), "utf-8");
    expect(raw).toContain("intents:");
    expect(raw).toContain("awareness:");
    expect(raw).toContain("cluster_priority:");
    expect(raw).toContain("blog/hub/en");
  });

  it("clears priority and omits empty map", () => {
    writeClusterPriority({ hubId: "blog/hub/en", priority: 2, contentRoot, mark: false });
    writeClusterPriority({ hubId: "blog/hub/en", priority: null, contentRoot, mark: false });
    expect(readClusterPriorities(contentRoot)).toEqual({});
    const raw = fs.readFileSync(seoConfigPath(contentRoot), "utf-8");
    expect(raw).not.toContain("cluster_priority:");
  });
});
