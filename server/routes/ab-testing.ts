/**
 * Settings → A/B testing: setup (hidden check page), health (checks), GA4 dimensions,
 * plus the loopback deploy hook that re-checks every site after a deploy.
 */

import type { Express, Request, Response } from "express";
import { api } from "../rate-limit/api.js";
import { requireCapability } from "./_helpers";
import { getSiteContextMap, type SiteContext } from "../site-manager";
import {
  checkPageContentType,
  checkPageExists,
  isAbTestingSetUp,
  isLatestCheckOk,
  latestConclusiveRun,
  latestRun,
  readAbTestingState,
} from "../ab-testing/state";
import { describeAbCheckRun, runAbCheck } from "../ab-testing/check";
import { recoverAbTestingIfNeeded, setupAbTesting } from "../ab-testing/setup";
import { listActiveTests } from "../ab-testing/active-tests";
import { checkGa4Dimensions, createGa4Dimensions } from "../ab-testing/ga4-dimensions";
import { child } from "../logger";

const log = child({ module: "routes/ab-testing" });

/** One background check (setup / manual / recovery) per site at a time. */
const running = new Map<string, Promise<unknown>>();

function siteOf(res: Response): SiteContext {
  return res.locals.site;
}

export function isAbCheckRunning(site: { contentRootName: string }): boolean {
  return running.has(site.contentRootName);
}

function startInBackground(site: SiteContext, label: string, task: () => Promise<unknown>): boolean {
  if (running.has(site.contentRootName)) return false;
  const p = task()
    .catch((err) => log.error({ err, site: site.contentRootName }, `[ab-testing] ${label} failed`))
    .finally(() => running.delete(site.contentRootName));
  running.set(site.contentRootName, p);
  return true;
}

/** Status payload for the A/B testing settings page. Never includes the token. */
export function abTestingStatus(site: SiteContext) {
  const state = readAbTestingState(site.contentRootName);
  const page = checkPageExists(site);
  const latest = latestRun(site.contentRootName);
  const conclusive = latestConclusiveRun(site.contentRootName);
  const url = page ? site.contentIndex.buildUrl(page.contentType, page.locale, page.slug) : null;
  return {
    set_up: isAbTestingSetUp(site),
    latest_check_ok: isLatestCheckOk(site.contentRootName),
    first_passed_at: state.first_passed_at,
    can_set_up: !!checkPageContentType(site.contentRoot),
    check_page: page ? { ...page, url } : null,
    has_token: !!state.check_token,
    running: isAbCheckRunning(site),
    running_tests: listActiveTests(site.contentRoot).length,
    latest_run: latest,
    latest_summary: latest ? describeAbCheckRun(latest) : null,
    latest_conclusive_status: conclusive?.status ?? null,
    runs: state.runs,
  };
}

function isLoopback(req: Request): boolean {
  const addr = req.socket?.remoteAddress ?? "";
  const loop = addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
  const forwarded =
    !!req.headers["x-forwarded-for"] ||
    !!req.headers["x-real-ip"] ||
    !!req.headers["cf-connecting-ip"] ||
    !!req.headers.forwarded;
  return loop && !forwarded;
}

let deployCheckRunning = false;

