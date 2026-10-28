import os from "os";
import path from "path";
import fs from "fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_UTM_CONVENTION } from "@shared/ads-settings";
import type { FunnelStage } from "@shared/funnel";
import { openVisitsDatabase } from "../first-party/visits-db";
import { rowFromMessage, writeBuffered, type PageMessage, type PageViewRow } from "../first-party/ingest";
import { openWindow, closeWindow } from "../first-party/windows";
import { buildFirstPartyFlow, utmGaps, windowFacts } from "./first-party-flow";
import type { PathStageIndex } from "./resolve";
import { buildPageAdvice, utmGapFinding, UTM_GAP_MIN_AD_VISITS } from "./advice";
import type { TrafficFacts, UtmGapFacts } from "@shared/page-stats";

const PAGE = "/en/landing/a";
const window = { current: { start: "2026-10-01", end: "2026-10-28" }, prior: { start: "2026-09-03", end: "2026-09-30" } };
const NOW = Date.parse("2026-10-29T12:00:00Z");

function stageIndex(stages: Record<string, FunnelStage>): PathStageIndex {
  const byPath = new Map(Object.entries(stages).map(([p, stage]) => [p, { key: p, content_type: "landing", slug: p, locale: "en", stage }]));
  const pathsByStage: PathStageIndex["pathsByStage"] = { awareness: [], consideration: [], decision: [], "post-enrollment": [] };
  for (const [p, s] of Object.entries(stages)) pathsByStage[s].push(p);
  return { byPath, pathsByStage, built_at: 0 };
}

let dir: string;
let db: ReturnType<typeof openVisitsDatabase>;
let seq = 0;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fpflow-"));
  db = openVisitsDatabase(path.join(dir, "visits.db"));
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function view(at: string, p: Partial<PageMessage> & { m?: "a" | "s" }, ctx: Partial<{ device: string }> = {}): PageViewRow {
  seq += 1;
  return rowFromMessage({ m: "s", id: `view-${String(seq).padStart(6, "0")}`, u: PAGE, tk: "t", ms: 15_000, ...p } as PageMessage, {
    now: Date.parse(at),
    contentType: "landing",
    device: ctx.device ?? "mobile",
    country: "US",
  });
}

function write(rows: PageViewRow[], transitions: Array<[string, string, string, number]> = []) {
  writeBuffered(db, {
    views: new Map(rows.map((r) => [r.view_key, r])),
    transitions: new Map(transitions.map(([day, from, to, n]) => [`${day}\u0001${from}\u0001${to}`, n])),
    credits: [],
  });
}

function flow(stage: FunnelStage = "consideration", index = stageIndex({ [PAGE]: "consideration", "/en/apply": "decision", "/en/blog/x": "awareness" })) {
  return buildFirstPartyFlow({
    db,
    paths: [PAGE],
    stage,
    index,
    window,
    contentType: "landing",
    peerPaths: [],
    convention: DEFAULT_UTM_CONVENTION,
    grace: null,
    now: NOW,
  });
}

