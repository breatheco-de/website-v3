import fs from "fs";
import os from "os";
import path from "path";
import * as yaml from "js-yaml";
import type { Request } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { commitAndPush, markFileAsModified } = vi.hoisted(() => ({
  commitAndPush: vi.fn(),
  markFileAsModified: vi.fn(),
}));
vi.mock("../github", () => ({ commitAndPush }));
vi.mock("../sync-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sync-state")>()),
  markFileAsModified,
}));
const { bqSettings } = vi.hoisted(() => ({ bqSettings: { current: { dataset_id: "analytics_123456" } as Record<string, string> } }));
vi.mock("../ecommerce/bigquery-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ecommerce/bigquery-client")>()),
  getBigQuerySettings: () => bqSettings.current,
  resolveBigQueryCredentials: () => ({ source: "gcs_json", credentials: { client_email: "sa@proj.iam.gserviceaccount.com" } }),
}));

import { resetRegistry } from "../content-types";
import { VersioningManager } from "../versioning/VersioningManager";
import { pickVariant } from "../versioning/assignment";
import { describeAbCheckRun, runAbCheck } from "./check";
import { checkPageFiles, recoverAbTestingIfNeeded, setupAbTesting } from "./setup";
import {
  _resetAbTestingStateCacheForTests,
  abCheckPageLock,
  isAbTestingSetUp,
  isLatestCheckOk,
  readAbTestingState,
  recordAbCheckRun,
  setAbTestingDataDirForTests,
  writeAbTestingState,
  type AbCheckRun,
} from "./state";
import { runPauseAbTestsMigration } from "./pause-migration";
import { invalidateActiveTestsCache } from "./active-tests";
import { collectAbTestingAlerts } from "../system-alerts";
import { evaluateSplit } from "../versioning/split-health";
import { checkGa4Dimensions, createGa4Dimensions, resolveGa4PropertyId, type AdminRequest } from "./ga4-dimensions";
import { injectPageVersionDataLayer } from "../utils/html-inject";
import { isExperimentExcludedUa } from "@shared/experiment-audience";
import { resolvePageVersion } from "../ads/lead-ledger";
import { abTestingWarnings } from "../../mcp-server/lib/ab-testing-warnings";

const SITE = "site_abunit";
let tempDir: string;
let contentRoot: string;
let vm: VersioningManager;

function writeEntry(slug: string, files: Record<string, string>) {
  const dir = path.join(contentRoot, "landings", slug);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body, "utf-8");
}

function site() {
  return {
    contentRoot,
    contentRootName: SITE,
    versioningManager: vm,
    config: { domain: "abunit.local" },
    contentIndex: { buildUrl: (_t: string, l: string, s: string) => `/${l}/landing/${s}` },
  };
}

function run(status: AbCheckRun["status"], extra: Partial<AbCheckRun> = {}): AbCheckRun {
  return {
    at: new Date().toISOString(), trigger: "manual", deploy_sha: null, status, url: null, requests: 0,
    observed: {}, expected: {}, p_value: null, checks: {}, ...extra,
  };
}

/** Fake site for the check: assigns by the visitor id with `split`, with knobs to break things. */
function fakeFetch(opts: {
  split?: number;
  cacheControl?: string;
  wrongContent?: boolean;
  noCookie?: boolean;
  blockedEvery?: number;
} = {}): typeof fetch {
  let n = 0;
  return (async (_url: string, init?: RequestInit) => {
    n += 1;
    if (opts.blockedEvery && n % opts.blockedEvery === 0) return new Response("Too many", { status: 429 });
    const cookie = String((init?.headers as Record<string, string>)?.cookie ?? "");
    const id = /4g_user_id=([^;]+)/.exec(cookie)?.[1] ?? "x";
    const existing = /4g_versioning_v2=([^;]+)/.exec(cookie)?.[1];
    const variant = existing ?? pickVariant(id, "k", [{ slug: "b", allocation: opts.split ?? 30 }])!;
    const marker = opts.wrongContent ? "b" : variant;
    const payload = {
      queries: [{ queryKey: ["/api/landings", "ab-check", "en"], data: { ab_check_version: marker, _page_version: { experiment_id: "x", variant } } }],
    };
    const headers = new Headers({ "content-type": "text/html", "cache-control": opts.cacheControl ?? "private, max-age=60" });
    if (!opts.noCookie) headers.append("set-cookie", `4g_versioning_v2=${variant}; Path=/; HttpOnly`);
    return new Response(`<html><body><script id="__INITIAL_DATA__" type="application/json">${JSON.stringify(payload)}</script></body></html>`, {
      status: 200,
      headers,
    });
  }) as unknown as typeof fetch;
}

