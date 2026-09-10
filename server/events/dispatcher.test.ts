import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ContentEvent } from "./types";

const mocks = vi.hoisted(() => {
  const enqueueJob = vi.fn().mockResolvedValue(undefined);
  const scheduleOnSaveValidationJob = vi.fn();
  const scheduleOgCaptureFromLocaleEvent = vi.fn().mockResolvedValue(undefined);
  const scheduleRedirectsValidation = vi.fn();
  const setPendingValidationWriteId = vi.fn();
  const queueLinkIndexRemove = vi.fn();
  const markEntryDirty = vi.fn();
  const flush = vi.fn().mockResolvedValue(undefined);
  return {
    enqueueJob,
    scheduleOnSaveValidationJob,
    scheduleOgCaptureFromLocaleEvent,
    scheduleRedirectsValidation,
    setPendingValidationWriteId,
    queueLinkIndexRemove,
    markEntryDirty,
    flush,
  };
});

vi.mock("../jobs/queue", () => ({ enqueueJob: mocks.enqueueJob }));
vi.mock("../services/onSaveValidationScheduler", () => ({
  scheduleOnSaveValidationJob: mocks.scheduleOnSaveValidationJob,
}));
vi.mock("../entry-preview-lifecycle", () => ({
  scheduleOgCaptureFromLocaleEvent: mocks.scheduleOgCaptureFromLocaleEvent,
}));
vi.mock("../services/onSaveValidation", () => ({
  scheduleRedirectsValidation: mocks.scheduleRedirectsValidation,
}));
vi.mock("../pipeline-state", () => ({
  setPendingValidationWriteId: mocks.setPendingValidationWriteId,
}));
vi.mock("../link-index", () => ({
  queueLinkIndexRemove: mocks.queueLinkIndexRemove,
  entryKeysFromDeletedPaths: vi.fn(() => ["page/foo/en"]),
}));
vi.mock("../site-manager", () => ({
  getSiteContextMap: () =>
    new Map([
      [
        "site_test",
        {
          contentRootName: "site_test",
          contentRoot: "/tmp/site_test",
          validationCache: { markEntryDirty: mocks.markEntryDirty, flush: mocks.flush },
        },
      ],
    ]),
}));

import { dispatchEventForTest } from "./dispatcher";

function baseEvent(
  type: ContentEvent["type"],
  overrides: Partial<ContentEvent> = {},
): ContentEvent {
  return {
    id: 42,
    type,
    site: "site_test",
    resource: { contentType: "page", slug: "home", locale: "en", layer: "live" },
    attribution: [],
    payload: {},
    published: false,
    created_at: Date.now(),
    ...overrides,
  };
}

function jobNames(): string[] {
  return mocks.enqueueJob.mock.calls.map((c) => c[0] as string);
}

describe("event dispatcher", () => {
  beforeEach(() => {
    mocks.enqueueJob.mockClear();
    mocks.scheduleOnSaveValidationJob.mockClear();
    mocks.scheduleOgCaptureFromLocaleEvent.mockClear();
    mocks.scheduleRedirectsValidation.mockClear();
    mocks.setPendingValidationWriteId.mockClear();
    mocks.queueLinkIndexRemove.mockClear();
    mocks.markEntryDirty.mockClear();
    mocks.flush.mockClear();
  });

  it("entry_locale_saved (live) enqueues index, validation, sync flush, and OG capture", async () => {
    await dispatchEventForTest(baseEvent("entry_locale_saved"));
    expect(jobNames()).toContain("index_refresh");
    expect(jobNames()).toContain("sync_state_flush");
    expect(mocks.scheduleOnSaveValidationJob).toHaveBeenCalled();
    expect(mocks.scheduleOgCaptureFromLocaleEvent).toHaveBeenCalled();
  });

  it("entry_locale_saved (variant) skips validation and OG capture", async () => {
    await dispatchEventForTest(
      baseEvent("entry_locale_saved", {
        resource: { contentType: "page", slug: "home", locale: "en", layer: "variant" },
        payload: { layer: "variant" },
      }),
    );
    expect(jobNames()).toContain("index_refresh");
    expect(jobNames()).toContain("sync_state_flush");
    expect(mocks.scheduleOnSaveValidationJob).not.toHaveBeenCalled();
    expect(mocks.scheduleOgCaptureFromLocaleEvent).not.toHaveBeenCalled();
  });

  it("entry_locale_promoted (live) schedules OG capture", async () => {
    await dispatchEventForTest(baseEvent("entry_locale_promoted"));
    expect(mocks.scheduleOgCaptureFromLocaleEvent).toHaveBeenCalled();
  });

  it("entry_common_saved enqueues index and sync flush", async () => {
    await dispatchEventForTest(
      baseEvent("entry_common_saved", {
        resource: { contentType: "page", slug: "home" },
        payload: { layer: "common" },
      }),
    );
    expect(jobNames()).toContain("index_refresh");
    expect(jobNames()).toContain("sync_state_flush");
    expect(mocks.scheduleOnSaveValidationJob).not.toHaveBeenCalled();
  });

  it("entry_seo_changed enqueues seo_index_refresh unless synced", async () => {
    await dispatchEventForTest(baseEvent("entry_seo_changed"));
    expect(jobNames()).toContain("seo_index_refresh");
    const seoCall = mocks.enqueueJob.mock.calls.find((c) => c[0] === "seo_index_refresh");
    expect(seoCall?.[1]).toEqual(
      expect.objectContaining({ mode: "rebuild", site: "site_test" }),
    );

    mocks.enqueueJob.mockClear();
    await dispatchEventForTest(
      baseEvent("entry_seo_changed", { payload: { seoIndexSynced: true } }),
    );
    expect(jobNames()).not.toContain("seo_index_refresh");
  });

  it("site_bulk_synced enqueues index and seo rebuild without sync flush", async () => {
    await dispatchEventForTest(
      baseEvent("site_bulk_synced", {
        resource: {},
        payload: { count: 2, deletedPaths: ["pages/foo/en.yml"] },
      }),
    );
    expect(jobNames()).toContain("index_refresh");
    expect(jobNames()).toContain("seo_index_refresh");
    const seoCall = mocks.enqueueJob.mock.calls.find((c) => c[0] === "seo_index_refresh");
    expect(seoCall?.[1]).toEqual(expect.objectContaining({ mode: "rebuild" }));
    expect(seoCall?.[2]).toEqual(expect.objectContaining({ delayMs: 5000 }));
    expect(jobNames()).not.toContain("sync_state_flush");
    expect(mocks.queueLinkIndexRemove).toHaveBeenCalled();
  });

  it("entry_deleted enqueues cleanup", async () => {
    await dispatchEventForTest(
      baseEvent("entry_deleted", {
        resource: { contentType: "page", slug: "home" },
        payload: { entryKeys: ["page/home/en"] },
      }),
    );
    expect(jobNames()).toContain("index_refresh");
    expect(jobNames()).toContain("entry_delete_cleanup");
  });

  it("site_redirects_changed enqueues index and redirects validation", async () => {
    await dispatchEventForTest(
      baseEvent("site_redirects_changed", {
        resource: { path: "site_test/custom-redirects.yml" },
      }),
    );
    expect(jobNames()).toContain("index_refresh");
    expect(mocks.scheduleRedirectsValidation).toHaveBeenCalled();
  });
});
