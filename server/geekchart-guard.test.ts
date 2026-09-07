import { describe, expect, it } from "vitest";
import { geometryViolations, checkGeekchartSections } from "./geekchart-guard";

describe("geometryViolations", () => {
  it("blocks only the -runtime geometry class", () => {
    const warnings = [
      "6.1-runtime edge L_A_B_0 (A→B) passes 3.0 from C, under the 16 clearance floor",
      "1.7 on a 358px phone this chart is taller than twice its width (about 1.3 phone screens) — try direction LR before cutting content; past that, fewer boxes or two short charts",
      '6.5-label-length "..." (A→B) is longer than two 28-character pill lines — kept the first two; a label that long is a sentence and belongs in a caption',
      "6.2-runtime edge L_B_C_0 (B→C) starts at (10,10), off B's outline",
    ];
    expect(geometryViolations(warnings)).toEqual([warnings[0], warnings[3]]);
  });
  it("passes a clean list", () => {
    expect(geometryViolations(["1.7 whatever"])).toEqual([]);
  });
});

describe("checkGeekchartSections", () => {
  it("reads the operations-array 'section' field, not only sectionData", async () => {
    const r = await checkGeekchartSections([
      { action: "add_section", section: { type: "geekchart", source: "flowchart LR\n  A[--> broken ]]]" } },
    ]);
    expect(r.ok).toBe(false);
  });
  it("ignores non-geekchart operations", async () => {
    const r = await checkGeekchartSections([
      { sectionData: { type: "article", content: "hi" } },
      { action: "reorder_sections" },
    ]);
    expect(r.ok).toBe(true);
  });
  it("accepts a clean chart and rejects an unparseable one", async () => {
    const clean = await checkGeekchartSections([
      { sectionData: { type: "geekchart", source: "flowchart LR\n  A[One] --> B[Two]" } },
    ]);
    expect(clean.ok).toBe(true);
    const broken = await checkGeekchartSections([
      { sectionData: { type: "geekchart", source: "flowchart LR\n  A[--> ]]]" } },
    ]);
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.violations[0]).toMatch(/render failed/);
  });
});
