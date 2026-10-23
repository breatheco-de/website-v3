import crypto from "crypto";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_VARIANT_SLUG,
  experimentId,
  isReservedExperimentSlug,
  pickVariant,
} from "./assignment";

// Realistic, reproducible visitor ids (UUID-like, not sequential).
const ids = Array.from({ length: 10_000 }, (_, i) =>
  crypto.createHash("sha256").update(`visitor-${i}`).digest("hex"),
);

function split(variants: Array<{ slug: string; allocation: number }>, key = "landing:promo:en") {
  const counts: Record<string, number> = {};
  for (const id of ids) {
    const v = pickVariant(id, key, variants) ?? "(none)";
    counts[v] = (counts[v] ?? 0) + 1;
  }
  return counts;
}

describe("pickVariant split", () => {
  it.each([
    [[{ slug: "a", allocation: 30 }], { a: 30, default: 70 }],
    [[{ slug: "a", allocation: 50 }], { a: 50, default: 50 }],
    [
      [
        { slug: "a", allocation: 10 },
        { slug: "b", allocation: 20 },
      ],
      { a: 10, b: 20, default: 70 },
    ],
    [[{ slug: "a", allocation: 100 }], { a: 100 }],
  ])("%j lands within 1.5 points of the target", (variants, expected) => {
    const counts = split(variants);
    for (const [slug, pct] of Object.entries(expected)) {
      expect(Math.abs(((counts[slug] ?? 0) / ids.length) * 100 - pct)).toBeLessThan(1.5);
    }
    expect(Object.keys(counts).sort()).toEqual(Object.keys(expected).sort());
  });

  it("returns null when no variant has traffic (no active test)", () => {
    expect(split([{ slug: "a", allocation: 0 }])).toEqual({ "(none)": ids.length });
  });

  it("gives Default's share to default, never to the first variant", () => {
    const counts = split([{ slug: "a", allocation: 30 }]);
    expect(counts[DEFAULT_VARIANT_SLUG]).toBeGreaterThan(6500);
    expect(counts.a).toBeLessThan(3500);
  });

  it("is deterministic for the same visitor and experiment", () => {
    const v = [{ slug: "a", allocation: 30 }];
    for (const id of ids.slice(0, 500)) {
      expect(pickVariant(id, "landing:promo:en", v)).toBe(pickVariant(id, "landing:promo:en", v));
    }
  });

  it("splits two experiments independently", () => {
    const v = [{ slug: "a", allocation: 50 }];
    let both = 0;
    for (const id of ids) {
      if (pickVariant(id, "landing:x:en", v) === "a" && pickVariant(id, "landing:y:en", v) === "a") both++;
    }
    expect(both / ids.length).toBeGreaterThan(0.22);
    expect(both / ids.length).toBeLessThan(0.28);
  });

  it("re-splits on a new run (different experiment key)", () => {
    const v = [{ slug: "a", allocation: 50 }];
    let changed = 0;
    for (const id of ids.slice(0, 2000)) {
      if (pickVariant(id, "landing:x:en@2026-10-01", v) !== pickVariant(id, "landing:x:en@2026-11-01", v)) changed++;
    }
    expect(changed / 2000).toBeGreaterThan(0.4);
  });
});

describe("experiment ids and reserved slugs", () => {
  it("adds the run date when present", () => {
    expect(experimentId("landing", "promo", "en")).toBe("landing:promo:en");
    expect(experimentId("landing", "promo", "en", "2026-10-23")).toBe("landing:promo:en@2026-10-23");
  });

  it("reserves default", () => {
    expect(isReservedExperimentSlug("default")).toBe(true);
    expect(isReservedExperimentSlug("b")).toBe(false);
  });
});
