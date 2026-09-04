import { describe, expect, it } from "vitest";
import {
  formatActivityActorLine,
  formatActivityListCopy,
  formatRelatedActivityTitle,
  getActivityLayerLabel,
  getActivityReport,
  selectWriteRelatedEvents,
} from "@/components/pipeline/entryActivityCopy";

describe("formatActivityListCopy", () => {
  it("maps single parts to what-changed titles", () => {
    const copy = formatActivityListCopy({
      type: "entry_locale_saved",
      payload: { parts: ["sections"], layer: "live" },
    });
    expect(copy.title).toBe("Updated page sections");
    expect(copy.blurb).toContain("live page");
    expect(copy.title.toLowerCase()).not.toContain("claude");
  });

  it("combines multiple parts into one title and names them in the blurb", () => {
    const copy = formatActivityListCopy({
      type: "entry_locale_saved",
      payload: { parts: ["seo", "sections"] },
    });
    expect(copy.title).toBe("Updated sections and SEO");
    expect(copy.blurb).toBe("Changed sections and SEO on this page.");
    expect(copy.blurb.toLowerCase()).not.toContain("several");
  });

  it("falls back honestly when parts are missing", () => {
    expect(formatActivityListCopy({ type: "entry_locale_saved", payload: {} }).title).toBe(
      "Locale save",
    );
    expect(formatActivityListCopy({ type: "entry_common_saved" }).title).toBe("Shared entry save");
    expect(formatActivityListCopy({ type: "entry_seo_changed", payload: null }).title).toBe(
      "SEO fields update",
    );
  });

  it("uses a Note snippet in the list blurb when present", () => {
    const copy = formatActivityListCopy({
      type: "entry_locale_saved",
      payload: {
        parts: ["seo", "sections"],
        report: "Saca how-long-does-it-take-to-learn-python de Coding Bootcamp. Internals…",
      },
    });
    expect(copy.title).toBe("Updated sections and SEO");
    expect(copy.blurb).toContain("Saca how-long-does-it-take-to-learn-python");
    expect(copy.blurb.toLowerCase()).not.toContain("several");
  });

  it("truncates long Note snippets for the list", () => {
    const long = "A".repeat(200);
    const copy = formatActivityListCopy({
      type: "entry_locale_saved",
      payload: { parts: ["meta"], report: long },
    });
    expect(copy.blurb!.endsWith("…")).toBe(true);
    expect(copy.blurb!.length).toBeLessThanOrEqual(120);
  });
});

describe("getActivityReport / getActivityLayerLabel", () => {
  it("returns trimmed report or null", () => {
    expect(getActivityReport({ report: "  hello  " })).toBe("hello");
    expect(getActivityReport({ report: "   " })).toBeNull();
    expect(getActivityReport({})).toBeNull();
  });

  it("labels live and variant layers", () => {
    expect(getActivityLayerLabel({ layer: "live" })).toBe("Live version");
    expect(getActivityLayerLabel({ layer: "variant" })).toBe("Draft / variant");
    expect(getActivityLayerLabel({})).toBeNull();
  });
});

describe("formatActivityActorLine", () => {
  it("joins actor and relative time", () => {
    const now = Date.parse("2026-09-04T12:00:00Z");
    const created = now - 3 * 24 * 60 * 60 * 1000;
    const line = formatActivityActorLine(
      [{ author: "Claude", actor: { type: "mcp", client: "cursor", model: "claude" } }],
      created,
      now,
    );
    expect(line).toContain("Claude");
    expect(line).toContain("3d ago");
  });
});

describe("selectWriteRelatedEvents", () => {
  const entryKey = "page/how-long/en";
  const base = { created_at: 1_000 };

  it("keeps session notes without entryKey and same-page claims", () => {
    const selected = selectWriteRelatedEvents({
      entryKey,
      writeEventId: 99,
      events: [
        {
          id: 2,
          type: "validation_issue_claimed",
          payload: { entryKey, report: "fixing meta" },
          created_at: 2_000,
        },
        {
          id: 1,
          type: "agent_session_note",
          payload: { report: "mid run" },
          created_at: 1_500,
        },
        {
          id: 3,
          type: "validation_issue_completed",
          payload: { entryKey },
          created_at: 3_000,
        },
      ],
    });
    expect(selected.map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it("excludes other-page claims, writes, and the write itself", () => {
    const selected = selectWriteRelatedEvents({
      entryKey,
      writeEventId: 50,
      events: [
        {
          id: 50,
          type: "validation_issue_claimed",
          payload: { entryKey },
          ...base,
        },
        {
          id: 10,
          type: "content_file_written",
          payload: { entryKey },
          created_at: 500,
        },
        {
          id: 11,
          type: "validation_issue_claimed",
          payload: { entryKey: "page/other/en" },
          created_at: 600,
        },
        {
          id: 12,
          type: "seo_index_ready",
          payload: {},
          created_at: 700,
        },
        {
          id: 13,
          type: "agent_session_summarized",
          payload: { report: "done" },
          created_at: 800,
        },
      ],
    });
    expect(selected.map((e) => e.id)).toEqual([13]);
  });

  it("returns empty when nothing matches", () => {
    expect(
      selectWriteRelatedEvents({
        entryKey,
        writeEventId: 1,
        events: [
          {
            id: 2,
            type: "validation_issue_claimed",
            payload: { entryKey: "blog/x/en" },
            ...base,
          },
        ],
      }),
    ).toEqual([]);
  });

  it("caps and sorts oldest first", () => {
    const events = Array.from({ length: 12 }, (_, i) => ({
      id: 100 - i,
      type: "agent_session_note" as const,
      payload: { report: `n${i}` },
      created_at: 10_000 - i * 100,
    }));
    const selected = selectWriteRelatedEvents({
      entryKey,
      writeEventId: 999,
      events,
      cap: 3,
    });
    expect(selected).toHaveLength(3);
    expect(selected[0]!.created_at).toBeLessThan(selected[1]!.created_at);
    expect(selected[1]!.created_at).toBeLessThan(selected[2]!.created_at);
  });
});

describe("formatRelatedActivityTitle", () => {
  it("uses plain staff titles", () => {
    expect(formatRelatedActivityTitle("validation_issue_claimed")).toBe("Claimed issue");
    expect(formatRelatedActivityTitle("validation_issue_released")).toBe("Released claim");
    expect(formatRelatedActivityTitle("validation_issue_completed")).toBe("Marked fixed");
    expect(formatRelatedActivityTitle("agent_session_note")).toBe("Session note");
    expect(formatRelatedActivityTitle("agent_session_summarized")).toBe("Session summary");
    expect(formatRelatedActivityTitle("agent_session_started")).toBe("Session started");
  });
});
