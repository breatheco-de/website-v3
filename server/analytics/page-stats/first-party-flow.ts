/**
 * Page stats traffic section from the site's own visit counts (data/<site>/visits.db) for
 * ads-first pages. Same TrafficFacts shape as the GA4 flow so the objective, funnel and
 * advice code is shared. Differences from GA4:
 * - one "session" = one counted page view of the page (reloads and back/forward excluded);
 * - suspected low-quality visits are left out of sessions and rates and reported apart;
 * - CTA rows per section are not collected (counts only), returning visitors come from GA4.
 */

import type Database from "better-sqlite3";
import { classifyTraffic, CLICK_ID_PLATFORM } from "@shared/paid-traffic";
import { utmViolations, type UtmGrace } from "@shared/ads-diagnostics-rules";
import type { UtmConvention } from "@shared/ads-settings";
import type { FunnelStage } from "@shared/funnel";
import type {
  CampaignTrafficRow,
  ChannelRow,
  FirstPartyFacts,
  PathRow,
  PeerRow,
  Section,
  TrafficFacts,
  TrafficTotals,
  UtmGapFacts,
} from "@shared/page-stats";
import { stageRank } from "@shared/page-objectives";
import { stageOfPath, type PathStageIndex } from "./resolve";
import { relationTo } from "./ga4-flow";
import { listWindows, type TypeWindow } from "../first-party/windows";
import { goodVisitSql, lowQualitySql, SUMMARY_GRACE_MS } from "../first-party/visit-quality";

export type FirstPartyWindow = { current: { start: string; end: string }; prior: { start: string; end: string } };

const SCROLL_DEPTHS = [25, 50, 75, 90] as const;

function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(", ");
}

type Grouped = {
  key: string;
  next_path: string | null;
  visits: number;
  engaged: number;
  page_views: number;
  entrances: number;
  bounces: number;
  exits: number;
  reached_decision: number;
  lead_later: number;
  form_or_cta: number;
  cta_sessions: number;
  task_sessions: number;
  lost: number;
  form_starts: number;
  video_starts: number;
  video_completes: number;
};

const METRICS = (good: string) => `
  SUM(CASE WHEN ${good} THEN 1 ELSE 0 END) AS visits,
  SUM(CASE WHEN ${good} AND engaged = 1 THEN 1 ELSE 0 END) AS engaged,
  COUNT(*) AS page_views,
  SUM(CASE WHEN ${good} AND entrance = 1 THEN 1 ELSE 0 END) AS entrances,
  SUM(CASE WHEN ${good} AND entrance = 1 AND engaged = 0 AND next_path IS NULL THEN 1 ELSE 0 END) AS bounces,
  SUM(CASE WHEN ${good} AND next_path IS NULL THEN 1 ELSE 0 END) AS exits,
  SUM(CASE WHEN ${good} AND reached_decision = 1 THEN 1 ELSE 0 END) AS reached_decision,
  SUM(CASE WHEN ${good} AND lead_later = 1 THEN 1 ELSE 0 END) AS lead_later,
  SUM(CASE WHEN ${good} AND (cta_clicks > 0 OR form_starts > 0 OR lead_later = 1) THEN 1 ELSE 0 END) AS form_or_cta,
  SUM(CASE WHEN ${good} AND cta_clicks > 0 THEN 1 ELSE 0 END) AS cta_sessions,
  SUM(CASE WHEN ${good} AND task_clicks > 0 THEN 1 ELSE 0 END) AS task_sessions,
  SUM(CASE WHEN ${good} AND next_path IS NULL AND engaged = 0 THEN 1 ELSE 0 END) AS lost,
  SUM(CASE WHEN ${good} THEN form_starts ELSE 0 END) AS form_starts,
  SUM(CASE WHEN ${good} THEN video_starts ELSE 0 END) AS video_starts,
  SUM(CASE WHEN ${good} THEN video_completes ELSE 0 END) AS video_completes`;

type Ctx = {
  db: Database.Database;
  paths: string[];
  stage: FunnelStage | null;
  index: PathStageIndex | null;
  staleBefore: number;
  /** ` AND page_version = ?` when one version is requested, else "". */
  vSql: string;
  vParams: unknown[];
};

