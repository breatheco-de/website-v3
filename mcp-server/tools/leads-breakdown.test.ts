import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LeadsListResponse, LeadsStatsResponse } from "../../shared/leads-query.js";

let sites = [{ domain: "4geeks.com" }, { domain: "florida.4geeks.com" }];
vi.mock("../lib/content.js", () => ({
  resolveSiteContext: () => ({ ok: true, domain: "4geeks.com" }),
  getMcpSiteConfigs: () => sites,
}));
vi.mock("../lib/oauth.js", () => ({ getTokenUsername: () => "staff@4geeks.com" }));
vi.mock("../lib/auth.js", () => ({ denyUnlessMetricsView: async () => null }));

const {
  registerLeadsBreakdownTools,
  leadsQueryParams,
  dropMostSpecificFilter,
  leadsBreakdownWarnings,
  leadsRowsNote,
  shapeLeadsBreakdown,
  filtersMatchNothingNextAction,
} = await import("./leads-breakdown");

const DAY = 86_400_000;
const END = Date.UTC(2026, 9, 8);
const START = END - 30 * DAY;

function stats(over: Partial<LeadsStatsResponse> = {}, kpis: Partial<LeadsStatsResponse["kpis"]> = {}): LeadsStatsResponse {
  return {
    range: "30d",
    start_ms: START,
    end_ms: END,
    collecting_since: START - 100 * DAY,
    kpis: {
      total_all_time: 500,
      in_range: 40,
      previous: 30,
      delta_pct: 33.3,
      paid: 20,
      paid_share: 50,
      tagged: 25,
      tagged_share: 62.5,
      tracked: 40,
      organic_search: 10,
      organic_share: 25,
      no_consent: 0,
      meta_unclear: 2,
      ...kpis,
    },
    tracking_since: START - 10 * DAY,
    product_since: null,
    funnel_since: START - 10 * DAY,
    funnel_persona_product_unknown: 0,
    timeline: { bucket: "day", points: [] },
    breakdowns: {
      source_medium: [{ key: "google|cpc", label: "google / cpc", count: 10, pct: 25, filter: { source: "google", medium: "cpc" } }],
      channels: [],
      conversion_paths: [],
      landing_paths: [],
      experiments: [],
      funnel_products: [],
      funnel_personas: [],
      time_to_lead: { paid_with_click: 0, median_days: null, buckets: [] },
    },
    ...over,
  } as LeadsStatsResponse;
}

function list(total: number, n: number): LeadsListResponse {
  return {
    total,
    page: 1,
    page_size: 20,
    total_pages: Math.max(1, Math.ceil(total / 20)),
    rows: Array.from({ length: n }, (_, i) => ({ submission_id: `s${i}` })) as unknown as LeadsListResponse["rows"],
  };
}

const codes = (ws: Array<{ code: string }>) => ws.map((w) => w.code);

describe("leadsQueryParams", () => {
  it("maps filters, range, include_test and site; omits defaults and never pages", () => {
    const p = leadsQueryParams(
      { range: "90d", include_test: true, source: " google ", medium: "(none)", channel: "organic_search", product: "full-stack" },
      "4geeks.com",
    );
    expect(p.get("range")).toBe("90d");
    expect(p.get("include_test")).toBe("1");
    expect(p.get("source")).toBe("google");
    expect(p.get("medium")).toBe("(none)");
    expect(p.get("channel")).toBe("organic_search");
    expect(p.get("product")).toBe("full-stack");
    expect(p.get("__site")).toBe("4geeks.com");
    const funnel = leadsQueryParams({ funnel_product: "ai-flex", funnel_persona: "ai-flex:the-developer" });
    expect(funnel.get("funnel_product")).toBe("ai-flex");
    expect(funnel.get("funnel_persona")).toBe("ai-flex:the-developer");
    expect(p.has("page")).toBe(false);
  });

  it("omits 30d default and blank filters", () => {
    const p = leadsQueryParams({ source: "  " });
    expect(p.toString()).toBe("");
  });
});

