import { describe, expect, it } from "vitest";
import { allowedToolNames } from "../../shared/mcp-tool-catalog.js";
import type { ImageEntry } from "../../shared/schema.js";
import {
  clampListMediaPage,
  clampListMediaPageSize,
  collectAvailableTags,
  filterAndSortMedia,
} from "./list-media.js";

function entry(partial: Partial<ImageEntry> & Pick<ImageEntry, "src" | "alt">): ImageEntry {
  return partial as ImageEntry;
}

const fixtures: Record<string, ImageEntry> = {
  "hero-a": entry({
    src: "/site/images/hero-a.webp",
    alt: "Hero A",
    tags: ["hero"],
    registered_at: "2026-09-10T12:00:00.000Z",
    usage_count: 2,
    origin: "upload",
  }),
  "hero-b": entry({
    src: "/site/images/hero-b.webp",
    alt: "Hero B",
    tags: ["hero", "press"],
    registered_at: "2026-09-11T12:00:00.000Z",
    usage_count: 5,
    origin: "import",
  }),
  "ai-cat": entry({
    src: "/site/images/ai-cat.webp",
    alt: "A cat",
    tags: ["illustration"],
    origin: "ai",
    ai: {
      generated: true,
      generated_at: "2026-09-12T08:00:00.000Z",
      requested_by: { kind: "agent", id: "agent-1", name: "Media Bot" },
    },
  }),
  "crop-1": entry({
    src: "/site/images/hero-a-crop.webp",
    alt: "Crop",
    tags: ["hero"],
    parentId: "hero-a",
    registered_at: "2026-09-12T09:00:00.000Z",
  }),
  "guide-pdf": entry({
    src: "/site/images/guide.pdf",
    alt: "Guide PDF",
    tags: ["doc"],
    registered_at: "2026-09-01T00:00:00.000Z",
  }),
  "reel-mp4": entry({
    src: "/site/images/reel.mp4",
    alt: "Reel",
    tags: ["video"],
    registered_at: "2026-08-01T00:00:00.000Z",
  }),
  "legacy-no-date": entry({
    src: "/site/images/legacy.webp",
    alt: "Legacy",
    tags: ["hero"],
  }),
};

describe("clampListMediaPage / page_size", () => {
  it("clamps page and page_size", () => {
    expect(clampListMediaPage(undefined)).toBe(1);
    expect(clampListMediaPage(0)).toBe(1);
    expect(clampListMediaPage(3.9)).toBe(3);
    expect(clampListMediaPageSize(undefined)).toBe(50);
    expect(clampListMediaPageSize(999)).toBe(100);
    expect(clampListMediaPageSize(10)).toBe(10);
  });
});

describe("collectAvailableTags", () => {
  it("prefers tagDefinitions keys", () => {
    expect(
      collectAvailableTags(fixtures, {
        hero: { label: "Hero", description: "", presets: [] },
        press: { label: "Press", description: "", presets: [] },
      }),
    ).toEqual(["hero", "press"]);
  });

  it("falls back to unique entry tags", () => {
    const tags = collectAvailableTags(fixtures);
    expect(tags).toContain("hero");
    expect(tags).toContain("doc");
    expect(tags).toContain("illustration");
  });
});

