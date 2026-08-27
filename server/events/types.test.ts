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
  "content_file_written",
  "content_entry_deleted",
  "content_bulk_synced",
  "binding_propagation_started",
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