describe("dropMostSpecificFilter", () => {
  it("drops variant before experiment before paths before source/medium before channel", () => {
    let f: Record<string, string> = {
      channel: "paid",
      source: "facebook",
      medium: "cpc",
      landing_path: "/en/x",
      conversion_path: "/en/y",
      experiment: "e1",
      variant: "b",
      ttl: "1_3d",
    };
    const order: string[] = [];
    for (;;) {
      const next = dropMostSpecificFilter(f);
      if (!next) break;
      order.push(next.dropped);
      f = next.filters as Record<string, string>;
    }
    expect(order).toEqual(["variant", "experiment", "conversion_path", "landing_path", "ttl", "source", "medium", "channel"]);
  });

  it("drops funnel persona, then funnel product, before the catalog product", () => {
    let f: Record<string, string> = { product: "full-stack", funnel_product: "ai-flex", funnel_persona: "ai-flex:the-developer" };
    const order: string[] = [];
    for (let next = dropMostSpecificFilter(f); next; next = dropMostSpecificFilter(f)) {
      order.push(next.dropped);
      f = next.filters as Record<string, string>;
    }
    expect(order).toEqual(["funnel_persona", "funnel_product", "product"]);
  });

  it("returns null with no filters", () => {
    expect(dropMostSpecificFilter({})).toBeNull();
  });
});

describe("leadsBreakdownWarnings", () => {
  const base = { filters: {}, domain: "4geeks.com", otherSites: [] as string[] };

  it("always carries the paid and source/medium notes, nothing else on a clean view", () => {
    expect(codes(leadsBreakdownWarnings({ ...base, stats: stats() }))).toEqual([
      "paid_count_differs_from_paid_traffic",
      "source_medium_differs_from_channel",
    ]);
  });

  it("single_site names the other sites", () => {
    const ws = leadsBreakdownWarnings({ ...base, otherSites: ["florida.4geeks.com"], stats: stats() });
    const w = ws.find((x) => x.code === "single_site")!;
    expect(w.message).toContain("4geeks.com");
    expect(w.message).toContain("florida.4geeks.com");
  });

  it("not_production_data with and without a download", () => {
    const pulled = leadsBreakdownWarnings({ ...base, stats: stats({ local_copy: { pulled_at: END, since: START, origin: "x" } }) });
    expect(pulled.find((w) => w.code === "not_production_data")!.message).toContain("2026-10-08");
    const never = leadsBreakdownWarnings({ ...base, stats: stats({ local_copy: { pulled_at: null, since: null, origin: null } }) });
    expect(never.find((w) => w.code === "not_production_data")!.message).toContain("never downloaded");
  });

  it("filters_match_nothing only when filters are set and nothing is in range", () => {
    expect(codes(leadsBreakdownWarnings({ ...base, filters: { source: "x" }, stats: stats({}, { in_range: 0 }) }))).toContain(
      "filters_match_nothing",
    );
    expect(codes(leadsBreakdownWarnings({ ...base, stats: stats({}, { in_range: 0 }) }))).not.toContain("filters_match_nothing");
    expect(codes(leadsBreakdownWarnings({ ...base, filters: { source: "x" }, stats: stats() }))).not.toContain(
      "filters_match_nothing",
    );
  });

  it("channel tracking partial and paid rule change when tracking started inside the range", () => {
    const ws = codes(leadsBreakdownWarnings({ ...base, stats: stats({ tracking_since: START + 5 * DAY }) }));
    expect(ws).toContain("channel_tracking_partial");
    expect(ws).toContain("paid_rule_change_in_range");
  });

  it("channel tracking partial (no rule change) when nothing is tracked yet", () => {
    const ws = codes(leadsBreakdownWarnings({ ...base, stats: stats({ tracking_since: null }) }));
    expect(ws).toContain("channel_tracking_partial");
    expect(ws).not.toContain("paid_rule_change_in_range");
  });

  it("no_consent_leads when any lead lacks consent", () => {
    const ws = leadsBreakdownWarnings({ ...base, stats: stats({}, { no_consent: 3 }) });
    expect(ws.find((w) => w.code === "no_consent_leads")!.message).toContain("3 lead");
  });

  it("funnel notes: overlap when products are recorded, partial tracking, unknown persona products", () => {
    const withProducts = stats({
      breakdowns: {
        ...stats().breakdowns,
        funnel_products: [{ key: "ai-flex", label: "AI Flex", count: 3, pct: 7.5, filter: { funnel_product: "ai-flex" } }],
      },
    });
    expect(codes(leadsBreakdownWarnings({ ...base, stats: withProducts }))).toContain("funnel_counts_overlap");
    expect(codes(leadsBreakdownWarnings({ ...base, filters: { funnel_persona: ":dev" }, stats: stats() }))).toContain(
      "funnel_counts_overlap",
    );
    expect(codes(leadsBreakdownWarnings({ ...base, stats: stats({ funnel_since: null }) }))).toContain("funnel_tracking_partial");
    const inside = leadsBreakdownWarnings({ ...base, stats: stats({ funnel_since: START + 2 * DAY }) });
    expect(inside.find((w) => w.code === "funnel_tracking_partial")!.message).toContain("2026-09-10");
    const unknown = leadsBreakdownWarnings({ ...base, stats: stats({ funnel_persona_product_unknown: 4 }) });
    expect(unknown.find((w) => w.code === "persona_product_unknown")!.message).toContain("4 lead");
  });
});

