import { describe, expect, it } from "vitest";
import { expectedCtrForPosition } from "./gsc-keep-filter";
import { PAGE1_CTR_GAP_RATIO, rollupPage1Ctr, type Page1CtrRow } from "./seo-page1-ctr";

function row(partial: Partial<Page1CtrRow> & Pick<Page1CtrRow, "query" | "url">): Page1CtrRow {
  const impressions = partial.impressions ?? 200;
  const clicks = partial.clicks ?? 0;
  const position = partial.position ?? 1;
  return {
    query: partial.query,
    url: partial.url,
    clicks,
    impressions,
    position,
    ctr: impressions > 0 ? clicks / impressions : 0,
  };
}

describe("rollupPage1Ctr", () => {
  it("ignores page-2+ rows so impression growth at low ranks does not dilute CTR", () => {
    const page1 = row({
      query: "bootcamp",
      url: "/a",
      position: 2,
      impressions: 200,
      clicks: 30,
    });
    const noise = row({
      query: "random long tail",
      url: "/b",
      position: 18,
      impressions: 50_000,
      clicks: 5,
    });
    const alone = rollupPage1Ctr([page1]);
    const mixed = rollupPage1Ctr([page1, noise]);
    expect(alone.ctr).toBeCloseTo(0.15);
    expect(mixed.ctr).toBeCloseTo(alone.ctr!);
    expect(mixed.impressions).toBe(200);
  });

  it("drops rows under the impressions floor", () => {
    const out = rollupPage1Ctr([
      row({ query: "tiny", url: "/t", position: 1, impressions: 99, clicks: 50 }),
      row({ query: "ok", url: "/o", position: 1, impressions: 100, clicks: 28 }),
    ]);
    expect(out.query_count).toBe(1);
    expect(out.ctr).toBeCloseTo(0.28);
  });

  it("marks below_expected when actual is under 50% of expected", () => {
    // Position 1 expected ~0.28; 5% CTR is well under half.
    const weak = rollupPage1Ctr([
      row({ query: "weak", url: "/w", position: 1, impressions: 200, clicks: 10 }),
    ]);
    expect(weak.expected_ctr).toBeCloseTo(expectedCtrForPosition(1));
    expect(weak.ctr!).toBeLessThan(weak.expected_ctr! * PAGE1_CTR_GAP_RATIO);
    expect(weak.below_expected).toBe(true);
    expect(weak.below_expected_count).toBe(1);

    const strong = rollupPage1Ctr([
      row({ query: "strong", url: "/s", position: 1, impressions: 200, clicks: 56 }),
    ]);
    expect(strong.below_expected).toBe(false);
    expect(strong.below_expected_count).toBe(0);
  });

  it("splits bands 1–3 vs 4–10", () => {
    const out = rollupPage1Ctr([
      row({ query: "top", url: "/t", position: 1, impressions: 100, clicks: 28 }),
      row({ query: "mid", url: "/m", position: 8, impressions: 100, clicks: 4 }),
    ]);
    expect(out.band_1_3?.query_count).toBe(1);
    expect(out.band_4_10?.query_count).toBe(1);
    expect(out.band_1_3!.ctr).toBeCloseTo(0.28);
    expect(out.band_4_10!.ctr).toBeCloseTo(0.04);
  });

  it("returns empty when nothing qualifies", () => {
    const out = rollupPage1Ctr([
      row({ query: "low", url: "/l", position: 15, impressions: 500, clicks: 1 }),
    ]);
    expect(out.empty).toBe(true);
    expect(out.ctr).toBeNull();
    expect(out.below_expected).toBe(false);
  });
});
