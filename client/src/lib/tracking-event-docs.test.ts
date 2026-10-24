import { describe, expect, it } from "vitest";
import { TRACKING_EVENTS } from "./tracking";
import { PUSH_DOCS, TRACKING_EVENT_DOCS, eventDoc } from "./tracking-event-docs";

describe("tracking event docs", () => {
  it("explains every tracked event and push row", () => {
    const rows = [...TRACKING_EVENTS, ...Object.keys(PUSH_DOCS)];
    for (const name of rows) {
      const doc = eventDoc(name);
      expect(doc, name).toBeDefined();
      expect(doc!.summary.trim(), name).not.toBe("");
      expect(doc!.trigger.trim(), name).not.toBe("");
      expect(doc!.fires.length, name).toBeGreaterThan(0);
      expect(doc!.source.trim(), name).not.toBe("");
    }
  });

  it("has no docs for events that are not tracked", () => {
    expect(Object.keys(TRACKING_EVENT_DOCS).sort()).toEqual([...TRACKING_EVENTS].sort());
  });
});
