/**
 * Derived cluster graph at `{contentRoot}/seo-index.json`.
 * YAML `seo:` is source of truth. Patch on every live write; rebuild on missing/corrupt.
 */

import * as fs from "fs";
import * as path from "path";
import {
  getFolder,
} from "./content-types";
import type { ContentIndex } from "./content-index";
import { contentIndex } from "./content-index";
import { getDefaultContentRoot } from "./site-config";
import { markFileAsModified } from "./sync-state";
import { runInSaveBatch } from "./events/save-batch-context";
import { emitEntrySeoChanged } from "./events/emit-entry-events";
import { buildEntryKey } from "../scripts/validation/shared/entryKey";
import { getSiteContextMap } from "./site-manager";
import { child } from "./logger";
import {
  hasEffectiveSeoSignal,
  isPillarPathExplicitlyNull,
  itemLocale,
  localeYamlRelPath,
  resolveEffectiveSeo,
} from "./seo-effective-seo";
import { isSeoMonitoringEnabled } from "./seo-monitoring";
import {
  contentRootAbs as monitoredContentRootAbs,
  dbItemKey,
  listMonitoredNoSeoSignalGaps,
  loadMonitoredDbItemsForRebuild,
  scanLiveLocaleFiles,
  slugFromDbItem,
} from "./seo-monitored-scan";
import {
  classifyClusterEntry,
  computeClusterHealth as computeClusterHealthBuckets,
  listBrokenClusterRefs,
  listClusterBucketEntries as listClusterBucketEntriesCore,
  type BrokenClusterRefReason,
  type BrokenClusterRefRow,
  type ClusterBucket,
  type ClusterBucketEntryRow,
  type ClusterFilterBucket,
  type ClusterHealth,
  type ListClusterBucketEntriesResult,
} from "./seo-cluster-stats";
export {
  classifyClusterEntry,
  listBrokenClusterRefs,
  isClusterFilterBucket,
  CLUSTER_FILTER_BUCKETS,
  enrichClusterBucketRowsWithKeywordMetrics,
  type BrokenClusterRefReason,
  type BrokenClusterRefRow,
  type ClusterBucket,
  type ClusterBucketEntryRow,
  type ClusterFilterBucket,
  type ClusterHealth,
  type ListClusterBucketEntriesResult,
} from "./seo-cluster-stats";
import {
  canonicalizePillarPath,
  entryCanonicalPath,
  mergeSeoUpdates,
  migrateMainKeywordInYamlText,
  normalizeSeoBlock,
  parseSeoResearchMetric,
  readSeoBlockFromYamlText,
  seoFieldFromPath,
  surgicalReplaceSeoBlock,
  validateSeoSave,
  yamlHasSeoKey,
  type SeoBlock,
  type SeoIndexWarning,
} from "./seo-fields";

const log = child({ module: "seo-index" });

const LIVE_LOCALE_FILE = /^[a-z]{2}\.ya?ml$/i;

export const SEO_INDEX_FILENAME = "seo-index.json";

export type { SeoIndexWarning };

export type WriteSeoFieldsResult =
  | {
      success: true;
      relativePath: string;
      filePath: string;
      isVariantLayer: boolean;
      warnings: SeoIndexWarning[];
      indexRebuilt?: boolean;
      memberFiles?: string[];
    }
  | {
      success: false;
      error: string;
      code?: string;
      statusCode?: number;
    };

function contentRootAbs(contentRoot?: string): string {
  return monitoredContentRootAbs(contentRoot);
}

function localeFilePath(
  contentType: string,
  slug: string,
  locale: string,
  contentRoot: string,
  variant?: string | null,
): string {
  const dir = path.join(contentRootAbs(contentRoot), getFolder(contentType, contentRoot), slug);
  if (variant && variant.trim() && variant.trim() !== "default") {
    return path.join(dir, `${variant.trim()}.${locale}.yml`);
  }
  return path.join(dir, `${locale}.yml`);
}

