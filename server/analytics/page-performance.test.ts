import { describe, expect, it } from "vitest";
import {
  buildLayoutPathIndex,
  computeChannelBaselines,
  computeLayoutPerformance,
  type ChannelRow,
} from "./page-performance";
import type { InsightPageRecord } from "@shared/schema";

const row = (p: Partial<ChannelRow>): ChannelRow => ({
  path: "/",
  channel: "organic",
  campaign: null,
  sessions: 0,
  engaged: 0,
  leads: 0,
  add_to_cart: 0,
  checkouts: 0,
  ...p,
});

describe("computeLayoutPerformance", () => {
  const index = new Map([
    ["/en/a", { key: "landing/a", contentType: "landing", stage: "decision" }],
    ["/en/b", { key: "landing/b", contentType: "landing", stage: "decision" }],
    ["/en/blog/x", { key: "blog::template", contentType: "blog" }],
    ["/en/blog/y", { key: "blog::template", contentType: "blog" }],
  ]);

  it("scores lift vs the channel baseline and clamps to 0.5–1.5", () => {
    const out = computeLayoutPerformance(
      [
        row({ path: "/en/a", channel: "paid", sessions: 1000, leads: 60 }),
        row({ path: "/en/b", channel: "paid", sessions: 1000, leads: 20 }),
      ],
      index,
      { windowDays: 90 },
    );
    // baseline 4%: a expected 40 → (60+5)/(40+5); b → (20+5)/(40+5)
    expect(out["landing/a"]!.lift).toBeCloseTo(65 / 45, 3);
    expect(out["landing/b"]!.lift).toBeCloseTo(25 / 45, 3);
    expect(out["landing/a"]!.outcome_metric).toBe("conversions");
    expect(out["landing/a"]!.factor).toBeLessThanOrEqual(1.5);
    expect(out["landing/b"]!.factor).toBeGreaterThanOrEqual(0.5);
  });

  it("does not punish a page for its traffic mix", () => {
    const out = computeLayoutPerformance(
      [
        row({ path: "/en/a", channel: "paid", sessions: 100, leads: 10 }),
        row({ path: "/en/b", channel: "organic", sessions: 100, leads: 1 }),
        row({ path: "/en/a", channel: "organic", sessions: 100, leads: 1 }),
        row({ path: "/en/b", channel: "paid", sessions: 100, leads: 10 }),
      ],
      index,
      { windowDays: 90 },
    );
    expect(out["landing/a"]!.lift).toBeCloseTo(1, 5);
    expect(out["landing/b"]!.lift).toBeCloseTo(1, 5);
  });

  it("aggregates a shared template across attached entries (one layout)", () => {
    const out = computeLayoutPerformance(
      [row({ path: "/en/blog/x", sessions: 50, engaged: 20 }), row({ path: "/en/blog/y", sessions: 50, engaged: 30 })],
      index,
      { windowDays: 90 },
    );
    expect(Object.keys(out)).toEqual(["blog::template"]);
    expect(out["blog::template"]).toMatchObject({ sessions: 100, outcome: 50, outcome_metric: "engaged_sessions" });
  });

  it("uses the campaign baseline when a campaign feeds 2+ layouts", () => {
    const out = computeLayoutPerformance(
      [
        row({ path: "/en/a", channel: "paid", campaign: "spring", sessions: 100, leads: 2 }),
        row({ path: "/en/b", channel: "paid", campaign: "spring", sessions: 100, leads: 2 }),
        row({ path: "/en/a", channel: "paid", campaign: "brand", sessions: 100, leads: 30 }),
      ],
      index,
      { windowDays: 90 },
    );
    // b only has spring traffic: expected = 100 × 2% = 2 → lift 1
    expect(out["landing/b"]!.lift).toBeCloseTo(1, 5);
  });
});

describe("buildLayoutPathIndex", () => {
  it("maps every attached entry URL to the template record and skips overlays", () => {
    const records: InsightPageRecord[] = [
      { key: "blog::template", contentType: "blog", kind: "shared_template", slugs: ["x", "y"], intent: "i", weight: 1, instanceCount: 2, sections: [] },
      { key: "landing/a", contentType: "landing", kind: "page", slug: "a", intent: "i", weight: 1, instanceCount: 1, sections: [], funnelStage: "decision" },
      { key: "overlays/m", contentType: "overlays", kind: "overlay", slug: "m", intent: "i", weight: 1, instanceCount: 1, sections: [] },
    ];
    const index = buildLayoutPathIndex(records, (ct, slug) => ({ en: `https://site.com/en/${ct}/${slug}/`, es: `/es/${ct}/${slug}` }));
    expect(index.get("/en/blog/x")?.key).toBe("blog::template");
    expect(index.get("/es/blog/y")?.key).toBe("blog::template");
    expect(index.get("/en/landing/a")).toMatchObject({ key: "landing/a", stage: "decision" });
    expect([...index.values()].some((v) => v.key.startsWith("overlays/"))).toBe(false);
  });
});

describe("computeChannelBaselines", () => {
  it("returns channel rates per content type + stage and per metric, without campaign keys", () => {
    const index = new Map([
      ["/en/a", { key: "landing/a", contentType: "landing", stage: "decision" }],
      ["/en/blog/x", { key: "blog/x", contentType: "blog", stage: "awareness" }],
    ]);
    const out = computeChannelBaselines(
      [
        row({ path: "/en/a", channel: "paid", campaign: "c1", sessions: 200, leads: 8, checkouts: 2 }),
        row({ path: "/en/blog/x", channel: "organic", sessions: 100, engaged: 40 }),
      ],
      index,
    );
    expect(out["ch|paid|landing|decision"]).toEqual({ sessions: 200, outcome: 10, rate: 0.05 });
    expect(out["ch|paid|*|conversions"]?.rate).toBe(0.05);
    expect(out["ch|organic|blog|awareness"]?.rate).toBe(0.4);
    expect(Object.keys(out).some((k) => k.startsWith("cp|"))).toBe(false);
  });
});
