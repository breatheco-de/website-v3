import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/openrush-client.js", () => ({
  isOpenRushConfigured: vi.fn(),
  inspectKeywordQuery: vi.fn(),
  OPENRUSH_INSPECT_KEYWORD_CREDITS: 5,
}));

vi.mock("./content.js", () => ({
  resolveContentType: vi.fn(() => ({
    contentType: "locations",
    config: {},
  })),
  loadPage: vi.fn(() => ({
    ok: true,
    data: { seo: { main_keyword: "Miami Coding Bootcamp" } },
  })),
}));

vi.mock("../../server/seo-index.js", () => ({
  loadSeoIndex: vi.fn(() => ({ entries: {} })),
  seoEntryId: vi.fn(() => "locations/miami-usa/en"),
}));

import { isOpenRushConfigured, inspectKeywordQuery } from "../../server/openrush-client.js";
import { runRefreshKeywordMetrics } from "./refresh-keyword-metrics-mcp";

const mockedConfigured = vi.mocked(isOpenRushConfigured);
const mockedInspect = vi.mocked(inspectKeywordQuery);

afterEach(() => {
  vi.clearAllMocks();
});

describe("runRefreshKeywordMetrics", () => {
  it("fails cleanly when OpenRush is inactive", async () => {
    mockedConfigured.mockReturnValue(false);
    const r = await runRefreshKeywordMetrics({
      contentPath: "/tmp/site",
      contentFolder: "site_x",
      contentType: "locations",
      slug: "miami-usa",
      locale: "en",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("openrush_inactive");
      expect(r.next_actions?.some((a) => a.tool === "update_issue")).toBe(true);
    }
    expect(mockedInspect).not.toHaveBeenCalled();
  });

  it("upserts cache on success and does not imply YAML write", async () => {
    mockedConfigured.mockReturnValue(true);
    mockedInspect.mockResolvedValue({
      ok: true,
      metrics: {
        keyword: "Miami Coding Bootcamp",
        monthly_volume: 1300,
        kw_difficulty: 33,
        competition_level: null,
        intent: null,
      },
      entry: {
        keyword: "Miami Coding Bootcamp",
        location: "United States",
        language: "English",
        fetched_at: "2026-09-09T00:00:00.000Z",
        monthly_volume: 1300,
        kw_difficulty: 33,
        notes: null,
        payload: null,
      },
      credits_note: "inspect_keyword uses 5 OpenRush credits",
    });

    const r = await runRefreshKeywordMetrics({
      contentPath: "/tmp/site",
      contentFolder: "site_x",
      contentType: "locations",
      slug: "miami-usa",
      locale: "en",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe("openrush_cache");
      expect(r.kw_monthly_volume).toBe(1300);
      expect(r.kw_difficulty).toBe(33);
      expect(r.side_effects.some((s) => s.kind === "openrush_keyword_cache")).toBe(true);
      expect(r.warnings.some((w) => w.code === "openrush_cache_only")).toBe(true);
      expect(r.warnings.some((w) => /did not write/i.test(w.message))).toBe(true);
    }
    expect(mockedInspect).toHaveBeenCalledOnce();
  });

  it("does not suggest inventing YAML when OpenRush pull fails", async () => {
    mockedConfigured.mockReturnValue(true);
    mockedInspect.mockResolvedValue({ ok: false, error: "credits exhausted" });
    const r = await runRefreshKeywordMetrics({
      contentPath: "/tmp/site",
      contentFolder: "site_x",
      contentType: "locations",
      slug: "miami-usa",
      locale: "en",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("openrush_keyword_failed");
      expect(r.warnings?.some((w) => /do not invent/i.test(w.message))).toBe(true);
    }
  });
});