function goodSql(ctx: Ctx): string {
  return goodVisitSql(ctx.staleBefore);
}

function grouped(ctx: Ctx, keyExpr: string, where: string, params: unknown[], paths = ctx.paths): Grouped[] {
  if (paths.length === 0) return [];
  return ctx.db
    .prepare(
      `SELECT ${keyExpr} AS key, next_path, ${METRICS(goodSql(ctx))}
       FROM fp_page_views WHERE path IN (${placeholders(paths.length)}) AND ${where}${ctx.vSql}
       GROUP BY key, next_path`,
    )
    .all(...paths, ...params, ...ctx.vParams) as Grouped[];
}

type Folded = Omit<Grouped, "key" | "next_path"> & { moved_forward: number; moved_back: number };

function emptyFolded(): Folded {
  return {
    visits: 0, engaged: 0, page_views: 0, entrances: 0, bounces: 0, exits: 0, reached_decision: 0, lead_later: 0,
    form_or_cta: 0, cta_sessions: 0, task_sessions: 0, lost: 0, form_starts: 0, video_starts: 0, video_completes: 0,
    moved_forward: 0, moved_back: 0,
  };
}

/** Sum grouped rows per key, classifying each next page against the page's stage. */
function fold(rows: Grouped[], stage: FunnelStage | null, index: PathStageIndex | null): Map<string, Folded> {
  const out = new Map<string, Folded>();
  const own = stageRank(stage);
  for (const r of rows) {
    const f = out.get(r.key) ?? emptyFolded();
    for (const k of Object.keys(f) as (keyof Folded)[]) {
      if (k === "moved_forward" || k === "moved_back") continue;
      f[k] += Number((r as unknown as Record<string, number>)[k] ?? 0);
    }
    if (r.next_path && index) {
      const next = stageRank(stageOfPath(index, r.next_path));
      if (next > 0 && next > own && (own > 0 || next >= 2)) f.moved_forward += Number(r.visits);
      if (next > 0 && own > 0 && next < own) f.moved_back += Number(r.visits);
    }
    out.set(r.key, f);
  }
  return out;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const xs = [...values].sort((a, b) => a - b);
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2;
}

function totalsOf(f: Folded | undefined, medianSeconds: number | null): TrafficTotals {
  const x = f ?? emptyFolded();
  return {
    sessions: x.visits,
    page_views: x.page_views,
    entrances: x.entrances,
    engaged_sessions: x.engaged,
    bounces: x.bounces,
    exits: x.exits,
    returning_sessions: 0,
    moved_forward: x.moved_forward,
    moved_back: x.moved_back,
    reached_decision: x.reached_decision,
    lead_later: x.lead_later,
    form_or_cta: x.form_or_cta,
    cta_sessions: x.cta_sessions,
    task_clicks: x.task_sessions,
    lost: x.lost,
    form_starts: x.form_starts,
    video_starts: x.video_starts,
    video_completes: x.video_completes,
    intent_events: 0,
    median_engaged_seconds: medianSeconds,
    median_session_seconds: null,
  };
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** On/off history → since / until / gaps inside the window. */
export function windowFacts(windows: TypeWindow[], window: FirstPartyWindow, now: number): Pick<FirstPartyFacts, "collecting_since" | "until" | "enabled" | "gaps"> {
  if (windows.length === 0) return { collecting_since: null, until: null, enabled: false, gaps: [] };
  const sorted = [...windows].sort((a, b) => a.enabled_at - b.enabled_at);
  const last = sorted[sorted.length - 1]!;
  const enabled = last.disabled_at === null;
  const gaps: FirstPartyFacts["gaps"] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const off = sorted[i]!.disabled_at;
    const on = sorted[i + 1]!.enabled_at;
    if (off === null || on <= off) continue;
    const start = dayOf(off);
    const end = dayOf(on);
    if (end < window.prior.start || start > window.current.end) continue;
    gaps.push({ start, end });
  }
  if (!enabled && last.disabled_at !== null && dayOf(last.disabled_at) <= window.current.end) {
    gaps.push({ start: dayOf(last.disabled_at), end: dayOf(Math.min(now, Date.parse(`${window.current.end}T23:59:59Z`))) });
  }
  return {
    collecting_since: dayOf(sorted[0]!.enabled_at),
    until: enabled ? null : dayOf(last.disabled_at!),
    enabled,
    gaps,
  };
}

