/**
 * A/B check: sends fresh-visitor requests to the hidden check page through the public
 * URL (Cloudflare included) and verifies split, content, stickiness, cookie and caching.
 */

import crypto from "crypto";
import { AB_CHECK_HEADER } from "@shared/experiment-audience";
import { getVersioningManager, type VersioningManager } from "../versioning/VersioningManager";
import { VERSIONING_COOKIE_NAME } from "../versioning/cookie-utils";
import {
  checkPageExists,
  ensureCheckToken,
  recordAbCheckRun,
  type AbCheckItem,
  type AbCheckRun,
  type AbCheckTrigger,
} from "./state";
import { expectedSharesPct, SRM_P_THRESHOLD, srmPValue } from "./stats";

export interface AbCheckSite {
  contentRoot: string;
  contentRootName: string;
  config?: { domain?: string };
  contentIndex?: { buildUrl(contentType: string, locale: string, slug: string): string };
  versioningManager?: VersioningManager;
}

export interface RunAbCheckOptions {
  trigger: AbCheckTrigger;
  deploySha?: string | null;
  /** Origin to request, e.g. https://4geeks.com. Defaults to the site's public URL. */
  baseUrl?: string;
  requests?: number;
  concurrency?: number;
  /** Spread requests over this window to stay under rate limits. */
  spreadMs?: number;
  timeoutMs?: number;
  /** Repeat-visit stickiness probes. */
  repeats?: number;
  fetchImpl?: typeof fetch;
  /** false: do not store the run (dry probes). */
  record?: boolean;
}

export type RunAbCheckResult = { not_set_up: true } | { not_set_up: false; run: AbCheckRun };

/** More than this share of blocked / challenged / timed-out requests makes the run inconclusive. */
export const INCONCLUSIVE_BLOCKED_RATIO = 0.1;
const CHECK_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 4GeeksABCheck/1.0";

type Probe =
  | {
      kind: "ok";
      userId: string;
      variant: string | null;
      marker: string | null;
      cacheControl: string;
      cfCacheStatus: string;
      versioningCookie: string | null;
    }
  | { kind: "blocked"; reason: string };

/** Public origin for the site's check requests. */
export function publicBaseUrl(site: AbCheckSite): { origin: string; siteQuery: string | null } {
  if (process.env.NODE_ENV === "production" && site.config?.domain) {
    return { origin: `https://${site.config.domain}`, siteQuery: null };
  }
  const origin = (process.env.SITE_URL || `http://127.0.0.1:${process.env.PORT || 5000}`).replace(/\/$/, "");
  return { origin, siteQuery: site.config?.domain ?? null };
}

function readSetCookie(res: Response, name: string): string | null {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const all = headers.getSetCookie?.() ?? (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")!] : []);
  for (const line of all) {
    for (const part of line.split(/,(?=\s*[\w-]+=)/)) {
      const trimmed = part.trim();
      if (trimmed.startsWith(`${name}=`)) return trimmed.slice(name.length + 1).split(";")[0];
    }
  }
  return null;
}

/** `_page_version.variant` and `ab_check_version` from `__INITIAL_DATA__`. */
export function parseCheckPage(html: string): { variant: string | null; marker: string | null } {
  const m = /<script id="__INITIAL_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!m) return { variant: null, marker: null };
  try {
    const payload = JSON.parse(m[1]) as { queries?: Array<{ data?: Record<string, unknown> }> };
    for (const q of payload.queries ?? []) {
      const data = q?.data;
      if (data && typeof data === "object" && ("_page_version" in data || "ab_check_version" in data)) {
        const pv = data._page_version as { variant?: unknown } | undefined;
        return {
          variant: typeof pv?.variant === "string" ? pv.variant : null,
          marker: typeof data.ab_check_version === "string" ? data.ab_check_version : null,
        };
      }
    }
  } catch {
    /* unparsable payload */
  }
  return { variant: null, marker: null };
}

function isChallenge(res: Response, body: string): boolean {
  if (res.status === 403 || res.status === 429 || res.status === 503) return true;
  if ((res.headers.get("cf-mitigated") ?? "").toLowerCase() === "challenge") return true;
  return /challenge-platform|Just a moment\.\.\./i.test(body.slice(0, 4000));
}

async function probe(
  fetchImpl: typeof fetch,
  url: string,
  token: string,
  timeoutMs: number,
  userId: string,
  extraCookie?: string,
): Promise<Probe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      headers: {
        [AB_CHECK_HEADER]: token,
        "user-agent": CHECK_UA,
        accept: "text/html",
        cookie: [`4g_user_id=${userId}`, extraCookie].filter(Boolean).join("; "),
      },
      signal: controller.signal,
    });
    const body = await res.text();
    if (isChallenge(res, body)) return { kind: "blocked", reason: `HTTP ${res.status}` };
    if (!res.ok) return { kind: "blocked", reason: `HTTP ${res.status}` };
    const parsed = parseCheckPage(body);
    return {
      kind: "ok",
      userId,
      variant: parsed.variant,
      marker: parsed.marker,
      cacheControl: res.headers.get("cache-control") ?? "",
      cfCacheStatus: res.headers.get("cf-cache-status") ?? "",
      versioningCookie: readSetCookie(res, VERSIONING_COOKIE_NAME),
    };
  } catch (err) {
    return { kind: "blocked", reason: err instanceof Error && err.name === "AbortError" ? "timeout" : "network error" };
  } finally {
    clearTimeout(timer);
  }
}

