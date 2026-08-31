import { describe, expect, it, beforeEach, vi } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";
import {
  _resetLinkIndexStateForTests,
  flushLinkIndexPendingSync,
  patchLinkIndexOutbound,
} from "./link-index";

vi.mock("./content-index", () => ({
  contentIndex: {
    getAlternateUrls: () => ({ en: "/en/target-page" }),
  },
}));

import { getDeleteReferrersPreview } from "./link-delete-preview";

describe("getDeleteReferrersPreview", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "delete-preview-"));
    _resetLinkIndexStateForTests();
  });

  it("returns referrers when index links to target path", () => {
    patchLinkIndexOutbound("page/source/en", ["/en/target-page"], dir);
    flushLinkIndexPendingSync(dir);

    const preview = getDeleteReferrersPreview({
      contentType: "page",
      slug: "target-page",
      locales: ["en"],
      contentRoot: dir,
      limit: 10,
    });

    expect(preview.targetUrls).toContain("/en/target-page");
    expect(preview.referrers.some((r) => r.entryKey === "page/source/en")).toBe(true);
    expect(preview.suggestions.length).toBeGreaterThan(0);
  });
});
