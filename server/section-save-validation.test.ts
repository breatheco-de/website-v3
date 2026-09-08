import fs from "fs";
import { afterAll, describe, expect, it } from "vitest";
import { validateSectionOperations } from "./section-save-validation";
import { createDemo, demoFilePath } from "./component-section-demos";
import { geometryViolations } from "@shared/component-registry/geekchart/v1.0/server";

const HUMAN = { isMcpAuthor: false };
const AGENT = { isMcpAuthor: true };

const CLEAN = "flowchart LR\n  A[One] --> B[Two]";
const BROKEN = "flowchart LR\n  A[--> broken ]]]";

const createdDemoHashes: string[] = [];
function demoFor(source: string): void {
  const { hash } = createDemo({
    componentType: "geekchart",
    version: "v1.0",
    section: { type: "geekchart", source },
  });
  createdDemoHashes.push(hash);
}
afterAll(() => {
  for (const hash of createdDemoHashes) {
    try {
      fs.unlinkSync(demoFilePath(hash));
    } catch {
      /* already gone */
    }
  }
});

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

describe("validateSectionOperations (human author)", () => {
  it("reads the real MCP add shape: add_item with item", async () => {
    const r = await validateSectionOperations(
      [{ action: "add_item", path: "sections", item: { type: "geekchart", source: BROKEN } }],
      HUMAN,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("geekchart_geometry");
  });
  it("reads update_field aimed at a section's source", async () => {
    const r = await validateSectionOperations(
      [{ action: "update_field", path: "sections.2.source", value: BROKEN }],
      HUMAN,
    );
    expect(r.ok).toBe(false);
  });
  it("reads the operations-array 'section' field, not only sectionData", async () => {
    const r = await validateSectionOperations(
      [{ action: "add_section", section: { type: "geekchart", source: BROKEN } }],
      HUMAN,
    );
    expect(r.ok).toBe(false);
  });
  it("ignores sections of types that declare no server hooks", async () => {
    const r = await validateSectionOperations(
      [
        { sectionData: { type: "article", content: "hi" } },
        { action: "reorder_sections" },
        { action: "update_field", path: "sections.1.title", value: "hello" },
      ],
      HUMAN,
    );
    expect(r.ok).toBe(true);
  });
  it("accepts a clean chart and rejects an unparseable one", async () => {
    const clean = await validateSectionOperations(
      [{ sectionData: { type: "geekchart", source: CLEAN } }],
      HUMAN,
    );
    expect(clean.ok).toBe(true);
    const broken = await validateSectionOperations(
      [{ sectionData: { type: "geekchart", source: BROKEN } }],
      HUMAN,
    );
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.violations[0]).toMatch(/render failed/);
  });
});

describe("validateSectionOperations (MCP author, preview-first)", () => {
  const UNPREVIEWED = "flowchart LR\n  P[Never previewed] --> Q[Chart]";
  const PREVIEWED = "flowchart LR\n  R[Previewed] --> S[Chart]";

  it("rejects an agent save whose chart source was never demoed", async () => {
    const r = await validateSectionOperations(
      [{ action: "add_item", path: "sections", item: { type: "geekchart", source: UNPREVIEWED } }],
      AGENT,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("geekchart_preview_required");
      expect(r.message).toMatch(/preview/);
    }
  });
  it("accepts the same save once a demo with that exact source exists", async () => {
    demoFor(PREVIEWED);
    const r = await validateSectionOperations(
      [{ action: "add_item", path: "sections", item: { type: "geekchart", source: PREVIEWED } }],
      AGENT,
    );
    expect(r.ok).toBe(true);
  });
  it("duration/caption changes on a previewed chart need no fresh preview", async () => {
    demoFor(PREVIEWED);
    const r = await validateSectionOperations(
      [
        {
          action: "update_section",
          index: 0,
          section: { type: "geekchart", source: PREVIEWED, duration: 2, caption: "new caption" },
        },
      ],
      AGENT,
    );
    expect(r.ok).toBe(true);
  });
  it("update_field rewriting the source to something undemoed is rejected", async () => {
    const r = await validateSectionOperations(
      [{ action: "update_field", path: "sections.0.source", value: UNPREVIEWED }],
      AGENT,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("geekchart_preview_required");
  });
  it("a demoed-but-broken chart still fails geometry, with the geometry code", async () => {
    demoFor(BROKEN);
    const r = await validateSectionOperations(
      [{ sectionData: { type: "geekchart", source: BROKEN } }],
      AGENT,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("geekchart_geometry");
  });
  it("human saves are exempt from preview-first", async () => {
    const r = await validateSectionOperations(
      [{ sectionData: { type: "geekchart", source: CLEAN } }],
      HUMAN,
    );
    expect(r.ok).toBe(true);
  });
});