function commonFilePath(contentType: string, slug: string, contentRoot: string): string {
  return path.join(contentRootAbs(contentRoot), getFolder(contentType, contentRoot), slug, "_common.yml");
}

function isLiveLocaleBasename(filePath: string): boolean {
  return LIVE_LOCALE_FILE.test(path.basename(filePath));
}

function relativeFromCwd(abs: string): string {
  return path.relative(process.cwd(), abs).split(path.sep).join("/");
}

export function isSeoIndexRelPath(filePath: string, contentRoot?: string): boolean {
  const folder = path.basename(contentRootAbs(contentRoot));
  const normalized = filePath.split(path.sep).join("/");
  return (
    normalized === SEO_INDEX_FILENAME ||
    normalized.endsWith(`/${SEO_INDEX_FILENAME}`) ||
    normalized === `${folder}/${SEO_INDEX_FILENAME}`
  );
}

export type SeoIndexEntry = {
  content_type: string;
  slug: string;
  locale: string;
  file: string;
  path: string;
  main_keyword: string | null;
  kw_monthly_volume: number | null;
  kw_difficulty: number | null;
  is_pillar: boolean;
  pillar_path: string | null;
  pillar_live: boolean | null;
  /** Explicit seo.pillar_path: null opt-out on locale YAML. */
  pillar_opted_out?: boolean;
};

export type SeoIndexCluster = {
  path: string;
  members: string[];
};

export type SeoIndex = {
  version: 1;
  generated_at: string;
  rebuilt?: boolean;
  entries: Record<string, SeoIndexEntry>;
  by_path: Record<string, string>;
  clusters: Record<string, SeoIndexCluster>;
  orphans: string[];
  warnings: SeoIndexWarning[];
};

export function seoEntryId(contentType: string, slug: string, locale: string): string {
  return `${contentType}/${slug}/${locale}`;
}

export function seoIndexPath(contentRoot?: string): string {
  const raw = contentRoot ?? getDefaultContentRoot();
  const abs = path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
  return path.join(abs, SEO_INDEX_FILENAME);
}

function emptyIndex(rebuilt = false): SeoIndex {
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    rebuilt: rebuilt || undefined,
    entries: {},
    by_path: {},
    clusters: {},
    orphans: [],
    warnings: [],
  };
}

function hasSeoSignal(seo: SeoBlock): boolean {
  return hasEffectiveSeoSignal(seo);
}

function indexEntryFromSeo(opts: {
  contentType: string;
  slug: string;
  locale: string;
  file: string;
  seo: SeoBlock;
  pillarLive: boolean | null;
  ci: ContentIndex;
}): SeoIndexEntry {
  const row = rowFromSeo(opts);
  row.pillar_opted_out = isPillarPathExplicitlyNull(opts.seo);
  return row;
}

function recomputeGraph(index: SeoIndex): void {
  const byPath: Record<string, string> = {};
  const clusters: Record<string, SeoIndexCluster> = {};
  const orphans: string[] = [];
  const warnings = index.warnings.filter((w) => w.code !== "duplicate_pillar");

  for (const [id, row] of Object.entries(index.entries)) {
    if (!row.is_pillar) continue;
    const p = row.path || row.pillar_path;
    if (!p) continue;
    if (byPath[p] && byPath[p] !== id) {
      warnings.push({
        code: "duplicate_pillar",
        entry: id,
        pillar_path: p,
        message: `Another hub already owns this path (${byPath[p]}).`,
      });
      continue;
    }
    byPath[p] = id;
    clusters[id] = { path: p, members: [] };
  }

  for (const [id, row] of Object.entries(index.entries)) {
    const pp = typeof row.pillar_path === "string" ? row.pillar_path.trim() : "";
    if (!pp) continue;
    if (row.is_pillar && (row.path === pp || row.pillar_path === pp)) continue;
    const hubId = byPath[pp];
    if (!hubId) {
      orphans.push(id);
      continue;
    }
    const cluster = clusters[hubId];
    if (cluster && !cluster.members.includes(id)) cluster.members.push(id);
  }

  index.by_path = byPath;
  index.clusters = clusters;
  index.orphans = orphans;
  index.warnings = warnings;
  index.generated_at = new Date().toISOString();
}

