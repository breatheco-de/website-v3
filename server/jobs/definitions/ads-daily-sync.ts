import path from "path";
import { Job } from "sidequest";
import { isGoogleConnected } from "../../ads/google-ads-days";
import { isGa4Configured } from "../../ads/paid-detection";
import { isMetaConnected, lastAdsRefreshStartedAt, requestAdsRefresh } from "../../ads/ads-refresh";
import { isLiveServer, liveServerStatus } from "../../live-server";
import { getSiteConfigs } from "../../site-config";
import { child } from "../../logger";
import { enqueueJob, scheduleJob } from "../queue";

const log = child({ module: "job:ads-daily-sync" });

export const ADS_DAILY_SYNC_JOB = "ads_daily_sync";
export const ADS_DAILY_SYNC_CRON = "0 5 * * *";
export const ADS_DAILY_SYNC_TZ = "America/New_York";
const ADS_DAILY_SYNC_HOUR = 5;

export type AdsSite = { site: string; contentRoot: string };

/** Same site key / content root as `site-manager` (refresh state lives under `.cache/<site>/`). */
export function connectedAdsSites(): AdsSite[] {
  const out: AdsSite[] = [];
  for (const config of getSiteConfigs()) {
    const contentRoot = path.isAbsolute(config.contentFolder)
      ? config.contentFolder
      : path.join(process.cwd(), config.contentFolder);
    if (!isMetaConnected(contentRoot) && !isGoogleConnected(contentRoot) && !isGa4Configured(contentRoot)) continue;
    out.push({ site: path.relative(process.cwd(), contentRoot), contentRoot });
  }
  return out;
}

function zonedParts(t: number): { y: number; m: number; d: number; h: number; min: number; s: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ADS_DAILY_SYNC_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute"), s: get("second") };
}

/** Zone offset (ms, wall clock minus UTC) at instant `t`. */
function zoneOffsetMs(t: number): number {
  const p = zonedParts(t);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(t / 1000) * 1000;
}

/** Most recent 5:00 AM America/New_York at or before `now`. */
export function latestDailySlot(now: number = Date.now()): Date {
  const p = zonedParts(now);
  const day = p.h >= ADS_DAILY_SYNC_HOUR ? p.d : p.d - 1;
  const wall = Date.UTC(p.y, p.m - 1, day, ADS_DAILY_SYNC_HOUR, 0, 0);
  let t = wall - zoneOffsetMs(wall);
  t = wall - zoneOffsetMs(t);
  return new Date(t);
}

export type AdsDailySyncDeps = {
  isLive: () => boolean;
  sites: () => AdsSite[];
  request: (site: string, contentRoot: string) => Promise<{ state: string }>;
};

const defaultDeps: AdsDailySyncDeps = {
  isLive: isLiveServer,
  sites: connectedAdsSites,
  request: (site, contentRoot) => requestAdsRefresh(site, contentRoot, "refresh"),
};

/** One refresh request per connected site. `requestAdsRefresh` skips active syncs and the retry wait. */
export async function runAdsDailySync(deps: AdsDailySyncDeps = defaultDeps): Promise<{ requested: number; failed: number }> {
  if (!deps.isLive()) {
    log.info("[AdsDailySyncJob] skipped: not the live server");
    return { requested: 0, failed: 0 };
  }
  let requested = 0;
  let failed = 0;
  for (const { site, contentRoot } of deps.sites()) {
    try {
      const status = await deps.request(site, contentRoot);
      requested++;
      log.info({ site, state: status.state }, "[AdsDailySyncJob] refresh requested");
    } catch (err) {
      failed++;
      log.warn({ err, site }, "[AdsDailySyncJob] refresh request failed");
    }
  }
  return { requested, failed };
}

/** Daily at 5 AM ET (live server only): queue the regular Ads refresh for every connected site. */
export class AdsDailySyncJob extends Job {
  async run(): Promise<{ requested: number; failed: number }> {
    return runAdsDailySync();
  }
}

export type ScheduleAdsDailySyncDeps = {
  isLive: () => boolean;
  sites: () => AdsSite[];
  lastStartedAt: (site: string) => string | undefined;
  schedule: typeof scheduleJob;
  enqueue: typeof enqueueJob;
  now: () => number;
};

const defaultScheduleDeps: ScheduleAdsDailySyncDeps = {
  isLive: isLiveServer,
  sites: connectedAdsSites,
  lastStartedAt: lastAdsRefreshStartedAt,
  schedule: scheduleJob,
  enqueue: enqueueJob,
  now: Date.now,
};

/** Sites with no refresh started since the most recent 5 AM ET slot (missed while the worker was down). */
export function sitesMissingDailySync(sites: AdsSite[], lastStartedAt: (site: string) => string | undefined, now: number): string[] {
  const slot = latestDailySlot(now).getTime();
  return sites
    .filter(({ site }) => {
      const t = Date.parse(lastStartedAt(site) ?? "");
      return !Number.isFinite(t) || t < slot;
    })
    .map(({ site }) => site);
}

/**
 * Worker startup: register the 5 AM ET cron and catch up a missed run. Live server only;
 * a production build that is not recognized as live logs why the daily sync is off.
 */
export async function scheduleAdsDailySync(deps: ScheduleAdsDailySyncDeps = defaultScheduleDeps): Promise<{ scheduled: boolean; catch_up: boolean }> {
  if (!deps.isLive()) {
    const s = liveServerStatus();
    if (s.production_mode) {
      log.warn(
        { production_mode: s.production_mode, site_url_host: s.site_url_host },
        "[AdsDailySync] daily ads sync is off on this server: production mode, but SITE_URL is not a sites.yml domain",
      );
    }
    return { scheduled: false, catch_up: false };
  }
  const scheduled = await deps.schedule(ADS_DAILY_SYNC_JOB, ADS_DAILY_SYNC_CRON, { timezone: ADS_DAILY_SYNC_TZ });
  const missing = sitesMissingDailySync(deps.sites(), deps.lastStartedAt, deps.now());
  if (missing.length === 0) return { scheduled, catch_up: false };
  await deps.enqueue(ADS_DAILY_SYNC_JOB, {}, { uniqueKey: ADS_DAILY_SYNC_JOB, uniqueWithArgs: false });
  log.info({ catch_up: true, sites: missing }, "[AdsDailySync] queued catch-up for a missed 5 AM run");
  return { scheduled, catch_up: true };
}
