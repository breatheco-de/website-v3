import { beforeEach, describe, expect, it, vi } from "vitest";

const setPending = vi.fn();

vi.mock("./pipeline-state", () => ({
  setPendingFactLiteralsDelta: (...args: unknown[]) => setPending(...args),
}));

vi.mock("./variable-manager", () => ({
  getVariableManager: () => ({
    getDefinitions: () => ({
      "global.price": { default: "$900", category: "price" },
    }),
    resolveVariable: (name: string) =>
      name === "global.price" ? { value: "$900" } : null,
  }),
}));

vi.mock("./content-proposals/claim-cues", () => ({
  evaluateClaimCues: (text: string) =>
    /\$\d|%|\+\d/.test(text) ? "ambiguous" : "clear_no",
  textFromUnknown: (v: unknown) => {
    if (typeof v === "string") return v;
    if (v == null) return "";
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  },
}));

import { evaluateFactLiteralWarnings } from "./fact-literals-edit";

describe("evaluateFactLiteralWarnings", () => {
  beforeEach(() => {
    setPending.mockClear();
  });

  it("skips draft / non-live writes", () => {
    const out = evaluateFactLiteralWarnings({
      contentRoot: "/tmp",
      isLiveWrite: false,
      entryData: { funnel: { stage: "decision" } },
      changes: [{ field_path: "sections.0.title", value: "Only $900 today" }],
      site: "site_test",
      entryKey: "landing/x@en",
    });
    expect(out).toEqual([]);
    expect(setPending).not.toHaveBeenCalled();
  });

  it("skips awareness (non-selling) funnel stages", () => {
    const out = evaluateFactLiteralWarnings({
      contentRoot: "/tmp",
      isLiveWrite: true,
      entryData: { funnel: { stage: "awareness" } },
      changes: [{ field_path: "sections.0.title", value: "Only $900 today" }],
      site: "site_test",
      entryKey: "landing/x@en",
    });
    expect(out).toEqual([]);
    expect(setPending).not.toHaveBeenCalled();
  });

  it("returns exact-match warnings and stashes delta on live decision pages", () => {
    const out = evaluateFactLiteralWarnings({
      contentRoot: "/tmp",
      isLiveWrite: true,
      entryData: { funnel: { stage: "decision", products: ["full-stack"] } },
      changes: [{ field_path: "sections.0.title", value: "Only $900 today" }],
      site: "site_test",
      entryKey: "landing/x@en",
      locale: "en",
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.literal).toBe("$900");
    expect(out[0]?.variables).toContain("global.price");
    expect(setPending).toHaveBeenCalledTimes(1);
  });

  it("does not stash on dry-run when stashForOnSave is false", () => {
    evaluateFactLiteralWarnings({
      contentRoot: "/tmp",
      isLiveWrite: true,
      entryData: { funnel: { stage: "consideration" } },
      changes: [{ field_path: "sections.0.title", value: "Only $900 today" }],
      site: "site_test",
      entryKey: "landing/x@en",
      stashForOnSave: false,
    });
    expect(setPending).not.toHaveBeenCalled();
  });
});
