/**
 * Warm the anonymous HTML cache for this release before traffic flips.
 * The live Sidequest worker still belongs to the previous release and would
 * reject these keys, so this process renders with the same function the
 * rebuild job uses and writes the disk handoff. Boot reloads that directory.
 *
 * Run from the new release directory, after `npm run build`:
 *   NODE_ENV=production node dist/prebuild-html-cache.js
 */
import path from "path";
import { pathToFileURL } from "url";
import { config as loadDotenv } from "dotenv";

/**
 * Sitemap locs are absolute. The HTML cache key is the path. A query string
 * or a private preview must not be stored under that path.
 * Drafts and noindex never appear in the sitemap.
 */
export function pathnameFromSitemapLoc(loc: string): string | null {
  let pathname = loc;
  try {
    const url = new URL(loc);
    if (url.search) return null;
    pathname = url.pathname;
  } catch {
    if (!loc.startsWith("/") || loc.includes("?")) return null;
  }
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  if (pathname.startsWith("/private/")) return null;
  return pathname || "/";
}

/** Pages a content type was expected to render (status 200) and how many came back empty or threw. */
export type RenderGateCounts = Record<string, { total: number; empty: number }>;

export type RenderGateResult = {
  failed: boolean;
  failing: Array<{ type: string; total: number; empty: number; share: number }>;
};

export const RENDER_GATE_MIN_PAGES = 5;
export const RENDER_GATE_MAX_EMPTY_SHARE = 0.1;

/** Fail when a content type with enough pages has more than 10% empty renders. */
export function evaluateRenderGate(
  counts: RenderGateCounts,
  opts: { minPages?: number; maxEmptyShare?: number } = {},
): RenderGateResult {
  const minPages = opts.minPages ?? RENDER_GATE_MIN_PAGES;
  const maxShare = opts.maxEmptyShare ?? RENDER_GATE_MAX_EMPTY_SHARE;
  const failing: RenderGateResult["failing"] = [];
  for (const [type, { total, empty }] of Object.entries(counts)) {
    if (total < minPages) continue;
    const share = empty / total;
    if (share > maxShare) failing.push({ type, total, empty, share });
  }
  return { failed: failing.length > 0, failing };
}

/** Deploy-log lines; deploy-vps.yml copies them into the Actions summary. */
export function renderGateLogLines(
  counts: RenderGateCounts,
  result: RenderGateResult,
  emptyPaths: string[],
  overridden: boolean,
): string[] {
  const lines = Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, c]) => `RENDER_GATE type=${type} total=${c.total} empty=${c.empty}`);
  for (const p of emptyPaths) lines.push(`RENDER_GATE_EMPTY path=${p}`);
  const outcome = !result.failed ? "passed" : overridden ? "skipped_by_override" : "failed";
  const failingText = result.failing
    .map((f) => `${f.type} ${Math.round(f.share * 100)}% (${f.empty}/${f.total})`)
    .join(", ");
  lines.push(`RENDER_GATE result=${outcome}${failingText ? ` failing="${failingText}"` : ""}`);
  return lines;
}

const isDirectRun =
  !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  await runPrebuild();
}

