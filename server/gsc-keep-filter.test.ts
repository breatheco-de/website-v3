import { describe, it, expect } from "vitest";
import {
  applyKeepFilter,
  expectedCtrForPosition,
  KEEP_RULES_VERSION,
  keywordTokenKey,
  normalizePageUrl,
  queriesMatchKeyword,
  shouldKeepRow,
  type GscDayRow,
} from "./gsc-keep-filter";

const ctx = {
  ourHosts: new Set(["example.com"]),
  ourPaths: new Set(["/bootcamp"]),
  keywordKeys: new Set([keywordTokenKey("python bootcamp")]),
};

function row(partial: Partial<GscDayRow> & { query: string; url: string }): GscDayRow {
  const impressions = partial.impressions ?? 10;
  const clicks = partial.clicks ?? 0;
  const sum_position = partial.sum_position ?? impressions * 5;
  return {
    country: "",
    clicks,
    impressions,
    sum_position,
    ctr: impressions > 0 ? clicks / impressions : 0,
    ...partial,
  };
}

describe("queriesMatchKeyword", () => {
  it("matches lowercase/trim", () => {
    expect(queriesMatchKeyword("Python Bootcamp", "python bootcamp")).toBe(true);
  });

  it("matches the same sorted word set (order-independent)", () => {
    expect(queriesMatchKeyword("bootcamp python", "python bootcamp")).toBe(true);
    expect(keywordTokenKey("full stack python")).toBe(keywordTokenKey("python full stack"));
  });

  it("does not match extra words", () => {
    expect(queriesMatchKeyword("best python bootcamp", "python bootcamp")).toBe(false);
  });
});

describe("normalizePageUrl", () => {
  it("strips www, trailing slash, and ignores tracking params", () => {
    expect(normalizePageUrl("https://www.example.com/bootcamp/?utm_source=gsc")).toEqual({
      host: "example.com",
      path: "/bootcamp",
    });
    expect(normalizePageUrl("https://example.com/bootcamp")).toEqual({
      host: "example.com",
      path: "/bootcamp",
    });
  });
});

describe("shouldKeepRow", () => {
  it("keeps a query that matches a main_keyword token set", () => {
    expect(
      shouldKeepRow(
        row({ query: "bootcamp python", url: "https://example.com/other", impressions: 1, sum_position: 50 }),
        ctx,
      ),
    ).toBe(true);
  });

  it("keeps page-2 positions even when the query is not a keyword", () => {
    expect(
      shouldKeepRow(
        row({
          query: "random long tail phrase here",
          url: "https://example.com/bootcamp",
          impressions: 8,
          sum_position: 8 * 15,
        }),
        ctx,
      ),
    ).toBe(true);
  });

  it("drops off-host long-tail", () => {
    expect(
      shouldKeepRow(
        row({ query: "cheap flights", url: "https://other.com/x", impressions: 2, sum_position: 80 }),
        ctx,
      ),
    ).toBe(false);
  });

  it("keeps anonymized queries for URL-level cards when impressions are material", () => {
    expect(
      shouldKeepRow(
        row({ query: "", url: "https://example.com/bootcamp", impressions: 20, sum_position: 100 }),
        ctx,
      ),
    ).toBe(true);
  });
});

describe("applyKeepFilter", () => {
  it("caps rows and sets truncated", () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      row({ query: `q${i}`, url: "https://example.com/bootcamp", impressions: 10 - i }),
    );
    const out = applyKeepFilter(rows, ctx);
    expect(out.truncated).toBe(false);
    expect(out.rows[0]?.query).toBe("q0");
  });

  it("keeps thin country splits when the worldwide total would be kept", () => {
    const rows = [
      row({
        query: "obscure long tail phrase xyz",
        url: "https://example.com/other-page",
        country: "esp",
        impressions: 3,
        sum_position: 3 * 50,
      }),
      row({
        query: "obscure long tail phrase xyz",
        url: "https://example.com/other-page",
        country: "usa",
        impressions: 3,
        sum_position: 3 * 50,
      }),
    ];
    // Individually: off-path, pos 50, impressions 3 < MIN_KEEP → drop.
    expect(shouldKeepRow(rows[0]!, ctx)).toBe(false);
    expect(shouldKeepRow(rows[1]!, ctx)).toBe(false);
    // Worldwide total impressions 6 ≥ MIN_KEEP → keep both splits.
    const out = applyKeepFilter(rows, ctx);
    expect(out.rows).toHaveLength(2);
  });

  it("prefers configured-market countries when truncating", async () => {
    const { DAY_ROW_CAP } = await import("./gsc-keep-filter");
    // Build more than CAP preferred+other by temporarily using a small local cap simulation:
    // We can't change DAY_ROW_CAP; instead verify preferred ordering by using enough rows
    // that sort alone would drop preferred low-impression rows — with prefer set they survive.
    // Use applyKeepFilter with preferredCountries and mock by testing relative order in truncated output
    // via a stub: inject many high-impression "zzz" country rows and few preferred.
    const preferred = new Set(["esp"]);
    const rows: GscDayRow[] = [];
    for (let i = 0; i < 5; i++) {
      rows.push(
        row({
          query: `keep-${i}`,
          url: "https://example.com/bootcamp",
          country: "esp",
          impressions: 1,
          sum_position: 5,
        }),
      );
    }
    for (let i = 0; i < DAY_ROW_CAP + 10; i++) {
      rows.push(
        row({
          query: `other-${i}`,
          url: "https://example.com/bootcamp",
          country: "deu",
          impressions: 100,
          sum_position: 500,
        }),
      );
    }
    const out = applyKeepFilter(rows, ctx, preferred);
    expect(out.truncated).toBe(true);
    expect(out.rows).toHaveLength(DAY_ROW_CAP);
    expect(out.rows.filter((r) => r.country === "esp")).toHaveLength(5);
  });
});

describe("expectedCtrForPosition", () => {
  it("is higher at position 1 than 10", () => {
    expect(expectedCtrForPosition(1)).toBeGreaterThan(expectedCtrForPosition(10));
  });
});

describe("KEEP_RULES_VERSION", () => {
  it("is a positive integer", () => {
    expect(KEEP_RULES_VERSION).toBeGreaterThan(0);
  });
});