let memory: { root: string; index: SeoIndex } | null = null;

export function loadSeoIndex(contentRoot?: string): SeoIndex {
  const file = seoIndexPath(contentRoot);
  const root = path.dirname(file);
  if (memory && memory.root === root) return memory.index;
  if (!fs.existsSync(file)) {
    const rebuilt = rebuildSeoIndex({ contentRoot, reason: "missing" });
    memory = { root, index: rebuilt };
    return rebuilt;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as SeoIndex;
    if (!parsed || parsed.version !== 1 || typeof parsed.entries !== "object") {
      throw new Error("invalid shape");
    }
    parsed.entries = parsed.entries || {};
    parsed.by_path = parsed.by_path || {};
    parsed.clusters = parsed.clusters || {};
    parsed.orphans = parsed.orphans || [];
    parsed.warnings = parsed.warnings || [];
    memory = { root, index: parsed };
    return parsed;
  } catch (err) {
    log.warn({ err, file }, "seo-index unreadable; rebuilding from YAML");
    const rebuilt = rebuildSeoIndex({ contentRoot, reason: "corrupt" });
    memory = { root, index: rebuilt };
    return rebuilt;
  }
}

export function saveSeoIndex(
  index: SeoIndex,
  opts?: { contentRoot?: string; author?: string; mark?: boolean; keepRebuilt?: boolean },
): string {
  const file = seoIndexPath(opts?.contentRoot);
  const rebuilt = opts?.keepRebuilt !== false ? index.rebuilt : undefined;
  const out: SeoIndex = {
    ...index,
    generated_at: new Date().toISOString(),
    rebuilt: rebuilt || undefined,
  };
  const persisted = { ...out };
  if (!persisted.rebuilt) delete persisted.rebuilt;
  fs.writeFileSync(file, `${JSON.stringify(persisted, null, 2)}\n`, "utf-8");
  memory = { root: path.dirname(file), index: out };
  if (opts?.mark !== false) {
    markFileAsModified(file, opts?.author, undefined, opts?.contentRoot);
  }
  return file;
}

export function invalidateSeoIndexCache(): void {
  memory = null;
}

function rowFromSeo(opts: {
  contentType: string;
  slug: string;
  locale: string;
  file: string;
  seo: SeoBlock;
  pillarLive: boolean | null;
  ci: ContentIndex;
}): SeoIndexEntry {
  const selfPath = entryCanonicalPath(opts.contentType, opts.slug, opts.locale, opts.ci) || "";
  const vol = parseSeoResearchMetric(opts.seo.kw_monthly_volume);
  const diff = parseSeoResearchMetric(opts.seo.kw_difficulty);
  return {
    content_type: opts.contentType,
    slug: opts.slug,
    locale: opts.locale,
    file: opts.file,
    path: selfPath,
    main_keyword: typeof opts.seo.main_keyword === "string" ? opts.seo.main_keyword : null,
    kw_monthly_volume: vol.ok ? vol.value : null,
    kw_difficulty: diff.ok ? diff.value : null,
    is_pillar: opts.seo.is_pillar === true,
    pillar_path:
      opts.seo.pillar_path === null
        ? null
        : typeof opts.seo.pillar_path === "string"
          ? opts.seo.pillar_path
          : null,
    pillar_live: opts.pillarLive,
  };
}

