import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  applyCheckResult,
  computeCoverage,
  isConfirmedGone,
  isConfirmedUnreachable,
  loadLinkStatus,
  pruneLinkStatus,
  recordCheckResults,
  setVerifiedOk,
  clearVerifiedOk,
} from "./status-store";

const DAY = 24 * 60 * 60 * 1000;
const t0 = new Date("2026-11-01T00:00:00.000Z");
const at = (days: number) => new Date(t0.getTime() + days * DAY);
const gone = { status: "gone" as const, reason: "not_found" as const, http_status: 404 };

const dirs: string[] = [];
function tmpRoot(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "link-status-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("applyCheckResult streaks", () => {
  it("confirms gone only after a second result at least 3 days after the first", () => {
    const first = applyCheckResult(undefined, gone, at(0));
    expect(first.gone_streak).toBe(1);
    expect(isConfirmedGone(first)).toBe(false);
    const sameDay = applyCheckResult(first, gone, at(0.5));
    expect(sameDay.gone_streak).toBe(2);
    expect(isConfirmedGone(sameDay)).toBe(false);
    const later = applyCheckResult(sameDay, gone, at(3));
    expect(later.streak_started_at).toBe(at(0).toISOString());
    expect(isConfirmedGone(later)).toBe(true);
  });

  it("ok resets streaks; unknown keeps the last definite answer", () => {
    const a = applyCheckResult(applyCheckResult(undefined, gone, at(0)), gone, at(4));
    const flaky = applyCheckResult(a, { status: "unknown", http_status: 503 }, at(5));
    expect(flaky.status).toBe("gone");
    expect(isConfirmedGone(flaky)).toBe(true);
    const back = applyCheckResult(flaky, { status: "ok", http_status: 200 }, at(6));
    expect(back.gone_streak).toBe(0);
    expect(isConfirmedGone(back)).toBe(false);
    expect(back.first_seen_at).toBe(at(0).toISOString());
  });

  it("unreachable confirms on its own streak", () => {
    const u = { status: "unreachable" as const, reason: "unreachable" as const, error: "ENOTFOUND" };
    const rec = applyCheckResult(applyCheckResult(undefined, u, at(0)), u, at(3));
    expect(isConfirmedUnreachable(rec)).toBe(true);
    expect(isConfirmedGone(rec)).toBe(false);
  });
});

describe("store", () => {
  it("verified_ok suppresses confirmation, survives checks, and is removed by prune", () => {
    const root = tmpRoot();
    const url = "https://dead.example/a";
    recordCheckResults(root, [{ url, result: gone }], at(0));
    recordCheckResults(root, [{ url, result: gone }], at(4));
    expect(isConfirmedGone(loadLinkStatus(root).urls[url])).toBe(true);

    setVerifiedOk(root, url, { by: "staff@x.com", reason: "opens in browser" }, at(5));
    recordCheckResults(root, [{ url, result: gone }], at(12));
    const rec = loadLinkStatus(root).urls[url]!;
    expect(rec.verified_ok?.by).toBe("staff@x.com");
    expect(isConfirmedGone(rec)).toBe(false);

    expect(clearVerifiedOk(root, url)).toBe(true);
    expect(isConfirmedGone(loadLinkStatus(root).urls[url])).toBe(true);

    expect(pruneLinkStatus(root, new Set())).toBe(1);
    expect(loadLinkStatus(root).urls[url]).toBeUndefined();
  });

  it("coverage counts checked, confirmed and verified URLs among those in use", () => {
    const g = applyCheckResult(applyCheckResult(undefined, gone, at(0)), gone, at(4));
    const statuses = {
      "https://a/1": g,
      "https://a/2": applyCheckResult(undefined, { status: "ok", http_status: 200 }, at(0)),
      "https://a/3": {
        status: "unknown" as const,
        checked_at: at(0).toISOString(),
        first_seen_at: at(0).toISOString(),
        gone_streak: 0,
        unreachable_streak: 0,
        never_checked: true as const,
        verified_ok: { by: "s", at: at(0).toISOString(), reason: "r" },
      },
    };
    expect(computeCoverage(["https://a/1", "https://a/2", "https://a/3", "https://a/4"], statuses)).toEqual({
      total: 4,
      checked: 2,
      gone: 1,
      unreachable: 0,
      verified_ok: 1,
    });
  });
});