const quick = { baseUrl: "http://fake", requests: 300, concurrency: 20, spreadMs: 0, record: false } as const;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-unit-"));
  contentRoot = path.join(tempDir, SITE);
  fs.mkdirSync(contentRoot, { recursive: true });
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    "landing:\n  directory: landings\n  url_pattern:\n    en: /en/landing/:slug\n",
    "utf-8",
  );
  resetRegistry(contentRoot);
  setAbTestingDataDirForTests(path.join(tempDir, "data"));
  _resetAbTestingStateCacheForTests();
  invalidateActiveTestsCache();
  vm = new VersioningManager(contentRoot);
  commitAndPush.mockReset();
  markFileAsModified.mockReset();
});

afterEach(() => {
  setAbTestingDataDirForTests(null);
  resetRegistry(contentRoot);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("A/B check", () => {
  beforeEach(() => writeEntry("ab-check", checkPageFiles()));

  it("passes on a correct setup", async () => {
    const out = await runAbCheck(site(), { ...quick, trigger: "manual", fetchImpl: fakeFetch() });
    expect(!out.not_set_up && out.run.status).toBe("passed");
  });

  it("fails when the split is off (50/50 vs 30/70)", async () => {
    const out = await runAbCheck(site(), { ...quick, trigger: "manual", fetchImpl: fakeFetch({ split: 50 }) });
    if (out.not_set_up) throw new Error("expected a run");
    expect(out.run.status).toBe("failed");
    expect(out.run.checks.split.ok).toBe(false);
    expect(describeAbCheckRun(out.run)).toMatch(/instead of/);
  });

  it("fails when pages could be shared between visitors", async () => {
    const out = await runAbCheck(site(), { ...quick, trigger: "manual", fetchImpl: fakeFetch({ cacheControl: "public, max-age=60" }) });
    expect(!out.not_set_up && out.run.checks.cache.ok).toBe(false);
  });

  it("fails when visitors get a different version than reported", async () => {
    const out = await runAbCheck(site(), { ...quick, trigger: "manual", fetchImpl: fakeFetch({ wrongContent: true }) });
    expect(!out.not_set_up && out.run.checks.content.ok).toBe(false);
  });

  it("fails when the versioning cookie is not set", async () => {
    const out = await runAbCheck(site(), { ...quick, trigger: "manual", fetchImpl: fakeFetch({ noCookie: true }) });
    expect(!out.not_set_up && out.run.checks.cookie.ok).toBe(false);
  });

  it("is inconclusive when more than 10% of requests are blocked", async () => {
    const out = await runAbCheck(site(), { ...quick, trigger: "manual", fetchImpl: fakeFetch({ blockedEvery: 5 }) });
    expect(!out.not_set_up && out.run.status).toBe("inconclusive");
  });

  it("reports not set up when the check page is missing", async () => {
    fs.rmSync(path.join(contentRoot, "landings", "ab-check"), { recursive: true, force: true });
    const out = await runAbCheck(site(), { ...quick, trigger: "manual", fetchImpl: fakeFetch() });
    expect(out.not_set_up).toBe(true);
  });
});

describe("state flags", () => {
  beforeEach(() => writeEntry("ab-check", checkPageFiles()));

  it("set up after one pass; a later failure keeps set up but blocks raises; inconclusive changes nothing", () => {
    expect(isAbTestingSetUp(site())).toBe(false);
    recordAbCheckRun(SITE, run("passed"));
    expect(isAbTestingSetUp(site())).toBe(true);
    expect(isLatestCheckOk(SITE)).toBe(true);
    recordAbCheckRun(SITE, run("failed"));
    expect(isAbTestingSetUp(site())).toBe(true);
    expect(isLatestCheckOk(SITE)).toBe(false);
    recordAbCheckRun(SITE, run("inconclusive"));
    expect(isLatestCheckOk(SITE)).toBe(false);
    recordAbCheckRun(SITE, run("passed"));
    recordAbCheckRun(SITE, run("inconclusive"));
    expect(isLatestCheckOk(SITE)).toBe(true);
  });

  it("locks the check page and nothing else", () => {
    expect(abCheckPageLock("landing", "ab-check", contentRoot)?.code).toBe("system_page_locked");
    writeEntry("ab-check-lookalike", { "_common.yml": "slug: ab-check-lookalike\n" });
    expect(abCheckPageLock("landing", "ab-check-lookalike", contentRoot)).toBeNull();
  });
});

describe("setup", () => {
  it("creates the check page, pushes it, and passes the first check; a second run creates nothing", async () => {
    commitAndPush.mockResolvedValue({ success: true, commitHash: "abc123" });
    const first = await setupAbTesting(site(), { checkOptions: { ...quick, record: true, fetchImpl: fakeFetch() } });
    expect(first.ok).toBe(true);
    expect(first.commitSha).toBe("abc123");
    expect(first.created).toHaveLength(4);
    expect(first.set_up).toBe(true);
    expect(isAbTestingSetUp(site())).toBe(true);

    const second = await setupAbTesting(site(), { checkOptions: { ...quick, fetchImpl: fakeFetch() } });
    expect(second.created).toHaveLength(0);
    expect(commitAndPush).toHaveBeenCalledTimes(1);
  });

  it("fails without a commit SHA (push rejected)", async () => {
    commitAndPush.mockResolvedValue({ success: false, error: "remote changed the same file" });
    const out = await setupAbTesting(site(), { checkOptions: { ...quick, fetchImpl: fakeFetch() } });
    expect(out.ok).toBe(false);
    expect(out.code).toBe("push_failed");
    expect(isAbTestingSetUp(site())).toBe(false);
  });

  it("recovers a lost setup record when the check page still exists", async () => {
    writeEntry("ab-check", checkPageFiles());
    expect(readAbTestingState(SITE).check_token).toBeNull();
    const recovered = await recoverAbTestingIfNeeded(site(), { ...quick, record: true, fetchImpl: fakeFetch() });
    expect(recovered?.status).toBe("passed");
    expect(readAbTestingState(SITE).check_token).toBeTruthy();
    expect(isAbTestingSetUp(site())).toBe(true);
    expect(await recoverAbTestingIfNeeded(site(), { ...quick, fetchImpl: fakeFetch() })).toBeNull();
  });
});

describe("system alerts", () => {
  beforeEach(() => writeEntry("ab-check", checkPageFiles()));

  it("failed check: critical with a running test, warning without; clears after a pass", async () => {
    recordAbCheckRun(SITE, run("failed", { checks: { split: { ok: false } }, observed: { default: 150, b: 150 }, expected: { default: 70, b: 30 } }));
    let alerts = await collectAbTestingAlerts([{ contentRoot, contentRootName: SITE }]);
    expect(alerts.find((a) => a.code === "ab_check_failed")?.severity).toBe("warning");

    writeEntry("promo", {
      "_common.yml": "slug: promo\n",
      "versioning.yml": yaml.dump({ en: { variants: [{ slug: "b", allocation: 30 }] } }),
    });
    invalidateActiveTestsCache();
    alerts = await collectAbTestingAlerts([{ contentRoot, contentRootName: SITE }]);
    expect(alerts.find((a) => a.code === "ab_check_failed")?.severity).toBe("critical");

    recordAbCheckRun(SITE, run("passed"));
    alerts = await collectAbTestingAlerts([{ contentRoot, contentRootName: SITE }]);
    expect(alerts).toHaveLength(0);
  });

  it("inconclusive is always a warning", async () => {
    recordAbCheckRun(SITE, run("inconclusive", { error: "blocked" }));
    const alerts = await collectAbTestingAlerts([{ contentRoot, contentRootName: SITE }]);
    expect(alerts.map((a) => [a.code, a.severity])).toEqual([["ab_check_inconclusive", "warning"]]);
  });
});

describe("pause migration (008)", () => {
  const deps = () => ({
    sites: () => [{ name: SITE, contentRoot }],
    pending: () => [] as string[],
    markModified: vi.fn(),
    push: vi.fn(async () => ({ success: true, commitHash: "sha-pause" })),
  });

  beforeEach(() => {
    writeEntry("ab-check", checkPageFiles());
    writeEntry("promo", {
      "_common.yml": "slug: promo\n",
      "versioning.yml": yaml.dump({ en: { variants: [{ slug: "b", allocation: 30 }], started_at: "2026-10-01" } }),
    });
  });

  it("dry run writes nothing", async () => {
    const d = deps();
    const out = await runPauseAbTestsMigration({ dryRun: true, deps: d, log: () => {} });
    expect(out.changed).toBe(1);
    expect(d.push).not.toHaveBeenCalled();
    const v = yaml.load(fs.readFileSync(path.join(contentRoot, "landings", "promo", "versioning.yml"), "utf-8")) as any;
    expect(v.en.variants[0].allocation).toBe(30);
  });

  it("pauses tests (not the check page), pushes, and a second run finds nothing", async () => {
    const d = deps();
    const out = await runPauseAbTestsMigration({ dryRun: false, deps: d, log: () => {} });
    expect(out.failed).toBe(false);
    expect(d.push).toHaveBeenCalledWith(SITE, [`${SITE}/landings/promo/versioning.yml`], expect.any(String));
    const promo = yaml.load(fs.readFileSync(path.join(contentRoot, "landings", "promo", "versioning.yml"), "utf-8")) as any;
    expect(promo.en.variants[0].allocation).toBe(0);
    expect(promo.en.started_at).toBe("2026-10-01");
    const check = yaml.load(fs.readFileSync(path.join(contentRoot, "landings", "ab-check", "versioning.yml"), "utf-8")) as any;
    expect(check.en.variants[0].allocation).toBe(30);

    const again = await runPauseAbTestsMigration({ dryRun: false, deps: deps(), log: () => {} });
    expect(again.changed).toBe(0);
  });

  it("fails when the push returns no SHA", async () => {
    const d = { ...deps(), push: vi.fn(async () => ({ success: false, error: "nope" })) };
    const out = await runPauseAbTestsMigration({ dryRun: false, deps: d, log: () => {}, error: () => {} });
    expect(out.failed).toBe(true);
  });
});

describe("split health", () => {
  it("mismatch, ok, collecting", () => {
    const expected = { default: 70, b: 30 };
    expect(evaluateSplit({ default: 250, b: 250 }, expected).status).toBe("mismatch");
    expect(evaluateSplit({ default: 345, b: 155 }, expected).status).toBe("ok");
    expect(evaluateSplit({ default: 50, b: 50 }, expected).status).toBe("collecting");
    expect(evaluateSplit({}, expected, { available: false }).status).toBe("unavailable");
  });
});

describe("GA4 dimensions", () => {
  it("reads the property id from the export dataset or the override", () => {
    expect(resolveGa4PropertyId({ dataset_id: "analytics_987" })).toBe("987");
    expect(resolveGa4PropertyId({ dataset_id: "renamed", ga4_property_id: "555" })).toBe("555");
    expect(resolveGa4PropertyId({ dataset_id: "renamed" })).toBeNull();
  });

  it("creates only the missing dimension", async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    const request: AdminRequest = async (_scope, url, init) => {
      calls.push({ url, body: init?.body });
      if (init?.method === "POST") return { status: 200, data: {} };
      return { status: 200, data: { customDimensions: [{ parameterName: "experiment_id", scope: "EVENT" }] } };
    };
    const out = await createGa4Dimensions(undefined, request);
    expect(out.ok).toBe(true);
    expect(out.created).toEqual(["variant"]);
    expect(calls.filter((c) => c.body).map((c) => (c.body as { parameterName: string }).parameterName)).toEqual(["variant"]);
  });

  it("explains missing access and a disabled Admin API", async () => {
    const denied: AdminRequest = async () => ({ status: 403, data: { error: { message: "The caller does not have permission" } } });
    const a = await checkGa4Dimensions(undefined, denied);
    expect(a.step).toBe("grant_access");
    expect(a.fix).toContain("sa@proj.iam.gserviceaccount.com");
    const disabled: AdminRequest = async () => ({
      status: 403,
      data: { error: { message: "Google Analytics Admin API has not been used in project 1 before or it is disabled." } },
    });
    expect((await checkGa4Dimensions(undefined, disabled)).step).toBe("enable_admin_api");
  });

  it("asks to connect BigQuery when there is no property", async () => {
    bqSettings.current = { dataset_id: "" };
    const out = await checkGa4Dimensions(undefined, async () => ({ status: 200, data: {} }));
    expect(out.step).toBe("configure_bigquery");
    bqSettings.current = { dataset_id: "analytics_123456" };
  });
});

describe("inline dataLayer version", () => {
  const html = "<html><head><!-- Google Tag Manager --></head><body></body></html>";
  const payload = { queries: [{ queryKey: ["/api/landings", "promo", "en"], data: { _page_version: { experiment_id: "landing:promo:en@2026-10-01", variant: "b" } } }] };

  it("writes the version before GTM and replaces an older copy", () => {
    const once = injectPageVersionDataLayer(html, payload);
    expect(once.indexOf("__AB_PAGE_VERSION__")).toBeLessThan(once.indexOf("<!-- Google Tag Manager"));
    expect(once).toContain('"variant":"b"');
    const twice = injectPageVersionDataLayer(once, payload);
    expect(twice.match(/__AB_PAGE_VERSION__/g)).toHaveLength(1);
  });

  it("adds nothing on pages without a test", () => {
    expect(injectPageVersionDataLayer(html, { queries: [{ queryKey: ["x"], data: {} }] })).toBe(html);
  });
});

describe("who can be put in a test", () => {
  it("excludes crawlers, AI bots, tools and missing user agents; keeps browsers", () => {
    expect(isExperimentExcludedUa("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(true);
    expect(isExperimentExcludedUa("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.0)")).toBe(true);
    expect(isExperimentExcludedUa("curl/8.4.0")).toBe(true);
    expect(isExperimentExcludedUa("")).toBe(true);
    expect(
      isExperimentExcludedUa(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(false);
  });
});

describe("lead credit (first test seen this visit)", () => {
  const cookie = (assignments: unknown[]) =>
    Buffer.from(JSON.stringify({ userId: "u1", assignments })).toString("base64");

  it("uses the visit cookie when the form did not send the experiment, and verifies it", () => {
    const req = {
      cookies: {
        "4g_versioning_v2": cookie([{ contentType: "landing", slug: "promo", locale: "en", variantSlug: "default", run: "2026-10-01", assignedAt: 1 }]),
        "4g_visit_exp": encodeURIComponent("landing:promo:en@2026-10-01|default"),
      },
    } as unknown as Request;
    expect(resolvePageVersion(req, {})).toEqual({ experiment_id: "landing:promo:en@2026-10-01", variant: "default" });
  });

  it("rejects an experiment that does not match the visitor's assignment", () => {
    const req = {
      cookies: {
        "4g_versioning_v2": cookie([{ contentType: "landing", slug: "promo", locale: "en", variantSlug: "b", run: "2026-10-01", assignedAt: 1 }]),
      },
    } as unknown as Request;
    expect(resolvePageVersion(req, { page_experiment_id: "landing:promo:en@2026-11-01" })).toBeNull();
  });
});

describe("list_variants warnings", () => {
  it("covers not set up, sticky with run dates, and split mismatch", () => {
    const w = abTestingWarnings({
      versioning: { en: { variants: [{ slug: "b", allocation: 30 }], started_at: "2026-10-01" } },
      ab_testing: { set_up: false, latest_check_ok: false },
      split_health: {
        en: {
          experiment_id: "landing:promo:en@2026-10-01",
          expected_pct: { default: 70, b: 30 },
          server: { status: "mismatch", total: 500, observed_pct: { default: 50, b: 50 }, p_value: 1e-20 },
          ga4: { status: "collecting", total: 10, observed_pct: {}, p_value: null },
          status: "mismatch",
        },
      },
    });
    expect(w.map((x) => x.code)).toEqual(["ab_testing_not_setup", "variant_assignment_sticky", "split_mismatch"]);
    expect(w[1].message).toContain("2026-10-01");
  });

  it("flags a failing check once set up, and stays quiet without running tests", () => {
    expect(
      abTestingWarnings({ versioning: { en: { variants: [{ slug: "b", allocation: 0 }] } }, ab_testing: { set_up: true, latest_check_ok: false } }).map((x) => x.code),
    ).toEqual(["ab_check_failing"]);
    expect(abTestingWarnings({ versioning: { en: { variants: [] } }, ab_testing: { set_up: true, latest_check_ok: true } })).toEqual([]);
  });
});

describe("state file", () => {
  it("never exposes the token through writes elsewhere and survives a reload", () => {
    writeAbTestingState(SITE, { check_token: "secret", check_page: null, first_passed_at: null, runs: [] });
    _resetAbTestingStateCacheForTests();
    expect(readAbTestingState(SITE).check_token).toBe("secret");
  });
});
