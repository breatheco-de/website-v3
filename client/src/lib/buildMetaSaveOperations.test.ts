import { describe, expect, it } from "vitest";
import {
  areSlugListsEqual,
  buildMetaSaveOperations,
  computeDirtyMetaKeys,
  withExplicitIndexRobots,
  type EditableMetaKey,
} from "./buildMetaSaveOperations";
import { normalizeRobotsForForm } from "./robotsMeta";
import type { SeoMeta } from "@/components/DebugBubble/types";

const baseline: SeoMeta = {
  page_title: "Ingeniería en IA | Programa en México con 4Geeks",
  description: "Desarrolla soluciones de IA con mentoría y comunidad profesional en 4Geeks Academy.",
  og_image: "https://example.com/og.png",
  canonical_url: "",
  robots: "index, follow",
  priority: "0.9",
  change_frequency: "weekly",
  redirects: [],
};

function dirty(...keys: string[]): Set<string> {
  return new Set(keys);
}

describe("buildMetaSaveOperations", () => {
  it("LIVE: only robots dirty emits meta.robots op, not title/description", () => {
    const seoMeta: SeoMeta = { ...baseline, robots: "noindex, nofollow" };
    const ops = buildMetaSaveOperations({
      context: "live",
      seoMeta,
      dirtyKeys: dirty("robots"),
    });
    expect(ops).toEqual([
      { action: "update_field", path: "meta.robots", value: "noindex, nofollow" },
    ]);
  });

  it("LIVE: unchanged title/description produce no ops for those keys", () => {
    const ops = buildMetaSaveOperations({
      context: "live",
      seoMeta: baseline,
      dirtyKeys: new Set(),
    });
    expect(ops).toEqual([]);
  });

  it("LIVE: cleared snippet field emits no delete op (cannot clear on live micro-save)", () => {
    const seoMeta: SeoMeta = { ...baseline, description: "" };
    const ops = buildMetaSaveOperations({
      context: "live",
      seoMeta,
      dirtyKeys: dirty("description"),
    });
    expect(ops).toEqual([]);
  });

  it("LIVE: dirty page_title with valid value patches meta.page_title only", () => {
    const seoMeta: SeoMeta = { ...baseline, page_title: "Updated SERP title" };
    const ops = buildMetaSaveOperations({
      context: "live",
      seoMeta,
      dirtyKeys: dirty("page_title"),
    });
    expect(ops).toEqual([
      { action: "update_field", path: "meta.page_title", value: "Updated SERP title" },
    ]);
  });

  it("LIVE: dirty optional field cleared sends null delete", () => {
    const seoMeta: SeoMeta = { ...baseline, og_image: "" };
    const ops = buildMetaSaveOperations({
      context: "live",
      seoMeta,
      dirtyKeys: dirty("og_image"),
    });
    expect(ops).toEqual([{ action: "update_field", path: "meta.og_image", value: null }]);
  });

  it("variant: unchanged inherited title emits no meta.page_title op", () => {
    const ops = buildMetaSaveOperations({
      context: "variant",
      seoMeta: baseline,
      dirtyKeys: dirty("robots"),
      displayMeta: { ...baseline, robots: "noindex, nofollow" },
      liveMeta: baseline,
      metaOverrides: [],
    });
    expect(ops.map((o) => o.path)).not.toContain("meta.page_title");
    expect(ops.map((o) => o.path)).not.toContain("meta.description");
  });

  it("variant: dirty override different from live writes patch op", () => {
    const seoMeta: SeoMeta = { ...baseline, page_title: "Custom variant title" };
    const ops = buildMetaSaveOperations({
      context: "variant",
      seoMeta,
      dirtyKeys: dirty("page_title"),
      displayMeta: { ...baseline, page_title: "Custom variant title" },
      liveMeta: baseline,
      metaOverrides: [],
    });
    expect(ops).toContainEqual({
      action: "update_field",
      path: "meta.page_title",
      value: "Custom variant title",
    });
  });

  it("variant: preserves non-editable override keys on variant file", () => {
    const seoMeta: SeoMeta = { ...baseline, robots: "noindex" };
    const ops = buildMetaSaveOperations({
      context: "variant",
      seoMeta,
      dirtyKeys: dirty("robots"),
      displayMeta: { ...baseline, robots: "noindex", custom_tracking: "abc" },
      liveMeta: baseline,
      metaOverrides: ["custom_tracking"],
    });
    expect(ops).toContainEqual({
      action: "update_field",
      path: "meta.custom_tracking",
      value: "abc",
    });
    expect(ops).toContainEqual({
      action: "update_field",
      path: "meta.robots",
      value: "noindex",
    });
  });
});

describe("areSlugListsEqual", () => {
  it("ignores order", () => {
    expect(areSlugListsEqual(["b", "a"], ["a", "b"])).toBe(true);
  });

  it("detects additions", () => {
    expect(areSlugListsEqual(["mexicocity-mexico"], [])).toBe(false);
  });
});

describe("computeDirtyMetaKeys", () => {
  it("detects changed editable keys and redirects", () => {
    const next: SeoMeta = {
      ...baseline,
      robots: "noindex",
      redirects: ["/old-path"],
    };
    const dirty = computeDirtyMetaKeys(next, baseline);
    expect(dirty.has("robots")).toBe(true);
    expect(dirty.has("redirects")).toBe(true);
    expect(dirty.has("page_title" as EditableMetaKey)).toBe(false);
  });
});

describe("withExplicitIndexRobots", () => {
  const clearRobots = () =>
    buildMetaSaveOperations({
      context: "live",
      seoMeta: { ...baseline, robots: "" },
      dirtyKeys: dirty("robots"),
    });

  it("writes index, follow instead of deleting when the page-wide value says noindex", () => {
    expect(clearRobots()).toEqual([{ action: "update_field", path: "meta.robots", value: null }]);
    expect(withExplicitIndexRobots(clearRobots(), "noindex, nofollow")).toEqual([
      { action: "update_field", path: "meta.robots", value: "index, follow" },
    ]);
  });

  it("keeps the delete when nothing underneath says noindex", () => {
    expect(withExplicitIndexRobots(clearRobots(), "")).toEqual(clearRobots());
    expect(withExplicitIndexRobots(clearRobots(), undefined)).toEqual(clearRobots());
  });

  it("leaves explicit values alone", () => {
    const ops = buildMetaSaveOperations({
      context: "live",
      seoMeta: { ...baseline, robots: "noindex" },
      dirtyKeys: dirty("robots"),
    });
    expect(withExplicitIndexRobots(ops, "noindex")).toEqual(ops);
  });
});

describe("normalizeRobotsForForm", () => {
  it("collapses spellings of the default to the default radio", () => {
    expect(normalizeRobotsForForm("index, follow")).toBe("");
    expect(normalizeRobotsForForm("Index,Follow")).toBe("");
    expect(normalizeRobotsForForm(undefined)).toBe("");
    expect(normalizeRobotsForForm("noindex")).toBe("noindex");
  });
});
