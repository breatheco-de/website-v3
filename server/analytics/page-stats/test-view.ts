/**
 * Page stats test view: one A/B test run (running, or the last finished one) split by version.
 * Only numbers measured per version: visits (GA4 exposure event or the site's own counts by
 * page_version), ledger leads by experiment_id + variant. Search, spend, links and edit markers
 * can't be split and are left out. One read per source and run, cached 10 minutes.
 */

import type { ContentIndex } from "../../content-index";
import { lastCompleteGa4Date } from "../../ads/paid-detection";
import { getFunnelSettings } from "../../settings";
import { getPathStageIndex, resolvePage } from "./resolve";
import { queryPageFlowByVariant } from "./ga4-flow";
import { queryTestLeads } from "./leads";
import { buildObjective } from "./objective";
import { buildPageAdvice } from "./advice";
import { readStageBenchmarks } from "./benchmarks";
import { firstPartyTraffic, resolveTrafficSource } from "./source";
import { windowFacts } from "./first-party-flow";
import { PageStatsNotFoundError, PageTestNotFoundError } from "./errors";
import { getVersioningManager, type VersioningManager } from "../../versioning/VersioningManager";
import { isTemplateVersioningSlug, listAttachedEntries, versioningContentSlug } from "../../shared-layout-entry";
import {
  PAGE_STATS_MIN_SESSIONS,
  TEST_DEFAULT_VERSION,
  type CompareRow,
  type CompareRowId,
  type LeadsFacts,
  type ObjectiveBlock,
  type PageStatsTestView,
  type PageTestInfo,
  type Section,
  type TestNotice,
  type TrafficFacts,
  type TrafficSource,
  type VersionFacts,
} from "@shared/page-stats";
import type { TypeWindow } from "../first-party/windows";
import { child } from "../../logger";

const log = child({ module: "page-stats/test-view" });

export const TEST_VIEW_CAP_DAYS = 90;
const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { expires: number; payload: PageStatsTestView }>();

