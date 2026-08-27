import { describe, it, expect } from "vitest";
import {
  googleToCrawlerStatus,
  crawlerProblemCount,
  allApplicableCrawlersIndexed,
  crawlerBadgeState,
  canonicalMismatch,
  normalizeCanonicalUrl,
  gscHeadline,
  type CrawlerPageStatus,
} from "./search-engine-status";

function google(overrides: Partial<CrawlerPageStatus> & { status: CrawlerPageStatus["status"] }): CrawlerPageStatus {
  return {
    id: "google",
    label: "Google",
    ...overrides,
  };
}

describe("gscHeadline", () => {
  it("maps draft, never checked, indexed, not indexed, error", () => {
    expect(
      gscHeadline(null, { requested: "/x", loc: null, inSitemap: false, isDraft: true, isPreview: true }),
    ).toBe("Not in sitemap (draft)");
    expect(gscHeadline(null)).toBe("Never checked");
    expect(gscHeadline({ inspectedAt: "t", verdict: "PASS" })).toBe("Indexed");
    expect(gscHeadline({ inspectedAt: "t", coverageState: "Submitted and indexed" })).toBe("Indexed");
    expect(gscHeadline({ inspectedAt: "t", verdict: "FAIL" })).toBe("Not indexed");
    expect(gscHeadline({ inspectedAt: "t", error: "quota" })).toBe("Error");
  });
});

describe("googleToCrawlerStatus", () => {
  it("maps loading, loadError, and not configured", () => {
    expect(googleToCrawlerStatus({ loading: true }).status).toBe("loading");
    expect(googleToCrawlerStatus({ loadError: true }).status).toBe("error");
    expect(googleToCrawlerStatus({ configured: false }).status).toBe("not_configured");
    expect(googleToCrawlerStatus({}).status).toBe("loading");
  });

  it("maps draft to not_applicable", () => {
    expect(
      googleToCrawlerStatus({
        configured: true,
        resolved: { requested: "/x", loc: null, inSitemap: false, isDraft: true, isPreview: true },
      }).status,
    ).toBe("not_applicable");
  });

  it("maps never checked, indexed, not indexed, and error", () => {
    expect(googleToCrawlerStatus({ configured: true, record: null }).status).toBe("never_checked");
    expect(
      googleToCrawlerStatus({ configured: true, record: { inspectedAt: "t", verdict: "PASS" } }).status,
    ).toBe("indexed");
    expect(
      googleToCrawlerStatus({ configured: true, record: { inspectedAt: "t", verdict: "FAIL" } }).status,
    ).toBe("not_indexed");
    expect(
      googleToCrawlerStatus({ configured: true, record: { inspectedAt: "t", error: "quota" } }).status,
    ).toBe("error");
  });
});

describe("canonicalMismatch", () => {
  it("returns false when either canonical missing", () => {
    expect(canonicalMismatch(null)).toBe(false);
    expect(canonicalMismatch({ inspectedAt: "t" })).toBe(false);
    expect(canonicalMismatch({ inspectedAt: "t", googleCanonical: "https://a.com/x" })).toBe(false);
  });

  it("returns false when equal after normalize", () => {
    expect(
      canonicalMismatch({
        inspectedAt: "t",
        googleCanonical: "https://www.example.com/foo/",
        userCanonical: "https://example.com/foo",
      }),
    ).toBe(false);
  });

  it("returns true when hosts or paths differ", () => {
    expect(
      canonicalMismatch({
        inspectedAt: "t",
        googleCanonical: "https://example.com/a",
        userCanonical: "https://example.com/b",
      }),
    ).toBe(true);
  });
});

describe("normalizeCanonicalUrl", () => {
  it("strips www and trailing slash", () => {
    expect(normalizeCanonicalUrl("https://www.Example.com/path/")).toBe("example.com/path");
  });
});

describe("crawlerProblemCount / allApplicableCrawlersIndexed / crawlerBadgeState", () => {
  it("treats never_checked as a problem without ok", () => {
    const statuses = [google({ status: "never_checked" })];
    expect(crawlerProblemCount(statuses)).toBe(1);
    expect(allApplicableCrawlersIndexed(statuses)).toBe(false);
    expect(crawlerBadgeState(statuses)).toEqual({ kind: "problems", count: 1 });
  });

  it("indexed alone is ok", () => {
    const statuses = [google({ status: "indexed" })];
    expect(crawlerProblemCount(statuses)).toBe(0);
    expect(allApplicableCrawlersIndexed(statuses)).toBe(true);
    expect(crawlerBadgeState(statuses)).toEqual({ kind: "ok", count: 0 });
  });

  it("draft alone is none (no problem, no check)", () => {
    const statuses = [google({ status: "not_applicable" })];
    expect(crawlerProblemCount(statuses)).toBe(0);
    expect(allApplicableCrawlersIndexed(statuses)).toBe(false);
    expect(crawlerBadgeState(statuses)).toEqual({ kind: "none", count: 0 });
  });

  it("not_configured and error are problems", () => {
    expect(crawlerBadgeState([google({ status: "not_configured" })])).toEqual({
      kind: "problems",
      count: 1,
    });
    expect(crawlerBadgeState([google({ status: "error" })])).toEqual({
      kind: "problems",
      count: 1,
    });
  });

  it("loading yields loading badge state", () => {
    expect(crawlerBadgeState([google({ status: "loading" })])).toEqual({
      kind: "loading",
      count: 0,
    });
  });

  it("mixed statuses: one not indexed yields problems count 1", () => {
    const statuses: CrawlerPageStatus[] = [
      google({ status: "indexed" }),
      { id: "google", label: "Other", status: "not_indexed" },
    ];
    expect(crawlerProblemCount(statuses)).toBe(1);
    expect(allApplicableCrawlersIndexed(statuses)).toBe(false);
    expect(crawlerBadgeState(statuses)).toEqual({ kind: "problems", count: 1 });
  });
});
