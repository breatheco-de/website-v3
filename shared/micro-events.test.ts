import { describe, expect, it } from "vitest";
import {
  parseMicroEventsExport,
  resolveMicroEventsForVariant,
  resolveMicroTabState,
  sanitizeMicroEventRows,
} from "./micro-events";

describe("sanitizeMicroEventRows", () => {
  it("keeps valid Micro rows", () => {
    expect(
      sanitizeMicroEventRows([
        { event: "cta_click", source: "section-tracking", label: "Clicks" },
        { event: "video_complete", source: "universal-video" },
      ]),
    ).toEqual([
      { event: "cta_click", source: "section-tracking", label: "Clicks" },
      { event: "video_complete", source: "universal-video" },
    ]);
  });

  it("drops forbidden and malformed rows", () => {
    expect(
      sanitizeMicroEventRows([
        { event: "add_to_cart", source: "track" },
        { event: "cta_click", source: "nope" },
        { event: "scroll_depth", source: "section-tracking" },
        null,
      ]),
    ).toEqual([]);
  });
});

describe("resolveMicroEventsForVariant", () => {
  const map = {
    "*": [{ event: "cta_click" as const, source: "section-tracking" as const }],
    drag_and_drop: [
      { event: "video_start" as const, source: "universal-video" as const },
      { event: "video_complete" as const, source: "universal-video" as const },
    ],
  };

  it("prefers the variant key over *", () => {
    expect(resolveMicroEventsForVariant(map, "drag_and_drop").map((r) => r.event)).toEqual([
      "video_start",
      "video_complete",
    ]);
  });

  it("falls back to *", () => {
    expect(resolveMicroEventsForVariant(map, "default")).toEqual(map["*"]);
  });
});

describe("parseMicroEventsExport", () => {
  it("accepts a valid map", () => {
    const r = parseMicroEventsExport({
      "*": [{ event: "cta_click", source: "section-tracking" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows).toHaveLength(1);
  });

  it("errors when only forbidden events are listed", () => {
    const r = parseMicroEventsExport({
      "*": [{ event: "add_to_cart", source: "track" }],
    });
    expect(r.ok).toBe(false);
  });
});

describe("resolveMicroTabState", () => {
  const ctaMap = {
    "*": [{ event: "cta_click" as const, source: "section-tracking" as const }],
  };
  const videoMap = {
    "*": [
      { event: "video_start" as const, source: "universal-video" as const },
      { event: "video_complete" as const, source: "universal-video" as const },
    ],
  };

  it("hides the tab when there is no micro-events file", () => {
    const s = resolveMicroTabState({ status: "missing" }, "default", {
      hasYoutube: false,
      hasFileVideo: false,
    });
    expect(s.showMicroTab).toBe(false);
    expect(s.microActiveRows).toEqual([]);
  });

  it("shows a YouTube warning without listing file-video rows as active", () => {
    const s = resolveMicroTabState({ status: "ok", map: videoMap }, "default", {
      hasYoutube: true,
      hasFileVideo: false,
    });
    expect(s.showYoutubeMicroWarning).toBe(true);
    expect(s.showMicroTab).toBe(true);
    expect(s.microActiveRows).toEqual([]);
    expect(s.microVideoRows).toHaveLength(2);
  });

  it("lists file-video rows only when this instance has an uploaded file", () => {
    const s = resolveMicroTabState({ status: "ok", map: videoMap }, "default", {
      hasYoutube: false,
      hasFileVideo: true,
    });
    expect(s.microActiveRows.map((r) => r.event)).toEqual(["video_start", "video_complete"]);
    expect(s.showYoutubeMicroWarning).toBe(false);
  });

  it("shows a staff warning when the map is broken", () => {
    const s = resolveMicroTabState(
      { status: "error", error: "parse failed" },
      "default",
      { hasYoutube: false, hasFileVideo: false },
    );
    expect(s.microBroken).toBe(true);
    expect(s.showMicroTab).toBe(true);
    expect(s.microActiveRows).toEqual([]);
  });

  it("shows curated non-payment cta_click rows (Ecommerce events stay off Micro)", () => {
    const s = resolveMicroTabState({ status: "ok", map: ctaMap }, "default", {
      hasYoutube: false,
      hasFileVideo: false,
    });
    expect(s.showMicroTab).toBe(true);
    expect(s.microActiveRows.map((r) => r.event)).toEqual(["cta_click"]);
  });
});