async function runPool<T>(count: number, concurrency: number, gapMs: number, task: (i: number) => Promise<T>): Promise<T[]> {
  const out: T[] = new Array(count);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, count)) }, async () => {
    while (next < count) {
      const i = next++;
      out[i] = await task(i);
      if (gapMs > 0 && next < count) await new Promise((r) => setTimeout(r, gapMs));
    }
  });
  await Promise.all(workers);
  return out;
}

function expectedMarker(variant: string | null): string | null {
  if (!variant) return null;
  return variant;
}

/**
 * Run the A/B check for one site. Returns `{ not_set_up: true }` when the check page
 * does not exist in content. Records the run unless `record: false`.
 */
export async function runAbCheck(site: AbCheckSite, opts: RunAbCheckOptions): Promise<RunAbCheckResult> {
  const page = checkPageExists(site);
  if (!page) return { not_set_up: true };

  const token = ensureCheckToken(site.contentRootName);
  const vm = site.versioningManager ?? getVersioningManager();
  const variants = vm.getVersioningForContent(page.contentType, page.slug)?.[page.locale]?.variants ?? [];
  const expected = expectedSharesPct(variants);

  const pathName = site.contentIndex?.buildUrl(page.contentType, page.locale, page.slug) || `/${page.locale}/landing/${page.slug}`;
  const base = opts.baseUrl ? { origin: opts.baseUrl.replace(/\/$/, ""), siteQuery: null } : publicBaseUrl(site);
  const url = `${base.origin}${pathName}${base.siteQuery ? `?__site=${encodeURIComponent(base.siteQuery)}` : ""}`;

  const requests = opts.requests ?? 300;
  const concurrency = opts.concurrency ?? 5;
  const spreadMs = opts.spreadMs ?? 60_000;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const repeats = opts.repeats ?? 20;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const gapMs = requests > 0 ? Math.floor((spreadMs * concurrency) / requests) : 0;

  const runBase = {
    at: new Date().toISOString(),
    trigger: opts.trigger,
    deploy_sha: opts.deploySha ?? null,
    url,
    requests,
    expected,
  };

  let run: AbCheckRun;
  try {
    const probes = await runPool(requests, concurrency, gapMs, () =>
      probe(fetchImpl, url, token, timeoutMs, crypto.randomUUID()),
    );
    const ok = probes.filter((p): p is Extract<Probe, { kind: "ok" }> => p.kind === "ok");
    const blocked = probes.filter((p): p is Extract<Probe, { kind: "blocked" }> => p.kind === "blocked");

    const observed: Record<string, number> = {};
    for (const p of ok) {
      const key = p.variant ?? "(unlabeled)";
      observed[key] = (observed[key] ?? 0) + 1;
    }

    if (blocked.length / Math.max(1, requests) > INCONCLUSIVE_BLOCKED_RATIO) {
      const reasons = [...new Set(blocked.map((b) => b.reason))].join(", ");
      run = {
        ...runBase,
        status: "inconclusive",
        observed,
        p_value: null,
        checks: { reachable: { ok: false, detail: `${blocked.length} of ${requests} requests blocked or timed out (${reasons})` } },
        error: "The check couldn't run: requests were blocked, challenged, or timed out.",
      };
    } else {
      const checks: Record<string, AbCheckItem> = {};
      const p = srmPValue(observed, expected);
      checks.split = {
        ok: p !== null && p >= SRM_P_THRESHOLD && !observed["(unlabeled)"],
        detail:
          p === null
            ? "No labeled responses"
            : `observed ${JSON.stringify(observed)} vs target ${JSON.stringify(expected)} (p=${p.toPrecision(3)})`,
      };
      const mismatched = ok.filter((pr) => pr.marker !== expectedMarker(pr.variant));
      checks.content = {
        ok: ok.length > 0 && mismatched.length === 0,
        detail: mismatched.length ? `${mismatched.length} responses showed a different version than reported` : undefined,
      };
      const shared = ok.filter(
        (pr) => !/\bprivate\b/i.test(pr.cacheControl) || /\bpublic\b/i.test(pr.cacheControl) || /^hit$/i.test(pr.cfCacheStatus),
      );
      checks.cache = {
        ok: ok.length > 0 && shared.length === 0,
        detail: shared.length
          ? `${shared.length} responses could be shared between visitors (Cache-Control "${shared[0].cacheControl}", cf-cache-status "${shared[0].cfCacheStatus}")`
          : undefined,
      };
      const noCookie = ok.filter((pr) => !pr.versioningCookie);
      checks.cookie = {
        ok: ok.length > 0 && noCookie.length === 0,
        detail: noCookie.length ? `${noCookie.length} responses did not set ${VERSIONING_COOKIE_NAME}` : undefined,
      };

      const sample = ok.filter((pr) => pr.versioningCookie).slice(0, repeats);
      const repeatProbes = await runPool(sample.length, concurrency, 0, (i) =>
        probe(
          fetchImpl,
          url,
          token,
          timeoutMs,
          sample[i].userId,
          `${VERSIONING_COOKIE_NAME}=${sample[i].versioningCookie}`,
        ),
      );
      const flipped = repeatProbes.filter(
        (pr, i) => pr.kind === "ok" && pr.variant !== sample[i].variant,
      );
      checks.sticky = {
        ok: sample.length > 0 && flipped.length === 0,
        detail: flipped.length ? `${flipped.length} of ${sample.length} returning visitors got a different version` : undefined,
      };

      const passed = Object.values(checks).every((c) => c.ok);
      run = { ...runBase, status: passed ? "passed" : "failed", observed, p_value: p, checks };
    }
  } catch (err) {
    run = {
      ...runBase,
      status: "inconclusive",
      observed: {},
      p_value: null,
      checks: {},
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (opts.record !== false) recordAbCheckRun(site.contentRootName, run);
  return { not_set_up: false, run };
}

/** Plain-English one-liner for alerts, deploy logs, and the Health tab. */
export function describeAbCheckRun(run: AbCheckRun): string {
  if (run.status === "inconclusive") return run.error ?? "The check couldn't run.";
  const pct = (counts: Record<string, number>) => {
    const total = Object.values(counts).reduce((n, v) => n + v, 0) || 1;
    return Object.entries(counts)
      .map(([k, v]) => `${k} ${Math.round((v / total) * 100)}%`)
      .join(" / ");
  };
  const target = Object.entries(run.expected)
    .map(([k, v]) => `${k} ${v}%`)
    .join(" / ");
  if (run.status === "passed") return `Visitors saw ${pct(run.observed)} (target ${target}).`;
  const failed = Object.entries(run.checks)
    .filter(([, c]) => !c.ok)
    .map(([name, c]) => (name === "split" ? `visitors saw ${pct(run.observed)} instead of ${target}` : c.detail ?? name));
  return failed.join("; ") || "The check failed.";
}
