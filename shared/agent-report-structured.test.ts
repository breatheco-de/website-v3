import { describe, expect, it } from "vitest";
import {
  buildStructuredAgentReport,
  composeAgentReportDisplay,
  deriveSimpleChanges,
  evaluateReportHeuristics,
  isBigFieldUpdate,
} from "@shared/agent-report-structured";

describe("agent-report-structured", () => {
  it("treats sections and long strings as big", () => {
    expect(isBigFieldUpdate({ field_path: "sections.0.data.body", value: "x" })).toBe(true);
    expect(
      isBigFieldUpdate({ field_path: "meta.description", value: "a".repeat(200) }),
    ).toBe(true);
    expect(isBigFieldUpdate({ field_path: "meta.title", value: "Short title" })).toBe(false);
    expect(isBigFieldUpdate({ field_path: "seo.pillar_path", value: "/hub" })).toBe(false);
  });

  it("derives simple_changes and skips big fields", () => {
    const changes = deriveSimpleChanges([
      { field_path: "meta.title", value: "Hello" },
      { field_path: "sections.1.data.links", value: [{ href: "/a" }] },
      { field_path: "seo.is_pillar", value: true },
    ]);
    expect(changes).toEqual([
      { field: "meta.title", after: "Hello" },
      { field: "seo.is_pillar", after: "true" },
    ]);
  });

  it("rejects boilerplate why and missing highlights for big updates", () => {
    const fail = evaluateReportHeuristics({
      why: "Cambio automatico del bot SEO via MCP con update_fields sobre el slug.",
      highlights: [],
      mode: "mutate_with_updates",
      updates: [{ field_path: "sections.0.data", value: { links: [] } }],
    });
    expect(fail.status).toBe("fail");
    if (fail.status === "fail") {
      expect(fail.missing.some((m) => /highlight|boilerplate|process/i.test(m))).toBe(true);
    }
  });

  it("passes solid why + simple-only updates without highlights", () => {
    const why =
      "Join orphan article to Coding Bootcamp hub for REFRESH #419 cluster fix.";
    const v = evaluateReportHeuristics({
      why,
      highlights: [],
      mode: "mutate_with_updates",
      updates: [{ field_path: "seo.pillar_path", value: "/us/coding-bootcamp" }],
    });
    expect(v.status).toBe("pass");
  });

  it("requires highlights for complete", () => {
    const v = evaluateReportHeuristics({
      why: "Fixed orphan page by setting pillar path to the bootcamp hub.",
      highlights: [],
      mode: "complete",
    });
    expect(v.status).toBe("fail");
  });

  it("composes display string", () => {
    const text = composeAgentReportDisplay({
      why: "Fix orphan",
      simple_changes: [{ field: "seo.pillar_path", after: "/hub" }],
      highlights: ["Added 2 internal links to related posts"],
    });
    expect(text).toContain("Why: Fix orphan");
    expect(text).toContain("• seo.pillar_path: /hub");
    expect(text).toContain("• Added 2 internal links");
  });

  it("buildStructuredAgentReport fails on short why", () => {
    const r = buildStructuredAgentReport({ why: "too short", highlights: [] });
    expect(r.ok).toBe(false);
  });
});
