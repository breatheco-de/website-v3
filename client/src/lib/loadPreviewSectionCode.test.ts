import { describe, expect, it, vi } from "vitest";
import { loadPreviewSectionCode } from "./loadPreviewSectionCode";

const known = new Set(["hero", "syllabus", "footer"]);

describe("loadPreviewSectionCode", () => {
  it("loads each type/variant once and reports nothing when all arrive", async () => {
    const load = vi.fn(async () => ({}));
    const result = await loadPreviewSectionCode(
      [{ type: "hero" }, { type: "footer" }, { type: "hero" }],
      1000,
      { hasType: (t) => known.has(t), load },
    );
    expect(load).toHaveBeenCalledTimes(2);
    expect([...result.notLoaded]).toEqual([]);
    expect([...result.unknownTypes]).toEqual([]);
  });

  it("marks sections whose code times out or fails as not loaded", async () => {
    const result = await loadPreviewSectionCode(
      [{ type: "hero" }, { type: "syllabus", variant: "program-modules" }, { type: "footer" }],
      20,
      {
        hasType: (t) => known.has(t),
        load: (t) =>
          t === "syllabus" ? new Promise(() => {}) : t === "footer" ? Promise.reject(new Error("chunk failed")) : Promise.resolve({}),
      },
    );
    expect([...result.notLoaded].sort()).toEqual([1, 2]);
  });

  it("reports unknown types separately and does not try to load them", async () => {
    const load = vi.fn(async () => ({}));
    const result = await loadPreviewSectionCode([{ type: "syllabuss" }, { type: "hero" }], 1000, {
      hasType: (t) => known.has(t),
      load,
    });
    expect([...result.unknownTypes]).toEqual([0]);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
