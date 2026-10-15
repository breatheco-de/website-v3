import { beforeEach, describe, expect, it, vi } from "vitest";

const { enqueueJob, listStoredHtmlCacheKeys } = vi.hoisted(() => ({
  enqueueJob: vi.fn(async () => ({ queued: true })),
  listStoredHtmlCacheKeys: vi.fn(() => [
    "dev::site_a::/en/home::live",
    "dev::site_b::/en/home::live",
  ]),
}));

vi.mock("./jobs/queue", () => ({ enqueueJob }));
vi.mock("./html-page-cache", () => ({
  listStoredHtmlCacheKeys,
  parseHtmlCacheKey: (key: string) => {
    const parts = key.split("::");
    return { siteId: parts[1], pathname: parts[2], variantKey: parts[3] };
  },
  buildHtmlCacheKey: (siteId: string, pathname: string, variantKey = "live") =>
    `dev::${siteId}::${pathname}::${variantKey}`,
  bumpHtmlGeneration: () => 2,
  getHtmlBuildId: () => "dev",
  noteHtmlRebuildPending: vi.fn(),
  invalidateHtmlPageCacheKey: vi.fn(),
  invalidateHtmlPageCache: vi.fn(),
  snapshotHotHtmlPages: () => [],
}));

import { scheduleHotHtmlRebuild, scheduleStoredHtmlPaths } from "./html-rebuild";

describe("scheduleHotHtmlRebuild", () => {
  beforeEach(() => {
    enqueueJob.mockClear();
  });

  it("rebuilds only the named site and uses that site's folder", async () => {
    scheduleHotHtmlRebuild("theme", { siteIds: ["site_a"], queue: "html_rebuild_bulk" });
    await vi.waitFor(() => expect(enqueueJob).toHaveBeenCalledTimes(1));
    expect(enqueueJob).toHaveBeenCalledWith(
      "html_page_rebuild",
      expect.objectContaining({
        siteId: "site_a",
        pathname: "/en/home",
        contentRoot: expect.stringMatching(/site_a$/),
      }),
      expect.objectContaining({ queue: "html_rebuild_bulk" }),
    );
  });

  it("enqueues a stored menu path and skips a path that is not stored", async () => {
    scheduleStoredHtmlPaths("site_a", ["/en/home", "/es/missing"], "/tmp/site_a");
    await vi.waitFor(() => expect(enqueueJob).toHaveBeenCalledTimes(1));
    expect(enqueueJob).toHaveBeenCalledWith(
      "html_page_rebuild",
      expect.objectContaining({ siteId: "site_a", pathname: "/en/home" }),
      expect.objectContaining({ queue: "html_rebuild" }),
    );
  });
});
