import { describe, expect, it } from "vitest";
import {
  buildContentUpdateTimelineItems,
  CONTENT_UPDATE_WINDOW_MS,
  parseUpdatedAtMs,
} from "./buildContentUpdateTimelineItems";

describe("parseUpdatedAtMs", () => {
  it("parses ISO strings and rejects empty", () => {
    expect(parseUpdatedAtMs("2024-06-01T12:00:00.000Z")).toBe(
      Date.parse("2024-06-01T12:00:00.000Z"),
    );
    expect(parseUpdatedAtMs(null)).toBeNull();
    expect(parseUpdatedAtMs("")).toBeNull();
    expect(parseUpdatedAtMs("not-a-date")).toBeNull();
  });
});

describe("buildContentUpdateTimelineItems", () => {
  const now = Date.parse("2024-08-20T12:00:00.000Z");

  it("filters to the last 14 days and sorts by updated_at", () => {
    const items = buildContentUpdateTimelineItems(
      [
        {
          slug: "old",
          title: "Old",
          updated_at: "2024-07-01T12:00:00.000Z",
          urls: { en: "/en/old" },
        },
        {
          slug: "recent-a",
          title: "Recent A",
          updated_at: "2024-08-18T10:00:00.000Z",
          urls: { en: "/en/a" },
        },
        {
          slug: "recent-b",
          title: "Recent B",
          updated_at: "2024-08-10T10:00:00.000Z",
          urls: { en: "/en/b" },
        },
      ],
      [],
      { nowMs: now, windowMs: CONTENT_UPDATE_WINDOW_MS },
    );
    expect(items.map((i) => i.slug)).toEqual(["recent-b", "recent-a"]);
  });

  it("unions by slug with static URLs winning and newer updated_at", () => {
    const items = buildContentUpdateTimelineItems(
      [
        {
          slug: "shared",
          title: "Static Title",
          updated_at: "2024-08-15T10:00:00.000Z",
          urls: { en: "/en/static", es: "/es/static" },
        },
      ],
      [
        {
          slug: "shared",
          title: "DB Title",
          updated_at: "2024-08-19T10:00:00.000Z",
          urls: { en: "/en/db", pt: "/pt/db" },
        },
        {
          slug: "db-only",
          title: "DB Only",
          updated_at: "2024-08-16T10:00:00.000Z",
          urls: { en: "/en/db-only" },
        },
      ],
      { nowMs: now },
    );

    expect(items).toHaveLength(2);
    const shared = items.find((i) => i.slug === "shared")!;
    expect(shared.title).toBe("Static Title");
    expect(shared.updatedAtMs).toBe(Date.parse("2024-08-19T10:00:00.000Z"));
    expect(shared.urls).toEqual({
      en: "/en/static",
      es: "/es/static",
      pt: "/pt/db",
    });
    expect(items.find((i) => i.slug === "db-only")?.urls).toEqual({
      en: "/en/db-only",
    });
  });

  it("drops rows without parseable updated_at", () => {
    const items = buildContentUpdateTimelineItems(
      [{ slug: "x", title: "X", updated_at: null, urls: { en: "/x" } }],
      [{ slug: "y", title: "Y", urls: { en: "/y" } }],
      { nowMs: now },
    );
    expect(items).toEqual([]);
  });
});
