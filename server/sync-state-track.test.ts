import { describe, expect, it } from "vitest";
import { shouldTrackFile } from "./sync-state";

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
});