/** Untagged / broken campaign tags on landing visits from ads (pure; exported for tests). */
export function utmGaps(
  rows: Array<{
    source: string | null;
    medium: string | null;
    campaign: string | null;
    utm_id: string | null;
    utm_term: string | null;
    utm_content: string | null;
    click_id_type: string | null;
    visits: number;
  }>,
  convention: UtmConvention,
  grace: UtmGrace | null,
): UtmGapFacts {
  const out: UtmGapFacts = { ad_visits: 0, paid_visits: 0, untagged: 0, untagged_paid: 0, broken: 0, broken_paid: 0, by_platform: [], top_broken: [] };
  const platforms = new Map<string, { platform: string; ad_visits: number; untagged: number; broken: number }>();
  const brokenValues = new Map<string, { code: string; param: string; value: string; visits: number }>();
  for (const r of rows) {
    const cls = classifyTraffic({
      utm_source: r.source,
      utm_medium: r.medium,
      click_ids: r.click_id_type ? { [r.click_id_type]: "1" } : undefined,
    });
    if (cls.status === "organic" || !r.click_id_type) continue;
    const paid = cls.status === "paid";
    const platform = cls.platform ?? (r.click_id_type ? CLICK_ID_PLATFORM[r.click_id_type] : null) ?? "other";
    const p = platforms.get(platform) ?? { platform, ad_visits: 0, untagged: 0, broken: 0 };
    p.ad_visits += r.visits;
    out.ad_visits += r.visits;
    if (paid) out.paid_visits += r.visits;
    if (!r.source && !r.medium) {
      out.untagged += r.visits;
      p.untagged += r.visits;
      if (paid) out.untagged_paid += r.visits;
    } else {
      const violations = utmViolations({
        params: {
          utm_source: r.source,
          utm_medium: r.medium,
          utm_campaign: r.campaign,
          utm_id: r.utm_id,
          utm_term: r.utm_term,
          utm_content: r.utm_content,
        },
        platform,
        convention,
        grace,
        kind: "observed",
      }).filter((v) => !v.in_grace);
      if (violations.length > 0) {
        out.broken += r.visits;
        p.broken += r.visits;
        if (paid) out.broken_paid += r.visits;
        for (const v of violations) {
          const k = `${v.code}|${v.param}|${v.value}`;
          const cur = brokenValues.get(k) ?? { code: v.code, param: v.param, value: v.value, visits: 0 };
          cur.visits += r.visits;
          brokenValues.set(k, cur);
        }
      }
    }
    platforms.set(platform, p);
  }
  out.by_platform = [...platforms.values()].sort((a, b) => b.ad_visits - a.ad_visits);
  out.top_broken = [...brokenValues.values()].sort((a, b) => b.visits - a.visits).slice(0, 5);
  return out;
}

export type FirstPartyFlowInput = {
  db: Database.Database;
  paths: string[];
  stage: FunnelStage | null;
  index: PathStageIndex | null;
  window: FirstPartyWindow;
  contentType: string | null;
  /** Other flagged pages in the same stage (benchmark peers). */
  peerPaths: string[];
  convention: UtmConvention;
  grace: UtmGrace | null;
  now?: number;
  /** Only visits served this version (`default` = live page during a test). */
  pageVersion?: string;
};