describe("filterAndSortMedia", () => {
  it("hides derived by default and includes them when asked", () => {
    const hidden = filterAndSortMedia(fixtures, {});
    expect(hidden.items.map((i) => i.media_id)).not.toContain("crop-1");
    const shown = filterAndSortMedia(fixtures, { include_derived: true });
    expect(shown.items.map((i) => i.media_id)).toContain("crop-1");
  });

  it("filters by doctype", () => {
    const pdfs = filterAndSortMedia(fixtures, { doctype: "pdf" });
    expect(pdfs.items.map((i) => i.media_id)).toEqual(["guide-pdf"]);
    const videos = filterAndSortMedia(fixtures, { doctype: "video" });
    expect(videos.items.map((i) => i.media_id)).toEqual(["reel-mp4"]);
  });

  it("filters by origin (uploaded = non-AI)", () => {
    const ai = filterAndSortMedia(fixtures, { origin: "ai" });
    expect(ai.items.map((i) => i.media_id)).toEqual(["ai-cat"]);
    const uploaded = filterAndSortMedia(fixtures, { origin: "uploaded", sort: "name" });
    expect(uploaded.items.map((i) => i.media_id)).not.toContain("ai-cat");
    expect(uploaded.items.map((i) => i.media_id)).toContain("hero-b"); // import counts as uploaded
  });

  it("OR-matches tags and reports unknown tags", () => {
    const hit = filterAndSortMedia(fixtures, { tags: ["press"] });
    expect(hit.items.map((i) => i.media_id)).toEqual(["hero-b"]);
    expect(hit.unknown_tags).toEqual([]);

    const unknown = filterAndSortMedia(fixtures, { tags: ["heroo"] });
    expect(unknown.total).toBe(0);
    expect(unknown.unknown_tags).toEqual(["heroo"]);
  });

  it("searches id, alt, tags, and AI requester", () => {
    expect(filterAndSortMedia(fixtures, { q: "hero-b" }).items[0]?.media_id).toBe("hero-b");
    expect(filterAndSortMedia(fixtures, { q: "Media Bot" }).items[0]?.media_id).toBe("ai-cat");
    expect(filterAndSortMedia(fixtures, { q: "illustration" }).items[0]?.media_id).toBe("ai-cat");
  });

  it("sorts newest/oldest/name/usage with missing timestamps sinking on newest", () => {
    const newest = filterAndSortMedia(fixtures, { sort: "newest", doctype: "image" });
    expect(newest.items.map((i) => i.media_id).slice(0, 3)).toEqual([
      "ai-cat",
      "hero-b",
      "hero-a",
    ]);
    expect(newest.items.map((i) => i.media_id).at(-1)).toBe("legacy-no-date");

    const oldest = filterAndSortMedia(fixtures, { sort: "oldest", doctype: "image" });
    expect(oldest.items[0]?.media_id).toBe("legacy-no-date");

    const name = filterAndSortMedia(fixtures, { sort: "name", doctype: "image" });
    expect(name.items.map((i) => i.media_id)).toEqual([
      "ai-cat",
      "hero-a",
      "hero-b",
      "legacy-no-date",
    ]);

    const usage = filterAndSortMedia(fixtures, { sort: "usage", doctype: "image" });
    expect(usage.items[0]?.media_id).toBe("hero-b");
    expect(usage.items[1]?.media_id).toBe("hero-a");
  });

  it("paginates and returns empty page past the end", () => {
    const page1 = filterAndSortMedia(fixtures, {
      include_derived: true,
      sort: "name",
      page: 1,
      page_size: 2,
    });
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(Object.keys(fixtures).length);
    expect(page1.has_more).toBe(true);

    const past = filterAndSortMedia(fixtures, {
      include_derived: true,
      page: 99,
      page_size: 2,
    });
    expect(past.items).toEqual([]);
    expect(past.total).toBe(Object.keys(fixtures).length);
    expect(past.has_more).toBe(false);
  });

  it("returns available_tags for the whole gallery", () => {
    const result = filterAndSortMedia(
      fixtures,
      { tags: ["press"] },
      {
        hero: { label: "Hero", description: "", presets: [] },
        press: { label: "Press", description: "", presets: [] },
        unused: { label: "Unused", description: "", presets: [] },
      },
    );
    expect(result.available_tags).toEqual(["hero", "press", "unused"]);
  });
});


describe("list_media catalog gate", () => {
  it("is visible with content_view and hidden without it", () => {
    const withView = new Set(allowedToolNames([{ name: "content_view", contentTypes: "*" }]));
    expect(withView.has("list_media")).toBe(true);
    const metricsOnly = new Set(allowedToolNames([{ name: "metrics_view" }]));
    expect(metricsOnly.has("list_media")).toBe(false);
  });
});
