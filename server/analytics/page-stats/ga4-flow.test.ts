import { describe, expect, it } from "vitest";
import { buildPageFlowSql, parsePageFlowRows, relationTo, type FlowRow } from "./ga4-flow";
import type { PathStageIndex } from "./resolve";

const index: PathStageIndex = {
  byPath: new Map([
    ["/en/apply", { key: "landing/apply/en", content_type: "landing", slug: "apply", locale: "en", stage: "decision" }],
    ["/en/blog/a", { key: "blog/a/en", content_type: "blog", slug: "a", locale: "en", stage: "awareness" }],
  ]),
  pathsByStage: { awareness: ["/en/blog/a"], consideration: [], decision: ["/en/apply"], "post-enrollment": [] },
  built_at: 0,
};

const window = { start: "2026-08-27", end: "2026-10-21", cur_start: "2026-09-24" };

function row(kind: string, period: string, extra: Partial<FlowRow>): FlowRow {
  return { kind, period, a: null, b: null, c: null, d: null, ...extra };
}

describe("buildPageFlowSql", () => {
  it("scans one window and splits current vs prior by day", () => {
    const sql = buildPageFlowSql("`p.d.events_*`");
    expect(sql).toContain("FROM `p.d.events_*`");
    expect(sql).toContain("@cur_start_s");
    expect(sql).toContain("IN UNNEST(@decision_paths)");
    expect(sql).toContain("NOT LOGICAL_OR(STARTS_WITH(path, '/private'))");
    expect(sql.match(/UNION ALL/g)?.length).toBe(12);
  });
});

describe("relationTo", () => {
  it("classifies next pages against the page's stage", () => {
    expect(relationTo("consideration", "decision")).toBe("forward");
    expect(relationTo("consideration", "awareness")).toBe("back");
    expect(relationTo("decision", "decision")).toBe("same");
    expect(relationTo("decision", null)).toBe("unknown");
    expect(relationTo(null, "consideration")).toBe("forward");
  });
});

describe("parsePageFlowRows", () => {
  it("builds totals, an aligned series and classified journeys", () => {
    const facts = parsePageFlowRows(
      [
        row("totals", "current", { sessions: 120, entrances: 80, moved_forward: 30, median_engaged_seconds: 21.04 }),
        row("totals", "prior", { sessions: 100 }),
        row("day", "current", { a: "20260924", sessions: 5 }),
        row("day", "prior", { a: "20260827", sessions: 3 }),
        row("next", "current", { a: "/en/apply", sessions: 30 }),
        row("next", "current", { a: "(exit)", sessions: 50 }),
        row("prev", "current", { a: "/en/blog/a", sessions: 12 }),
        row("channel", "current", { a: "paid", sessions: 60, moved_forward: 10 }),
        row("channel", "prior", { a: "paid", sessions: 40 }),
        row("cta", "current", { a: "hero", b: "0", c: "Apply", d: "/en/apply", clicks: 9, sessions: 7 }),
        row("scroll", "current", { a: "50", sessions: 40 }),
        row("since", "current", { a: "cta_click", b: "20261001" }),
      ],
      { stage: "consideration", index, window },
    );
    expect(facts.current.sessions).toBe(120);
    expect(facts.current.median_engaged_seconds).toBe(21);
    expect(facts.prior.sessions).toBe(100);
    expect(facts.series).toHaveLength(28);
    expect(facts.series[0]).toEqual({ day: "2026-09-24", sessions: 5, prior_sessions: 3 });
    expect(facts.next_pages[0]).toMatchObject({ path: "/en/apply", stage: "decision", relation: "forward" });
    expect(facts.next_pages[1]).toMatchObject({ path: "(exit)", relation: "exit" });
    expect(facts.previous_pages[0]).toMatchObject({ stage: "awareness", relation: "back" });
    expect(facts.channels[0]).toMatchObject({ channel: "paid", sessions: 60, prior_sessions: 40 });
    expect(facts.cta[0]).toMatchObject({ section_type: "hero", section_index: 0, clicks: 9 });
    expect(facts.scroll).toEqual([{ depth: 50, sessions: 40 }]);
    expect(facts.tracking_since).toEqual({ cta_click: "2026-10-01", scroll_depth: null });
  });
});
