#!/usr/bin/env tsx
/**
 * Local MCP stress harness — npm run test:stress
 *
 * Boots isolated app+MCP on dedicated ports, runs data-driven read-only scenarios,
 * writes artifacts/stress-report.{json,md,html}.
 */

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { config as loadDotenv } from "dotenv";
import { mintConnectionToken, readConnectionToken } from "../../cli/src/lib/connection-token.js";
import { pullAllSitesContent } from "../content-pull.js";
import { resolveBudget, SITE_PROBE_P95_MS } from "./budgets.js";
import { McpStressClient } from "./mcp-client.js";
import { isDbBacked, loadContentTypes } from "../../mcp-server/lib/content.js";
import { entrySourceRoot } from "../../mcp-server/lib/entry-source.js";
import { listTypePages } from "../../server/entry-layer.js";
import {
  aggregateProbe,
  aggregateSamples,
  buildReport,
  detectNotConfiguredPayload,
  writeReports,
  type CallSample,
  type ScenarioStats,
} from "./report.js";
import {
  resolveArgs,
  scenariosForRun,
  scenariosInPhase,
  type DiscoveryCtx,
  type Scenario,
} from "./scenarios.js";
import {
  spawnStressServers,
  stopStressServers,
  waitForAppHealth,
  waitForMcpHealth,
  type StressHandles,
} from "./spawn.js";

loadDotenv({ quiet: true });

type Flags = {
  pull: boolean;
  forcePull: boolean;
  skipPull: boolean;
  concurrency: number;
  heavy: boolean;
  port: number;
  mcpPort: number;
  failOnBudget: boolean;
};