export function patchSeoIndexAfterLiveWrite(opts: {
  contentRoot?: string;
  contentType: string;
  slug: string;
  locale: string;
  file: string;
  seo: SeoBlock;
  pillarLive: boolean | null;
  extraWarnings?: SeoIndexWarning[];
  ci?: ContentIndex;
  author?: string;
}): { indexPath: string; rebuilt: boolean } {
  const ci = opts.ci ?? contentIndex;
  let rebuilt = false;
  let index: SeoIndex;
  try {
    index = loadSeoIndex(opts.contentRoot);
    rebuilt = !!index.rebuilt;
  } catch {
    index = rebuildSeoIndex({ contentRoot: opts.contentRoot, reason: "patch-load-failed", ci });
    rebuilt = true;
  }

  const id = seoEntryId(opts.contentType, opts.slug, opts.locale);
  index.warnings = (index.warnings || []).filter((w) => w.entry !== id);

  if (!hasSeoSignal(opts.seo)) {
    delete index.entries[id];
  } else {
    index.entries[id] = indexEntryFromSeo({
      contentType: opts.contentType,
      slug: opts.slug,
      locale: opts.locale,
      file: opts.file,
      seo: opts.seo,
      pillarLive: opts.pillarLive,
      ci,
    });
  }
  if (opts.extraWarnings?.length) {
    index.warnings.push(...opts.extraWarnings);
  }
  recomputeGraph(index);
  const indexPath = saveSeoIndex(index, {
    contentRoot: opts.contentRoot,
    author: opts.author,
    mark: false,
  });
  return { indexPath, rebuilt };
}

function ingestMonitoredSeoEntry(
  index: SeoIndex,
  opts: {
    contentType: string;
    slug: string;
    locale: string;
    file: string;
    seo: SeoBlock;
    ci: ContentIndex;
  },
): void {
  if (!hasSeoSignal(opts.seo)) return;

  let seo = opts.seo;
  let pillarLive: boolean | null = null;
  if (typeof seo.pillar_path === "string" && seo.pillar_path.trim()) {
    const canon = canonicalizePillarPath(seo.pillar_path, opts.locale, opts.ci);
    seo = { ...seo, pillar_path: canon.path };
    pillarLive = canon.live;
    if (!canon.live) {
      index.warnings.push({
        code: "pillar_not_live",
        entry: seoEntryId(opts.contentType, opts.slug, opts.locale),
        pillar_path: canon.path,
      });
    }
  }

  const id = seoEntryId(opts.contentType, opts.slug, opts.locale);
  index.entries[id] = indexEntryFromSeo({
    contentType: opts.contentType,
    slug: opts.slug,
    locale: opts.locale,
    file: opts.file,
    seo,
    pillarLive,
    ci: opts.ci,
  });
}

