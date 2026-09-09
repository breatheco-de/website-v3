import { describe, expect, it } from "vitest";
import { requireMutateReport, requireMutateWhyHighlights } from "./page-tool-helpers.js";

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
      "Replaced blog hero with standard blogHero variant for title, subtitle, authors, and reading time display.";
    const result = requireMutateReport(report);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trimmedReport).toBe(report);
      expect(result.trimmedReport.length).toBeGreaterThanOrEqual(80);
    }
  });
});

describe("requireMutateWhyHighlights", () => {
  it("rejects missing why", () => {
    const result = requireMutateWhyHighlights(undefined, ["Set pillar"], {
      mode: "mutate_with_updates",
      updates: [{ field_path: "seo.pillar_path", value: "/hub" }],
    });
    expect(result.ok).toBe(false);
  });

  it("requires highlights for big field updates", () => {
    const result = requireMutateWhyHighlights(
      "Refresh article body and add internal links for cluster coverage ticket.",
      [],
      {
        mode: "mutate_with_updates",
        updates: [{ field_path: "sections.0.data", value: { html: "x" } }],
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = parseResult(result.result);
      expect(body.code).toBe("report_quality");
    }
  });

  it("accepts solid why for simple SEO update", () => {
    const result = requireMutateWhyHighlights(
      "Join orphan article to Coding Bootcamp hub for REFRESH #419.",
      [],
      {
        mode: "mutate_with_updates",
        updates: [{ field_path: "seo.pillar_path", value: "/us/coding-bootcamp" }],
      },
    );
    expect(result.ok).toBe(true);
  });
});
