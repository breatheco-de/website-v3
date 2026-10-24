import { describe, expect, it } from "vitest";
import {
  crossedThresholds,
  ctaClickPayload,
  ctaDestination,
  isTrackablePath,
  scrollPercent,
  type ElementLike,
} from "./section-tracking";

const ORIGIN = "https://4geeks.com";

function el(opts: {
  attrs?: Record<string, string>;
  text?: string;
  matches?: string[];
  parent?: ElementLike | null;
}): ElementLike {
  const self: ElementLike = {
    textContent: opts.text ?? null,
    id: opts.attrs?.id,
    getAttribute: (name) => opts.attrs?.[name] ?? null,
    closest: (selector) => {
      if ((opts.matches ?? []).some((m) => selector.includes(m))) return self;
      return opts.parent ? opts.parent.closest(selector) : null;
    },
  };
  return self;
}

const section = el({
  attrs: { "data-section-type": "hero", "data-section-index": "2", id: "hero-main" },
  matches: [".section-wrapper"],
});

describe("ctaClickPayload", () => {
  it("attributes a link click to its section", () => {
    const link = el({ attrs: { href: "/en/apply/" }, text: "  Apply   now ", matches: ["a[href]"], parent: section });
    const span = el({ text: "Apply", parent: link });
    expect(ctaClickPayload(span, { pathname: "/en/bootcamp", origin: ORIGIN })).toEqual({
      section_type: "hero",
      section_index: 2,
      section_id: "hero-main",
      page_path: "/en/bootcamp",
      label: "Apply now",
      destination: "/en/apply",
    });
  });

  it("ignores clicks outside a control or outside a section", () => {
    const text = el({ text: "plain", parent: section });
    expect(ctaClickPayload(text, { pathname: "/", origin: ORIGIN })).toBeNull();
    const looseButton = el({ text: "Menu", matches: ["button"] });
    expect(ctaClickPayload(looseButton, { pathname: "/", origin: ORIGIN })).toBeNull();
  });

  it("trims long labels", () => {
    const button = el({ text: "x".repeat(300), matches: ["button"], parent: section });
    const payload = ctaClickPayload(button, { pathname: "/", origin: ORIGIN });
    expect(String(payload?.label).length).toBe(100);
    expect(payload?.destination).toBeUndefined();
  });
});

describe("ctaDestination", () => {
  it("normalizes same-origin, external, anchors and schemes", () => {
    expect(ctaDestination("https://4geeks.com/en/apply/?x=1", ORIGIN)).toBe("/en/apply");
    expect(ctaDestination("https://learn.4geeks.com/login", ORIGIN)).toBe("learn.4geeks.com/login");
    expect(ctaDestination("#pricing", ORIGIN)).toBe("#pricing");
    expect(ctaDestination("mailto:hi@4geeks.com", ORIGIN)).toBe("mailto:");
    expect(ctaDestination("", ORIGIN)).toBeUndefined();
  });
});

describe("scroll thresholds", () => {
  it("fires each threshold once", () => {
    const sent = new Set<number>();
    expect(crossedThresholds(sent, 60)).toEqual([25, 50]);
    sent.add(25).add(50);
    expect(crossedThresholds(sent, 60)).toEqual([]);
    expect(crossedThresholds(sent, 95)).toEqual([75, 90]);
  });

  it("computes percent from the viewport bottom", () => {
    expect(scrollPercent(0, 1000, 4000)).toBe(25);
    expect(scrollPercent(0, 1000, 800)).toBe(100);
    expect(scrollPercent(3000, 1000, 4000)).toBe(100);
  });
});

describe("isTrackablePath", () => {
  it("skips staff pages", () => {
    expect(isTrackablePath("/private/settings")).toBe(false);
    expect(isTrackablePath("/private")).toBe(false);
    expect(isTrackablePath("/en/blog/foo")).toBe(true);
  });
});
