import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { checkUrls, linkChecksEnabled, PER_HOST_GAP_MS, selectUrlsToCheck } from "./refresh";
import { applyCheckResult, loadLinkStatus } from "./status-store";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-11-10T00:00:00.000Z");
const ok = { status: "ok" as const, http_status: 200 };

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("selectUrlsToCheck", () => {
  const statuses = {
    "https://a/fresh": applyCheckResult(undefined, ok, new Date(now - 1 * DAY)),
    "https://a/stale": applyCheckResult(undefined, ok, new Date(now - 8 * DAY)),
    "https://a/older": applyCheckResult(undefined, ok, new Date(now - 20 * DAY)),
    "https://a/verified": {
      ...applyCheckResult(undefined, ok, new Date(now - 30 * DAY)),
      verified_ok: { by: "s", at: "x", reason: "r" },
    },
  };
  const urls = ["https://a/fresh", "https://a/stale", "https://a/new", "https://a/older", "https://a/verified"];

  it("takes new URLs first, then the oldest stale ones; skips fresh and verified", () => {
    expect(selectUrlsToCheck(urls, statuses, { now })).toEqual(["https://a/new", "https://a/older", "https://a/stale"]);
  });

  it("respects the cap", () => {
    expect(selectUrlsToCheck(urls, statuses, { now, cap: 2 })).toEqual(["https://a/new", "https://a/older"]);
  });

  it("force (single-post hard run) ignores the freshness window", () => {
    expect(selectUrlsToCheck(urls, statuses, { now, force: true }).sort()).toEqual([...urls].sort());
  });
});

describe("checkUrls", () => {
  it("spaces requests to the same host, saves results, and stops at the budget", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "link-refresh-"));
    dirs.push(root);
    const sleeps: number[] = [];
    let clock = 0;
    const classify = vi.fn(async (url: string) => {
      clock += 1000;
      return url.endsWith("/dead") ? { status: "gone" as const, reason: "not_found" as const, http_status: 404 } : ok;
    });
    const out = await checkUrls(root, ["https://h1/a", "https://h1/dead", "https://h2/a"], {
      classify,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      clock: () => clock,
      budgetMs: 60_000,
    });
    expect(out).toEqual({ selected: 3, checked: 3, stopped_early: false });
    expect(sleeps).toEqual([PER_HOST_GAP_MS]);
    expect(loadLinkStatus(root).urls["https://h1/dead"]?.gone_streak).toBe(1);

    clock = 0;
    const partial = await checkUrls(root, ["https://h3/a", "https://h3/b", "https://h3/c"], {
      classify,
      sleep: async () => {},
      clock: () => clock,
      budgetMs: 1500,
    });
    expect(partial.checked).toBe(2);
    expect(partial.stopped_early).toBe(true);
  });
});

describe("linkChecksEnabled", () => {
  it("is on with LINK_CHECK_LOCAL=1 off the live server", () => {
    expect(linkChecksEnabled({ LINK_CHECK_LOCAL: "1" } as NodeJS.ProcessEnv)).toBe(true);
  });
});
