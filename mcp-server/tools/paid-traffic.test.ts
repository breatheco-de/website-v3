import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CatalogGrant } from "../lib/tool-catalog.js";

vi.mock("../lib/content.js", () => ({ resolveSiteContext: () => ({ ok: true, domain: "4geeks.com" }) }));
vi.mock("../lib/oauth.js", () => ({ getTokenUsername: () => "staff@4geeks.com", getTokenClientName: () => undefined }));
vi.mock("../lib/auth.js", () => ({
  denyUnlessMetricsView: async () => null,
  checkCap: async () => false,
  getActiveRoleId: () => undefined,
  getActiveMcpToken: () => undefined,
}));

const { registerPaidTrafficTools, accountSyncWarnings, overviewNextActions, adsRunWarnings, adsIssueNextActions, compactCampaignRef } = await import("./paid-traffic");

describe("compactCampaignRef", () => {
  it("drops zero counts, null rates, empty money and false flags but keeps identity and computed 0 rates", () => {
    const out = compactCampaignRef({
      platform: null,
      campaign_id: null,
      campaign_name: "Visits without campaign tag",
      untagged: true,
      paid_visits: 40,
      clicks: 0,
      spend: {},
      unique_leads: 0,
      conversion_rate: 0,
      ctr: null,
      cost_per_lead: {},
      low_sample: false,
      tag_texts: [],
      visits_by_platform: { meta: 40 },
    });
    expect(out).toEqual({
      platform: null,
      campaign_id: null,
      campaign_name: "Visits without campaign tag",
      untagged: true,
      paid_visits: 40,
      conversion_rate: 0,
      visits_by_platform: { meta: 40 },
    });
  });
});

describe("accountSyncWarnings", () => {
  it("flags unreadable accounts and accounts still waiting on their first load", () => {
    const w = accountSyncWarnings([
      { id: "111", name: "US", history_loaded: true },
      { id: "222", history_loaded: false, sync_error: "no access" },
      { id: "333", history_loaded: false },
    ]);
    expect(w.map((x) => x.code)).toEqual(["meta_account_unreadable", "meta_account_not_synced"]);
    expect(w[0]!.message).toContain("222");
    expect(w[0]!.message).toContain("no access");
    expect(w[1]!.message).toContain("333");
    expect(w[1]!.message).not.toContain("222");
  });

  it("is empty when every account is loaded", () => {
    expect(accountSyncWarnings([{ id: "111", history_loaded: true }])).toEqual([]);
    expect(accountSyncWarnings(undefined)).toEqual([]);
  });
});

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;

function register(grants: CatalogGrant[]): Handler {
  let handler: Handler | null = null;
  const mcp = { tool: (...args: unknown[]) => (handler = args[args.length - 1] as Handler) } as unknown as McpServer;
  registerPaidTrafficTools(mcp, "token", grants);
  return handler!;
}

function parse(res: Awaited<ReturnType<Handler>>) {
  return JSON.parse(res.content[0]!.text) as Record<string, unknown> & {
    warnings: Array<{ code: string; message: string }>;
    side_effects: Array<{ kind: string }>;
    issues: Array<{ id: string }>;
  };
}

const ISSUE = {
  id: "ads:meta:missing_tracking_params:campaign:c1",
  code: "missing_tracking_params",
  severity: "warning",
  affected_ads: Array.from({ length: 30 }, (_, i) => `a${i + 1}`),
  affected_ads_total: 30,
  verify: { action: "recheck", state: "open", verify: { kind: "instant" } },
  details: { ads: [{ ad_id: "a1" }, { ad_id: "a2" }, { ad_id: "a3" }], ads_total: 8, ads_offset: 0, unchecked: [{ reason: "setup_fetch_failed", ads: 2 }] },
};

const RUN = { never_run: false, last_run: { finished_at: "2026-09-29T10:00:00.000Z", skipped: [] }, active: [], last_failed: null, busy: null };

const calls: Array<{ url: string; method: string }> = [];
let reportWarnings: Array<{ code: string; message: string }> = [];
let reportError: { status: number; body: Record<string, unknown> } | null = null;

