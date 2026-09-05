import { describe, expect, it } from "vitest";
import {
  entryRefFromEvent,
  formatEventHeadline,
  formatEventHeadlinePlain,
} from "@/components/pipeline/formatEventHeadline";
import type { PipelineContentEvent } from "@/components/pipeline/EventLogSummaries";

function baseEvent(overrides: Partial<PipelineContentEvent>): PipelineContentEvent {
  return {
    id: 42,
    type: "entry_locale_saved",
    resource: {},
    payload: {},
    attribution: [],
    published: true,
    created_at: Date.now(),
    ...overrides,
  };
}

describe("entryRefFromEvent", () => {
  it("parses resource fields", () => {
    expect(
      entryRefFromEvent(
        { contentType: "blog", slug: "demo-post", locale: "en" },
        {},
      ),
    ).toEqual({ contentType: "blog", slug: "demo-post", locale: "en" });
  });

  it("parses entryKey from payload", () => {
    expect(entryRefFromEvent({}, { entryKey: "page/home/en" })).toEqual({
      contentType: "page",
      slug: "home",
      locale: "en",
    });
  });
});

describe("formatEventHeadlinePlain", () => {
  it("formats locale save with agent and entry", () => {
    expect(
      formatEventHeadlinePlain(
        baseEvent({
          attribution: [{ author: "demo", actor: { type: "mcp", client: "Cursor", model: "claude-4-sonnet" } }],
          resource: { contentType: "blog", slug: "demo-post", locale: "en" },
        }),
      ),
    ).toBe("#42 Claude has updated your blog en/demo-post");
  });

  it("formats skipped validation as muted headline", () => {
    const result = formatEventHeadline(
      baseEvent({
        id: 44,
        type: "validation_results_ready",
        payload: { skipped: true },
        resource: { contentType: "page", slug: "home", locale: "en" },
      }),
    );
    expect(result.plain).toBe("#44 Validation was skipped for your page en/home");
    expect(result.muted).toBe(true);
    expect(result.technicalLabel).toBe("Validation Skipped");
  });

  it("formats index refresh after a save", () => {
    expect(
      formatEventHeadlinePlain(
        baseEvent({
          id: 41,
          type: "index_snapshot_ready",
          attribution: [{ actor: { type: "system", source: "index-refresh" } }],
          resource: { contentType: "blog", slug: "demo-post", locale: "en" },
        }),
      ),
    ).toBe("#41 The site index was refreshed after your blog en/demo-post");
  });

  it("omits activity id when includeId is false", () => {
    expect(
      formatEventHeadlinePlain(
        baseEvent({
          id: 12696,
          type: "index_snapshot_ready",
          attribution: [{ actor: { type: "system", source: "index-refresh" } }],
        }),
        { includeId: false },
      ),
    ).toBe("The site index was refreshed");
  });

  it("formats validation ready as system executor", () => {
    expect(
      formatEventHeadlinePlain(
        baseEvent({
          id: 50,
          type: "validation_results_ready",
          attribution: [{ actor: { type: "system", source: "on-save-validation" } }],
          resource: { contentType: "page", slug: "home", locale: "en" },
          payload: { skipped: false },
        }),
      ),
    ).toBe("#50 Validation finished validating your page en/home");
  });

  it("formats binding done as system executor", () => {
    expect(
      formatEventHeadlinePlain(
        baseEvent({
          id: 51,
          type: "binding_propagation_done",
          attribution: [{ actor: { type: "system", source: "binding-propagation" } }],
          resource: { groupId: "demo-footer", locale: "en" },
          payload: { updated: 3 },
        }),
      ),
    ).toBe("#51 Shared section sync synced shared section en/demo-footer to 3 pages");
  });

  it("formats bulk sync without entry", () => {
    expect(
      formatEventHeadlinePlain(
        baseEvent({
          type: "site_bulk_synced",
          payload: { count: 3 },
          attribution: [{ author: "staff.dev", actor: { type: "ui" } }],
        }),
      ),
    ).toBe("#42 staff.dev synced 3 files from GitHub");
  });
});
