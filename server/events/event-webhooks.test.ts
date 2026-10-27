import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  buildWebhookBody,
  claimHookBuffer,
  clearHookBuffer,
  clampMaxEventsPerCall,
  computeDroppedBuffersOnSave,
  EVENT_WEBHOOK_DEBOUNCE_DEFAULT_MS,
  EVENT_WEBHOOK_MAX_WAIT_DEFAULT_MS,
  eventWebhookFilters,
  flushDueBuffersForSite,
  flushHookIfDue,
  getHookBuffer,
  getProposalForWebhookFilter,
  matchProposalFilter,
  isHookDue,
  listEnabledHooksForType,
  loadEventWebhookConfig,
  matchFilterString,
  maybeEnqueueEventWebhook,
  filterKeysForEventType,
  parseEventWebhookConfig,
  recordDelivery,
  listDeliveries,
  previewDeliveryPayload,
  restoreClaimedBuffer,
  saveEventWebhookConfig,
  setHookBuffer,
  slimEventForWebhook,
  stopEventWebhookDueScanForTests,
  type EventWebhookConfig,
  type EventWebhookHook,
  type EventWebhookProposalSummary,
} from "./event-webhooks";
import { emitEvent } from "./event-store";
import { ensurePipelineDb, resetPipelineDbCache } from "../pipeline-db/runner";
import { clearSiteSqliteCacheForTests, getSiteSqlite } from "../db";
import { buildServerPageTracking } from "../tracking-page-context";
import { getSiteConfigs } from "../site-config";
import type { ContentEvent } from "./types";

const TEST_SITE = `site_event-webhooks-test-${Date.now()}`;

vi.mock("../jobs/queue", () => ({
  enqueueJob: vi.fn(async () => ({ queued: true })),
}));

vi.mock("../tracking-page-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tracking-page-context")>();
  return {
    ...actual,
    buildServerPageTracking: vi.fn(() => null),
  };
});

vi.mock("../site-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../site-config")>();
  return {
    ...actual,
    getSiteConfigs: vi.fn(() => actual.getSiteConfigs()),
  };
});

