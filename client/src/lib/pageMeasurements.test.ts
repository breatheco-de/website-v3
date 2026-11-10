import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { measurePage } from "./pageMeasurements";

type Rect = { top: number; right: number; width: number; height: number };

/** Minimal element: only what measurePage reads (no DOM library in this repo's test env). */
class FakeEl {
  children: FakeEl[] = [];
  parentElement: FakeEl | null = null;
  dataset: Record<string, string> = {};
  offsetParent: object | null = {};
  textContent = "";
  constructor(
    public tagName: string,
    public className: string,
    public rect: Rect,
    public style: Record<string, string> = {},
  ) {}
  add(...kids: FakeEl[]): this {
    for (const k of kids) {
      k.parentElement = this;
      this.children.push(k);
    }
    return this;
  }
  getBoundingClientRect() {
    return { ...this.rect, left: this.rect.right - this.rect.width, bottom: this.rect.top + this.rect.height };
  }
  private all(): FakeEl[] {
    return this.children.flatMap((c) => [c, ...c.all()]);
  }
  querySelectorAll(sel: string): FakeEl[] {
    const all = this.all();
    if (sel === "*") return all;
    if (sel === "img") return all.filter((e) => e.tagName === "IMG");
    if (sel.startsWith(".section-wrapper")) return all.filter((e) => e.className.includes("section-wrapper"));
    if (sel.startsWith("h1")) return all.filter((e) => /^H[1-6]$/.test(e.tagName));
    return [];
  }
  closest(): FakeEl | null {
    let node: FakeEl | null = this;
    while (node && !node.className.includes("section-wrapper")) node = node.parentElement;
    return node;
  }
}

const VW = 390;

function section(index: number, type: string, height: number, ...kids: FakeEl[]): FakeEl {
  const el = new FakeEl("DIV", "section-wrapper", { top: index * 500, right: VW, width: VW, height });
  el.dataset = { sectionIndex: String(index), sectionType: type };
  return el.add(...kids);
}

let scrollWidth = VW;

beforeEach(() => {
  scrollWidth = VW;
  const g = globalThis as Record<string, unknown>;
  g.window = { innerWidth: VW, innerHeight: 800, scrollY: 0 };
  g.document = {
    documentElement: {
      get scrollWidth() {
        return scrollWidth;
      },
      scrollHeight: 3000,
    },
  };
  g.getComputedStyle = (el: FakeEl) => ({
    paddingTop: "0px",
    paddingBottom: "0px",
    marginTop: "0px",
    marginBottom: "0px",
    backgroundImage: "none",
    backgroundColor: "rgba(0, 0, 0, 0)",
    overflow: "visible",
    overflowX: "visible",
    ...el.style,
  });
});

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.window;
  delete g.document;
  delete g.getComputedStyle;
});

function measure(root: FakeEl, opts?: Parameters<typeof measurePage>[1]) {
  return measurePage(root as unknown as ParentNode, opts).findings;
}

describe("measurePage horizontal overflow", () => {
  it("ignores a carousel track clipped by an overflow-hidden parent inside the viewport", () => {
    const track = new FakeEl("DIV", "track", { top: 0, right: 1592, width: 1592, height: 300 });
    const clip = new FakeEl("DIV", "clip", { top: 0, right: VW, width: VW, height: 300 }, { overflow: "hidden" }).add(track);
    const root = new FakeEl("DIV", "root", { top: 0, right: VW, width: VW, height: 500 }).add(section(0, "testimonials_slide", 400, clip));
    expect(measure(root).filter((f) => f.code === "horizontal_overflow")).toEqual([]);
  });

  it("flags an unclipped child that sticks out of the viewport", () => {
    const wide = new FakeEl("DIV", "wide", { top: 0, right: VW + 50, width: VW + 50, height: 100 });
    const root = new FakeEl("DIV", "root", { top: 0, right: VW, width: VW, height: 500 }).add(section(0, "hero", 400, wide));
    expect(measure(root)).toContainEqual(
      expect.objectContaining({ code: "horizontal_overflow", section_path: "sections[0]", evidence: { overflow_px: 50, viewport_width: VW } }),
    );
  });

  it("always reports page-level overflow, even with a section-level finding", () => {
    scrollWidth = VW + 120;
    const wide = new FakeEl("DIV", "wide", { top: 0, right: VW + 50, width: VW + 50, height: 100 });
    const root = new FakeEl("DIV", "root", { top: 0, right: VW, width: VW, height: 500 }).add(section(0, "hero", 400, wide));
    const overflow = measure(root).filter((f) => f.code === "horizontal_overflow");
    expect(overflow.map((f) => f.section_path)).toEqual(["sections[0]", null]);
  });
});

describe("measurePage sections that did not render", () => {
  it("reports code that did not load instead of an empty section", () => {
    const root = new FakeEl("DIV", "root", { top: 0, right: VW, width: VW, height: 500 }).add(section(0, "syllabus", 0));
    const findings = measure(root, { notLoaded: new Set([0]) });
    expect(findings.map((f) => f.code)).toEqual(["section_not_loaded"]);
  });

  it("reports an unknown section type instead of an empty or not-loaded section", () => {
    const root = new FakeEl("DIV", "root", { top: 0, right: VW, width: VW, height: 500 }).add(section(0, "syllabuss", 0));
    const findings = measure(root, { notLoaded: new Set([0]), unknownTypes: new Set([0]) });
    expect(findings).toEqual([expect.objectContaining({ code: "section_unknown_type", severity: "error" })]);
  });

  it("still reports a genuinely empty section", () => {
    const root = new FakeEl("DIV", "root", { top: 0, right: VW, width: VW, height: 500 }).add(section(0, "footer", 0));
    expect(measure(root).map((f) => f.code)).toEqual(["empty_section"]);
  });
});
