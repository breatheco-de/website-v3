import { describe, expect, it, vi } from "vitest";
import {
  ADS_DAILY_SYNC_CRON,
  ADS_DAILY_SYNC_JOB,
  ADS_DAILY_SYNC_TZ,
  latestDailySlot,
  runAdsDailySync,
  scheduleAdsDailySync,
  sitesMissingDailySync,
  type AdsSite,
  type ScheduleAdsDailySyncDeps,
} from "./ads-daily-sync";

const SITES: AdsSite[] = [
  { site: "site_a", contentRoot: "/x/site_a" },
  { site: "site_b", contentRoot: "/x/site_b" },
];

const iso = (t: string) => new Date(t).getTime();

describe("latestDailySlot (5 AM America/New_York)", () => {
  it("after 5 AM gives today's slot", () => {
    expect(latestDailySlot(iso("2026-10-26T13:00:00Z")).toISOString()).toBe("2026-10-26T09:00:00.000Z");
  });

  it("exactly 5 AM is that slot", () => {
    expect(latestDailySlot(iso("2026-10-26T09:00:00Z")).toISOString()).toBe("2026-10-26T09:00:00.000Z");
  });

  it("before 5 AM gives yesterday's slot", () => {
    expect(latestDailySlot(iso("2026-10-26T08:00:00Z")).toISOString()).toBe("2026-10-25T09:00:00.000Z");
  });

  it("November switch: same day uses EST, early morning rolls back to the EDT slot across the month", () => {
    expect(latestDailySlot(iso("2026-11-01T12:00:00Z")).toISOString()).toBe("2026-11-01T10:00:00.000Z");
    expect(latestDailySlot(iso("2026-11-02T09:30:00Z")).toISOString()).toBe("2026-11-01T10:00:00.000Z");
    expect(latestDailySlot(iso("2026-11-01T08:00:00Z")).toISOString()).toBe("2026-10-31T09:00:00.000Z");
  });

  it("March switch: same day uses EDT, early morning rolls back to the EST slot", () => {
    expect(latestDailySlot(iso("2026-03-08T12:00:00Z")).toISOString()).toBe("2026-03-08T09:00:00.000Z");
    expect(latestDailySlot(iso("2026-03-08T08:30:00Z")).toISOString()).toBe("2026-03-07T10:00:00.000Z");
  });
});

describe("runAdsDailySync", () => {
  it("does nothing off the live server", async () => {
    const request = vi.fn();
    const res = await runAdsDailySync({ isLive: () => false, sites: () => SITES, request });
    expect(request).not.toHaveBeenCalled();
    expect(res).toEqual({ requested: 0, failed: 0 });
  });

  it("requests one refresh per connected site", async () => {
    const request = vi.fn(async () => ({ state: "queued" }));
    const res = await runAdsDailySync({ isLive: () => true, sites: () => SITES, request });
    expect(request.mock.calls).toEqual([
      ["site_a", "/x/site_a"],
      ["site_b", "/x/site_b"],
    ]);
    expect(res).toEqual({ requested: 2, failed: 0 });
  });

  it("one site failing does not stop the others", async () => {
    const request = vi.fn(async (site: string) => {
      if (site === "site_a") throw new Error("boom");
      return { state: "queued" };
    });
    const res = await runAdsDailySync({ isLive: () => true, sites: () => SITES, request });
    expect(request).toHaveBeenCalledTimes(2);
    expect(res).toEqual({ requested: 1, failed: 1 });
  });
});

describe("sitesMissingDailySync", () => {
  const now = iso("2026-10-26T13:00:00Z");

  it("flags sites with no run or a run before the slot", () => {
    const started: Record<string, string | undefined> = { site_a: undefined, site_b: "2026-10-25T20:00:00Z" };
    expect(sitesMissingDailySync(SITES, (s) => started[s], now)).toEqual(["site_a", "site_b"]);
  });

  it("does not flag a site whose run started after the slot (even one that failed)", () => {
    expect(sitesMissingDailySync(SITES, () => "2026-10-26T09:01:00Z", now)).toEqual([]);
  });
});

function scheduleDeps(over: Partial<ScheduleAdsDailySyncDeps> = {}): ScheduleAdsDailySyncDeps {
  return {
    isLive: () => true,
    sites: () => SITES,
    lastStartedAt: () => "2026-10-26T09:05:00Z",
    schedule: vi.fn(async () => true),
    enqueue: vi.fn(async () => ({ queued: true })),
    now: () => iso("2026-10-26T13:00:00Z"),
    ...over,
  };
}

describe("scheduleAdsDailySync", () => {
  it("is a no-op off the live server", async () => {
    const deps = scheduleDeps({ isLive: () => false });
    const res = await scheduleAdsDailySync(deps);
    expect(deps.schedule).not.toHaveBeenCalled();
    expect(deps.enqueue).not.toHaveBeenCalled();
    expect(res).toEqual({ scheduled: false, catch_up: false });
  });

  it("registers the 5 AM ET cron and skips catch-up when today's run started", async () => {
    const deps = scheduleDeps();
    const res = await scheduleAdsDailySync(deps);
    expect(deps.schedule).toHaveBeenCalledWith(ADS_DAILY_SYNC_JOB, ADS_DAILY_SYNC_CRON, { timezone: ADS_DAILY_SYNC_TZ });
    expect(deps.enqueue).not.toHaveBeenCalled();
    expect(res).toEqual({ scheduled: true, catch_up: false });
  });

  it("queues a catch-up when a site missed the 5 AM run", async () => {
    const deps = scheduleDeps({ lastStartedAt: (s) => (s === "site_b" ? "2026-10-25T09:05:00Z" : "2026-10-26T09:05:00Z") });
    const res = await scheduleAdsDailySync(deps);
    expect(deps.enqueue).toHaveBeenCalledWith(ADS_DAILY_SYNC_JOB, {}, { uniqueKey: ADS_DAILY_SYNC_JOB, uniqueWithArgs: false });
    expect(res).toEqual({ scheduled: true, catch_up: true });
  });
});