/** visits.db → TrafficFacts (+ first_party block). */
export function buildFirstPartyFlow(input: FirstPartyFlowInput): TrafficFacts {
  const now = input.now ?? Date.now();
  const vSql = input.pageVersion ? " AND page_version = ?" : "";
  const vParams: unknown[] = input.pageVersion ? [input.pageVersion] : [];
  const ctx: Ctx = { db: input.db, paths: input.paths, stage: input.stage, index: input.index, staleBefore: now - SUMMARY_GRACE_MS, vSql, vParams };
  const { current, prior } = input.window;
  const period = `CASE WHEN day >= '${current.start}' THEN 'current' ELSE 'prior' END`;
  const inBoth = "day >= ? AND day <= ?";
  const inCur = "day >= ? AND day <= ?";
  const both = [prior.start, current.end];
  const cur = [current.start, current.end];
  const good = goodSql(ctx);
  const pathIn = `path IN (${placeholders(input.paths.length)})`;

  const byPeriod = fold(grouped(ctx, period, inBoth, both), input.stage, input.index);
  // Next pages reached after the tab chain broke (new tab / reload) also move the visit forward or back.
  // fp_transitions has no page_version, so a single-version view leaves them out.
  if (input.paths.length > 0 && input.index && !input.pageVersion) {
    const own = stageRank(input.stage);
    const moves = input.db
      .prepare(
        `SELECT ${period} AS key, to_path, SUM(count) AS n FROM fp_transitions
         WHERE from_path IN (${placeholders(input.paths.length)}) AND ${inBoth} GROUP BY key, to_path`,
      )
      .all(...input.paths, ...both) as Array<{ key: string; to_path: string; n: number }>;
    for (const m of moves) {
      const f = byPeriod.get(m.key);
      if (!f || input.paths.includes(m.to_path)) continue;
      const next = stageRank(stageOfPath(input.index, m.to_path));
      if (next > 0 && next > own && (own > 0 || next >= 2)) f.moved_forward += Number(m.n);
      if (next > 0 && own > 0 && next < own) f.moved_back += Number(m.n);
    }
  }
  const curSeconds = input.db
    .prepare(`SELECT seconds FROM fp_page_views WHERE ${pathIn} AND ${inCur} AND ${good} AND seconds > 0${vSql}`)
    .all(...input.paths, ...cur, ...vParams) as Array<{ seconds: number }>;
  const priorSeconds = input.db
    .prepare(`SELECT seconds FROM fp_page_views WHERE ${pathIn} AND day >= ? AND day <= ? AND ${good} AND seconds > 0${vSql}`)
    .all(...input.paths, prior.start, prior.end, ...vParams) as Array<{ seconds: number }>;

  // Daily series
  const dayRows = input.db
    .prepare(`SELECT day, SUM(CASE WHEN ${good} THEN 1 ELSE 0 END) AS n FROM fp_page_views WHERE ${pathIn} AND ${inBoth}${vSql} GROUP BY day`)
    .all(...input.paths, ...both, ...vParams) as Array<{ day: string; n: number }>;
  const byDay = new Map(dayRows.map((r) => [r.day, Number(r.n)]));
  const days = Math.round((Date.parse(`${current.end}T00:00:00Z`) - Date.parse(`${current.start}T00:00:00Z`)) / 86_400_000) + 1;
  const series: TrafficFacts["series"] = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(current.start, i);
    series.push({ day, sessions: byDay.get(day) ?? 0, prior_sessions: byDay.get(addDays(day, -days)) ?? 0 });
  }

  const classify = (path: string, sentinel: string): PathRow => {
    if (path === sentinel) return { path, sessions: 0, stage: null, relation: sentinel === "(exit)" ? "exit" : "unknown" };
    const stage = input.index ? stageOfPath(input.index, path) : null;
    return { path, sessions: 0, stage, relation: relationTo(input.stage, stage) };
  };

  // Previous pages
  const prevRows = input.db
    .prepare(
      `SELECT COALESCE(prev_path, '(entrance)') AS p, COUNT(*) AS n FROM fp_page_views
       WHERE ${pathIn} AND ${inCur} AND ${good}${vSql} GROUP BY p ORDER BY n DESC LIMIT 25`,
    )
    .all(...input.paths, ...cur, ...vParams) as Array<{ p: string; n: number }>;

  // Next pages: in-tab next page + transitions recorded when the tab chain broke (new tab / reload).
  const nextCounts = new Map<string, number>();
  for (const r of grouped(ctx, "'all'", inCur, cur)) {
    const key = r.next_path ?? "(exit)";
    nextCounts.set(key, (nextCounts.get(key) ?? 0) + Number(r.visits));
  }
  const transitions = input.paths.length && !input.pageVersion
    ? (input.db
        .prepare(
          `SELECT to_path AS p, SUM(count) AS n FROM fp_transitions
           WHERE from_path IN (${placeholders(input.paths.length)}) AND day >= ? AND day <= ? GROUP BY to_path`,
        )
        .all(...input.paths, ...cur) as Array<{ p: string; n: number }>)
    : [];
  let moved = 0;
  for (const t of transitions) {
    if (input.paths.includes(t.p)) continue;
    nextCounts.set(t.p, (nextCounts.get(t.p) ?? 0) + Number(t.n));
    moved += Number(t.n);
  }
  // A broken-chain next page was counted as an exit on the landing row; move it.
  if (moved > 0) nextCounts.set("(exit)", Math.max(0, (nextCounts.get("(exit)") ?? 0) - moved));
  const nextPages = [...nextCounts.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([p, n]) => ({ ...classify(p, "(exit)"), sessions: n }));

  // Referrers (landing visits)
  const referrers = input.db
    .prepare(
      `SELECT REPLACE(referrer_host, 'www.', '') AS host, COUNT(*) AS n FROM fp_page_views
       WHERE ${pathIn} AND ${inCur} AND ${good} AND entrance = 1 AND referrer_host IS NOT NULL${vSql}
       GROUP BY host ORDER BY n DESC LIMIT 20`,
    )
    .all(...input.paths, ...cur, ...vParams) as Array<{ host: string; n: number }>;

  // Channels
  const channelCur = fold(grouped(ctx, "channel", inCur, cur), input.stage, input.index);
  const channelPrior = fold(grouped(ctx, "channel", "day >= ? AND day <= ?", [prior.start, prior.end]), input.stage, input.index);
  const toChannelRow = (channel: string, f: Folded, priorSessions: number): ChannelRow => ({
    channel,
    sessions: f.visits,
    engaged: f.engaged,
    moved_forward: f.moved_forward,
    reached_decision: f.reached_decision,
    lead_later: f.lead_later,
    bounces: f.bounces,
    prior_sessions: priorSessions,
    benchmark_rate: null,
  });
  const channels = [...channelCur.entries()]
    .map(([ch, f]) => toChannelRow(ch, f, channelPrior.get(ch)?.visits ?? 0))
    .filter((c) => c.sessions > 0)
    .sort((a, b) => b.sessions - a.sessions);
  const priorChannels = [...channelPrior.entries()].map(([ch, f]) => toChannelRow(ch, f, 0));

  // Campaigns (paid or tagged)
  const campaignGroups = fold(
    grouped(
      ctx,
      "COALESCE(source, '') || char(1) || COALESCE(medium, '') || char(1) || COALESCE(campaign, '')",
      `${inCur} AND (channel = 'paid' OR campaign IS NOT NULL)`,
      cur,
    ),
    input.stage,
    input.index,
  );
  const campaigns: CampaignTrafficRow[] = [...campaignGroups.entries()]
    .map(([k, f]) => {
      const [source, medium, campaign] = k.split("\u0001");
      return {
        source: source ?? "",
        medium: medium ?? "",
        campaign: campaign ?? "",
        sessions: f.visits,
        engaged: f.engaged,
        moved_forward: f.moved_forward,
        reached_decision: f.reached_decision,
        lead_later: f.lead_later,
      };
    })
    .filter((c) => c.sessions > 0)
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 25);

  const simple = (col: string, limit: number) =>
    (input.db
      .prepare(
        `SELECT COALESCE(${col}, '(unknown)') AS k, COUNT(*) AS n FROM fp_page_views
         WHERE ${pathIn} AND ${inCur} AND ${good}${vSql} GROUP BY k ORDER BY n DESC LIMIT ${limit}`,
      )
      .all(...input.paths, ...cur, ...vParams) as Array<{ k: string; n: number }>).map((r) => ({ key: r.k, n: Number(r.n) }));

  const scrollRow = input.db
    .prepare(
      `SELECT ${SCROLL_DEPTHS.map((d) => `SUM(CASE WHEN max_scroll >= ${d} THEN 1 ELSE 0 END) AS d${d}`).join(", ")}
       FROM fp_page_views WHERE ${pathIn} AND ${inCur} AND ${good}${vSql}`,
    )
    .get(...input.paths, ...cur, ...vParams) as Record<string, number | null>;

  // Peers: other flagged pages in the same stage.
  const peerPaths = input.peerPaths.filter((p) => !input.paths.includes(p));
  const peerFold = fold(grouped(ctx, "path", inCur, cur, peerPaths), input.stage, input.index);
  const peers: PeerRow[] = [...peerFold.entries()].map(([path, f]) => ({
    path,
    sessions: f.visits,
    engaged: f.engaged,
    moved_forward: f.moved_forward,
    reached_decision: f.reached_decision,
    task_sessions: f.task_sessions,
  }));

  // Suspected low quality
  const lq = lowQualitySql(ctx.staleBefore);
  const lowQualityRows = input.db
    .prepare(
      `SELECT COALESCE(campaign, source, click_id_type, channel) AS label, COUNT(*) AS n FROM fp_page_views
       WHERE ${pathIn} AND ${inCur} AND counted_visit = 1 AND ${lq}${vSql} GROUP BY label ORDER BY n DESC LIMIT 6`,
    )
    .all(...input.paths, ...cur, ...vParams) as Array<{ label: string; n: number }>;

  // Versions
  const versionFold = input.pageVersion
    ? new Map<string, Folded>()
    : fold(grouped(ctx, "page_version", `${inCur} AND page_version IS NOT NULL`, cur), input.stage, input.index);
  const primaryOf = (f: Folded): number => {
    switch (input.stage) {
      case "awareness":
        return f.moved_forward;
      case "consideration":
        return f.reached_decision;
      case "decision":
        return f.lead_later;
      case "post-enrollment":
        return f.task_sessions;
      default:
        return f.engaged;
    }
  };
  const versions =
    versionFold.size >= 2
      ? [...versionFold.entries()]
          .map(([version, f]) => ({ version, visits: f.visits, engaged: f.engaged, primary: primaryOf(f) }))
          .sort((a, b) => b.visits - a.visits)
      : [];

  // Campaign tags on landing visits from ads
  const utmRows = input.db
    .prepare(
      `SELECT source, medium, campaign, utm_id, utm_term, utm_content, click_id_type, COUNT(*) AS visits
       FROM fp_page_views WHERE ${pathIn} AND ${inCur} AND ${good} AND entrance = 1 AND click_id_type IS NOT NULL${vSql}
       GROUP BY source, medium, campaign, utm_id, utm_term, utm_content, click_id_type`,
    )
    .all(...input.paths, ...cur, ...vParams) as Parameters<typeof utmGaps>[0];

  const windows = input.contentType ? listWindows(input.db, input.contentType) : [];

  return {
    source: "first_party",
    first_party: {
      ...windowFacts(windows, input.window, now),
      low_quality: lowQualityRows.reduce((s, r) => s + Number(r.n), 0),
      low_quality_campaigns: lowQualityRows.map((r) => ({ label: r.label ?? "(unknown)", visits: Number(r.n) })),
      versions,
      returning_share_ga4: null,
      utm: utmGaps(
        utmRows.map((r) => ({ ...r, visits: Number(r.visits) })),
        input.convention,
        input.grace,
      ),
    },
    current: totalsOf(byPeriod.get("current"), median(curSeconds.map((r) => r.seconds))),
    prior: totalsOf(byPeriod.get("prior"), median(priorSeconds.map((r) => r.seconds))),
    series,
    previous_pages: prevRows.map((r) => ({ ...classify(r.p, "(entrance)"), sessions: Number(r.n) })),
    next_pages: nextPages,
    referrers: referrers.map((r) => ({ host: r.host, sessions: Number(r.n) })),
    channels,
    campaigns,
    devices: simple("device", 10).map((r) => ({ device: r.key, sessions: r.n })),
    countries: simple("country", 12).map((r) => ({ country: r.key, sessions: r.n })),
    cta: [],
    scroll: SCROLL_DEPTHS.map((d) => ({ depth: d, sessions: Number(scrollRow?.[`d${d}`] ?? 0) })).filter((r) => r.sessions > 0),
    tracking_since: { cta_click: null, scroll_depth: null },
    prior_channels: priorChannels,
    peers,
  };
}

export function firstPartyFlowSection(input: FirstPartyFlowInput): Section<TrafficFacts> {
  const data = buildFirstPartyFlow(input);
  const empty = data.current.sessions < 1 && data.prior.sessions < 1 && (data.first_party?.low_quality ?? 0) === 0;
  return {
    status: empty ? "insufficient_data" : "ok",
    as_of: input.window.current.end,
    ...(empty ? { message: "No visits counted on this page in the period yet." } : {}),
    data,
  };
}
