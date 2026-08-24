import { describe, expect, it } from "vitest";
import {
  eventHasTypedDetails,
  eventValidationEntryRef,
  formatBindingDoneOutcome,
  formatBulkSyncPreview,
  type PipelineContentEvent,
} from "@/components/pipeline/EventLogSummaries";

function baseEvent(overrides: Partial<PipelineContentEvent>): PipelineContentEvent {
  return {
    id: 1,
    type: "content_file_written",
    resource: {},
    payload: {},
    attribution: [],
    published: true,
    created_at: Date.now(),
    ...overrides,
  };
}

describe("formatBulkSyncPreview", () => {
  it("shows first path and remainder count", () => {
    expect(
      formatBulkSyncPreview(3, [
        "site/pages/foo/en.yml",
        "site/pages/bar/en.yml",
        "site/pages/baz/en.yml",
      ]),
    ).toBe("site/pages/foo/en.yml (+2 more)");
  });

  it("handles empty file list with count only", () => {
    expect(formatBulkSyncPreview(5, [])).toBe("5 files");
  });
});

describe("formatBindingDoneOutcome", () => {
  it("summarizes updated pages", () => {
    expect(formatBindingDoneOutcome(1, 0)).toBe("Updated 1 page");
    expect(formatBindingDoneOutcome(3, 0)).toBe("Updated 3 pages");
  });

  it("includes error count when present", () => {
    expect(formatBindingDoneOutcome(2, 1)).toBe("Updated 2 pages · 1 error");
    expect(formatBindingDoneOutcome(0, 2)).toBe("Updated 0 pages · 2 errors");
  });
});

describe("eventHasTypedDetails", () => {
  it("returns true for list-heavy event types", () => {
    expect(eventHasTypedDetails(baseEvent({ type: "content_bulk_synced" }))).toBe(true);
    expect(eventHasTypedDetails(baseEvent({ type: "binding_propagation_done" }))).toBe(true);
    expect(
      eventHasTypedDetails(baseEvent({ type: "validation_issue_claimed", payload: { code: "x" } })),
    ).toBe(true);
  });

  it("requires entryKey for validation_results_ready", () => {
    expect(eventHasTypedDetails(baseEvent({ type: "validation_results_ready" }))).toBe(false);
    expect(
      eventHasTypedDetails(
        baseEvent({ type: "validation_results_ready", payload: { entryKey: "page/foo/en" } }),
      ),
    ).toBe(true);
  });

  it("returns false for raw-json-only types", () => {
    expect(eventHasTypedDetails(baseEvent({ type: "index_snapshot_ready" }))).toBe(false);
    expect(eventHasTypedDetails(baseEvent({ type: "content_file_written" }))).toBe(false);
  });
});

describe("eventValidationEntryRef", () => {
  it("returns entry key for validation results when not skipped", () => {
    expect(
      eventValidationEntryRef(
        baseEvent({
          type: "validation_results_ready",
          payload: { entryKey: "page/foo/en" },
        }),
      ),
    ).toEqual({ entryKey: "page/foo/en" });
  });

  it("returns null for skipped validation results", () => {
    expect(
      eventValidationEntryRef(
        baseEvent({
          type: "validation_results_ready",
          payload: { entryKey: "page/foo/en", skipped: true },
        }),
      ),
    ).toBeNull();
  });

  it("returns entry key and page url for validation issue events", () => {
    expect(
      eventValidationEntryRef(
        baseEvent({
          type: "validation_issue_claimed",
          payload: { entryKey: "page/foo/en", url: "/en/page/foo" },
        }),
      ),
    ).toEqual({ entryKey: "page/foo/en", pageUrl: "/en/page/foo" });
  });

  it("returns null for unrelated event types", () => {
    expect(eventValidationEntryRef(baseEvent({ type: "content_bulk_synced" }))).toBeNull();
  });
});