export function registerAbTestingRoutes(app: Express): void {
  api.get(
    app,
    "/api/settings/ab-testing",
    { rate: "exempt", reason: "staff settings read, capability-gated" },
    async (req, res) => {
      const auth = await requireCapability(req, res, "content_view");
      if (!auth.authorized) return;
      const site = siteOf(res);
      // Recovery (3b): the check page exists but this server lost its setup record.
      const state = readAbTestingState(site.contentRootName);
      if (checkPageExists(site) && (!state.check_token || !state.first_passed_at) && state.runs.length === 0) {
        startInBackground(site, "recovery", () => recoverAbTestingIfNeeded(site));
      }
      res.json(abTestingStatus(site));
    },
  );

  api.post(app, "/api/settings/ab-testing/setup", { rate: "staffWrite" }, async (req, res) => {
    const auth = await requireCapability(req, res, "content_allocate_traffic");
    if (!auth.authorized) return;
    const site = siteOf(res);
    if (!checkPageContentType(site.contentRoot)) {
      res.status(400).json({ code: "no_content_type", error: "This site has no landing or page content type to host the check page." });
      return;
    }
    const started = startInBackground(site, "setup", async () => {
      const result = await setupAbTesting(site, { author: auth.author ?? undefined });
      if (!result.ok) log.warn({ site: site.contentRootName, error: result.error }, "[ab-testing] setup failed");
      lastSetupResult.set(site.contentRootName, result);
      return result;
    });
    res.status(202).json({ started, ...abTestingStatus(site) });
  });

  api.get(
    app,
    "/api/settings/ab-testing/setup-result",
    { rate: "exempt", reason: "staff settings read, capability-gated" },
    async (req, res) => {
      const auth = await requireCapability(req, res, "content_view");
      if (!auth.authorized) return;
      const site = siteOf(res);
      res.json({ result: lastSetupResult.get(site.contentRootName) ?? null, running: isAbCheckRunning(site) });
    },
  );

  api.post(app, "/api/settings/ab-testing/check", { rate: "staffWrite" }, async (req, res) => {
    const auth = await requireCapability(req, res, "content_allocate_traffic");
    if (!auth.authorized) return;
    const site = siteOf(res);
    if (!checkPageExists(site)) {
      res.status(400).json({ code: "ab_testing_not_setup", error: "Set up A/B testing first." });
      return;
    }
    const started = startInBackground(site, "manual check", () => runAbCheck(site, { trigger: "manual" }));
    res.status(202).json({ started, ...abTestingStatus(site) });
  });

  api.get(
    app,
    "/api/settings/ab-testing/ga4-dimensions",
    { rate: "exempt", reason: "staff settings read, capability-gated" },
    async (req, res) => {
      const auth = await requireCapability(req, res, "metrics_view");
      if (!auth.authorized) return;
      res.json(await checkGa4Dimensions(siteOf(res).contentRoot));
    },
  );

  api.post(app, "/api/settings/ab-testing/ga4-dimensions", { rate: "staffWrite" }, async (req, res) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    const result = await createGa4Dimensions(siteOf(res).contentRoot);
    res.status(result.ok ? 200 : 400).json(result);
  });

  api.post(
    app,
    "/api/internal/ab-testing/check-all",
    { rate: "exempt", reason: "loopback deploy hook" },
    async (req, res) => {
      if (!isLoopback(req)) {
        res.status(403).json({ error: "loopback only" });
        return;
      }
      if (deployCheckRunning) {
        res.status(409).json({ error: "A deploy check is already running" });
        return;
      }
      deployCheckRunning = true;
      const deploySha = typeof req.body?.deploy_sha === "string" ? req.body.deploy_sha.slice(0, 64) : null;
      try {
        const sites = [...getSiteContextMap().values()];
        const results = await Promise.all(
          sites.map(async (site) => {
            const domain = site.config.domain;
            if (!checkPageExists(site)) return { site: domain, result: "not_setup" as const, line: `AB_CHECK site=${domain} result=not_setup` };
            const out = await runAbCheck(site, { trigger: "deploy", deploySha });
            if (out.not_set_up) return { site: domain, result: "not_setup" as const, line: `AB_CHECK site=${domain} result=not_setup` };
            const run = out.run;
            const observed = Object.entries(run.observed).map(([k, v]) => `${k}:${v}`).join(",");
            const target = Object.entries(run.expected).map(([k, v]) => `${k}:${v}%`).join(",");
            return {
              site: domain,
              result: run.status,
              summary: describeAbCheckRun(run),
              line: `AB_CHECK site=${domain} result=${run.status} observed=${observed || "-"} target=${target || "-"} summary="${describeAbCheckRun(run).replace(/"/g, "'")}"`,
            };
          }),
        );
        res.json({ results, lines: results.map((r) => r.line) });
      } finally {
        deployCheckRunning = false;
      }
    },
  );
}

const lastSetupResult = new Map<string, unknown>();

/** Boot recovery (3b): after the server is healthy, rebuild lost setup records. */
export function scheduleAbTestingBootRecovery(delayMs = 30_000): void {
  const timer = setTimeout(() => {
    for (const site of getSiteContextMap().values()) {
      const state = readAbTestingState(site.contentRootName);
      if (!checkPageExists(site) || (state.check_token && state.first_passed_at)) continue;
      startInBackground(site, "boot recovery", () => recoverAbTestingIfNeeded(site));
    }
  }, delayMs);
  timer.unref?.();
}