describe("buildFirstPartyFlow", () => {
  it("counts visits without reloads or low-quality views, and splits current / prior by UTC day", () => {
    write([
      view("2026-10-05T23:59:00Z", { rh: "google.com" }),
      view("2026-10-06T00:01:00Z", { rh: "google.com" }),
      view("2026-10-06T10:00:00Z", { nt: "r" }),
      view("2026-10-07T10:00:00Z", { ms: 300 }),
      view("2026-09-10T10:00:00Z", {}),
    ]);
    const t = flow();
    expect(t.source).toBe("first_party");
    expect(t.current.sessions).toBe(2);
    expect(t.prior.sessions).toBe(1);
    expect(t.first_party?.low_quality).toBe(1);
    expect(t.series.find((d) => d.day === "2026-10-05")?.sessions).toBe(1);
    expect(t.series.find((d) => d.day === "2026-10-06")?.sessions).toBe(1);
    expect(t.channels).toMatchObject([{ channel: "organic", sessions: 2 }]);
  });

  it("merges broken-chain transitions into next pages without double counting", () => {
    write(
      [view("2026-10-10T10:00:00Z", { nx: "/en/apply" }), view("2026-10-10T11:00:00Z", {}), view("2026-10-10T12:00:00Z", {})],
      [["2026-10-10", PAGE, "/en/blog/x", 1]],
    );
    const t = flow();
    const next = Object.fromEntries(t.next_pages.map((p) => [p.path, p.sessions]));
    expect(next).toEqual({ "/en/apply": 1, "/en/blog/x": 1, "(exit)": 1 });
    expect(t.current.moved_forward).toBe(1);
    expect(t.current.moved_back).toBe(1);
  });

  it("breaks visits down by page version only when there are two or more", () => {
    write([view("2026-10-10T10:00:00Z", { ver: "default" })]);
    expect(flow().first_party?.versions).toEqual([]);
    write([view("2026-10-11T10:00:00Z", { ver: "b", nx: "/en/apply" }), view("2026-10-11T11:00:00Z", { ver: "b" })]);
    const versions = flow().first_party?.versions ?? [];
    expect(versions.map((v) => v.version).sort()).toEqual(["b", "default"]);
    expect(versions.find((v) => v.version === "b")).toMatchObject({ visits: 2 });
  });

  it("counts one version only within the test dates, without low-quality visits or broken-chain moves", () => {
    write(
      [
        view("2026-10-10T10:00:00Z", { ver: "b" }),
        view("2026-10-11T10:00:00Z", { ver: "b", nx: "/en/apply" }),
        view("2026-10-11T11:00:00Z", { ver: "b", ms: 300 }),
        view("2026-10-11T12:00:00Z", { ver: "default" }),
        view("2026-09-20T10:00:00Z", { ver: "b" }),
      ],
      [["2026-10-10", PAGE, "/en/blog/x", 3]],
    );
    const t = buildFirstPartyFlow({
      db,
      paths: [PAGE],
      stage: "consideration",
      index: stageIndex({ [PAGE]: "consideration", "/en/apply": "decision", "/en/blog/x": "awareness" }),
      window: { current: { start: "2026-10-01", end: "2026-10-28" }, prior: { start: "2026-10-01", end: "2026-09-30" } },
      contentType: "landing",
      peerPaths: [],
      convention: DEFAULT_UTM_CONVENTION,
      grace: null,
      now: NOW,
      pageVersion: "b",
    });
    expect(t.current.sessions).toBe(2);
    expect(t.prior.sessions).toBe(0);
    expect(t.current.moved_forward).toBe(1);
    expect(t.current.moved_back).toBe(0);
    expect(t.first_party?.low_quality).toBe(1);
    expect(t.first_party?.versions).toEqual([]);
    expect(t.next_pages.map((p) => p.path)).not.toContain("/en/blog/x");
  });

  it("reports collecting since, gaps and until from the on/off history", () => {
    openWindow(db, "landing", Date.parse("2026-09-15T00:00:00Z"));
    closeWindow(db, "landing", Date.parse("2026-10-03T00:00:00Z"));
    openWindow(db, "landing", Date.parse("2026-10-08T00:00:00Z"));
    const fp = flow().first_party!;
    expect(fp).toMatchObject({ collecting_since: "2026-09-15", until: null, enabled: true, gaps: [{ start: "2026-10-03", end: "2026-10-08" }] });
  });
});

describe("windowFacts", () => {
  it("shows until and a trailing gap when switched off", () => {
    const f = windowFacts(
      [{ content_type: "landing", enabled_at: Date.parse("2026-09-01T00:00:00Z"), disabled_at: Date.parse("2026-10-20T00:00:00Z") }],
      window,
      NOW,
    );
    expect(f).toMatchObject({ enabled: false, until: "2026-10-20", gaps: [{ start: "2026-10-20", end: "2026-10-28" }] });
  });
});

describe("utmGaps", () => {
  const row = (p: Partial<Parameters<typeof utmGaps>[0][number]>) => ({
    source: null, medium: null, campaign: null, utm_id: null, utm_term: null, utm_content: null, click_id_type: null, visits: 1, ...p,
  });

  it("ignores visits without a click ID (organic / direct)", () => {
    expect(utmGaps([row({ visits: 50 })], DEFAULT_UTM_CONVENTION, null).ad_visits).toBe(0);
  });

  it("counts untagged and broken ad visits; fbclid-only is ad traffic but not paid", () => {
    const g = utmGaps(
      [
        row({ click_id_type: "gclid", visits: 8 }),
        row({ click_id_type: "fbclid", visits: 5 }),
        row({ click_id_type: "gclid", source: "google", medium: "cpc", campaign: "x", utm_id: "{campaignid}", visits: 2 }),
        row({ click_id_type: "gclid", source: "google", medium: "cpc", campaign: "fall", utm_id: "123456789", utm_term: "987654321", visits: 20 }),
      ],
      DEFAULT_UTM_CONVENTION,
      null,
    );
    expect(g).toMatchObject({ ad_visits: 35, paid_visits: 30, untagged: 13, untagged_paid: 8, broken: 2, broken_paid: 2 });
    expect(g.top_broken[0]).toMatchObject({ code: "utm_unfilled_macro", param: "utm_id" });
  });
});

