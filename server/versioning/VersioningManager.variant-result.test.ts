import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../content-types", () => ({
  getFolder: (type: string) => {
    const map: Record<string, string> = {
      landing: "landings",
      program: "programs",
      page: "pages",
      location: "locations",
    };
    return map[type] ?? type;
  },
  getType: () => null,
}));

vi.mock("../sync-state", () => ({
  addFileModifiedListener: () => {},
  markFileAsModified: () => {},
}));

vi.mock("../gcs", () => ({
  gcs: {
    downloadText: async () => null,
    uploadText: async () => {},
  },
}));

describe("VersioningManager.getVariantContentResult", () => {
  let tmpRoot: string;
  let contentRoot: string;
  let mgr: InstanceType<typeof import("./VersioningManager").VersioningManager>;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vm-variant-"));
    contentRoot = path.join(tmpRoot, "site_test");
    fs.mkdirSync(path.join(contentRoot, "landings", "broken-landing"), { recursive: true });
    fs.writeFileSync(
      path.join(contentRoot, "landings", "broken-landing", "_common.yml"),
      "slug: broken-landing\ntitle: Broken\nlocale: en\n",
      "utf-8",
    );

    const { VersioningManager } = await import("./VersioningManager");
    mgr = new VersioningManager(contentRoot);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("returns parse_error when variant YAML is invalid", () => {
    fs.writeFileSync(
      path.join(contentRoot, "landings", "broken-landing", "draft.en.yml"),
      "meta:\n  page_title: x\nsections:\n  - type: hero\n    title: ok\n  broken_indent\n    nope: 1\n",
      "utf-8",
    );

    const result = mgr.getVariantContentResult("landing", "broken-landing", "draft", "en");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("parse_error");
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.filePath).toContain("draft.en.yml");
  });

  it("returns missing when variant file does not exist", () => {
    const result = mgr.getVariantContentResult("landing", "broken-landing", "draft", "en");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing");
  });

  it("returns ok data when variant YAML is valid", () => {
    fs.writeFileSync(
      path.join(contentRoot, "landings", "broken-landing", "draft.en.yml"),
      "meta:\n  page_title: Hello\nsections:\n  - type: hero\n    version: \"1.0\"\n    title: Hi\n",
      "utf-8",
    );
    const result = mgr.getVariantContentResult("landing", "broken-landing", "draft", "en");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.data as { meta?: { page_title?: string } }).meta?.page_title).toBe("Hello");
  });
});
