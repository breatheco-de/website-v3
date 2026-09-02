import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const rebuildSeoIndex = vi.fn();
  const patchSeoIndexAfterLiveWrite = vi.fn();
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
  return {
    rebuildSeoIndex,
    patchSeoIndexAfterLiveWrite,
    invalidateSeoIndexCache,
    loadSeoIndex,
    emitEvent,
  };
});

vi.mock("../../seo-index", () => ({
  rebuildSeoIndex: mocks.rebuildSeoIndex,
  patchSeoIndexAfterLiveWrite: mocks.patchSeoIndexAfterLiveWrite,
  invalidateSeoIndexCache: mocks.invalidateSeoIndexCache,
  loadSeoIndex: mocks.loadSeoIndex,
}));
vi.mock("../../events/event-store", () => ({ emitEvent: mocks.emitEvent }));
vi.mock("../../content-index", () => ({ contentIndex: {} }));
vi.mock("../../seo-effective-seo", () => ({
  resolveEffectiveSeo: vi.fn(() => ({})),
  localeYamlRelPath: vi.fn(() => "pages/home/en.yml"),
}));
vi.mock("../../seo-fields", () => ({
  validateSeoSave: vi.fn(() => ({
    ok: true,
    coerced: {},
    pillarLive: false,
    warnings: [],
  })),
}));
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(() => true),
    },
    existsSync: vi.fn(() => true),
  };
});

import { SeoIndexRefreshJob } from "./seo-index-refresh";

describe("SeoIndexRefreshJob", () => {
  beforeEach(() => {
    mocks.rebuildSeoIndex.mockClear();
    mocks.patchSeoIndexAfterLiveWrite.mockClear();
    mocks.invalidateSeoIndexCache.mockClear();
    mocks.emitEvent.mockClear();
  });

  it("rebuild mode rebuilds and emits seo_index_ready", async () => {
    const job = new SeoIndexRefreshJob();
    await job.run({
      site: "site_test",
      contentRoot: "/tmp/site_test",
      generation: 10,
      mode: "rebuild",
      triggeredByEventId: 10,
    });
    expect(mocks.rebuildSeoIndex).toHaveBeenCalled();
    expect(mocks.invalidateSeoIndexCache).toHaveBeenCalled();
    expect(mocks.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "seo_index_ready",
        site: "site_test",
        payload: expect.objectContaining({ generation: 10, mode: "rebuild" }),
      }),
    );
  });

  it("patch mode patches listed entry keys", async () => {
    const job = new SeoIndexRefreshJob();
    await job.run({
      site: "site_test",
      contentRoot: "/tmp/site_test",
      generation: 11,
      mode: "patch",
      entryKeys: ["page/home/en"],
    });
    expect(mocks.patchSeoIndexAfterLiveWrite).toHaveBeenCalled();
    expect(mocks.rebuildSeoIndex).not.toHaveBeenCalled();
    expect(mocks.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "seo_index_ready" }),
    );
  });
});