export function clearPageTestStatsCache(): void {
  cache.clear();
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const maxDay = (a: string, b: string) => (a > b ? a : b);
const minDay = (a: string, b: string) => (a < b ? a : b);

/** A test already running before run history existed has no record until its next versioning write. */
function runningFromConfig(vm: VersioningManager, contentType: string, slug: string, locale: string) {
  const cfg = vm.getVersioningForContent(contentType, slug)?.[locale];
  const live = (cfg?.variants ?? []).filter((v) => (v.allocation ?? 0) > 0);
  if (live.length === 0) return null;
  return {
    experiment_id: vm.getExperimentId(contentType, slug, locale),
    versions: live.map((v) => v.slug),
    started_at: cfg?.started_at ?? null,
    ended_at: null,
    split_changes: [],
  };
}

/** Running or last finished test for an entry's language, from the run history. */
export function resolvePageTest(opts: {
  vm: VersioningManager;
  contentRoot?: string;
  entry: { content_type: string; slug: string; locale: string };
}): PageTestInfo | null {
  try {
    const slug = versioningContentSlug(opts.entry.content_type, opts.entry.slug, opts.contentRoot);
    const run = opts.vm.getLatestRun(opts.entry.content_type, slug, opts.entry.locale) ?? runningFromConfig(opts.vm, opts.entry.content_type, slug, opts.entry.locale);
    if (!run) return null;
    return {
      experiment_id: run.experiment_id,
      status: run.ended_at ? "ended" : "running",
      started_at: run.started_at,
      ended_at: run.ended_at,
      versions: [TEST_DEFAULT_VERSION, ...run.versions.filter((v) => v !== TEST_DEFAULT_VERSION)],
      split_changes: run.split_changes,
      shared_template: isTemplateVersioningSlug(slug)
        ? { pages: listAttachedEntries(opts.entry.content_type, opts.entry.locale, opts.contentRoot).length }
        : null,
    };
  } catch (err) {
    log.warn({ err, entry: opts.entry }, "[page-stats] test lookup failed");
    return null;
  }
}

/** Test dates clipped to the last complete day and the cap. */
export function testWindow(test: Pick<PageTestInfo, "started_at" | "ended_at">, lastDay: string): {
  start: string;
  end: string;
  capped: boolean;
} {
  const end = test.ended_at ? minDay(test.ended_at, lastDay) : lastDay;
  const capStart = addDays(end, -(TEST_VIEW_CAP_DAYS - 1));
  const start = test.started_at ?? capStart;
  return { start: minDay(maxDay(start, capStart), end), end, capped: start < capStart };
}

/** Gaps in "Optimize for ads" and a late counting start, inside the test dates. */
export function firstPartyNotices(windows: TypeWindow[], window: { start: string; end: string }, now: number): TestNotice[] {
  const facts = windowFacts(windows, { current: window, prior: { start: window.start, end: addDays(window.start, -1) } }, now);
  const out: TestNotice[] = [];
  if (facts.collecting_since && facts.collecting_since > window.start) out.push({ kind: "first_party_started", day: facts.collecting_since });
  for (const g of facts.gaps) {
    const start = maxDay(g.start, window.start);
    const end = minDay(g.end, window.end);
    if (start <= end) out.push({ kind: "first_party_gap", start, end });
  }
  return out;
}

type RowInput = {
  sessions: number;
  engaged: number;
  bounces: number;
  medianSeconds: number | null;
  primary: number | null;
  leadsHere: number;
  leadsAll: number;
  paidVisits: number;
  paidLeads: number;
};

function rowInput(f: VersionFacts): RowInput {
  const t = f.traffic.data?.current;
  const sessions = t?.sessions ?? 0;
  return {
    sessions,
    engaged: t?.engaged_sessions ?? 0,
    bounces: t?.bounces ?? 0,
    medianSeconds: t?.median_engaged_seconds ?? null,
    primary: f.objective?.primary.value ?? null,
    leadsHere: f.leads.data?.converted_here.count ?? 0,
    leadsAll: f.leads.data?.all_from_test ?? 0,
    paidVisits: f.paid_summary.paid_visits,
    paidLeads: f.paid_summary.paid_leads,
  };
}

/** Compare table rows; `best` only on rates and times, and only once every version has `minVisits`. */
export function buildCompareRows(opts: {
  versions: string[];
  byVersion: Record<string, VersionFacts>;
  primary: { label: string; target: number | null } | null;
  minVisits: number;
}): CompareRow[] {
  const inputs = new Map(opts.versions.map((v) => [v, opts.byVersion[v] ? rowInput(opts.byVersion[v]!) : null]));
  const enough = opts.versions.length > 1 && opts.versions.every((v) => (inputs.get(v)?.sessions ?? 0) >= opts.minVisits);
  const ratio = (n: number, d: number) => (d > 0 ? n / d : null);
  const row = (
    id: CompareRowId,
    label: string,
    format: CompareRow["format"],
    pick: (r: RowInput) => number | null,
    opt: { higher?: boolean; best?: boolean; target?: number | null } = {},
  ): CompareRow => {
    const values: Record<string, number | null> = {};
    for (const v of opts.versions) {
      const r = inputs.get(v);
      values[v] = r ? pick(r) : null;
    }
    const higher = opt.higher ?? true;
    let best: string | null = null;
    if (enough && opt.best) {
      const scored = opts.versions.filter((v) => values[v] !== null) as string[];
      if (scored.length === opts.versions.length) {
        const sorted = [...scored].sort((a, b) => (higher ? values[b]! - values[a]! : values[a]! - values[b]!));
        if (values[sorted[0]!] !== values[sorted[1]!]) best = sorted[0]!;
      }
    }
    return { id, label, format, values, target: opt.target ?? null, higher_is_better: higher, best };
  };
  const rows: CompareRow[] = [row("visits", "Visits", "count", (r) => r.sessions)];
  if (opts.primary) {
    rows.push(row("primary", opts.primary.label, "rate", (r) => r.primary, { best: true, target: opts.primary.target }));
  }
  rows.push(
    row("leads_here", "Leads sent on this page", "count", (r) => r.leadsHere),
    row("leads_here_rate", "Leads sent on this page, per visit", "rate", (r) => ratio(r.leadsHere, r.sessions), { best: true }),
    row("leads_all", "All leads from visitors who saw it", "count", (r) => r.leadsAll),
    row("leads_all_rate", "All leads from visitors who saw it, per visit", "rate", (r) => ratio(r.leadsAll, r.sessions), { best: true }),
    row("engaged_rate", "Engaged visits", "rate", (r) => ratio(r.engaged, r.sessions), { best: true }),
    row("median_seconds", "Median time on page", "seconds", (r) => r.medianSeconds, { best: true }),
    row("bounce_rate", "Bounce rate", "rate", (r) => ratio(r.bounces, r.sessions), { best: true, higher: false }),
    row("paid_visits", "Paid visits", "count", (r) => r.paidVisits),
    row("paid_leads", "Paid leads", "count", (r) => r.paidLeads),
  );
  return rows;
}

function emptyTraffic(status: Section<TrafficFacts>["status"], message?: string): Section<TrafficFacts> {
  return { status, as_of: null, ...(message ? { message } : {}), data: null };
}

export async function getPageTestStats(opts: {
  site: string;
  contentRoot?: string;
  ci: ContentIndex;
  path: string;
  refresh?: boolean;
  source?: TrafficSource;
  versioningManager?: VersioningManager;
  now?: Date;
}): Promise<PageStatsTestView> {
  const index = getPathStageIndex(opts.site, opts.ci);
  const page = resolvePage({ site: opts.site, ci: opts.ci, path: opts.path, scope: "url", index });
  if (!page) throw new PageStatsNotFoundError("path could not be normalized to a public page path.");
  const vm = opts.versioningManager ?? getVersioningManager();
  const test = page.entry ? resolvePageTest({ vm, contentRoot: opts.contentRoot, entry: page.entry }) : null;
  if (!test) throw new PageTestNotFoundError("No A/B test is recorded for this page's language.");

  const { source, contentType, windows } = resolveTrafficSource({
    site: opts.site,
    contentRoot: opts.contentRoot,
    entryContentType: page.entry?.content_type ?? null,
    requested: opts.source,
  });
  const key = `test|${opts.site}|${source}|${test.experiment_id}|${test.ended_at ?? "running"}|${page.path}`;
  const hit = cache.get(key);
  if (!opts.refresh && hit && hit.expires > Date.now()) return hit.payload;

  const now = opts.now ?? new Date();
  // The site's own counts are live; GA4 lags until its export day is complete.
  const lastDay = source === "first_party" ? now.toISOString().slice(0, 10) : lastCompleteGa4Date(now);
  const window = testWindow(test, lastDay);
  const stage = page.stage;
  const notices: TestNotice[] = [];

  const traffic = new Map<string, Section<TrafficFacts>>();
  if (source === "ga4") {
    const flow = await queryPageFlowByVariant({
      paths: page.paths,
      stage,
      index,
      window,
      experimentId: test.experiment_id,
      contentRoot: opts.contentRoot,
    });
    if (flow.status === "not_configured" || flow.status === "error") {
      notices.push({ kind: "visits_unavailable", message: flow.message ?? "GA4 could not be read." });
    } else if (flow.byVariant.size === 0) {
      notices.push({ kind: "no_ga4_exposure" });
    }
    for (const v of test.versions) {
      const data = flow.byVariant.get(v);
      traffic.set(
        v,
        data
          ? { status: data.current.sessions > 0 ? "ok" : "insufficient_data", as_of: flow.as_of, data }
          : emptyTraffic(flow.status === "ok" || flow.status === "insufficient_data" ? "insufficient_data" : flow.status, flow.message ?? "No GA4 visits for this version yet."),
      );
    }
  } else {
    notices.push(...firstPartyNotices(windows, window, now.getTime()));
    for (const v of test.versions) {
      traffic.set(
        v,
        firstPartyTraffic({
          site: opts.site,
          contentRoot: opts.contentRoot,
          ci: opts.ci,
          paths: page.paths,
          stage,
          index,
          contentType,
          current: window,
          prior: { start: window.start, end: addDays(window.start, -1) },
          pageVersion: v,
        }),
      );
    }
  }

  const leads = queryTestLeads({ site: opts.site, paths: page.paths, experimentId: test.experiment_id, versions: test.versions, window });
  const target = stage ? getFunnelSettings(opts.contentRoot).targets?.[stage] : undefined;
  // GA4 stage benchmarks are not applied to the site's own counts (same rule as the normal drawer).
  const saved = stage && source === "ga4" ? readStageBenchmarks(opts.site).stages[stage] : undefined;

  const byVersion: Record<string, VersionFacts> = {};
  for (const v of test.versions) {
    const t = traffic.get(v)!;
    const l: Section<LeadsFacts> = leads.get(v) ?? { status: "error", as_of: null, data: null };
    let objective: ObjectiveBlock | null = null;
    if (stage) {
      objective = buildObjective({
        stage,
        traffic: t.data,
        leads: l.data,
        paid: null,
        organic: null,
        target,
        rateBenchmark: saved?.rate ?? null,
        rateBenchmarkPages: saved?.pages ?? 0,
        testView: true,
      });
    }
    const advice = buildPageAdvice({
      stage,
      path: page.path,
      objective,
      traffic: t.data,
      leads: l.data,
      organic: null,
      paid: null,
      links: null,
      testView: true,
    });
    const paidVisits = t.data?.channels.find((c) => c.channel === "paid")?.sessions ?? 0;
    const paidLeads = l.data?.converted_here.paid_count ?? 0;
    byVersion[v] = {
      traffic: t,
      leads: l,
      paid_summary: {
        paid_visits: paidVisits,
        paid_leads: paidLeads,
        conversion_rate: paidVisits > 0 ? paidLeads / paidVisits : null,
        low_sample: paidVisits < PAGE_STATS_MIN_SESSIONS,
      },
      objective,
      advice,
    };
  }

  const firstObjective = test.versions.map((v) => byVersion[v]?.objective).find(Boolean) ?? null;
  const payload: PageStatsTestView = {
    path: page.path,
    test,
    source,
    window: { start: window.start, end: window.end },
    capped: window.capped,
    cap_days: TEST_VIEW_CAP_DAYS,
    min_visits: PAGE_STATS_MIN_SESSIONS,
    notices,
    compare: buildCompareRows({
      versions: test.versions,
      byVersion,
      primary: firstObjective ? { label: firstObjective.primary.label, target: firstObjective.primary.target } : null,
      minVisits: PAGE_STATS_MIN_SESSIONS,
    }),
    by_version: byVersion,
    generated_at: new Date().toISOString(),
  };
  cache.set(key, { expires: Date.now() + TTL_MS, payload });
  log.info({ site: opts.site, path: page.path, source, experiment: test.experiment_id }, "[page-stats] test view built");
  return payload;
}
