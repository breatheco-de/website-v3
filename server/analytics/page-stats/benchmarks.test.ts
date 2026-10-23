import { describe, expect, it } from "vitest";
import { median, stageCostBenchmark, stageRateBenchmark } from "./benchmarks";
import type { PeerRow } from "@shared/page-stats";

const peer = (path: string, sessions: number, p: Partial<PeerRow> = {}): PeerRow => ({
  path, sessions, engaged: 0, moved_forward: 0, reached_decision: 0, task_sessions: 0, ...p,
});

describe("median", () => {
  it("handles odd, even and empty lists", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("stageRateBenchmark", () => {
  it("medians other same-stage pages with enough sessions, excluding this page", () => {
    const peers = [
      peer("/me", 1000, { reached_decision: 900 }),
      peer("/a", 200, { reached_decision: 20 }),
      peer("/b", 300, { reached_decision: 60 }),
      peer("/c", 400, { reached_decision: 120 }),
      peer("/tiny", 20, { reached_decision: 20 }),
    ];
    const r = stageRateBenchmark({ metric: "reached_decision_rate", peers, ownPaths: ["/me"], converted: new Map() });
    expect(r).toEqual({ rate: 0.2, pages: 3 });
  });

  it("uses ledger leads for decision conversion and needs at least 3 peers", () => {
    const peers = [peer("/a", 200), peer("/b", 400)];
    const converted = new Map([["/a", 10], ["/b", 8]]);
    expect(stageRateBenchmark({ metric: "conversion_rate", peers, ownPaths: [], converted }).rate).toBeNull();
    const more = [...peers, peer("/c", 100)];
    converted.set("/c", 3);
    expect(stageRateBenchmark({ metric: "conversion_rate", peers: more, ownPaths: [], converted }).rate).toBeCloseTo(0.03);
  });
});

describe("stageCostBenchmark", () => {
  it("medians per currency over pages with enough paid visits", () => {
    const r = stageCostBenchmark([
      { spend: { USD: 100 }, denominator: 10, enough: true },
      { spend: { USD: 300 }, denominator: 10, enough: true },
      { spend: { USD: 200 }, denominator: 10, enough: true },
      { spend: { USD: 9999 }, denominator: 1, enough: false },
      { spend: { EUR: 50 }, denominator: 5, enough: true },
    ]);
    expect(r.cost).toEqual({ USD: 20 });
    expect(r.pages).toBe(4);
  });
});