export function rebuildSeoIndex(opts?: {
  contentRoot?: string;
  author?: string;
  reason?: string;
  ci?: ContentIndex;
  mark?: boolean;
}): SeoIndex {
  const ci = opts?.ci ?? contentIndex;
  const contentRoot = contentRootAbs(opts?.contentRoot);
  const index = emptyIndex(true);
  const seenIds = new Set<string>();

  const dbItemsByType = loadMonitoredDbItemsForRebuild(opts?.contentRoot);

  const files = scanLiveLocaleFiles(opts?.contentRoot);
  for (const f of files) {
    if (!isSeoMonitoringEnabled(f.contentType, opts?.contentRoot)) continue;

    const commonPath = path.join(path.dirname(f.absPath), "_common.yml");
    if (fs.existsSync(commonPath) && yamlHasSeoKey(fs.readFileSync(commonPath, "utf-8"))) {
      index.warnings.push({
        code: "seo_on_common",
        entry: seoEntryId(f.contentType, f.slug, f.locale),
        message: "_common.yml has a seo: block; locale-only is required.",
      });
    }

    const dbItem = dbItemsByType.get(f.contentType)?.get(dbItemKey(f.slug, f.locale));
    const seo = resolveEffectiveSeo({
      contentType: f.contentType,
      slug: f.slug,
      locale: f.locale,
      contentRoot,
      dbItem: dbItem ?? null,
    });

    const id = seoEntryId(f.contentType, f.slug, f.locale);
    ingestMonitoredSeoEntry(index, {
      contentType: f.contentType,
      slug: f.slug,
      locale: f.locale,
      file: f.relFile,
      seo,
      ci,
    });
    if (index.entries[id]) seenIds.add(id);
  }

  for (const [contentType, byKey] of dbItemsByType) {
    for (const [, item] of byKey) {
      const slug = slugFromDbItem(item);
      if (!slug) continue;
      const locale = itemLocale(item, contentType, contentRoot);
      const id = seoEntryId(contentType, slug, locale);
      if (seenIds.has(id)) continue;

      const relFile = localeYamlRelPath(contentType, slug, locale, contentRoot);
      const seo = resolveEffectiveSeo({
        contentType,
        slug,
        locale,
        contentRoot,
        dbItem: item,
      });
      ingestMonitoredSeoEntry(index, {
        contentType,
        slug,
        locale,
        file: relFile,
        seo,
        ci,
      });
      if (index.entries[id]) seenIds.add(id);
    }
  }

  recomputeGraph(index);
  saveSeoIndex(index, {
    contentRoot: opts?.contentRoot,
    author: opts?.author,
    mark: opts?.mark !== false,
  });
  log.info(
    { reason: opts?.reason, entries: Object.keys(index.entries).length },
    "seo-index rebuilt",
  );
  return index;
}

/** Cluster health including monitored pages with no SEO signal as Unclustered. */
export function computeClusterHealth(
  index: SeoIndex,
  ci: ContentIndex = contentIndex,
  contentRoot?: string,
): ClusterHealth {
  const gaps = listMonitoredNoSeoSignalGaps(contentRoot);
  return computeClusterHealthBuckets(index, ci, gaps);
}

/** Paginated cluster-bucket entries including monitored no-signal gaps for Unclustered. */
export function listClusterBucketEntries(
  index: SeoIndex,
  opts: {
    bucket: ClusterFilterBucket;
    q?: string;
    page?: number;
    pageSize?: number;
    ci?: ContentIndex;
    contentRoot?: string;
  },
): ListClusterBucketEntriesResult {
  const gaps =
    opts.bucket === "unclustered"
      ? listMonitoredNoSeoSignalGaps(opts.contentRoot)
      : [];
  return listClusterBucketEntriesCore(index, {
    bucket: opts.bucket,
    q: opts.q,
    page: opts.page,
    pageSize: opts.pageSize,
    ci: opts.ci,
    noSignalGaps: gaps,
  });
}

export function getClusterFromIndex(
  pillarPathOrHubId: string,
  contentRoot?: string,
): { hubId: string; path: string; members: string[] } | null {
  const index = loadSeoIndex(contentRoot);
  if (index.clusters[pillarPathOrHubId]) {
    const c = index.clusters[pillarPathOrHubId];
    return { hubId: pillarPathOrHubId, path: c.path, members: c.members };
  }
  const hubId = index.by_path[pillarPathOrHubId];
  if (!hubId) return null;
  const c = index.clusters[hubId];
  if (!c) return null;
  return { hubId, path: c.path, members: c.members };
}

export function getSeoIndexEntry(
  contentType: string,
  slug: string,
  locale: string,
  contentRoot?: string,
): SeoIndexEntry | undefined {
  return loadSeoIndex(contentRoot).entries[seoEntryId(contentType, slug, locale)];
}

/** Used by migrate script only — keep yaml helper reachable. */
export function migrateLocaleFileText(text: string): { text: string; moved: boolean } {
  return migrateMainKeywordInYamlText(text);
}

