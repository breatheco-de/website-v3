import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import {
  getHookBuffer,
  resolveContentRootForSite,
  saveEventWebhookConfig,
  stopEventWebhookDueScanForTests,
} from "./event-webhooks";
import { emitEvent } from "./event-store";
import { ensurePipelineDb, resetPipelineDbCache } from "../pipeline-db/runner";
import { clearSiteSqliteCacheForTests } from "../db";

const TEST_SITE = `site_event-webhooks-emit-test-${Date.now()}`;
const contentRoot = path.join(process.cwd(), TEST_SITE);

vi.mock("../jobs/queue", () => ({
  enqueueJob: vi.fn(async () => ({ queued: true })),
}));

vi.mock("../site-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../site-config")>();
  return {
    ...actual,
    getSiteConfigs: () => [{ domain: "emit-test.local", contentFolder: TEST_SITE }],
  };
});

function rmSite() {
  const dataDir = path.join("data", TEST_SITE);
  if (fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  if (fs.existsSync(contentRoot)) fs.rmSync(contentRoot, { recursive: true, force: true });
}

describe("event-webhooks emit fan-out", () => {
  beforeEach(() => {
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    rmSite();
    ensurePipelineDb(TEST_SITE, { skipBackup: true });
    fs.mkdirSync(contentRoot, { recursive: true });
    stopEventWebhookDueScanForTests();
  });

  afterEach(() => {
    stopEventWebhookDueScanForTests();
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    rmSite();
    vi.clearAllMocks();
  });

  it("resolves the content root from sites config by content folder name", () => {
    expect(resolveContentRootForSite(TEST_SITE)).toBe(contentRoot);
    expect(resolveContentRootForSite("site_does-not-exist")).toBeNull();
  });

  it("emitEvent buffers the event on a subscribed hook without a manual enqueue", async () => {
    saveEventWebhookConfig(contentRoot, {
      version: 1,
      subscriptions: {
        proposal_created: [
          {
            id: "reviewer",
            enabled: true,
            method: "POST",
            url: "https://example.com/hook",
            debounce_ms: 30_000,
            max_wait_ms: 60_000,
            max_events_per_call: 50,
          },
        ],
      },
    });

    const ev = emitEvent({
      site: TEST_SITE,
      type: "proposal_created",
      payload: { proposal_id: "p-emit" },
    });

    await vi.waitFor(() => {
      expect(getHookBuffer(TEST_SITE, "proposal_created", "reviewer").pendingEventIds).toEqual([
        ev.id,
      ]);
    });
  });

  it("buffers blocker events but skips ones from a paused proposal", async () => {
    saveEventWebhookConfig(contentRoot, {
      version: 1,
      subscriptions: {
        proposal_blocker_added: [
          {
            id: "writer",
            enabled: true,
            method: "POST",
            url: "https://example.com/hook",
            debounce_ms: 30_000,
            max_wait_ms: 60_000,
            max_events_per_call: 50,
          },
        ],
      },
    });

    emitEvent({
      site: TEST_SITE,
      type: "proposal_blocker_added",
      payload: { proposal_id: "p-paused", blocker_id: 1, staff_summary: "Fix it", paused: true },
    });
    const live = emitEvent({
      site: TEST_SITE,
      type: "proposal_blocker_added",
      payload: { proposal_id: "p-live", blocker_id: 2, staff_summary: "Fix it" },
    });

    await vi.waitFor(() => {
      expect(getHookBuffer(TEST_SITE, "proposal_blocker_added", "writer").pendingEventIds).toEqual([
        live.id,
      ]);
    });
  });
});
