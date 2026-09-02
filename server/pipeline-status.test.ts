import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import type { ContentEvent } from "./events/types";
import {
  deriveInFlight,
  derivePipelineOverallStatus,
  pairLifecycleEvents,
  parseBindingLeaseResource,
  PIPELINE_STALE_THRESHOLD_MS,
} from "./pipeline-status";

function event(partial: Partial<ContentEvent> & Pick<ContentEvent, "id" | "type">): ContentEvent {
  return {
    site: "site_test",
    resource: {},
    payload: {},
    attribution: [],
    published: true,
    created_at: Date.now(),
    ...partial,
  };
}

describe("pipeline-status", () => {
  describe("parseBindingLeaseResource", () => {
    it("parses binding lease keys", () => {
      expect(parseBindingLeaseResource("binding:bind_abc:en")).toEqual({
        groupId: "bind_abc",
        locale: "en",
      });
    });

    it("returns null for non-binding resources", () => {
      expect(parseBindingLeaseResource("other:foo")).toBeNull();
    });
  });

  describe("deriveInFlight", () => {
    it("detects index refresh when writes are ahead of applied generation", () => {
      const events = [
        event({ id: 5, type: "entry_locale_saved", resource: { contentType: "page", slug: "home", locale: "en" } }),
      ];
      const result = deriveInFlight(events, 3);
      expect(result.indexRefresh).toBe(true);
    });

    it("clears index refresh when lastApplied catches up", () => {
      const events = [
        event({ id: 8, type: "entry_locale_saved", resource: { contentType: "blog", slug: "a", locale: "en" } }),
        event({ id: 9, type: "entry_locale_saved", resource: { contentType: "blog", slug: "b", locale: "en" } }),
        event({ id: 12, type: "index_snapshot_ready", triggeredByEventIds: [8, 9], payload: { generation: 10 } }),
      ];
      const result = deriveInFlight(events, 10);
      expect(result.indexRefresh).toBe(false);
    });

    it("keeps index refresh until snapshot generation is applied", () => {
      const events = [
        event({ id: 10, type: "entry_locale_saved", resource: { contentType: "blog", slug: "a", locale: "en" } }),
        event({ id: 12, type: "index_snapshot_ready", triggeredByEventIds: [10], payload: { generation: 10 } }),
      ];
      const result = deriveInFlight(events, 7);
      expect(result.indexRefresh).toBe(true);
    });

    it("clears validation when ready event matches entry", () => {
      const events = [
        event({
          id: 10,
          type: "entry_locale_saved",
          resource: { contentType: "blog", slug: "post", locale: "en" },
          created_at: Date.now() - 2000,
        }),
        event({
          id: 11,
          type: "validation_results_ready",
          triggeredByEventId: 10,
          payload: { entryKey: "blog/post/en", skipped: true, reason: "no_matching_files" },
        }),
      ];
      const result = deriveInFlight(events, 10);
      expect(result.validations).toHaveLength(0);
    });

    it("detects pending validation without matching ready event", () => {
      const events = [
        event({
          id: 10,
          type: "entry_locale_saved",
          resource: { contentType: "blog", slug: "post", locale: "en" },
          created_at: Date.now() - 2000,
        }),
      ];
      const result = deriveInFlight(events, 10);
      expect(result.validations).toHaveLength(1);
      expect(result.validations[0]?.entryKey).toBe("blog/post/en");
    });

    it("detects seo index lag for entry_seo_changed without ready", () => {
      const events = [
        event({
          id: 15,
          type: "entry_seo_changed",
          resource: { contentType: "page", slug: "home", locale: "en" },
        }),
      ];
      const result = deriveInFlight(events, 15, 0);
      expect(result.seoIndexRefresh).toBe(true);
    });

    it("clears seo lag when seo_index_ready covers write", () => {
      const events = [
        event({
          id: 16,
          type: "entry_seo_changed",
          resource: { contentType: "page", slug: "home", locale: "en" },
        }),
        event({
          id: 17,
          type: "seo_index_ready",
          triggeredByEventId: 16,
          payload: { generation: 16 },
        }),
      ];
      const result = deriveInFlight(events, 17, 17);
      expect(result.seoIndexRefresh).toBe(false);
    });

    it("detects propagation without done event", () => {
      const events = [
        event({
          id: 20,
          type: "binding_propagation_started",
          payload: { groupId: "g1", locale: "en", holder: "user-1" },
          created_at: Date.now() - 1000,
        }),
      ];
      const result = deriveInFlight(events, 20);
      expect(result.propagations).toHaveLength(1);
      expect(result.propagations[0]?.holder).toBe("user-1");
    });

    it("clears propagation when done event exists", () => {
      const events = [
        event({
          id: 21,
          type: "binding_propagation_started",
          payload: { groupId: "g1", locale: "en", holder: "user-1" },
        }),
        event({
          id: 22,
          type: "binding_propagation_done",
          triggeredByEventId: 21,
          payload: { groupId: "g1", locale: "en" },
        }),
      ];
      const result = deriveInFlight(events, 22);
      expect(result.propagations).toHaveLength(0);
    });
  });

  describe("derivePipelineOverallStatus", () => {
    it("returns stalled when outbox is too old", () => {
      expect(
        derivePipelineOverallStatus({
          oldestUnpublishedAgeMs: PIPELINE_STALE_THRESHOLD_MS + 1,
          engineStatus: "running",
          behindBy: 0,
        }),
      ).toBe("stalled");
    });

    it("returns degraded when engine is restarting", () => {
      expect(
        derivePipelineOverallStatus({
          oldestUnpublishedAgeMs: null,
          engineStatus: "restarting",
          behindBy: 0,
        }),
      ).toBe("degraded");
    });

    it("returns ok when healthy", () => {
      expect(
        derivePipelineOverallStatus({
          oldestUnpublishedAgeMs: 500,
          engineStatus: "running",
          behindBy: 2,
        }),
      ).toBe("ok");
    });
  });

  describe("pairLifecycleEvents", () => {
    it("pairs propagation started with done", () => {
      const events = [
        event({
          id: 1,
          type: "binding_propagation_started",
          payload: { groupId: "g1", locale: "en" },
          created_at: 1000,
        }),
        event({
          id: 2,
          type: "binding_propagation_done",
          triggeredByEventId: 1,
          payload: { groupId: "g1", locale: "en" },
          created_at: 3500,
        }),
      ];
      const pairs = pairLifecycleEvents(events);
      expect(pairs).toHaveLength(1);
      expect(pairs[0]?.durationMs).toBe(2500);
    });
  });
});
