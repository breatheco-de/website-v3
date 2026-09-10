import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isApprovedSeoResearchSource,
  normalizeSeoResearchSource,
  seoResearchWriteGate,
  touchesKwMetricSets,
  touchesKwMetrics,
} from "./seo-research-gate";

vi.mock("../../server/openrush-client.js", () => ({
  isOpenRushConfigured: vi.fn(),
}));

import { isOpenRushConfigured } from "../../server/openrush-client.js";

const mockedConfigured = vi.mocked(isOpenRushConfigured);

afterEach(() => {
  vi.clearAllMocks();
});

describe("seo-research-gate", () => {
  it("detects kw_* set vs reset", () => {
    expect(
      touchesKwMetricSets([{ field_path: "seo.kw_monthly_volume", value: 100 }]),
    ).toBe(true);
    expect(
      touchesKwMetricSets([{ field_path: "seo.kw_monthly_volume", reset: true }]),
    ).toBe(false);
    expect(
      touchesKwMetrics([{ field_path: "seo.kw_monthly_volume", reset: true }]),
    ).toBe(true);
    expect(touchesKwMetricSets([{ field_path: "seo.main_keyword", value: "x" }])).toBe(false);
  });

  it("approves staff_provided and external:name only", () => {
    expect(isApprovedSeoResearchSource("staff_provided")).toBe(true);
    expect(isApprovedSeoResearchSource("external:google_keyword_planner")).toBe(true);
    expect(isApprovedSeoResearchSource("external: ")).toBe(false);
    expect(isApprovedSeoResearchSource("openrush")).toBe(false);
    expect(isApprovedSeoResearchSource("estimated")).toBe(false);
    expect(isApprovedSeoResearchSource("model")).toBe(false);
    expect(normalizeSeoResearchSource(" Staff_Provided ")).toBe("staff_provided");
    expect(normalizeSeoResearchSource("external: Ahrefs ")).toBe("external:Ahrefs");
  });

  it("allows non-kw updates without source", () => {
    mockedConfigured.mockReturnValue(true);
    const r = seoResearchWriteGate({
      contentRoot: "/tmp",
      updates: [{ field_path: "seo.main_keyword", value: "learn python" }],
      slug: "foo",
      locale: "en",
      contentType: "blog",
    });
    expect(r.ok).toBe(true);
  });

  it("rejects kw_* YAML when OpenRush is configured (B1)", () => {
    mockedConfigured.mockReturnValue(true);
    const r = seoResearchWriteGate({
      contentRoot: "/tmp",
      updates: [
        { field_path: "seo.kw_monthly_volume", value: 1300 },
        { field_path: "seo.kw_difficulty", value: 33 },
      ],
      seo_research_source: "staff_provided",
      slug: "miami-usa",
      locale: "en",
      contentType: "locations",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("seo_research_use_openrush");
      expect(r.next_actions.some((a) => a.tool === "refresh_keyword_metrics")).toBe(true);
    }
  });

  it("requires provenance when OpenRush is off", () => {
    mockedConfigured.mockReturnValue(false);
    const missing = seoResearchWriteGate({
      contentRoot: "/tmp",
      updates: [{ field_path: "seo.kw_monthly_volume", value: 100 }],
      slug: "foo",
      locale: "en",
      contentType: "blog",
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe("seo_research_source_required");

    const bad = seoResearchWriteGate({
      contentRoot: "/tmp",
      updates: [{ field_path: "seo.kw_difficulty", value: 40 }],
      seo_research_source: "estimated",
      slug: "foo",
      locale: "en",
      contentType: "blog",
    });
    expect(bad.ok).toBe(false);

    const ok = seoResearchWriteGate({
      contentRoot: "/tmp",
      updates: [
        { field_path: "seo.kw_monthly_volume", value: 100 },
        { field_path: "seo.kw_difficulty", value: 40 },
      ],
      seo_research_source: "external:google_keyword_planner",
      slug: "foo",
      locale: "en",
      contentType: "blog",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.source).toBe("external:google_keyword_planner");
  });

  it("allows reset of kw_* without provenance", () => {
    mockedConfigured.mockReturnValue(false);
    const r = seoResearchWriteGate({
      contentRoot: "/tmp",
      updates: [{ field_path: "seo.kw_monthly_volume", reset: true }],
      slug: "foo",
      locale: "en",
      contentType: "blog",
    });
    expect(r.ok).toBe(true);
  });
});