beforeEach(() => {
  calls.length = 0;
  reportWarnings = [];
  reportError = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET" });
      if (url.includes("/api/ads/sync")) return new Response(JSON.stringify({ refresh: { state: "queued" } }), { status: 200 });
      if (url.includes("platform=overview")) {
        return new Response(
          JSON.stringify({
            platform: "overview",
            window_days: 28,
            status: "errors",
            platforms: {
              meta: { connected: true, status: "ok", open_errors: 0, open_warnings: 0, top_issues: [] },
              google: { connected: true, status: "errors", open_errors: 1, open_warnings: 0, top_issues: [] },
            },
            shared_issues: [{ id: "consent_rate_drop", code: "consent_rate_drop", why: "Accept rate dropped." }],
            totals: {},
          }),
          { status: 200 },
        );
      }
      if (url.includes("platform=google")) {
        return new Response(
          JSON.stringify({
            platform: "google",
            window_days: 28,
            issue_window_days: 28,
            status: "warnings",
            issues: [{ id: "google_transfer_stale", code: "google_transfer_stale" }],
            warnings: [{ code: "google_data_through", message: "Google data through 2026-06-28" }, { code: "other", message: "x" }],
            refresh: { state: "idle" },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/api/ads/report")) {
        if (reportError) return new Response(JSON.stringify(reportError.body), { status: reportError.status });
        const report = {
          meta: { connected: true, last_synced_at: null, accounts: [] },
          ga4: { configured: true, last_export_date: null },
          pages: [],
          destinations: [],
          campaigns: [],
          totals: {},
          warnings: reportWarnings,
          refresh: { state: "queued" },
        };
        return new Response(JSON.stringify(report), { status: 200 });
      }
      const detail = url.includes("issue_ids");
      const body = detail
        ? { issue_window_days: 28, issues: [ISSUE], missing_issue_ids: ["gone:1"], refresh: { state: "idle" }, run: RUN }
        : {
            window_days: 28,
            issue_window_days: 28,
            status: "warnings",
            kpis: {},
            issues: [ISSUE],
            warnings: [],
            refresh: { state: "idle" },
            run: RUN,
          };
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("get_paid_traffic refresh gate", () => {
  it("warns refresh_not_allowed without ads_settings and still reads", async () => {
    const out = parse(await register([{ name: "metrics_view" } as CatalogGrant])({ mode: "diagnostics", platform: "meta", refresh: true }));
    expect(out.warnings.map((w) => w.code)).toContain("refresh_not_allowed");
    expect(calls.some((c) => c.url.includes("/api/ads/sync"))).toBe(false);
    expect(out.issues).toHaveLength(1);
    expect(out.side_effects.map((s) => s.kind)).not.toContain("meta_sync_enqueued");
  });

  it("queues the all-platform sync with ads_settings and reports both side effects", async () => {
    const grants = [{ name: "metrics_view" }, { name: "ads_settings" }] as CatalogGrant[];
    const out = parse(await register(grants)({ mode: "summary", refresh: true }));
    const sync = calls.find((c) => c.url.includes("/api/ads/sync"));
    expect(sync?.method).toBe("POST");
    expect(out.side_effects.map((s) => s.kind)).toEqual(expect.arrayContaining(["meta_sync_enqueued", "google_sync_enqueued"]));
    expect(out.warnings.map((w) => w.code)).not.toContain("refresh_not_allowed");
  });
});

describe("get_paid_traffic diagnostics details", () => {
  it("list mode: aggregates unchecked reasons and flags truncated ad lists", async () => {
    const out = parse(await register([{ name: "metrics_view" } as CatalogGrant])({ mode: "diagnostics", platform: "meta" }));
    const codes = out.warnings.map((w) => w.code);
    expect(decodeURIComponent(calls.find((c) => c.url.includes("/api/diagnostics/ads"))!.url)).toContain("platform=meta");
    expect(codes).toContain("tracking_unchecked_setup_fetch_failed");
    expect(codes).toContain("ads_truncated");
    expect(codes).toContain("ads_diagnostics_model");
    expect((out.issues[0] as unknown as { affected_ads: string[] }).affected_ads).toHaveLength(20);
    const next = (out as unknown as { next_actions: Array<{ tool: string; args_hint?: Record<string, unknown> }> }).next_actions;
    expect(next).toContainEqual(expect.objectContaining({ tool: "update_ads_issue", args_hint: { action: "recheck", issue_id: ISSUE.id } }));
    expect(out.side_effects).toEqual([]);
  });

  it("detail mode: sends issue_ids, reports missing ids and the next ads_offset", async () => {
    const out = parse(
      await register([{ name: "metrics_view" } as CatalogGrant])({
        mode: "diagnostics",
        issue_ids: [ISSUE.id, "gone:1"],
      }),
    );
    const diag = calls.find((c) => c.url.includes("/api/diagnostics/ads"))!;
    expect(decodeURIComponent(diag.url)).toContain(`issue_ids[]=${ISSUE.id}`);
    expect(decodeURIComponent(diag.url)).not.toContain("snapshot_id");
    const notFound = out.warnings.find((w) => w.code === "issue_not_found");
    expect(notFound?.message).toContain("gone:1");
    expect(out.warnings.map((w) => w.code)).toContain("diagnostics_platform_defaulted");
    const truncated = out.warnings.find((w) => w.code === "ads_truncated");
    expect(truncated?.message).toContain("ads_offset 3");
    expect((out.issues[0] as unknown as { affected_ads: string[] }).affected_ads).toHaveLength(30);
    expect(out.side_effects).toEqual([]);
  });
});

describe("get_paid_traffic filters", () => {
  const metricsOnly = [{ name: "metrics_view" } as CatalogGrant];

  it("forwards id filters and since / until to the report", async () => {
    await register(metricsOnly)({ mode: "campaigns", campaign_ids: ["111", "222"], ad_ids: ["9"], since: "2026-06-01", until: "2026-06-30" });
    const url = decodeURIComponent(calls.find((c) => c.url.includes("/api/ads/report"))!.url);
    expect(url).toContain("campaign_ids[]=111");
    expect(url).toContain("campaign_ids[]=222");
    expect(url).toContain("ad_ids[]=9");
    expect(url).toContain("since=2026-06-01");
    expect(url).toContain("until=2026-06-30");
    expect(url).not.toContain("adset_ids");
  });

  it("adds a mode campaigns next action when ids matched nothing", async () => {
    reportWarnings = [{ code: "filter_no_match", message: "No spend, visits or leads matched campaign_ids [111]" }];
    const out = parse(await register(metricsOnly)({ mode: "summary", campaign_ids: ["111"] })) as unknown as {
      warnings: Array<{ code: string }>;
      next_actions: Array<{ tool: string; args_hint?: { mode?: string } }>;
    };
    expect(out.warnings.map((w) => w.code)).toContain("filter_no_match");
    expect(out.next_actions.some((a) => a.tool === "get_paid_traffic" && a.args_hint?.mode === "campaigns")).toBe(true);
  });

  it("returns the platform_required_for_ids code from the report", async () => {
    reportError = { status: 400, body: { error: "Pass platform", code: "platform_required_for_ids" } };
    const out = parse(await register(metricsOnly)({ mode: "summary", campaign_ids: ["111"] }));
    expect(out.success).toBe(false);
    expect(out.code).toBe("platform_required_for_ids");
  });

  it("diagnostics: forwards id filters and warns that since / until are ignored", async () => {
    const out = parse(await register(metricsOnly)({ mode: "diagnostics", platform: "meta", adset_ids: ["55"], since: "2026-06-01" }));
    const url = decodeURIComponent(calls.find((c) => c.url.includes("/api/diagnostics/ads"))!.url);
    expect(url).toContain("adset_ids[]=55");
    expect(url).not.toContain("since=");
    const codes = out.warnings.map((w) => w.code);
    expect(codes).toContain("range_ignored_in_diagnostics");
    expect(codes).toContain("diagnostics_filtered");
  });
});

describe("get_paid_traffic diagnostics platforms", () => {
  const metricsOnly = [{ name: "metrics_view" } as CatalogGrant];

  it("overview (no platform): next action per platform with open issues; consent moves to warnings", async () => {
    const out = parse(await register(metricsOnly)({ mode: "diagnostics" })) as unknown as {
      platform: string;
      shared_issues: unknown[];
      warnings: Array<{ code: string }>;
      next_actions: Array<{ args_hint?: { platform?: string } }>;
      side_effects: unknown[];
    };
    expect(out.platform).toBe("overview");
    expect(out.next_actions.map((a) => a.args_hint?.platform)).toEqual(["google"]);
    expect(out.shared_issues).toEqual([]);
    expect(out.warnings.map((w) => w.code)).toContain("consent_rate_drop");
    expect(out.side_effects).toEqual([]);
  });

  it("google: forwards status warnings, writes nothing, flags ignored Meta-only args", async () => {
    const out = parse(await register(metricsOnly)({ mode: "diagnostics", platform: "google", ads_limit: 5 }));
    const codes = out.warnings.map((w) => w.code);
    expect(codes).toContain("google_data_through");
    expect(codes).not.toContain("other");
    expect(codes).toContain("google_diagnostics_args_ignored");
    expect(out.side_effects).toEqual([]);
    expect(out.issues.map((i) => i.id)).toEqual(["google_transfer_stale"]);
  });

  it("rejects platforms without diagnostics", async () => {
    const out = parse(await register(metricsOnly)({ mode: "diagnostics", platform: "tiktok" }));
    expect(out.success).toBe(false);
    expect(out.code).toBe("diagnostics_platform_unsupported");
    expect(calls.some((c) => c.url.includes("/api/diagnostics/ads"))).toBe(false);
  });

  it("overviewNextActions skips disconnected and clean platforms", () => {
    expect(
      overviewNextActions({
        meta: { connected: false, open_errors: 3 },
        google: { connected: true, open_errors: 0, open_warnings: 0 },
      }),
    ).toEqual([]);
  });
});

describe("Ads run state for agents", () => {
  it("never run → warning + a single run next action", () => {
    const run = { never_run: true, last_run: null, active: [], last_failed: null, busy: null };
    expect(adsRunWarnings(run).map((w) => w.code)).toEqual(["ads_never_run"]);
    expect(adsIssueNextActions([{ id: "x", verify: { action: "recheck" } }], run)).toEqual([
      expect.objectContaining({ tool: "update_ads_issue", args_hint: { action: "run" } }),
    ]);
  });

  it("flags running Runs, failures and skipped platforms (not fixed, not re-evaluated)", () => {
    const codes = adsRunWarnings({
      never_run: false,
      last_run: { finished_at: "2026-09-29", skipped: [{ platform: "google", reason: "not connected" }] },
      active: [{ job_id: "j", kind: "run", lane: "fork", status: "running" }],
      last_failed: { kind: "recheck", error: "Meta timeout." },
      busy: { code: "ads_sync_active", message: "Ads Sync is running." },
    });
    expect(codes.map((w) => w.code)).toEqual(["ads_run_in_progress", "ads_last_job_failed", "ads_platform_not_checked", "ads_sync_active"]);
    expect(codes[2]!.message).toContain("not fixed, not re-evaluated");
  });

  it("maps verify.action to recheck / mark_fixed (with report hint) and skips waiting issues", () => {
    const next = adsIssueNextActions(
      [
        { id: "a", verify: { action: "recheck_ready" } },
        { id: "b", verify: { action: "mark_fixed", verify: { kind: "fresh_days" } } },
        { id: "c", verify: { action: "wait" } },
      ],
      { never_run: false },
    );
    expect(next.map((n) => [n.args_hint?.action, n.args_hint?.issue_id, n.priority])).toEqual([
      ["recheck", "a", "recommended"],
      ["mark_fixed", "b", "optional"],
    ]);
    expect(next[1]!.args_hint).toHaveProperty("report");
  });
});
