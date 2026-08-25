import { describe, it, expect } from "vitest";
import { gscHeadline, gscInspectModeLabel, gscPermissionLabel, isGscPropertyAccessDenied } from "./gscInspection";

describe("gscHeadline", () => {
  it("labels drafts, never-checked, indexed, and errors", () => {
    expect(gscHeadline(null, { requested: "/x", loc: null, inSitemap: false, isDraft: true, isPreview: true })).toBe(
      "Not in sitemap (draft)",
    );
    expect(gscHeadline(null)).toBe("Never checked");
    expect(gscHeadline({ inspectedAt: "t", verdict: "PASS" })).toBe("Indexed");
    expect(gscHeadline({ inspectedAt: "t", coverageState: "Submitted and indexed" })).toBe("Indexed");
    expect(gscHeadline({ inspectedAt: "t", verdict: "FAIL" })).toBe("Not indexed");
    expect(gscHeadline({ inspectedAt: "t", error: "quota" })).toBe("Error");
  });
});

describe("isGscPropertyAccessDenied", () => {
  it("detects Search Console permission errors", () => {
    expect(isGscPropertyAccessDenied("Search Console inspect failed (403): PERMISSION_DENIED")).toBe(true);
    expect(isGscPropertyAccessDenied("quota exceeded")).toBe(false);
  });
});

describe("gscInspectModeLabel", () => {
  it("labels bulk inspect modes", () => {
    expect(gscInspectModeLabel("never")).toBe("never inspected");
    expect(gscInspectModeLabel("stale")).toBe("stale");
    expect(gscInspectModeLabel("all")).toBe("all");
  });
});
