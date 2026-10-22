import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { markFileAsModified } = vi.hoisted(() => ({ markFileAsModified: vi.fn() }));

vi.mock("../content-types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../content-types")>()),
  getFolder: (type: string) => (type === "landing" ? "landings" : type),
  getType: () => null,
}));
vi.mock("../sync-state", () => ({
  addFileModifiedListener: () => {},
  markFileAsModified,
}));
vi.mock("../gcs", () => ({ gcs: { downloadText: async () => null, uploadText: async () => {} } }));

describe("VersioningManager.updateVersioning author", () => {
  let tmpRoot: string;
  let contentRoot: string;
  let mgr: InstanceType<typeof import("./VersioningManager").VersioningManager>;

  beforeEach(async () => {
    markFileAsModified.mockClear();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vm-author-"));
    contentRoot = path.join(tmpRoot, "site_test");
    fs.mkdirSync(path.join(contentRoot, "landings", "promo"), { recursive: true });
    const { VersioningManager } = await import("./VersioningManager");
    mgr = new VersioningManager(contentRoot);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const data = { en: { variants: [{ slug: "draft", allocation: 0 }] } };

  it("queues versioning.yml under the person who made the change, for that site", () => {
    mgr.updateVersioning("landing", "promo", data, { author: "alice", contentRoot });

    const configPath = path.join(contentRoot, "landings", "promo", "versioning.yml");
    expect(fs.existsSync(configPath)).toBe(true);
    expect(markFileAsModified).toHaveBeenCalledWith(configPath, "alice", undefined, contentRoot);
  });

  it("falls back to the service author and the manager's own site", () => {
    mgr.updateVersioning("landing", "promo", data);

    expect(markFileAsModified).toHaveBeenCalledWith(
      path.join(contentRoot, "landings", "promo", "versioning.yml"),
      "System",
      undefined,
      contentRoot,
    );
  });
});
