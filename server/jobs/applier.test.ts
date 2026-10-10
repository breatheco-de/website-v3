import { describe, expect, it } from "vitest";
import { decideSnapshot, isNewerSnapshot, snapshotGeneration } from "./applier";

describe("snapshot generation 0", () => {
  it("treats 0 as a real generation and rejects missing values", () => {
    expect(snapshotGeneration(0)).toBe(0);
    expect(snapshotGeneration(12)).toBe(12);
    expect(snapshotGeneration(undefined)).toBeNull();
    expect(snapshotGeneration(null)).toBeNull();
    expect(snapshotGeneration(Number.NaN)).toBeNull();
  });

  it("applies generation 0 when nothing has been applied yet", () => {
    expect(isNewerSnapshot(0, null)).toBe(true);
    expect(isNewerSnapshot(0, 0)).toBe(false);
    expect(isNewerSnapshot(4, 0)).toBe(true);
  });

  it("loads an older snapshot when the slow phase is not in memory yet", () => {
    expect(decideSnapshot({
      generation: 0,
      lastApplied: 851,
      slowPhaseReady: false,
      latestWriteGen: 0,
    })).toBe("apply");
    expect(decideSnapshot({
      generation: 0,
      lastApplied: 851,
      slowPhaseReady: true,
      latestWriteGen: 0,
    })).toBe("already-applied");
    expect(decideSnapshot({
      generation: 0,
      lastApplied: 851,
      slowPhaseReady: false,
      latestWriteGen: 900,
    })).toBe("stale");
  });
});