function trafficWith(utm: UtmGapFacts): TrafficFacts {
  const t = flowEmpty();
  t.first_party = { collecting_since: null, until: null, enabled: true, gaps: [], low_quality: 0, low_quality_campaigns: [], versions: [], returning_share_ga4: null, utm };
  return t;
}

function flowEmpty(): TrafficFacts {
  const z = {
    sessions: 0, page_views: 0, entrances: 0, engaged_sessions: 0, bounces: 0, exits: 0, returning_sessions: 0, moved_forward: 0,
    moved_back: 0, reached_decision: 0, lead_later: 0, form_or_cta: 0, cta_sessions: 0, task_clicks: 0, lost: 0, form_starts: 0,
    video_starts: 0, video_completes: 0, intent_events: 0, median_engaged_seconds: null, median_session_seconds: null,
  };
  return {
    source: "first_party", current: { ...z }, prior: { ...z }, series: [], previous_pages: [], next_pages: [], referrers: [], channels: [],
    campaigns: [], devices: [], countries: [], cta: [], scroll: [], tracking_since: { cta_click: null, scroll_depth: null },
    prior_channels: [], peers: [],
  };
}

function gaps(p: Partial<UtmGapFacts>): UtmGapFacts {
  return { ad_visits: 0, paid_visits: 0, untagged: 0, untagged_paid: 0, broken: 0, broken_paid: 0, by_platform: [], top_broken: [], ...p };
}

describe("untagged ad visits finding", () => {
  const base = { stage: "decision" as const, path: PAGE, objective: null, leads: null, organic: null, paid: null, links: null };

  it("needs at least 10 ad visits", () => {
    const t = trafficWith(gaps({ ad_visits: UTM_GAP_MIN_AD_VISITS - 1, paid_visits: 9, untagged: 9, untagged_paid: 9 }));
    expect(utmGapFinding({ ...base, traffic: t })).toBeNull();
  });

  it("warns from 3% and errors from 10% of paid ad visits", () => {
    expect(utmGapFinding({ ...base, traffic: trafficWith(gaps({ ad_visits: 100, paid_visits: 100, untagged: 2, untagged_paid: 2 })) })).toBeNull();
    expect(utmGapFinding({ ...base, traffic: trafficWith(gaps({ ad_visits: 100, paid_visits: 100, untagged: 4, untagged_paid: 4 })) })?.tone).toBe("warn");
    const err = utmGapFinding({ ...base, traffic: trafficWith(gaps({ ad_visits: 230, paid_visits: 230, untagged: 42, untagged_paid: 42 })) });
    expect(err).toMatchObject({ tone: "bad", id: "ad_visits_untagged" });
    expect(err?.evidence).toContain("42 of 230 visits from ads (18%)");
  });

  it("fbclid-only visits never raise an error", () => {
    const f = utmGapFinding({ ...base, traffic: trafficWith(gaps({ ad_visits: 100, paid_visits: 50, untagged: 40, untagged_paid: 0 })) });
    expect(f?.tone).toBe("warn");
  });

  it("is part of the ranked advice", () => {
    const advice = buildPageAdvice({ ...base, traffic: trafficWith(gaps({ ad_visits: 230, paid_visits: 230, untagged: 42, untagged_paid: 42 })) });
    expect(advice.findings.map((f) => f.id)).toContain("ad_visits_untagged");
  });
});

describe("closing a window keeps collected rows", () => {
  it("does not delete visits", () => {
    write([view("2026-10-10T10:00:00Z", {})]);
    openWindow(db, "landing", 1);
    closeWindow(db, "landing", 2);
    expect(db.prepare("SELECT COUNT(*) AS n FROM fp_page_views").get()).toEqual({ n: 1 });
  });
});