describe("shapeLeadsBreakdown", () => {
  it("omits timeline and leads unless asked, keeps breakdown filters", () => {
    const out = shapeLeadsBreakdown({ stats: stats(), list: null, domain: "4geeks.com", includeTimeline: false });
    expect(out.timeline).toBeUndefined();
    expect(out.leads).toBeUndefined();
    expect(out.site).toBe("4geeks.com");
    expect((out.breakdowns as LeadsStatsResponse["breakdowns"]).source_medium[0]!.filter).toEqual({ source: "google", medium: "cpc" });
  });

  it("adds timeline and the latest-20 leads with a note", () => {
    const out = shapeLeadsBreakdown({ stats: stats(), list: list(57, 20), domain: "4geeks.com", includeTimeline: true });
    expect(out.timeline).toEqual({ bucket: "day", points: [] });
    const leads = out.leads as { total: number; shown: number; note: string };
    expect(leads.total).toBe(57);
    expect(leads.shown).toBe(20);
    expect(leads.note).toContain("Latest 20 of 57");
  });

  it("rows note says all matching leads when they fit", () => {
    expect(leadsRowsNote(5, 5)).toBe("All matching leads.");
    expect(leadsRowsNote(0, 0)).toBe("All matching leads.");
  });
});

describe("filtersMatchNothingNextAction", () => {
  it("retries with the same args minus the most specific filter", () => {
    const action = filtersMatchNothingNextAction(
      { range: "90d", site: "4geeks.com", channel: "paid", variant: "b", experiment: "e1" },
      { channel: "paid", variant: "b", experiment: "e1" },
    )!;
    expect(action.tool).toBe("get_leads_breakdown");
    expect(action.args_hint).toEqual({ channel: "paid", experiment: "e1", range: "90d", site: "4geeks.com" });
    expect(action.reason).toContain("variant");
  });
});

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;

function register(): Handler {
  let handler: Handler | null = null;
  const mcp = { tool: (...args: unknown[]) => (handler = args[args.length - 1] as Handler) } as unknown as McpServer;
  registerLeadsBreakdownTools(mcp, "token", [{ name: "metrics_view" }]);
  return handler!;
}

const calls: string[] = [];
let statsBody: LeadsStatsResponse = stats();
let statsStatus = 200;

beforeEach(() => {
  calls.length = 0;
  statsBody = stats();
  statsStatus = 200;
  sites = [{ domain: "4geeks.com" }, { domain: "florida.4geeks.com" }];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("/api/ads/leads/stats")) {
        return new Response(JSON.stringify(statsStatus === 200 ? statsBody : { error: "Invalid range" }), { status: statsStatus });
      }
      return new Response(JSON.stringify(list(3, 3)), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("get_leads_breakdown handler", () => {
  it("calls stats only by default and returns the always-on notes", async () => {
    const res = await register()({});
    const body = JSON.parse(res.content[0]!.text);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/api/ads/leads/stats?");
    expect(calls[0]).toContain("__site=4geeks.com");
    expect(body.success).toBe(true);
    expect(body.leads).toBeUndefined();
    expect(codes(body.warnings)).toEqual(
      expect.arrayContaining(["single_site", "paid_count_differs_from_paid_traffic", "source_medium_differs_from_channel"]),
    );
    expect(body.next_actions).toEqual([]);
  });

  it("fetches leads when include_leads and skips single_site on one-site installs", async () => {
    sites = [{ domain: "4geeks.com" }];
    const res = await register()({ include_leads: true, channel: "organic_search" });
    const body = JSON.parse(res.content[0]!.text);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatch(/\/api\/ads\/leads\?.*channel=organic_search/);
    expect(body.leads.note).toBe("All matching leads.");
    expect(codes(body.warnings)).not.toContain("single_site");
  });

  it("recommends a broader retry when filters match nothing", async () => {
    statsBody = stats({}, { in_range: 0 });
    const res = await register()({ source: "google", landing_path: "/en/x" });
    const body = JSON.parse(res.content[0]!.text);
    expect(body.next_actions[0].args_hint).toEqual({ source: "google" });
  });

  it("fails with the server error", async () => {
    statsStatus = 400;
    const res = await register()({});
    const body = JSON.parse(res.content[0]!.text);
    expect(body.success).toBe(false);
    expect(body.message).toContain("Invalid range");
  });
});