function rewriteMemberPillarPaths(opts: {
  contentRoot?: string;
  hubId: string;
  oldPath: string;
  newPath: string;
}): string[] {
  if (!opts.oldPath || opts.oldPath === opts.newPath) return [];
  const index = loadSeoIndex(opts.contentRoot);
  const cluster = index.clusters[opts.hubId];
  const members = cluster?.members || [];
  const written: string[] = [];
  const root = contentRootAbs(opts.contentRoot);
  for (const memberId of members) {
    const row = index.entries[memberId];
    if (!row?.file) continue;
    const abs = path.isAbsolute(row.file) ? row.file : path.join(root, row.file);
    if (!fs.existsSync(abs)) continue;
    const text = fs.readFileSync(abs, "utf-8");
    const seo = readSeoBlockFromYamlText(text);
    seo.pillar_path = opts.newPath;
    const next = surgicalReplaceSeoBlock(text, seo);
    if (next !== text) {
      fs.writeFileSync(abs, next, "utf-8");
      written.push(abs);
    }
  }
  return written;
}

/**
 * Surgical locale `seo:` write + live index patch. Does not yaml.dump the rest of the file.
 * Disk writes complete first; then markFileAsModified for every path with the same author.
 */
export function writeSeoFields(opts: {
  contentType: string;
  slug: string;
  locale: string;
  updates: Record<string, unknown>;
  author?: string;
  contentRoot?: string;
  variant?: string | null;
  ci?: ContentIndex;
}): WriteSeoFieldsResult {
  const contentRoot = opts.contentRoot ?? getDefaultContentRoot();
  const ci = opts.ci ?? contentIndex;
  const filePath = localeFilePath(opts.contentType, opts.slug, opts.locale, contentRoot, opts.variant);
  if (!fs.existsSync(filePath)) {
    return {
      success: false,
      error: `Locale file not found: ${relativeFromCwd(filePath)}`,
      statusCode: 404,
      code: "seo_file_missing",
    };
  }

  const commonPath = commonFilePath(opts.contentType, opts.slug, contentRoot);
  const commonYaml = fs.existsSync(commonPath) ? fs.readFileSync(commonPath, "utf-8") : null;
  if (commonYaml && yamlHasSeoKey(commonYaml)) {
    return {
      success: false,
      error: "seo.* must live on the locale YAML file, not _common.yml.",
      code: "seo_on_common",
      statusCode: 400,
    };
  }

  const original = fs.readFileSync(filePath, "utf-8");
  const current = readSeoBlockFromYamlText(original);
  const merged = mergeSeoUpdates(current, opts.updates);
  const validated = validateSeoSave({
    next: merged,
    locale: opts.locale,
    contentType: opts.contentType,
    slug: opts.slug,
    ci,
    commonYaml,
  });
  if (!validated.ok) {
    return { success: false, error: validated.error, code: validated.code, statusCode: 400 };
  }

  const nextYaml = surgicalReplaceSeoBlock(original, validated.coerced);
  const isVariant = !isLiveLocaleBasename(filePath);
  const filesToMark: string[] = [];
  if (nextYaml !== original) {
    fs.writeFileSync(filePath, nextYaml, "utf-8");
    filesToMark.push(filePath);
  }

  let indexRebuilt = false;
  const memberFiles: string[] = [];
  if (!isVariant) {
    const hubId = seoEntryId(opts.contentType, opts.slug, opts.locale);
    let prevPath: string | undefined;
    try {
      const prev = loadSeoIndex(contentRoot).entries[hubId];
      prevPath = prev?.path || prev?.pillar_path || undefined;
    } catch {
      prevPath = undefined;
    }
    const newPath =
      typeof validated.coerced.pillar_path === "string" ? validated.coerced.pillar_path : "";
    if (validated.coerced.is_pillar === true && prevPath && newPath && prevPath !== newPath) {
      memberFiles.push(
        ...rewriteMemberPillarPaths({
          contentRoot,
          hubId,
          oldPath: prevPath,
          newPath,
        }),
      );
      filesToMark.push(...memberFiles);
    }

    const patch = patchSeoIndexAfterLiveWrite({
      contentRoot,
      contentType: opts.contentType,
      slug: opts.slug,
      locale: opts.locale,
      file: path.relative(contentRootAbs(contentRoot), filePath).split(path.sep).join("/"),
      seo: validated.coerced,
      pillarLive: validated.pillarLive,
      extraWarnings: validated.warnings,
      ci,
    });
    indexRebuilt = patch.rebuilt;
  }

  const uniqueMarks = Array.from(new Set(filesToMark.filter((f) => !isSeoIndexRelPath(f, contentRoot))));
  const memberEntryKeys = memberFiles.map((abs) => {
    const rel = relativeFromCwd(abs);
    const parsed = rel.match(
      /\/(programs|landings|locations|pages|blog|workshops|events|courses)\/([^/]+)\/([^/]+)\.ya?ml$/i,
    );
    if (!parsed) return null;
    const folder = parsed[1]!.toLowerCase();
    const typeMap: Record<string, string> = {
      programs: "program",
      landings: "landing",
      locations: "location",
      pages: "page",
      blog: "blog",
      workshops: "workshop",
      events: "event",
      courses: "course",
    };
    const contentType = typeMap[folder] ?? folder.replace(/s$/, "");
    const slug = parsed[2]!;
    const base = parsed[3]!.replace(/\.ya?ml$/i, "");
    const locale = base.includes(".") ? base.split(".").pop()! : base;
    return buildEntryKey(contentType, slug, locale);
  }).filter((k): k is string => Boolean(k));

  for (const f of uniqueMarks) {
    if (memberFiles.includes(f)) {
      runInSaveBatch({ suppressPipelineEmit: true, reason: "hub_seo_rewrite" }, () => {
        markFileAsModified(f, opts.author, undefined, contentRoot);
      });
    } else {
      markFileAsModified(f, opts.author, undefined, contentRoot);
    }
  }

  if (!isVariant) {
    const rootName = path.basename(contentRootAbs(contentRoot));
    const relLocale = path.relative(contentRootAbs(contentRoot), filePath).split(path.sep).join("/");
    emitEntrySeoChanged({
      site: rootName,
      contentType: opts.contentType,
      slug: opts.slug,
      locale: opts.locale,
      path: relLocale,
      author: opts.author,
      seoIndexSynced: true,
      ...(memberEntryKeys.length ? { memberEntryKeys } : {}),
    });
  }

  log.info(
    {
      contentType: opts.contentType,
      slug: opts.slug,
      locale: opts.locale,
      variant: opts.variant || null,
      indexRebuilt,
      members: memberFiles.length,
    },
    "writeSeoFields",
  );

  return {
    success: true,
    relativePath: relativeFromCwd(filePath),
    filePath,
    isVariantLayer: isVariant,
    warnings: validated.warnings,
    indexRebuilt,
    memberFiles: memberFiles.map(relativeFromCwd),
  };
}