function rmSite() {
  const dir = path.join("data", TEST_SITE.replace(/\//g, "-"));
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function hook(partial: Partial<EventWebhookHook> & { id: string; url: string }): EventWebhookHook {
  return {
    enabled: true,
    method: "POST",
    debounce_ms: EVENT_WEBHOOK_DEBOUNCE_DEFAULT_MS,
    max_wait_ms: EVENT_WEBHOOK_MAX_WAIT_DEFAULT_MS,
    max_events_per_call: 50,
    ...partial,
  };
}

function insertProposal(opts: {
  id: string;
  kind?: string;
  proposer_username: string;
  proposer_actor?: Record<string, unknown>;
  entries?: Array<{ entry_key: string; locale: string }>;
  idea_funnel?: unknown;
}) {
  const now = Date.now();
  const db = getSiteSqlite(TEST_SITE);
  db.prepare(
    `INSERT INTO content_proposals (
      id, site, fingerprint, status, kind, category, title, summary,
      documentation_json, related_issue_ids_json, proposer_username, proposer_actor_json,
      created_at, updated_at, tags_json, search_text, idea_funnel_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    opts.id,
    TEST_SITE,
    "fp",
    "open",
    opts.kind ?? "edits",
    "content.field",
    "T",
    "S".repeat(80),
    "{}",
    "[]",
    opts.proposer_username,
    JSON.stringify(opts.proposer_actor ?? {}),
    now,
    now,
    "[]",
    "",
    opts.idea_funnel === undefined ? null : JSON.stringify(opts.idea_funnel),
  );
  for (const e of opts.entries ?? []) {
    db.prepare(
      `INSERT INTO content_proposal_entries (
        proposal_id, entry_key, locale, status, ops_json, baseline_context_json
      ) VALUES (?,?,?,?,?,?)`,
    ).run(opts.id, e.entry_key, e.locale, "pending", "[]", "{}");
  }
}

function baseEvent(partial: Partial<ContentEvent> = {}): ContentEvent {
  return {
    id: 1,
    type: "proposal_finished",
    site: TEST_SITE,
    resource: {},
    attribution: [],
    payload: { proposal_id: "p1" },
    published: true,
    created_at: Date.now(),
    ...partial,
  } as ContentEvent;
}

describe("event-webhooks", () => {
  let tmpRoot: string;

  beforeEach(() => {
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    rmSite();
    ensurePipelineDb(TEST_SITE, { skipBackup: true });
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "event-webhooks-"));
    stopEventWebhookDueScanForTests();
  });

  afterEach(async () => {
    stopEventWebhookDueScanForTests();
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    rmSite();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    vi.clearAllMocks();
    const siteActual = await vi.importActual<typeof import("../site-config")>("../site-config");
    vi.mocked(getSiteConfigs).mockReset();
    vi.mocked(getSiteConfigs).mockImplementation(() => siteActual.getSiteConfigs());
    vi.mocked(buildServerPageTracking).mockReset();
    vi.mocked(buildServerPageTracking).mockImplementation(() => null);
  });

  it("parses multi-hook yaml and rejects unknown types / duplicate ids", () => {
    const cfg = parseEventWebhookConfig({
      version: 1,
      subscriptions: {
        proposal_created: [
          { id: "a", enabled: true, url: "https://example.com/a", events_per_call: 2 },
          { id: "b", enabled: false, url: "https://example.com/b", events_per_call: 1 },
        ],
      },
    });
    expect(cfg.subscriptions.proposal_created).toHaveLength(2);
    expect(listEnabledHooksForType(cfg, "proposal_created")).toHaveLength(1);
    expect(cfg.subscriptions.proposal_created?.[0]?.max_events_per_call).toBe(2);
    expect(cfg.subscriptions.proposal_created?.[0]?.debounce_ms).toBe(
      EVENT_WEBHOOK_DEBOUNCE_DEFAULT_MS,
    );
    expect(cfg.subscriptions.proposal_created?.[0]?.max_wait_ms).toBe(
      EVENT_WEBHOOK_MAX_WAIT_DEFAULT_MS,
    );

    expect(() =>
      parseEventWebhookConfig({
        version: 1,
        subscriptions: { entry_deleted: [{ id: "x", enabled: true, url: "https://x.com" }] },
      }),
    ).toThrow(/disallowed/);

    expect(() =>
      parseEventWebhookConfig({
        version: 1,
        subscriptions: {
          proposal_created: [
            { id: "a", enabled: true, url: "https://example.com/a" },
            { id: "a", enabled: true, url: "https://example.com/b" },
          ],
        },
      }),
    ).toThrow(/Duplicate/);
  });

  it("clamps max_events_per_call to 1..50", () => {
    expect(clampMaxEventsPerCall(0)).toBe(1);
    expect(clampMaxEventsPerCall(100)).toBe(50);
    expect(clampMaxEventsPerCall(5)).toBe(5);
  });

  it("rejects max_wait shorter than debounce when both positive", () => {
    expect(() =>
      parseEventWebhookConfig({
        version: 1,
        subscriptions: {
          proposal_created: [
            {
              id: "bad",
              enabled: true,
              url: "https://example.com/a",
              debounce_ms: 60_000,
              max_wait_ms: 10_000,
            },
          ],
        },
      }),
    ).toThrow(/max wait must be greater than or equal/i);
  });

  it("round-trips YAML save/load with new throttle keys (drops events_per_call)", () => {
    const config: EventWebhookConfig = {
      version: 1,
      subscriptions: {
        proposal_created: [
          hook({
            id: "slack",
            url: "https://hooks.example.com/x",
            max_events_per_call: 3,
            debounce_ms: 5_000,
            max_wait_ms: 15_000,
          }),
        ],
      },
    };
    saveEventWebhookConfig(tmpRoot, config);
    const loaded = loadEventWebhookConfig(tmpRoot);
    expect(loaded.subscriptions.proposal_created?.[0]?.id).toBe("slack");
    expect(loaded.subscriptions.proposal_created?.[0]?.max_events_per_call).toBe(3);
    expect(loaded.subscriptions.proposal_created?.[0]?.debounce_ms).toBe(5_000);
    expect(loaded.subscriptions.proposal_created?.[0]?.max_wait_ms).toBe(15_000);
    const yamlText = fs.readFileSync(path.join(tmpRoot, "event-webhooks.yml"), "utf-8");
    expect(yamlText).not.toMatch(/(^|[^_])events_per_call/);
    expect(yamlText).toMatch(/debounce_ms/);
    expect(yamlText).toMatch(/max_events_per_call/);
  });

  it("migrates events_per_call to max_events_per_call with default timing", () => {
    const cfg = parseEventWebhookConfig({
      version: 1,
      subscriptions: {
        proposal_created: [
          { id: "legacy", enabled: true, url: "https://example.com/a", events_per_call: 3 },
        ],
      },
    });
    const h = cfg.subscriptions.proposal_created?.[0];
    expect(h?.max_events_per_call).toBe(3);
    expect(h?.debounce_ms).toBe(EVENT_WEBHOOK_DEBOUNCE_DEFAULT_MS);
    expect(h?.max_wait_ms).toBe(EVENT_WEBHOOK_MAX_WAIT_DEFAULT_MS);
  });

  it("buffers until debounce then flushes; immediate 0/0 enqueues on first event", async () => {
    const { enqueueJob } = await import("../jobs/queue");
    const config: EventWebhookConfig = {
      version: 1,
      subscriptions: {
        proposal_created: [
          hook({
            id: "h1",
            url: "https://example.com/1",
            debounce_ms: 30_000,
            max_wait_ms: 60_000,
            max_events_per_call: 50,
          }),
          hook({
            id: "h2",
            url: "https://example.com/2",
            debounce_ms: 0,
            max_wait_ms: 0,
            max_events_per_call: 50,
          }),
        ],
      },
    };
    saveEventWebhookConfig(tmpRoot, config);

    const e1 = emitEvent({
      site: TEST_SITE,
      type: "proposal_created",
      payload: { proposal_id: "p1" },
    });
    maybeEnqueueEventWebhook(e1, tmpRoot);
    expect(getHookBuffer(TEST_SITE, "proposal_created", "h1").pendingCount).toBe(1);
    expect(enqueueJob).toHaveBeenCalled(); // h2 immediate

    const now = Date.now();
    setHookBuffer(TEST_SITE, "proposal_created", "h1", {
      pendingEventIds: [e1.id],
      pendingCount: 1,
      first_pending_at: now - 31_000,
      last_event_at: now - 31_000,
    });
    const flushed = await flushHookIfDue({
      site: TEST_SITE,
      eventType: "proposal_created",
      hook: hook({
        id: "h1",
        url: "https://example.com/1",
        debounce_ms: 30_000,
        max_wait_ms: 60_000,
      }),
      now,
    });
    expect(flushed).toBe(1);
    expect(getHookBuffer(TEST_SITE, "proposal_created", "h1").pendingCount).toBe(0);
  });

  it("max wait forces flush under continuous drip; size cap flushes early", async () => {
    const h = hook({
      id: "drip",
      url: "https://example.com/drip",
      debounce_ms: 60_000,
      max_wait_ms: 10_000,
      max_events_per_call: 50,
    });
    // max_wait < debounce is invalid for parse — use isHookDue directly
    const now = Date.now();
    const buf = {
      pendingEventIds: [1, 2],
      pendingCount: 2,
      first_pending_at: now - 11_000,
      last_event_at: now - 100,
    };
    expect(isHookDue(buf, h, now)).toBe(true);

    const capHook = hook({
      id: "cap",
      url: "https://example.com/cap",
      debounce_ms: 60_000,
      max_wait_ms: 120_000,
      max_events_per_call: 2,
    });
    saveEventWebhookConfig(tmpRoot, {
      version: 1,
      subscriptions: { proposal_created: [capHook] },
    });
    const { enqueueJob } = await import("../jobs/queue");
    vi.mocked(enqueueJob).mockClear();

    const e1 = emitEvent({
      site: TEST_SITE,
      type: "proposal_created",
      payload: { proposal_id: "c1" },
    });
    maybeEnqueueEventWebhook(e1, tmpRoot);
    expect(getHookBuffer(TEST_SITE, "proposal_created", "cap").pendingCount).toBe(1);

    const e2 = emitEvent({
      site: TEST_SITE,
      type: "proposal_created",
      payload: { proposal_id: "c2" },
    });
    maybeEnqueueEventWebhook(e2, tmpRoot);
    expect(getHookBuffer(TEST_SITE, "proposal_created", "cap").pendingCount).toBe(0);
    expect(enqueueJob).toHaveBeenCalled();
  });

  it("legacy buffer without timestamps is due on scan", async () => {
    const { enqueueJob } = await import("../jobs/queue");
    const h = hook({ id: "legacy", url: "https://example.com/legacy" });
    saveEventWebhookConfig(tmpRoot, {
      version: 1,
      subscriptions: { proposal_created: [h] },
    });
    setHookBuffer(TEST_SITE, "proposal_created", "legacy", {
      pendingEventIds: [42],
      pendingCount: 1,
    });
    expect(
      isHookDue(getHookBuffer(TEST_SITE, "proposal_created", "legacy"), h, Date.now()),
    ).toBe(true);
    vi.mocked(enqueueJob).mockClear();
    const n = await flushDueBuffersForSite(TEST_SITE, tmpRoot);
    expect(n).toBe(1);
    expect(enqueueJob).toHaveBeenCalled();
    expect(getHookBuffer(TEST_SITE, "proposal_created", "legacy").pendingCount).toBe(0);
  });

  it("claim-then-flush: second claim sees empty; enqueue failure restores buffer", async () => {
    const { enqueueJob } = await import("../jobs/queue");
    setHookBuffer(TEST_SITE, "proposal_created", "claim", {
      pendingEventIds: [1, 2],
      pendingCount: 2,
      first_pending_at: 1,
      last_event_at: 2,
    });
    const first = claimHookBuffer(TEST_SITE, "proposal_created", "claim");
    expect(first.eventIds).toEqual([1, 2]);
    const second = claimHookBuffer(TEST_SITE, "proposal_created", "claim");
    expect(second.eventIds).toEqual([]);

    restoreClaimedBuffer(TEST_SITE, "proposal_created", "claim", first);
    expect(getHookBuffer(TEST_SITE, "proposal_created", "claim").pendingEventIds).toEqual([1, 2]);

    const h = hook({
      id: "fail",
      url: "https://example.com/fail",
      debounce_ms: 0,
      max_wait_ms: 0,
    });
    saveEventWebhookConfig(tmpRoot, {
      version: 1,
      subscriptions: { proposal_created: [h] },
    });
    setHookBuffer(TEST_SITE, "proposal_created", "fail", {
      pendingEventIds: [9],
      pendingCount: 1,
      first_pending_at: Date.now(),
      last_event_at: Date.now(),
    });
    vi.mocked(enqueueJob).mockResolvedValueOnce({ queued: false });
    const flushed = await flushHookIfDue({
      site: TEST_SITE,
      eventType: "proposal_created",
      hook: h,
    });
    expect(flushed).toBe(0);
    expect(getHookBuffer(TEST_SITE, "proposal_created", "fail").pendingEventIds).toEqual([9]);
    const failures = listDeliveries(TEST_SITE, { status: "failure", limit: 5 });
    expect(failures.some((r) => r.hook_id === "fail")).toBe(true);
  });

  it("URL change / disable drops only that hook buffer", () => {
    setHookBuffer(TEST_SITE, "proposal_created", "keep", {
      pendingEventIds: [1, 2],
      pendingCount: 2,
      first_pending_at: 1,
      last_event_at: 2,
    });
    setHookBuffer(TEST_SITE, "proposal_created", "drop-me", {
      pendingEventIds: [3],
      pendingCount: 1,
      first_pending_at: 1,
      last_event_at: 1,
    });
    const before: EventWebhookConfig = {
      version: 1,
      subscriptions: {
        proposal_created: [
          hook({ id: "keep", url: "https://example.com/a", max_events_per_call: 5 }),
          hook({ id: "drop-me", url: "https://example.com/old", max_events_per_call: 5 }),
        ],
      },
    };
    const after: EventWebhookConfig = {
      version: 1,
      subscriptions: {
        proposal_created: [
          hook({ id: "keep", url: "https://example.com/a", max_events_per_call: 2 }),
          hook({ id: "drop-me", url: "https://example.com/new", max_events_per_call: 5 }),
        ],
      },
    };
    const dropped = computeDroppedBuffersOnSave(TEST_SITE, before, after);
    expect(dropped.some((d) => d.hookId === "drop-me" && d.dropped === 1)).toBe(true);
    expect(getHookBuffer(TEST_SITE, "proposal_created", "keep").pendingCount).toBe(2);
    expect(getHookBuffer(TEST_SITE, "proposal_created", "drop-me").pendingCount).toBe(0);
  });

  it("shortening wait on flushHookIfDue sends pending that are now due", async () => {
    const { enqueueJob } = await import("../jobs/queue");
    const now = Date.now();
    setHookBuffer(TEST_SITE, "proposal_created", "shorten", {
      pendingEventIds: [7],
      pendingCount: 1,
      first_pending_at: now - 5_000,
      last_event_at: now - 5_000,
    });
    const longHook = hook({
      id: "shorten",
      url: "https://example.com/s",
      debounce_ms: 30_000,
      max_wait_ms: 60_000,
    });
    expect(await flushHookIfDue({ site: TEST_SITE, eventType: "proposal_created", hook: longHook, now })).toBe(
      0,
    );

    const shortHook = hook({
      id: "shorten",
      url: "https://example.com/s",
      debounce_ms: 1_000,
      max_wait_ms: 5_000,
    });
    vi.mocked(enqueueJob).mockClear();
    expect(
      await flushHookIfDue({ site: TEST_SITE, eventType: "proposal_created", hook: shortHook, now }),
    ).toBe(1);
    expect(enqueueJob).toHaveBeenCalled();
  });

  it("clearHookBuffer reports dropped count", () => {
    setHookBuffer(TEST_SITE, "proposal_closed", "x", {
      pendingEventIds: [9, 10, 11],
      pendingCount: 3,
      first_pending_at: 1,
      last_event_at: 2,
    });
    expect(clearHookBuffer(TEST_SITE, "proposal_closed", "x")).toBe(3);
    expect(clearHookBuffer(TEST_SITE, "proposal_closed", "x")).toBe(0);
  });

  it("records and lists deliveries; prunes conceptually via retention window query", () => {
    const id = recordDelivery({
      site: TEST_SITE,
      eventType: "proposal_created",
      hookId: "h1",
      eventIds: [1, 2],
      url: "https://hooks.example.com/path",
      status: "failure",
      error: "could not queue",
      source: "live",
    });
    expect(id).toBeGreaterThan(0);
    const rows = listDeliveries(TEST_SITE, { limit: 10 });
    expect(rows[0]?.hook_id).toBe("h1");
    expect(rows[0]?.url_host).toBe("hooks.example.com");
    expect(rows[0]?.status).toBe("failure");
  });

  it("listDeliveries filters by hook, status, and order", () => {
    const t0 = Date.now() - 60_000;
    recordDelivery({
      site: TEST_SITE,
      eventType: "proposal_created",
      hookId: "a",
      eventIds: [1],
      url: "https://a.example.com",
      status: "success",
      httpStatus: 200,
      source: "live",
    });
    recordDelivery({
      site: TEST_SITE,
      eventType: "proposal_closed",
      hookId: "b",
      eventIds: [2],
      url: "https://b.example.com",
      status: "failure",
      source: "live",
    });
    const failures = listDeliveries(TEST_SITE, { status: "failure", limit: 20 });
    expect(failures.every((r) => r.status === "failure")).toBe(true);
    const hookB = listDeliveries(TEST_SITE, { hookId: "b", limit: 20 });
    expect(hookB).toHaveLength(1);
    expect(hookB[0]?.hook_id).toBe("b");
    const asc = listDeliveries(TEST_SITE, { order: "asc", limit: 20 });
    const desc = listDeliveries(TEST_SITE, { order: "desc", limit: 20 });
    expect(asc.map((r) => r.id)).toEqual([...desc.map((r) => r.id)].reverse());
    void t0;
  });

  it("previewDeliveryPayload rebuilds slim body or reports missing events", () => {
    const ev = emitEvent({
      site: TEST_SITE,
      type: "proposal_created",
      payload: { proposal_id: "p-preview" },
    });
    const cfg: EventWebhookConfig = {
      version: 1,
      subscriptions: {
        proposal_created: [
          hook({
            id: "preview-hook",
            url: "https://hooks.example.com/in",
            debounce_ms: 0,
            max_wait_ms: 0,
          }),
        ],
      },
    };
    saveEventWebhookConfig(tmpRoot, cfg);

    const okId = recordDelivery({
      site: TEST_SITE,
      eventType: "proposal_created",
      hookId: "preview-hook",
      eventIds: [ev.id],
      url: "https://hooks.example.com/in",
      status: "success",
      httpStatus: 200,
      source: "live",
    });
    const ok = previewDeliveryPayload(TEST_SITE, tmpRoot, okId);
    expect(ok).not.toBeNull();
    expect(ok!.warnings).toContain("recreated_not_archived");
    expect(ok!.payload).not.toBeNull();
    expect(ok!.events_found).toBe(1);
    const throttle = ok!.payload!.throttle as Record<string, unknown>;
    expect(throttle.debounce_ms).toBe(0);
    expect(throttle.max_wait_ms).toBe(0);
    const events = ok!.payload!.events as Array<{ payload?: { proposal_id?: string } }>;
    expect(events[0]?.payload?.proposal_id).toBe("p-preview");

    const missId = recordDelivery({
      site: TEST_SITE,
      eventType: "proposal_created",
      hookId: "preview-hook",
      eventIds: [999_999_999],
      url: "https://hooks.example.com/in",
      status: "failure",
      source: "live",
    });
    const miss = previewDeliveryPayload(TEST_SITE, tmpRoot, missId);
    expect(miss!.payload).toBeNull();
    expect(miss!.warnings).toContain("events_missing");
  });

  it("slimEventForWebhook keeps proposal_id only in payload", () => {
    const event = {
      id: 12,
      type: "proposal_created",
      site: TEST_SITE,
      resource: {},
      attribution: [],
      payload: { proposal_id: "abc", huge: "nope" },
      published: true,
      created_at: Date.now(),
    } as ContentEvent;
    const slim = slimEventForWebhook(event);
    expect(slim.payload).toEqual({ proposal_id: "abc" });
  });

  it("parses filter and rejects unknown keys / invalid kinds", () => {
    const cfg = parseEventWebhookConfig({
      version: 1,
      subscriptions: {
        proposal_finished: [
          {
            id: "f1",
            enabled: true,
            url: "https://example.com/f",
            filter: {
              proposal_authors: ["Alice", "alice"],
              proposal_models: ["grok*"],
              kinds: ["edits"],
            },
          },
        ],
      },
    });
    const f = cfg.subscriptions.proposal_finished?.[0]?.filter;
    expect(f?.proposal_authors).toEqual(["Alice"]);
    expect(f?.proposal_models).toEqual(["grok*"]);
    expect(f?.kinds).toEqual(["edits"]);

    expect(() =>
      parseEventWebhookConfig({
        version: 1,
        subscriptions: {
          proposal_finished: [
            {
              id: "bad",
              enabled: true,
              url: "https://example.com/f",
              filter: { not_a_real_key: ["x"] },
            },
          ],
        },
      }),
    ).toThrow(/unknown filter key/);

    expect(() =>
      parseEventWebhookConfig({
        version: 1,
        subscriptions: {
          proposal_finished: [
            {
              id: "bad2",
              enabled: true,
              url: "https://example.com/f",
              filter: { kinds: ["nope"] },
            },
          ],
        },
      }),
    ).toThrow(/invalid value/);
  });

  it("matchFilterString supports exact and prefix *", () => {
    expect(matchFilterString("grok-4", ["grok*"])).toBe(true);
    expect(matchFilterString("grok-4", ["grok"])).toBe(false);
    expect(matchFilterString("Grok", ["grok"])).toBe(true);
  });

  it("matchProposalFilter ANDs fields; empty filter matches; excludes work", () => {
    const proposal: EventWebhookProposalSummary = {
      id: "p1",
      kind: "edits",
      proposer_username: "alesanchezr",
      proposer_actor: { type: "mcp", model: "grok-4" },
      content_types: ["landing", "blog"],
      locales: ["en", "es"],
      funnel: null,
    };
    const event = baseEvent({
      attribution: [{ author: "reviewer", actor: { type: "ui" } }],
    });

    expect(
      matchProposalFilter(
        event,
        hook({ id: "any", url: "https://x.com" }),
        proposal,
        true,
      ).ok,
    ).toBe(true);

    expect(
      matchProposalFilter(
        event,
        hook({
          id: "ok",
          url: "https://x.com",
          filter: {
            proposal_authors: ["alesanchezr"],
            proposal_models: ["grok*"],
            kinds: ["edits"],
            content_types: ["blog"],
            locales: ["es"],
          },
        }),
        proposal,
        true,
      ).ok,
    ).toBe(true);

    expect(
      matchProposalFilter(
        event,
        hook({
          id: "and-fail",
          url: "https://x.com",
          filter: { proposal_authors: ["alesanchezr"], kinds: ["idea"] },
        }),
        proposal,
        true,
      ),
    ).toEqual({ ok: false, reason: "no_match" });

    expect(
      matchProposalFilter(
        event,
        hook({
          id: "ex",
          url: "https://x.com",
          filter: { exclude_content_types: ["landing"] },
        }),
        proposal,
        true,
      ),
    ).toEqual({ ok: false, reason: "no_match" });

    expect(
      matchProposalFilter(
        event,
        hook({
          id: "model-miss",
          url: "https://x.com",
          filter: { proposal_models: ["claude*"] },
        }),
        { ...proposal, proposer_actor: { type: "mcp" } },
        true,
      ),
    ).toEqual({ ok: false, reason: "no_match" });
  });

  it("missing proposal with proposal filter → skipped delivery; event-only still matches", async () => {
    const { enqueueJob } = await import("../jobs/queue");
    vi.mocked(enqueueJob).mockClear();

    saveEventWebhookConfig(tmpRoot, {
      version: 1,
      subscriptions: {
        proposal_finished: [
          hook({
            id: "need-prop",
            url: "https://example.com/a",
            debounce_ms: 0,
            max_wait_ms: 0,
            filter: { proposal_authors: ["alesanchezr"] },
          }),
          hook({
            id: "event-only",
            url: "https://example.com/b",
            debounce_ms: 0,
            max_wait_ms: 0,
            filter: { event_authors: ["reviewer"] },
          }),
        ],
      },
    });

    const e = emitEvent({
      site: TEST_SITE,
      type: "proposal_finished",
      attribution: [{ author: "reviewer", actor: { type: "ui" } }],
      payload: { proposal_id: "missing-proposal" },
    });
    maybeEnqueueEventWebhook(e, tmpRoot);

    expect(getHookBuffer(TEST_SITE, "proposal_finished", "need-prop").pendingCount).toBe(0);
    const skipped = listDeliveries(TEST_SITE, { status: "skipped", hookId: "need-prop" });
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.error).toBe("proposal_unresolved");

    expect(getHookBuffer(TEST_SITE, "proposal_finished", "event-only").pendingCount).toBe(0);
    expect(enqueueJob).toHaveBeenCalled();
  });

  it("filters by proposal author+model and does not buffer non-matches", () => {
    insertProposal({
      id: "p-match",
      proposer_username: "alesanchezr",
      proposer_actor: { type: "mcp", model: "grok-4" },
      entries: [{ entry_key: "landing/home", locale: "en" }],
    });
    insertProposal({
      id: "p-other",
      proposer_username: "other",
      proposer_actor: { type: "mcp", model: "claude-3" },
      entries: [{ entry_key: "blog/x", locale: "es" }],
    });

    saveEventWebhookConfig(tmpRoot, {
      version: 1,
      subscriptions: {
        proposal_finished: [
          hook({
            id: "swarm",
            url: "https://example.com/swarm",
            debounce_ms: 30_000,
            max_wait_ms: 60_000,
            filter: {
              proposal_authors: ["alesanchezr"],
              proposal_models: ["grok*"],
            },
          }),
        ],
      },
    });

    const matchEv = emitEvent({
      site: TEST_SITE,
      type: "proposal_finished",
      payload: { proposal_id: "p-match" },
    });
    maybeEnqueueEventWebhook(matchEv, tmpRoot);
    expect(getHookBuffer(TEST_SITE, "proposal_finished", "swarm").pendingCount).toBe(1);

    const missEv = emitEvent({
      site: TEST_SITE,
      type: "proposal_finished",
      payload: { proposal_id: "p-other" },
    });
    maybeEnqueueEventWebhook(missEv, tmpRoot);
    expect(getHookBuffer(TEST_SITE, "proposal_finished", "swarm").pendingCount).toBe(1);
    expect(listDeliveries(TEST_SITE, { status: "skipped" })).toHaveLength(0);

    const loaded = getProposalForWebhookFilter(TEST_SITE, "p-match");
    expect(loaded?.content_types).toContain("landing");
    expect(loaded?.locales).toContain("en");
  });

  it("filter change on save drops waiting buffer", () => {
    setHookBuffer(TEST_SITE, "proposal_finished", "f", {
      pendingEventIds: [1],
      pendingCount: 1,
      first_pending_at: 1,
      last_event_at: 1,
    });
    const before: EventWebhookConfig = {
      version: 1,
      subscriptions: {
        proposal_finished: [
          hook({
            id: "f",
            url: "https://example.com/a",
            filter: { proposal_authors: ["a"] },
          }),
        ],
      },
    };
    const after: EventWebhookConfig = {
      version: 1,
      subscriptions: {
        proposal_finished: [
          hook({
            id: "f",
            url: "https://example.com/a",
            filter: { proposal_authors: ["b"] },
          }),
        ],
      },
    };
    const dropped = computeDroppedBuffersOnSave(TEST_SITE, before, after);
    expect(dropped.some((d) => d.hookId === "f" && d.dropped === 1)).toBe(true);
    expect(getHookBuffer(TEST_SITE, "proposal_finished", "f").pendingCount).toBe(0);
  });

  it("hooks without filter remain backward compatible", () => {
    saveEventWebhookConfig(tmpRoot, {
      version: 1,
      subscriptions: {
        proposal_created: [
          hook({ id: "plain", url: "https://example.com/p", debounce_ms: 0, max_wait_ms: 0 }),
        ],
      },
    });
    const e = emitEvent({
      site: TEST_SITE,
      type: "proposal_created",
      payload: { proposal_id: "anything" },
    });
    maybeEnqueueEventWebhook(e, tmpRoot);
    expect(getHookBuffer(TEST_SITE, "proposal_created", "plain").pendingCount).toBe(0);
  });

  it("listDeliveries can filter skipped status", () => {
    recordDelivery({
      site: TEST_SITE,
      eventType: "proposal_finished",
      hookId: "s",
      eventIds: [1],
      url: "https://example.com",
      status: "skipped",
      error: "proposal_unresolved",
      source: "live",
    });
    const rows = listDeliveries(TEST_SITE, { status: "skipped" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("skipped");
  });

  it("slimEventForWebhook attaches proposal summary when provided", () => {
    const event = baseEvent({ id: 99, payload: { proposal_id: "p1" } });
    const slim = slimEventForWebhook(event, {
      id: "p1",
      kind: "edits",
      proposer_username: "a",
      proposer_actor: { type: "mcp", model: "grok" },
      content_types: ["landing"],
      locales: ["en"],
      funnel: null,
    });
    expect(slim.proposal).toEqual({
      id: "p1",
      kind: "edits",
      proposer_username: "a",
      proposer_actor: { type: "mcp", model: "grok" },
      content_types: ["landing"],
      locales: ["en"],
      funnel: null,
    });
  });

  describe("funnel filters", () => {
    const ideaBase: EventWebhookProposalSummary = {
      id: "idea-1",
      kind: "idea",
      proposer_username: "writer",
      proposer_actor: { type: "mcp", model: "grok-4" },
      content_types: [],
      locales: [],
      funnel: { stage: "decision", products: ["ai-engineering"] },
    };
    const ev = baseEvent({ type: "proposal_created", payload: { proposal_id: "idea-1" } });
    const match = (
      filter: EventWebhookHook["filter"],
      proposal: EventWebhookProposalSummary = ideaBase,
    ) => matchProposalFilter(ev, hook({ id: "h", url: "https://x.com", filter }), proposal, true).ok;

    it("stage include / exclude", () => {
      expect(match({ funnel_stages: ["decision"] })).toBe(true);
      expect(match({ funnel_stages: ["awareness", "consideration"] })).toBe(false);
      expect(match({ exclude_funnel_stages: ["decision"] })).toBe(false);
      expect(match({ exclude_funnel_stages: ["awareness"] })).toBe(true);
    });

    it("product include / exclude on named bindings", () => {
      expect(match({ funnel_products: ["ai-engineering"] })).toBe(true);
      expect(match({ funnel_products: ["ai-*"] })).toBe(true);
      expect(match({ funnel_products: ["full-stack"] })).toBe(false);
      expect(match({ exclude_funnel_products: ["ai-engineering"] })).toBe(false);
      expect(match({ exclude_funnel_products: ["full-stack"] })).toBe(true);
    });

    it("no funnel fails include filters (edits or idea without funnel)", () => {
      const edits = { ...ideaBase, kind: "edits", funnel: null };
      const bareIdea = { ...ideaBase, funnel: null };
      expect(match({ funnel_stages: ["decision"] }, edits)).toBe(false);
      expect(match({ funnel_products: ["ai-engineering"] }, bareIdea)).toBe(false);
      expect(match({ exclude_funnel_stages: ["decision"] }, bareIdea)).toBe(true);
    });

    it("all-products ideas match any product include; excluded only by all", () => {
      const allIdea = { ...ideaBase, funnel: { stage: "awareness" as const, products: "all" as const } };
      expect(match({ funnel_products: ["ai-engineering"] }, allIdea)).toBe(true);
      expect(match({ exclude_funnel_products: ["all"] }, allIdea)).toBe(false);
      expect(match({ exclude_funnel_products: ["ai-engineering"] }, allIdea)).toBe(true);
    });

    it("parses funnel filters and proposal_idea_funnel_set subscriptions; rejects bad stage", () => {
      const cfg = parseEventWebhookConfig({
        version: 1,
        subscriptions: {
          proposal_idea_funnel_set: [
            {
              id: "fs",
              enabled: true,
              url: "https://example.com/fs",
              filter: {
                funnel_stages: ["Decision", "decision"],
                funnel_products: ["ai-engineering"],
              },
            },
          ],
        },
      });
      const f = cfg.subscriptions.proposal_idea_funnel_set?.[0]?.filter;
      expect(f?.funnel_stages).toEqual(["decision"]);
      expect(f?.funnel_products).toEqual(["ai-engineering"]);

      expect(() =>
        parseEventWebhookConfig({
          version: 1,
          subscriptions: {
            proposal_created: [
              {
                id: "bad-stage",
                enabled: true,
                url: "https://example.com/f",
                filter: { funnel_stages: ["buy-now"] },
              },
            ],
          },
        }),
      ).toThrow(/invalid value/);
    });

    it("getProposalForWebhookFilter parses idea_funnel; slimEventForWebhook includes it", () => {
      insertProposal({
        id: "idea-funnel",
        kind: "idea",
        proposer_username: "writer",
        idea_funnel: {
          stage: "consideration",
          products: [
            { product: "ai-engineering", persona: "the-career-changer" },
            { product: "full-stack" },
          ],
        },
      });
      insertProposal({ id: "idea-bare", kind: "idea", proposer_username: "writer" });

      const loaded = getProposalForWebhookFilter(TEST_SITE, "idea-funnel");
      expect(loaded?.funnel).toEqual({
        stage: "consideration",
        products: ["ai-engineering", "full-stack"],
      });
      expect(getProposalForWebhookFilter(TEST_SITE, "idea-bare")?.funnel).toBeNull();

      const slim = slimEventForWebhook(
        baseEvent({ payload: { proposal_id: "idea-funnel" } }),
        loaded,
      );
      expect((slim.proposal as { funnel: unknown }).funnel).toEqual(loaded?.funnel);
    });
  });

  it("entry_common_saved matches the page content type and does not load a proposal", () => {
    expect(eventWebhookFilters.proposal_created).toBe(eventWebhookFilters.proposal_revised);
    expect(eventWebhookFilters.entry_common_saved).not.toBe(eventWebhookFilters.proposal_created);

    const proposal: EventWebhookProposalSummary = {
      id: "p1",
      kind: "edits",
      proposer_username: "writer",
      proposer_actor: { type: "ui" },
      content_types: ["workshop"],
      locales: ["en"],
      funnel: null,
    };
    const proposalEvent = baseEvent({
      type: "proposal_created",
      resource: { contentType: "blog" },
    });
    expect(
      matchProposalFilter(
        proposalEvent,
        hook({ id: "p", url: "https://example.com/p", filter: { content_types: ["workshop"] } }),
        proposal,
        true,
      ).ok,
    ).toBe(true);
    expect(
      matchProposalFilter(
        proposalEvent,
        hook({ id: "p", url: "https://example.com/p", filter: { content_types: ["blog"] } }),
        proposal,
        true,
      ).ok,
    ).toBe(false);

    saveEventWebhookConfig(tmpRoot, {
      version: 1,
      subscriptions: {
        entry_common_saved: [
          hook({
            id: "workshops",
            url: "https://example.com/w",
            filter: { content_types: ["Workshop"] },
          }),
        ],
      },
    });

    const hit = emitEvent({
      site: TEST_SITE,
      type: "entry_common_saved",
      resource: { contentType: "workshop", slug: "el-mapa", layer: "common" },
      payload: { parts: ["identity"], layer: "common" },
    });
    maybeEnqueueEventWebhook(hit, tmpRoot);
    expect(getHookBuffer(TEST_SITE, "entry_common_saved", "workshops").pendingEventIds).toContain(
      hit.id,
    );
    expect(listDeliveries(TEST_SITE, { status: "skipped" })).toHaveLength(0);

    const miss = emitEvent({
      site: TEST_SITE,
      type: "entry_common_saved",
      resource: { contentType: "blog", slug: "post", layer: "common" },
      payload: { parts: ["identity"], layer: "common" },
    });
    maybeEnqueueEventWebhook(miss, tmpRoot);
    expect(getHookBuffer(TEST_SITE, "entry_common_saved", "workshops").pendingEventIds).toEqual([
      hit.id,
    ]);

    expect(filterKeysForEventType("entry_common_saved")).not.toContain("locales");
    expect(filterKeysForEventType("entry_common_saved")).not.toContain("exclude_locales");
    expect(filterKeysForEventType("entry_locale_saved")).toContain("locales");
  });

  it("rejects proposal-only filter keys on entry_common_saved", () => {
    expect(() =>
      parseEventWebhookConfig({
        version: 1,
        subscriptions: {
          entry_common_saved: [
            {
              id: "bad",
              enabled: true,
              url: "https://example.com/w",
              filter: { kinds: ["idea"] },
            },
          ],
        },
      }),
    ).toThrow(/not allowed for this event/);

    expect(() =>
      parseEventWebhookConfig({
        version: 1,
        subscriptions: {
          entry_common_saved: [
            {
              id: "bad-funnel",
              enabled: true,
              url: "https://example.com/w",
              filter: { funnel_stages: ["awareness"] },
            },
          ],
        },
      }),
    ).toThrow(/not allowed for this event/);

    expect(() =>
      parseEventWebhookConfig({
        version: 1,
        subscriptions: {
          entry_common_saved: [
            {
              id: "bad-locale",
              enabled: true,
              url: "https://example.com/w",
              filter: { locales: ["en"] },
            },
          ],
        },
      }),
    ).toThrow(/not allowed for this event/);

    const cfg = parseEventWebhookConfig({
      version: 1,
      subscriptions: {
        entry_common_saved: [
          {
            id: "ok",
            enabled: true,
            url: "https://example.com/w",
            filter: { content_types: ["workshop"] },
          },
        ],
      },
    });
    expect(cfg.subscriptions.entry_common_saved?.[0]?.filter).toEqual({
      content_types: ["workshop"],
    });
  });

  it("entry_common_saved body includes tracking ids and omits tracking when it is off", () => {
    vi.mocked(getSiteConfigs).mockReturnValue([
      { domain: "test.example", contentFolder: tmpRoot },
    ]);
    const site = path.relative(process.cwd(), tmpRoot);
    const event = baseEvent({
      type: "entry_common_saved",
      site,
      resource: {
        contentType: "workshop",
        slug: "el-mapa",
        layer: "common",
        path: "workshop/el-mapa/_common.yml",
      },
      payload: { parts: ["funnel"], layer: "common" },
    });
    const h = hook({ id: "w", url: "https://example.com/w" });

    vi.mocked(buildServerPageTracking).mockReturnValue({
      product: "ai-engineering",
      persona: "the-career-changer",
      product_persona: "ai-engineering:the-career-changer",
      funnel_stage: "awareness",
      content_key: "workshop:el-mapa",
    });
    const on = buildWebhookBody({
      site,
      eventType: "entry_common_saved",
      hook: h,
      events: [event],
      source: "live",
    });
    const onItem = (on.events as Record<string, unknown>[])[0];
    expect(onItem).toMatchObject({
      id: event.id,
      type: "entry_common_saved",
      created_at: event.created_at,
      resource: event.resource,
      tracking: { product: "ai-engineering", persona: "the-career-changer" },
    });
    expect(onItem).not.toHaveProperty("payload");
    expect(buildServerPageTracking).toHaveBeenCalledWith({
      contentRoot: tmpRoot,
      contentType: "workshop",
      slug: "el-mapa",
      mode: "ids",
    });

    vi.mocked(buildServerPageTracking).mockReturnValue(null);
    const off = buildWebhookBody({
      site,
      eventType: "entry_common_saved",
      hook: h,
      events: [event],
      source: "live",
    });
    const offItem = (off.events as Record<string, unknown>[])[0];
    expect(offItem).not.toHaveProperty("tracking");
    expect(offItem.resource).toEqual(event.resource);
    expect(off.event_type).toBe("entry_common_saved");
  });

  it("entry_locale_saved body includes the active test the way a served page does", () => {
    expect(eventWebhookFilters.entry_locale_saved).toBe(eventWebhookFilters.entry_common_saved);
    vi.mocked(getSiteConfigs).mockReturnValue([
      { domain: "test.example", contentFolder: tmpRoot },
    ]);
    const site = path.relative(process.cwd(), tmpRoot);
    const dir = path.join(tmpRoot, "workshop", "el-mapa");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "versioning.yml"),
      ["en:", "  started_at: '2026-10-01'", "  variants:", "    - slug: b", "      allocation: 50", ""].join("\n"),
      "utf-8",
    );
    const h = hook({ id: "w", url: "https://example.com/w" });
    const variantEvent = baseEvent({
      type: "entry_locale_saved",
      site,
      resource: {
        contentType: "workshop",
        slug: "el-mapa",
        locale: "en",
        layer: "variant",
        path: "workshop/el-mapa/b.en.yml",
      },
      payload: {},
    });
    const variantBody = buildWebhookBody({
      site,
      eventType: "entry_locale_saved",
      hook: h,
      events: [variantEvent],
      source: "live",
    });
    expect((variantBody.events as Record<string, unknown>[])[0]).toMatchObject({
      type: "entry_locale_saved",
      experiment_id: "workshop:el-mapa:en@2026-10-01",
      variant: "b",
    });

    const liveEvent = baseEvent({
      type: "entry_locale_saved",
      site,
      resource: {
        contentType: "workshop",
        slug: "el-mapa",
        locale: "en",
        layer: "live",
        path: "workshop/el-mapa/en.yml",
      },
      payload: {},
    });
    const liveBody = buildWebhookBody({
      site,
      eventType: "entry_locale_saved",
      hook: h,
      events: [liveEvent],
      source: "live",
    });
    expect((liveBody.events as Record<string, unknown>[])[0]).toMatchObject({
      experiment_id: "workshop:el-mapa:en@2026-10-01",
      variant: "default",
    });

    fs.rmSync(path.join(dir, "versioning.yml"));
    const quiet = buildWebhookBody({
      site,
      eventType: "entry_locale_saved",
      hook: h,
      events: [variantEvent],
      source: "live",
    });
    const quietItem = (quiet.events as Record<string, unknown>[])[0];
    expect(quietItem).not.toHaveProperty("experiment_id");
    expect(quietItem).not.toHaveProperty("variant");
    expect(quietItem).not.toHaveProperty("tracking");
  });
});

describe("replaceProposalsFromSnapshot does not fire webhooks", () => {
  const SITE = `site_ew-pull-${Date.now()}`;

  beforeEach(() => {
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    const dir = path.join("data", SITE.replace(/\//g, "-"));
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    ensurePipelineDb(SITE, { skipBackup: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    const dir = path.join("data", SITE.replace(/\//g, "-"));
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("does not call enqueueJob when importing snapshot rows", async () => {
    const { enqueueJob } = await import("../jobs/queue");
    const { replaceProposalsFromSnapshot } = await import("../content-proposals/service");
    replaceProposalsFromSnapshot(SITE, [
      {
        id: "imported-1",
        site: "prod",
        fingerprint: "fp",
        status: "open",
        kind: "notes",
        category: "handoff",
        title: "Imported",
        summary: "S".repeat(80),
        rationale: null,
        documentation: {},
        related_issue_ids: [],
        proposer_username: "alice",
        proposer_actor: {},
        created_at: Date.now(),
        updated_at: Date.now(),
        claim: null,
        tags: [],
        search_text: "imported",
        created_agent_session_id: null,
        promote_on_apply: false,
        no_auto_retry: true,
        close_reason: null,
        close_note: null,
        closed_by: null,
        closed_at: null,
        related_entries: [],
        review_context_snapshot: null,
        supersedes_proposal_id: null,
        replaced_by_proposal_id: null,
        escalated: false,
        escalated_at: null,
        escalated_by: null,
        escalated_note: null,
        decision_debug: null,
        review_situations: [],
        entries: [],
        blockers: [],
      } as any,
    ]);
    expect(enqueueJob).not.toHaveBeenCalled();
  });
});
