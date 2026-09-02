import { describe, expect, it } from "vitest";
import { requireMutateReport } from "./page-tool-helpers.js";

function parseResult(result: { content: [{ type: "text"; text: string }] }) {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

describe("requireMutateReport", () => {
  it("rejects missing report", () => {
    const result = requireMutateReport(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = parseResult(result.result);
      expect(body.action_required).toBe("report_required");
      expect(body.code).toBe("report_required");
    }
  });

  it("rejects short report", () => {
    const result = requireMutateReport("too short");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = parseResult(result.result);
      expect(body.code).toBe("report_too_short");
    }
  });

  it("accepts report at least 80 characters", () => {
    const report =
      "Replaced blog hero with standard blogHero variant for title, subtitle, authors, and reading_time display.";
    const result = requireMutateReport(report);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trimmedReport).toBe(report);
      expect(result.trimmedReport.length).toBeGreaterThanOrEqual(80);
    }
  });
});