async function runPrebuild(): Promise<void> {
  loadDotenv({ quiet: true });
  process.env.NODE_ENV = "production";
  // Rendering touches the global content index, which would enqueue index_refresh.
  // That opens the live Sidequest database and this process never exits.
  process.env.PREBUILD_HTML = "1";

  const { requireSiteConfigs } = await import("../server/site-config");
  const { renderHubHtml } = await import("../server/render-hub-html");
  const { buildHtmlRebuildSite } = await import("../server/html-rebuild");
  const { getSitemapUrls, toActiveSiteCtx } = await import("../server/sitemap");
  const { getHtmlBuildId, canonicalHtmlCachePath } = await import("../server/html-page-cache");
  const { resolveLocaleHomeAliasTarget } = await import("../server/locale-home-alias");
  const { createPublicUrlResolver } = await import("../server/redirects");
  const { normalizePublicPath } = await import("../shared/public-app-routes");
  const { markdownPluginFlags } = await import("../server/markdown-enhance");
  const { writeRenderGateState } = await import("../server/render-gate-state");
  const { child } = await import("../server/logger");

  const log = child({ module: "prebuild-html" });
  const CONCURRENCY = 2;

  type PageJob = {
    siteId: string;
    pathname: string;
    slug?: string;
    locale?: string;
    contentType?: string;
  };

  async function runPool(jobs: PageJob[]): Promise<void> {
    let next = 0;
    async function loop(): Promise<void> {
      while (next < jobs.length) {
        const job = jobs[next];
        next += 1;
        let gateNoted = false;
        try {
          const runtime = runtimes.get(job.siteId);
          if (!runtime) {
            skipped += 1;
            log.warn(
              { pathname: job.pathname, siteId: job.siteId },
              `prebuild skipped ${job.pathname}: no runtime`,
            );
            continue;
          }
          const canonical = canonicalHtmlCachePath(job.pathname, runtime.contentIndex);
          if (canonical !== job.pathname) {
            log.warn(
              { pathname: job.pathname, canonical, siteId: job.siteId },
              `prebuild ${job.pathname} does not match cache path ${canonical}`,
            );
          }
          const rendered = await renderHubHtml({
            site: runtime,
            pathname: job.pathname,
            variantKey: "live",
            writeCache: true,
          });
          if (!rendered || rendered.status === 200) {
            noteGate(job, !rendered);
            gateNoted = true;
          }
          if (!rendered || rendered.status !== 200) {
            skipped += 1;
            const reason = !rendered ? "empty body" : `status ${rendered.status}`;
            log.warn(
              { pathname: job.pathname, siteId: job.siteId, status: rendered?.status },
              `prebuild skipped ${job.pathname}: ${reason}`,
            );
            continue;
          }
          const { AUDIENCE_LLM_VARIANT } = await import("../shared/llm-html-audience");
          const llm = await renderHubHtml({
            site: runtime,
            pathname: job.pathname,
            variantKey: AUDIENCE_LLM_VARIANT,
            writeCache: true,
          });
          if (llm && llm.status !== 200 && llm.status !== 204) {
            log.warn(
              { pathname: job.pathname, siteId: job.siteId, status: llm.status },
              `prebuild audience-llm skipped ${job.pathname}: status ${llm.status}`,
            );
          }
          wrote += 1;
          if (wrote % 25 === 0) {
            console.log(`[prebuild-html] wrote ${wrote}/${jobs.length}`);
          }
        } catch (err) {
          failed += 1;
          if (!gateNoted) noteGate(job, true);
          log.warn({ err, pathname: job.pathname, siteId: job.siteId }, "prebuild page failed");
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => loop()));
  }

  const sites = requireSiteConfigs();
  const runtimes = new Map<string, ReturnType<typeof buildHtmlRebuildSite>>();
  const jobs: PageJob[] = [];

  const gateCounts: RenderGateCounts = {};
  const gateEmptyPaths: string[] = [];
  function noteGate(job: PageJob, empty: boolean): void {
    const type = job.contentType || "other";
    const key = sites.length > 1 ? `${job.siteId}:${type}` : type;
    const c = (gateCounts[key] ??= { total: 0, empty: 0 });
    c.total += 1;
    if (empty) {
      c.empty += 1;
      gateEmptyPaths.push(sites.length > 1 ? `${job.siteId}${job.pathname}` : job.pathname);
    }
  }

  let redirected = 0;

  for (const site of sites) {
    const runtime = buildHtmlRebuildSite(site.contentFolder, site.contentFolder);
    runtimes.set(site.contentFolder, runtime);
    // The slow index holds redirects. Building it here means refreshCustomRedirects
    // does not enqueue index_refresh. That enqueue opens the live Sidequest
    // database and this process never exits, so the deploy never flips traffic.
    runtime.contentIndex.scanSlow();
    const redirects = createPublicUrlResolver(runtime.contentIndex, { freshRedirects: true });
    const seen = new Set<string>();
    for (const row of getSitemapUrls(toActiveSiteCtx(runtime), true)) {
      const pathname = pathnameFromSitemapLoc(row.loc);
      if (!pathname || seen.has(pathname)) continue;
      seen.add(pathname);
      const alias = resolveLocaleHomeAliasTarget(pathname, runtime.contentIndex, runtime.contentRoot);
      const redirectHit = redirects.test(pathname);
      const mapped =
        redirectHit.match
          ? redirectHit.resolvedTo || (typeof redirectHit.to === "string" ? redirectHit.to : "")
          : "";
      const redirectTo = alias || mapped;
      if (redirectTo && normalizePublicPath(redirectTo) !== normalizePublicPath(pathname)) {
        redirected += 1;
        continue;
      }
      jobs.push({
        siteId: site.contentFolder,
        pathname,
        slug: row.slug,
        locale: row.locale,
        contentType: row.content_type,
      });
    }
  }

  const codeHighlight = new Map<string, boolean>();
  function pageNeedsCodeHighlight(job: PageJob): boolean {
    const id = `${job.siteId}:${job.pathname}`;
    const cached = codeHighlight.get(id);
    if (cached !== undefined) return cached;
    const contentIndex = runtimes.get(job.siteId)?.contentIndex;
    let needs = false;
    if (contentIndex && job.slug) {
      const opts = job.contentType ? { contentType: job.contentType } : undefined;
      const locale = job.locale || "en";
      const texts = [
        contentIndex.getFileContent(job.slug, locale, opts)?.content,
        contentIndex.getFileContent(job.slug, "_common", opts)?.content,
      ];
      needs = texts.some((text) => !!text && markdownPluginFlags(text).shiki);
    }
    codeHighlight.set(id, needs);
    return needs;
  }

  jobs.sort((a, b) => Number(pageNeedsCodeHighlight(a)) - Number(pageNeedsCodeHighlight(b)));

  console.log(`[prebuild-html] build ${getHtmlBuildId()} pages ${jobs.length}`);

  let wrote = 0;
  let skipped = 0;
  let failed = 0;

  await runPool(jobs);

  console.log(
    `[prebuild-html] done wrote ${wrote} skipped ${skipped} failed ${failed} redirected ${redirected}`,
  );
  if (wrote === 0 && jobs.length > 0) {
    console.error("[prebuild-html] no page was stored");
    process.exit(1);
  }

  const gate = evaluateRenderGate(gateCounts);
  const overridden = process.env.SKIP_RENDER_GATE === "1";
  for (const line of renderGateLogLines(gateCounts, gate, gateEmptyPaths.slice(0, 200), overridden)) {
    console.log(line);
  }
  writeRenderGateState({
    result: !gate.failed ? "passed" : overridden ? "skipped_by_override" : "failed",
    deploy_sha: process.env.DEPLOY_SHA || null,
    run_url: process.env.DEPLOY_RUN_URL || null,
    checked_at: new Date().toISOString(),
    counts: gateCounts,
    failing: gate.failing,
    empty_paths: gateEmptyPaths.slice(0, 50),
  });
  if (gate.failed && !overridden) {
    console.error(
      "[prebuild-html] page render check failed: too many pages of a content type rendered empty. " +
        "The deploy stops before going live; the live site is unchanged.",
    );
    process.exit(1);
  }
}
