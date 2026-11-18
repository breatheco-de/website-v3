import { describe, expect, it } from "vitest";
import { factLiteralWarnings } from "./fact-literals-mcp.js";

describe("factLiteralWarnings", () => {
  it("maps sync rows to MCP warnings", () => {
    const out = factLiteralWarnings([
      {
        message: "“84%” matches a stored site fact — prefer {{ global.global_job_placement_rate }}.",
        field_path: "sections.0.data.headline",
        literal: "84%",
        variables: ["global.global_job_placement_rate"],
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.code).toBe("fact_literal_prefer_variable");
    expect(out[0]?.message).toContain("sections.0.data.headline");
    expect(out[0]?.message).toContain("global.global_job_placement_rate");
  });

  it("ignores empty / non-array", () => {
    expect(factLiteralWarnings(null)).toEqual([]);
    expect(factLiteralWarnings([{ message: "" }])).toEqual([]);
  });
});