/**
 * Remove one key from locale `seo:` (overlay reset). Falls through to DB baseline via
 * resolveEffectiveSeo for the index patch. Does not write the database.
 */
export function resetSeoOverlayField(opts: {
  contentType: string;
  slug: string;
  locale: string;
  fieldPath: string;
  author?: string;
  contentRoot?: string;
  variant?: string | null;
  dbItem?: Record<string, unknown> | null;
  ci?: ContentIndex;
}): WriteSeoFieldsResult & { noop?: boolean } {
  const field = seoFieldFromPath(opts.fieldPath);
  if (!field) {
    return {
      success: false,
      error: `Unknown seo field: ${opts.fieldPath}`,
      statusCode: 400,
      code: "seo_unknown_field",
    };
  }

  const contentRoot = opts.contentRoot ?? getDefaultContentRoot();
  const ci = opts.ci ?? contentIndex;
  const filePath = localeFilePath(opts.contentType, opts.slug, opts.locale, contentRoot, opts.variant);
  if (!fs.existsSync(filePath)) {
    return {
      success: false,
      error: `Locale file not found: ${relativeFromCwd(filePath)}`,
      statusCode: 404,
      code: "seo_file_missing",
    };
  }

  const original = fs.readFileSync(filePath, "utf-8");
  const current = readSeoBlockFromYamlText(original);
  if (!Object.prototype.hasOwnProperty.call(current, field)) {
    return {
      success: true,
      noop: true,
      relativePath: relativeFromCwd(filePath),
      filePath,
      isVariantLayer: !isLiveLocaleBasename(filePath),
      error: `Nothing to reset — "${opts.fieldPath}" is not set on this locale seo: block.`,
    };
  }

  const nextBlock: SeoBlock = { ...current };
  delete nextBlock[field];
  // Drop undefined leftovers; keep explicit nulls
  const cleaned: SeoBlock = {};
  for (const [k, v] of Object.entries(nextBlock)) {
    if (v !== undefined) cleaned[k] = v;
  }

  const nextYaml = surgicalReplaceSeoBlock(original, cleaned);
  const isVariant = !isLiveLocaleBasename(filePath);
  const filesToMark: string[] = [];
  if (nextYaml !== original) {
    fs.writeFileSync(filePath, nextYaml, "utf-8");
    filesToMark.push(filePath);
  }

  let indexRebuilt = false;
  if (!isVariant) {
    const effective = resolveEffectiveSeo({
      contentType: opts.contentType,
      slug: opts.slug,
      locale: opts.locale,
      contentRoot,
      dbItem: opts.dbItem ?? null,
    });
    const commonPath = commonFilePath(opts.contentType, opts.slug, contentRoot);
    const commonYaml = fs.existsSync(commonPath) ? fs.readFileSync(commonPath, "utf-8") : null;
    const validated = validateSeoSave({
      next: effective,
      locale: opts.locale,
      contentType: opts.contentType,
      slug: opts.slug,
      ci,
      commonYaml,
    });
    const seoForIndex = validated.ok ? validated.coerced : effective;
    const pillarLive = validated.ok ? validated.pillarLive : null;
    const patch = patchSeoIndexAfterLiveWrite({
      contentRoot,
      contentType: opts.contentType,
      slug: opts.slug,
      locale: opts.locale,
      file: path.relative(contentRootAbs(contentRoot), filePath).split(path.sep).join("/"),
      seo: seoForIndex,
      pillarLive,
      ci,
    });
    indexRebuilt = patch.rebuilt;
    if (patch.indexPath) filesToMark.push(patch.indexPath);
  }

  for (const f of Array.from(new Set(filesToMark))) {
    markFileAsModified(f, opts.author, undefined, contentRoot);
  }

  return {
    success: true,
    relativePath: relativeFromCwd(filePath),
    filePath,
    isVariantLayer: isVariant,
    indexRebuilt,
  };
}

/** Rebuild from live YAML when remote also touched the index — never force that path. */
export function healSeoIndexOnRemoteOverlap(opts?: {
  contentRoot?: string;
  author?: string;
  remoteChangedFiles?: string[];
}): { healed: boolean; indexPath?: string } {
  const remote = opts?.remoteChangedFiles || [];
  if (!remote.some((f) => isSeoIndexRelPath(f, opts?.contentRoot))) {
    return { healed: false };
  }
  rebuildSeoIndex({
    contentRoot: opts?.contentRoot,
    author: opts?.author,
    reason: "remote-overlap",
    mark: false,
  });
  log.info({ contentRoot: opts?.contentRoot }, "seo-index rebuilt after remote overlap (no force)");
  return { healed: true, indexPath: seoIndexPath(opts?.contentRoot) };
}
