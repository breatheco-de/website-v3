import { describe, expect, it } from "vitest";
import { validateSectionOperations } from "./section-save-validation";
import { geometryViolations } from "@shared/component-registry/geekchart/v1.0/server";

describe("geekchart geometryViolations", () => {
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

describe("validateSectionOperations", () => {
  it("reads the real MCP add shape: add_item with item", async () => {
    const r = await validateSectionOperations([
      { action: "add_item", path: "sections", item: { type: "geekchart", source: "flowchart LR\n  A[--> broken ]]]" } },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("geekchart_geometry");
  });
  it("reads update_field aimed at a section's source", async () => {
    const r = await validateSectionOperations([
      { action: "update_field", path: "sections.2.source", value: "flowchart LR\n  A[--> broken ]]]" },
    ]);
    expect(r.ok).toBe(false);
  });
  it("reads the operations-array 'section' field, not only sectionData", async () => {
    const r = await validateSectionOperations([
      { action: "add_section", section: { type: "geekchart", source: "flowchart LR\n  A[--> broken ]]]" } },
    ]);
    expect(r.ok).toBe(false);
  });
  it("ignores sections of types that declare no server hooks", async () => {
    const r = await validateSectionOperations([
      { sectionData: { type: "article", content: "hi" } },
      { action: "reorder_sections" },
      { action: "update_field", path: "sections.1.title", value: "hello" },
    ]);
    expect(r.ok).toBe(true);
  });
  it("accepts a clean chart and rejects an unparseable one", async () => {
    const clean = await validateSectionOperations([
      { sectionData: { type: "geekchart", source: "flowchart LR\n  A[One] --> B[Two]" } },
    ]);
    expect(clean.ok).toBe(true);
    const broken = await validateSectionOperations([
      { sectionData: { type: "geekchart", source: "flowchart LR\n  A[--> ]]]" } },
    ]);
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.violations[0]).toMatch(/render failed/);
  });
});