function parseFlags(argv: string[]): Flags {
  const getNum = (name: string, fallback: number) => {
    const i = argv.indexOf(name);
    if (i < 0) return fallback;
    const v = Number(argv[i + 1]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  return {
    pull: argv.includes("--pull"),
    forcePull: argv.includes("--force-pull"),
    skipPull: argv.includes("--skip-pull"),
    concurrency: getNum("--concurrency", 8),
    heavy: argv.includes("--heavy"),
    port: getNum("--port", 5100),
    mcpPort: getNum("--mcp-port", 3101),
    failOnBudget: argv.includes("--fail-on-budget"),
  };
}

type SiteEntry = { domain: string; contentFolder: string };

function loadPrimarySite(projectRoot: string): SiteEntry {
  const sitesPath = path.join(projectRoot, "sites.yml");
  if (!fs.existsSync(sitesPath)) {
    throw new Error("sites.yml not found at project root");
  }
  const raw = fs.readFileSync(sitesPath, "utf-8");
  // Minimal parse: first domain block with content_folder
  const lines = raw.split("\n");
  let domain: string | null = null;
  let contentFolder: string | null = null;
  for (const line of lines) {
    if (/^\s*#/.test(line) || !line.trim()) continue;
    const dom = line.match(/^([a-z0-9][a-z0-9.-]*):\s*$/i);
    if (dom && !["bucket_name"].includes(dom[1]!.toLowerCase())) {
      if (domain && contentFolder) break;
      domain = dom[1]!;
      contentFolder = null;
      continue;
    }
    const cf = line.match(/^\s+content_folder:\s*(\S+)/);
    if (cf && domain && !contentFolder) {
      contentFolder = cf[1]!.replace(/['"]/g, "");
    }
  }
  if (!domain || !contentFolder) {
    throw new Error("Could not resolve primary domain/content_folder from sites.yml");
  }
  return { domain, contentFolder };
}

async function ensureContent(
  projectRoot: string,
  site: SiteEntry,
  flags: Flags,
): Promise<{ pulled: boolean; commit?: string | null }> {
  const folderPath = path.join(projectRoot, site.contentFolder);
  const missing = !fs.existsSync(folderPath);

  if (missing && flags.skipPull) {
    throw new Error(
      `Content folder ${site.contentFolder} is missing and --skip-pull was set. Run npm run content:pull or omit --skip-pull.`,
    );
  }

  if (missing || flags.pull || flags.forcePull) {
    if (!process.env.GITHUB_TOKEN?.trim()) {
      throw new Error(
        `Need to pull content but GITHUB_TOKEN is not set. Set it in .env, then retry.`,
      );
    }
    console.log(`[stress] Pulling content (${flags.forcePull ? "force" : "hash-diff"})…`);
    const result = await pullAllSitesContent({
      force: flags.forcePull,
      required: true,
      quiet: false,
    });
    if (!result.ok) {
      throw new Error("content:pull failed — see logs above");
    }
    const row = result.results.find((r) => r.contentFolder === site.contentFolder);
    if (!fs.existsSync(folderPath)) {
      throw new Error(`Content folder ${site.contentFolder} still missing after pull`);
    }
    return { pulled: true, commit: row?.commitSha ?? null };
  }

  return { pulled: false };
}

type EntryRow = { slug?: string; locales?: string[] };

function extractEntryRows(list: Record<string, unknown> | null): EntryRow[] {
  if (!list) return [];
  if (Array.isArray(list.entries)) return list.entries as EntryRow[];
  if (Array.isArray(list.items)) return list.items as EntryRow[];
  if (Array.isArray(list.rows)) return list.rows as EntryRow[];
  return [];
}

function pickSampleIndices(n: number, maxSamples: number): number[] {
  if (n <= 0) return [];
  if (n <= maxSamples) return Array.from({ length: n }, (_, i) => i);
  const idxs = new Set<number>([0, n - 1, Math.floor(n / 2)]);
  const step = Math.max(1, Math.floor(n / maxSamples));
  for (let i = 0; i < n && idxs.size < maxSamples; i += step) idxs.add(i);
  return [...idxs].sort((a, b) => a - b);
}

function localeOf(row: EntryRow): string {
  return Array.isArray(row.locales) && row.locales[0] ? row.locales[0] : "en";
}

async function discoverCtx(
  client: McpStressClient,
  site: SiteEntry,
  heavy: boolean,
): Promise<DiscoveryCtx> {
  const siteArg = { site: site.domain };
  const statsCall = await client.callTool("list_entries", siteArg);
  if (!statsCall.ok) {
    throw new Error(`Discovery list_entries stats failed: ${statsCall.error}`);
  }
  const stats = client.parseJson(statsCall.text);
  const types = Array.isArray(stats?.types)
    ? (stats!.types as Array<{ contentType?: string; count?: number }>)
    : [];
  if (!types.length) {
    throw new Error(
      "Discovery found no content types. Ensure site_* has entries, then retry.",
    );
  }

  const ranked = [...types]
    .filter((t) => typeof t.contentType === "string" && (t.count ?? 0) > 0)
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  if (!ranked.length) {
    throw new Error(
      "Discovery found content types but all counts are zero — cannot pick a slug.",
    );
  }

  const blog = ranked.find((t) => t.contentType === "blog");
  const primary = blog ?? ranked[0]!;
  const contentType = primary.contentType!;
  const alt = ranked.find((t) => t.contentType !== contentType);
  const entryCount =
    typeof primary.count === "number" && primary.count > 0
      ? primary.count
      : 0;

  const limit = heavy ? 100 : 50;
  const listCall = await client.callTool("list_entries", {
    ...siteArg,
    contentType,
    limit,
  });
  if (!listCall.ok) {
    throw new Error(`Discovery list_entries(${contentType}) failed: ${listCall.error}`);
  }
  const list = client.parseJson(listCall.text);
  const rows = extractEntryRows(list).filter(
    (r) => typeof r.slug === "string" && r.slug.trim(),
  );
  if (!rows.length) {
    const keys = list ? Object.keys(list).join(",") : "null";
    throw new Error(
      `Discovery found no entry slugs for contentType=${contentType} (payload keys: ${keys}).`,
    );
  }

  // Sample up to 10 candidates; size by get_entry_content payload bytes.
  const sampleIdx = pickSampleIndices(rows.length, 10);
  const sized: Array<{ slug: string; locale: string; bytes: number }> = [];
  for (const i of sampleIdx) {
    const row = rows[i]!;
    const slug = row.slug!.trim();
    const locale = localeOf(row);
    const probe = await client.callTool("get_entry_content", {
      ...siteArg,
      slug,
      locale,
    });
    sized.push({
      slug,
      locale,
      bytes: probe.ok ? probe.response_bytes : 0,
    });
  }
  sized.sort((a, b) => b.bytes - a.bytes);
  const heavyPick = sized[0] ?? {
    slug: rows[0]!.slug!.trim(),
    locale: localeOf(rows[0]!),
    bytes: 0,
  };
  const lightPick = sized[sized.length - 1] ?? heavyPick;
  const hasDistinctLight = lightPick.slug !== heavyPick.slug;

  // Optional inventory — best-effort; scenarios skip when missing.
  let productSku: string | undefined;
  let productContentType: string | undefined;
  const productsCall = await client.callTool("list_products", siteArg);
  if (productsCall.ok) {
    const pdata = client.parseJson(productsCall.text);
    const products = Array.isArray(pdata?.products)
      ? (pdata!.products as Array<{ content_slug?: string; content_type?: string; slug?: string }>)
      : [];
    const first = products.find((p) => p.content_slug || p.slug);
    if (first) {
      productSku = (first.content_slug || first.slug)!.trim();
      if (typeof first.content_type === "string") productContentType = first.content_type;
    }
  }

  let databaseId: string | undefined;
  const dbCall = await client.callTool("list_databases", siteArg);
  if (dbCall.ok) {
    const ddata = client.parseJson(dbCall.text);
    const databases = Array.isArray(ddata?.databases)
      ? (ddata!.databases as Array<{ name?: string }>)
      : [];
    const first = databases.find((d) => typeof d.name === "string" && d.name.trim());
    if (first?.name) databaseId = first.name.trim();
  }

  const dbEntry = discoverDbEntry(site);
  const adsEntry = discoverAdsOptimizedEntry(site);

  let componentName: string | undefined;
  const compCall = await client.callTool("list_components", siteArg);
  if (compCall.ok) {
    const cdata = client.parseJson(compCall.text);
    const comps = Array.isArray(cdata)
      ? (cdata as Array<{ type?: string; name?: string }>)
      : Array.isArray(cdata?.components)
        ? (cdata!.components as Array<{ type?: string; name?: string }>)
        : [];
    const first = comps.find((c) => c.type || c.name);
    if (first) componentName = String(first.type || first.name).trim();
  }

  let seoClusterId: string | undefined;
  const clusterCall = await client.callTool("list_seo_clusters", siteArg);
  if (clusterCall.ok) {
    const cldata = client.parseJson(clusterCall.text);
    const clusters = Array.isArray(cldata?.clusters)
      ? (cldata!.clusters as Array<{ hubId?: string }>)
      : [];
    const first = clusters.find((c) => typeof c.hubId === "string" && c.hubId.trim());
    if (first?.hubId) seoClusterId = first.hubId.trim();
  }

  let mediaHasPage2 = false;
  const mediaCall = await client.callTool("list_media", {
    ...siteArg,
    page: 1,
    page_size: 100,
  });
  if (mediaCall.ok) {
    const mdata = client.parseJson(mediaCall.text);
    const total =
      typeof mdata?.total === "number"
        ? mdata.total
        : typeof mdata?.total_count === "number"
          ? mdata.total_count
          : Array.isArray(mdata?.items)
            ? mdata.items.length
            : Array.isArray(mdata?.media)
              ? mdata.media.length
              : 0;
    const pageSize =
      typeof mdata?.page_size === "number"
        ? mdata.page_size
        : typeof mdata?.pageSize === "number"
          ? mdata.pageSize
          : 100;
    mediaHasPage2 = total > pageSize;
  }

  const resolvedEntryCount =
    entryCount ||
    (typeof list?.total === "number"
      ? list.total
      : typeof list?.total_count === "number"
        ? list.total_count
        : rows.length);

  return {
    site: site.domain,
    contentType,
    slug: heavyPick.slug,
    locale: heavyPick.locale,
    slugLight: hasDistinctLight ? lightPick.slug : undefined,
    localeLight: hasDistinctLight ? lightPick.locale : undefined,
    hasDistinctLight,
    heavy,
    contentTypeAlt: alt?.contentType,
    entryCount: resolvedEntryCount,
    mediaHasPage2,
    productSku,
    productContentType,
    databaseId,
    componentName,
    seoClusterId,
    ...(dbEntry ? { dbEntrySlug: dbEntry.slug, dbEntryLocale: dbEntry.locale, dbEntryContentType: dbEntry.contentType } : {}),
    ...(adsEntry ? { adsEntrySlug: adsEntry.slug, adsEntryLocale: adsEntry.locale, adsEntryContentType: adsEntry.contentType } : {}),
  };
}

/** First page of a database-backed type from its stored copy (local read; no MCP call). */
function discoverDbEntry(site: SiteEntry): { contentType: string; slug: string; locale: string } | null {
  try {
    const contentPath = path.resolve(process.cwd(), site.contentFolder);
    for (const [contentType, config] of Object.entries(loadContentTypes(contentPath))) {
      if (!isDbBacked(config)) continue;
      const first = listTypePages(entrySourceRoot(contentPath), contentType)?.pages[0];
      if (first) return { contentType, slug: first.slug, locale: first.locale };
    }
  } catch {
    // Scenario skips when no database entry is found.
  }
  return null;
}

/** First page of an "Optimize for ads" type (local read; no MCP call). */
function discoverAdsOptimizedEntry(site: SiteEntry): { contentType: string; slug: string; locale: string } | null {
  try {
    const contentPath = path.resolve(process.cwd(), site.contentFolder);
    for (const [contentType, config] of Object.entries(loadContentTypes(contentPath))) {
      if ((config as { ads?: { optimize?: boolean } }).ads?.optimize !== true) continue;
      const first = listTypePages(entrySourceRoot(contentPath), contentType)?.pages[0];
      if (first) return { contentType, slug: first.slug, locale: first.locale };
    }
  } catch {
    // Scenario skips when no ads-optimized page is found.
  }
  return null;
}

async function runScenario(
  client: McpStressClient,
  scenario: Scenario,
  ctx: DiscoveryCtx,
): Promise<{ stats: ScenarioStats; skipped?: { scenario_id: string; reason: string } }> {
  const band = scenario.class ?? "normal";
  const budget = resolveBudget(scenario.id, band);
  const skipReason = scenario.skipIf?.(ctx) ?? null;
  if (skipReason) {
    return {
      stats: aggregateSamples(
        scenario.id,
        scenario.tool,
        {},
        band,
        [],
        budget,
        skipReason,
        scenario.about,
      ),
      skipped: { scenario_id: scenario.id, reason: skipReason },
    };
  }

  const args = resolveArgs(scenario, ctx);
  const reps = scenario.reps ?? 3;
  const samples: CallSample[] = [];
  for (let i = 0; i < reps; i++) {
    const result = await client.callTool(scenario.tool, args);
    const payload = result.ok ? client.parseJson(result.text) : null;
    samples.push({
      duration_ms: result.duration_ms,
      response_bytes: result.response_bytes,
      est_tokens: result.est_tokens,
      ok: result.ok,
      error: result.error,
      not_configured: result.ok ? detectNotConfiguredPayload(payload) : false,
    });
  }

  return {
    stats: aggregateSamples(
      scenario.id,
      scenario.tool,
      args,
      band,
      samples,
      budget,
      undefined,
      scenario.about,
    ),
  };
}

async function runBurst(
  client: McpStressClient,
  ctx: DiscoveryCtx,
  burstScenarios: Scenario[],
  concurrency: number,
  appPort: number,
): Promise<{
  byScenario: Map<string, { scenario: Scenario; samples: CallSample[] }>;
  probeMs: number[];
  probeFailures: number;
}> {
  const probeMs: number[] = [];
  let probeFailures = 0;
  let probing = true;

  const takeProbe = async () => {
    const t0 = Date.now();
    try {
      const res = await fetch(`http://127.0.0.1:${appPort}/health`);
      probeMs.push(Date.now() - t0);
      if (!res.ok) probeFailures += 1;
    } catch {
      probeMs.push(Date.now() - t0);
      probeFailures += 1;
    }
  };

  // Seed a few probes before load so short bursts still yield useful p50/p95.
  for (let i = 0; i < 3; i++) await takeProbe();

  const probeLoop = (async () => {
    while (probing) {
      await takeProbe();
      await new Promise((r) => setTimeout(r, 50));
    }
  })();

  const active = burstScenarios.filter((s) => !(s.skipIf?.(ctx) ?? null));
  const byScenario = new Map<string, { scenario: Scenario; samples: CallSample[] }>();
  for (const s of active) {
    byScenario.set(s.id, { scenario: s, samples: [] });
  }

  const jobs = Array.from({ length: concurrency }, async (_, i) => {
    if (!active.length) return;
    const scenario = active[i % active.length]!;
    const args = resolveArgs(scenario, ctx);
    const result = await client.callTool(scenario.tool, args);
    const payload = result.ok ? client.parseJson(result.text) : null;
    const sample: CallSample = {
      duration_ms: result.duration_ms,
      response_bytes: result.response_bytes,
      est_tokens: result.est_tokens,
      ok: result.ok,
      error: result.error,
      not_configured: result.ok ? detectNotConfiguredPayload(payload) : false,
    };
    byScenario.get(scenario.id)!.samples.push(sample);
  });

  await Promise.all(jobs);
  // Hold the probe open briefly after burst so concurrent load is reflected.
  await new Promise((r) => setTimeout(r, 200));
  probing = false;
  await probeLoop;

  return { byScenario, probeMs, probeFailures };
}

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const flags = parseFlags(process.argv.slice(2));
  const started_at = new Date().toISOString();

  console.log(
    `[stress] ports app=${flags.port} mcp=${flags.mcpPort} concurrency=${flags.concurrency} heavy=${flags.heavy}`,
  );

  const site = loadPrimarySite(projectRoot);
  const contentMeta = await ensureContent(projectRoot, site, flags);
  console.log(`[stress] content ${site.contentFolder} (${site.domain})`);

  let token = readConnectionToken(projectRoot);
  if (!token) token = mintConnectionToken(projectRoot);
  else process.env.WEBLIFY_CONNECTION_TOKEN = token;

  let handles: StressHandles | null = null;
  let exitCode = 0;

  try {
    handles = await spawnStressServers({
      projectRoot,
      appPort: flags.port,
      mcpPort: flags.mcpPort,
      connectionToken: token,
    });
    console.log("[stress] waiting for app + MCP health…");
    await waitForAppHealth(flags.port);
    await waitForMcpHealth(flags.mcpPort, handles.mcp);
    console.log("[stress] servers healthy");

    const mcpBase = `http://127.0.0.1:${flags.mcpPort}`;
    const client = new McpStressClient(mcpBase, token);
    console.log("[stress] OAuth bootstrap (weblify-local)…");
    await client.bootstrapOAuth();
    await client.initialize();

    // Warmup — discarded
    console.log("[stress] warmup…");
    await client.callTool("list_sites", {});

    console.log("[stress] discovery…");
    const ctx = await discoverCtx(client, site, flags.heavy);
    console.log(
      `[stress] discovered type=${ctx.contentType} heavy=${ctx.slug}@${ctx.locale}` +
        (ctx.hasDistinctLight
          ? ` light=${ctx.slugLight}@${ctx.localeLight}`
          : " light=(same)") +
        ` entries≈${ctx.entryCount}` +
        (ctx.productSku ? ` product=${ctx.productSku}` : "") +
        (ctx.databaseId ? ` db=${ctx.databaseId}` : "") +
        (ctx.componentName ? ` component=${ctx.componentName}` : "") +
        (ctx.seoClusterId ? ` cluster=${ctx.seoClusterId}` : ""),
    );

    const allScenarios = scenariosForRun(flags.heavy);
    const sequential = scenariosInPhase(allScenarios, "sequential");
    const scenarioStats: ScenarioStats[] = [];
    const skipped: Array<{ scenario_id: string; reason: string }> = [];

    console.log(`[stress] sequential (${sequential.length} scenarios)…`);
    for (const scenario of sequential) {
      process.stdout.write(`  · ${scenario.id}… `);
      const { stats, skipped: sk } = await runScenario(client, scenario, ctx);
      scenarioStats.push(stats);
      if (sk) {
        skipped.push(sk);
        console.log(`skipped (${sk.reason})`);
      } else if (stats.hard_error) {
        console.log(`ERROR ${stats.duration_ms.p95}ms`);
      } else {
        console.log(
          `${stats.duration_ms.p95}ms p95 / ${stats.est_tokens.max} tokens${stats.over_band.length ? " [over band]" : ""}${stats.not_configured ? " [N.C.]" : ""}`,
        );
      }
    }

    const burstList = scenariosInPhase(allScenarios, "burst");
    console.log(
      `[stress] burst ×${flags.concurrency} across ${burstList.length} tools + /health probe…`,
    );
    const burst = await runBurst(client, ctx, burstList, flags.concurrency, flags.port);
    for (const [id, { scenario, samples }] of burst.byScenario) {
      if (!samples.length) continue;
      const band = scenario.class ?? "normal";
      const budget = resolveBudget(id, band);
      const burstStats = aggregateSamples(
        `burst_${id}`,
        scenario.tool,
        { ...resolveArgs(scenario, ctx), concurrency: flags.concurrency },
        band,
        samples,
        budget,
        undefined,
        scenario.about,
      );
      scenarioStats.push(burstStats);
      console.log(
        `  · burst_${id} p95=${burstStats.duration_ms.p95}ms tokens=${burstStats.est_tokens.max}`,
      );
    }

    const healthProbe = aggregateProbe(burst.probeMs, burst.probeFailures);
    if (healthProbe.p95_ms > SITE_PROBE_P95_MS) {
      // Attach as over_band note via synthetic — report section handles probe separately
      console.log(
        `  · /health probe p95=${healthProbe.p95_ms}ms (band ${SITE_PROBE_P95_MS}ms) [over band]`,
      );
    } else {
      console.log(`  · /health probe p95=${healthProbe.p95_ms}ms`);
    }

    const finished_at = new Date().toISOString();
    const probeOver = healthProbe.p95_ms > SITE_PROBE_P95_MS || healthProbe.failures > 0;

    // If probe over band, count toward fail_on_budget
    const report = buildReport({
      started_at,
      finished_at,
      ports: { app: flags.port, mcp: flags.mcpPort },
      content: {
        folder: site.contentFolder,
        domain: site.domain,
        pulled: contentMeta.pulled,
        commit: contentMeta.commit,
      },
      auth: "weblify-local (OAuth via connection token)",
      concurrency: flags.concurrency,
      heavy: flags.heavy,
      fail_on_budget: flags.failOnBudget,
      scenarios: scenarioStats,
      skipped,
      site_probe: { health: healthProbe },
    });

    if (flags.failOnBudget && probeOver) {
      report.ok = false;
      report.summary.over_band += 1;
    }

    const { jsonPath, mdPath, htmlPath } = writeReports(projectRoot, report);
    console.log(`[stress] wrote ${jsonPath}`);
    console.log(`[stress] wrote ${mdPath}`);
    console.log(`[stress] wrote ${htmlPath}`);
    console.log(
      `[stress] summary: hard_errors=${report.summary.hard_errors} over_band=${report.summary.over_band} skipped=${report.summary.skipped} not_configured=${report.summary.not_configured}`,
    );
    if (report.summary.slowest_scenario) {
      console.log(`[stress] slowest: ${report.summary.slowest_scenario}`);
    }
    if (report.summary.largest_payload_scenario) {
      console.log(`[stress] largest tokens: ${report.summary.largest_payload_scenario}`);
    }

    for (const s of scenarioStats.filter((x) => x.over_band.length)) {
      console.warn(
        `[stress] WARN over band: ${s.scenario_id} (${s.over_band.join(", ")})`,
      );
    }
    if (probeOver) {
      console.warn(
        `[stress] WARN site probe over band or failures (p95=${healthProbe.p95_ms}ms failures=${healthProbe.failures})`,
      );
    }

    // Primary CTA — clickable in most terminals
    console.log(`\nReport: ${pathToFileURL(htmlPath).href}\n`);

    if (!report.ok) exitCode = 1;
  } catch (err) {
    console.error(`[stress] FATAL: ${err instanceof Error ? err.message : String(err)}`);
    exitCode = 1;
  } finally {
    stopStressServers(handles);
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
