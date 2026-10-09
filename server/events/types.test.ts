import { describe, it, expect } from "vitest";
import {
  EVENT_TYPES,
  EVENT_TYPE_META,
  OUTBOX_DISPATCHABLE_EVENT_TYPES,
  INDEX_WRITE_EVENT_TYPES,
  isOutboxDispatchable,
} from "./types";

/** Dispatch types handled in server/events/dispatcher.ts switch. */
const DISPATCHER_HANDLED_TYPES = new Set([
  "entry_locale_saved",
  "entry_locale_promoted",
  "entry_common_saved",
  "registry_file_saved",
  "entry_redirects_changed",
  "entry_seo_changed",
  "site_redirects_changed",
  "site_bulk_synced",
  "entry_deleted",
  "entry_locale_unpublished",
  "theme_changed",
  "variables_changed",
  "menu_changed",
  "tag_manager_changed",
  "database_row_changed",
  "database_refreshed",
  "shared_template_saved",
  "binding_propagation_started",
  "cluster_hub_path_rewrite_started",
]);

describe("EVENT_TYPE_META", () => {
  it("defines meta for every event type", () => {
    for (const type of EVENT_TYPES) {
      expect(EVENT_TYPE_META[type]).toBeDefined();
      expect(["dispatch", "audit"]).toContain(EVENT_TYPE_META[type].outbox);
    }
  });

  it("OUTBOX_DISPATCHABLE matches dispatcher switch cases", () => {
    expect(new Set(OUTBOX_DISPATCHABLE_EVENT_TYPES)).toEqual(DISPATCHER_HANDLED_TYPES);
    for (const type of OUTBOX_DISPATCHABLE_EVENT_TYPES) {
      expect(isOutboxDispatchable(type)).toBe(true);
      expect(EVENT_TYPE_META[type].outbox).toBe("dispatch");
    }
  });

  it("INDEX_WRITE_EVENT_TYPES matches affectsWriteGeneration flag", () => {
    const expected = EVENT_TYPES.filter((t) => EVENT_TYPE_META[t].affectsWriteGeneration);
    expect([...INDEX_WRITE_EVENT_TYPES].sort()).toEqual([...expected].sort());
  });

  it("audit types are not dispatchable", () => {
    for (const type of EVENT_TYPES) {
      if (EVENT_TYPE_META[type].outbox === "audit") {
        expect(isOutboxDispatchable(type)).toBe(false);
        expect(OUTBOX_DISPATCHABLE_EVENT_TYPES).not.toContain(type);
      }
    }
  });
});
