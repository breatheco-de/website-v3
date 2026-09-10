import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const rebuildSeoIndex = vi.fn();
  const invalidateSeoIndexCache = vi.fn();
  const loadSeoIndex = vi.fn(() => ({ entries: { "page/home/en": {} } }));
  const emitEvent = vi.fn(() => ({
    id: 99,
    type: "seo_index_ready",
    site: "site_test",
    resource: {},
    attribution: [],
    payload: {},
    published: true,
    created_at: Date.now(),
  }));
  const scanFast = vi.fn();
  const scanSlow = vi.fn();
  const ContentIndex = vi.fn(function ContentIndexMock() {
    return { scanFast, scanSlow };
  });
  const MediaGallery = vi.fn();
  const DatabaseManager = vi.fn();
  return {
    rebuildSeoIndex,
    invalidateSeoIndexCache,
    loadSeoIndex,
    emitEvent,
    scanFast,
    scanSlow,
    ContentIndex,
    MediaGallery,
    DatabaseManager,
  };
});

vi.mock("../../seo-index", () => ({
  rebuildSeoIndex: mocks.rebuildSeoIndex,
  invalidateSeoIndexCache: mocks.invalidateSeoIndexCache,
  loadSeoIndex: mocks.loadSeoIndex,
}));
vi.mock("../../events/event-store", () => ({ emitEvent: mocks.emitEvent }));
vi.mock("../../content-index", () => ({
  ContentIndex: mocks.ContentIndex,
  contentIndex: {},
}));
vi.mock("../../media-gallery", () => ({ MediaGallery: mocks.MediaGallery }));
vi.mock("../../database", () => ({ DatabaseManager: mocks.DatabaseManager }));

import { SeoIndexRefreshJob } from "./seo-index-refresh";

describe("SeoIndexRefreshJob", () => {
  beforeEach(() => {
    mocks.rebuildSeoIndex.mockClear();
    mocks.invalidateSeoIndexCache.mockClear();
    mocks.emitEvent.mockClear();
    mocks.scanFast.mockClear();
    mocks.scanSlow.mockClear();
    mocks.ContentIndex.mockClear();
    mocks.MediaGallery.mockClear();
    mocks.DatabaseManager.mockClear();
    mocks.loadSeoIndex.mockClear();
  });

  it("always full-rebuilds with a fresh ContentIndex and emits seo_index_ready", async () => {
    const job = new SeoIndexRefreshJob();
    await job.run({
      site: "site_test",
      contentRoot: "/tmp/site_test",
      generation: 10,
      mode: "rebuild",
      triggeredByEventId: 10,
    });
    expect(mocks.ContentIndex).toHaveBeenCalled();
    expect(mocks.scanFast).toHaveBeenCalled();
    expect(mocks.scanSlow).toHaveBeenCalled();
    expect(mocks.rebuildSeoIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        contentRoot: "/tmp/site_test",
        reason: "seo_index_refresh",
        ci: expect.anything(),
      }),
    );
    expect(mocks.invalidateSeoIndexCache).toHaveBeenCalled();
    expect(mocks.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "seo_index_ready",
        site: "site_test",
        payload: expect.objectContaining({ generation: 10, mode: "rebuild" }),
      }),
    );
  });

  it("treats legacy patch mode as a full rebuild", async () => {
    const job = new SeoIndexRefreshJob();
    await job.run({
      site: "site_test",
      contentRoot: "/tmp/site_test",
      generation: 11,
      mode: "patch",
      entryKeys: ["page/home/en"],
    });
    expect(mocks.rebuildSeoIndex).toHaveBeenCalled();
    expect(mocks.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "seo_index_ready",
        payload: expect.objectContaining({ mode: "rebuild" }),
      }),
    );
  });
});
