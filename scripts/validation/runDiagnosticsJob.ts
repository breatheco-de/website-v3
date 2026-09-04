/**
 * Shared diagnostics job runner used by the forked worker process.
 * Parent Express process must not call this on the hot path.
 */

import type { PageCacheEntry, ValidatorResult } from "./shared/types";
import { ValidationService } from "./service";
import { getCanonicalUrl } from "./shared/canonicalUrls";
import { entryKeyFromContentFile } from "./shared/entryKey";
import { getValidatorRunClass, isEntryLocalValidator } from "./shared/runClass";
import { validators as defaultValidators, getValidator } from "./validators";
import type { ContentIndex } from "../../server/content-index";
import type { ValidationCacheService } from "../../server/services/validationCacheService";
import { isUrlStaleForFullRun } from "../../server/services/validationCacheMerge";
import type { DiagnosticsFreshness } from "./diagnosticsIpc";
import type { DiagnosticsJobResultsFile } from "./diagnosticsIpc";
import {
  diagnosticsNeedsSeoIndex,
  ensureSeoIndexBeforeDiagnostics,
} from "../../server/seo-index";

export type DiagnosticsUrlTarget = {
  url: string;
  slug: string;
  filePath: string;
  locale: string;
  type: string;
};

export type MappedIssue = {
  code: string;
  message: string;
  severity: "error" | "warning";
  category: string;
  validator?: string;
  file?: string;
  suggestion?: string;
  url?: string;
};

export function effectiveValidatorNames(
  requested?: string[],
  opts?: { slugFiltered?: boolean },
): {
  pageValidators: string[];
  siteWideValidators: string[];
  partial: boolean;
} {
  const pool = defaultValidators.map((v) => v.name).filter((n) => n !== "lighthouse");
  const names =
    requested && requested.length > 0
      ? requested.filter((n) => n !== "lighthouse" && !!getValidator(n))
      : pool;

  let resolved = names.filter((n) => n !== "lighthouse" && !!getValidator(n));
  const partial = !!(requested && requested.length > 0);

  if (opts?.slugFiltered) {
    resolved = resolved.filter((n) => isEntryLocalValidator(n));
  }

  const pageValidators = resolved.filter((n) => getValidatorRunClass(n) === "entry-local");
  const siteWideValidators = resolved.filter((n) => getValidatorRunClass(n) !== "entry-local");
  return { pageValidators, siteWideValidators, partial };
}

export async function resolveUrlTargets(
  contentRoot: string,
  ci: ContentIndex,
  slugs?: string[],
  urls?: string[],
  files?: string[],
): Promise<DiagnosticsUrlTarget[]> {
  const service = new ValidationService();
  const context = await service.buildContext({ contentRoot, ci });
  const slugSet = slugs && slugs.length > 0 ? new Set(slugs) : null;
  const urlSet =
    urls && urls.length > 0
      ? new Set(urls.map((u) => u.toLowerCase().replace(/\/$/, "") || "/"))
      : null;
  const fileSet = files && files.length > 0 ? new Set(files) : null;

  const targets: DiagnosticsUrlTarget[] = [];
  const seen = new Set<string>();

  for (const file of context.contentFiles) {
    if (fileSet && !fileSet.has(file.filePath)) continue;
    if (slugSet && !slugSet.has(file.slug)) continue;
    const url = getCanonicalUrl(file);
    const norm = url.toLowerCase().replace(/\/$/, "") || "/";
    if (urlSet && !urlSet.has(norm)) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    targets.push({
      url,
      slug: file.slug,
      filePath: file.filePath,
      locale: file.locale,
      type: file.type,
    });
  }

  return targets;
}

function mapEntryIssues(
  url: string,
  entry: PageCacheEntry | undefined,
  categories?: string[],
): MappedIssue[] {
  if (!entry) return [];
  const catSet = categories && categories.length > 0 ? new Set(categories) : null;
  const all: MappedIssue[] = [
    ...(entry.errors ?? []).map((e) => ({
      code: e.code,
      message: e.message,
      severity: "error" as const,
      category: e.category ?? "other",
      ...(e.validator ? { validator: e.validator } : {}),
      ...(e.file ? { file: e.file } : {}),
      ...(e.suggestion ? { suggestion: e.suggestion } : {}),
      url,
    })),
    ...(entry.warnings ?? []).map((w) => ({
      code: w.code,
      message: w.message,
      severity: "warning" as const,
      category: w.category ?? "other",
      ...(w.validator ? { validator: w.validator } : {}),
      ...(w.file ? { file: w.file } : {}),
      ...(w.suggestion ? { suggestion: w.suggestion } : {}),
      url,
    })),
  ];
  return catSet ? all.filter((i) => catSet.has(i.category)) : all;
}

export function issuesBySlugFromTargets(
  cache: ValidationCacheService,
  targets: { url: string; slug: string }[],
  categories?: string[],
): {
  issuesBySlug: Record<string, MappedIssue[]>;
  lastFullRunAtBySlug: Record<string, string | null>;
  cacheMisses: string[];
} {
  const issuesBySlug: Record<string, MappedIssue[]> = {};
  const lastFullRunAtBySlug: Record<string, string | null> = {};
  const cacheMisses: string[] = [];

  for (const t of targets) {
    if (!issuesBySlug[t.slug]) issuesBySlug[t.slug] = [];
    const entry = cache.getByUrl(t.url);
    if (!entry) {
      if (!cacheMisses.includes(t.slug)) cacheMisses.push(t.slug);
      lastFullRunAtBySlug[t.slug] = lastFullRunAtBySlug[t.slug] ?? null;
      continue;
    }
    issuesBySlug[t.slug].push(...mapEntryIssues(t.url, entry, categories));
    const full = entry.lastFullRunAt ?? null;
    const prev = lastFullRunAtBySlug[t.slug];
    if (!prev || (full && full > prev)) lastFullRunAtBySlug[t.slug] = full;
  }

  return { issuesBySlug, lastFullRunAtBySlug, cacheMisses };
}

/** Sentinel entry key — partial apply clears file-only issues without touching real entries. */
export const VALIDATOR_ONLY_ENTRY_KEY = "__validator_only__";

export type RunDiagnosticsJobInput = {
  contentRoot: string;
  ci: ContentIndex;
  cache: ValidationCacheService;
  slugs?: string[];
  urls?: string[];
  freshness: DiagnosticsFreshness;
  max_age_seconds: number;
  validators?: string[];
  include_artifacts: boolean;
  categories?: string[];
  /** Shared-template file re-check: one validator pass, no per-URL loop. */
  validator_only?: boolean;
  onProgress: (p: {
    processed: number;
    total: number;
    staleUrlCount: number;
    urlCount: number;
    message?: string;
  }) => void;
};

export type RunDiagnosticsJobOutput = {
  summary: { errorCount: number; warningCount: number };
  validatorResults: ValidatorResult[];
  issuesBySlug: Record<string, MappedIssue[]>;
  resultsPayload: DiagnosticsJobResultsFile;
};

export async function runDiagnosticsJob(
  input: RunDiagnosticsJobInput,
): Promise<RunDiagnosticsJobOutput> {
  const {
    contentRoot,
    ci,
    cache,
    slugs,
    urls,
    freshness,
    max_age_seconds,
    validators,
    include_artifacts: includeArtifacts,
    categories,
    validator_only: validatorOnly,
    onProgress,
  } = input;

  const service = new ValidationService();
  const context = await service.buildContext({ contentRoot, ci });
  const slugFiltered = !!(slugs?.length || urls?.length || validatorOnly);
  const { pageValidators, siteWideValidators, partial } = effectiveValidatorNames(validators, {
    slugFiltered,
  });

  const allTargets = validatorOnly
    ? []
    : await resolveUrlTargets(contentRoot, ci, slugs, urls);

  const allValidatorNames = [...pageValidators, ...siteWideValidators];
  if (diagnosticsNeedsSeoIndex(allValidatorNames)) {
    if (!slugFiltered) {
      ensureSeoIndexBeforeDiagnostics({ contentRoot, ci });
    } else if (allTargets.length > 0) {
      ensureSeoIndexBeforeDiagnostics({
        contentRoot,
        ci,
        entryKeys: allTargets.map((t) => `${t.type}/${t.slug}/${t.locale}`),
      });
    }
  }

  let staleTargets = allTargets;
  if (!partial && freshness === "max_age") {
    staleTargets = allTargets.filter((t) =>
      isUrlStaleForFullRun(cache.getByUrl(t.url), max_age_seconds),
    );
  }

  const workUnits =
    (validatorOnly && pageValidators.length > 0 ? 1 : 0) +
    (!validatorOnly && pageValidators.length > 0 ? staleTargets.length : 0) +
    (siteWideValidators.length > 0 ? 1 : 0);
  const total = Math.max(workUnits, 1);
  let processed = 0;

  onProgress({
    processed,
    total,
    staleUrlCount: validatorOnly ? 0 : staleTargets.length,
    urlCount: validatorOnly ? 0 : allTargets.length,
    message: "Starting validators",
  });

  const allValidatorResults: ValidatorResult[] = [];
  const allContentFiles = context.contentFiles;
  const nowIso = () => new Date().toISOString();

  if (validatorOnly && pageValidators.length > 0) {
    context.contentFiles = [];
    try {
      const result = await service.runValidators({
        validators: pageValidators,
        includeArtifacts,
      });
      allValidatorResults.push(...result.validators);
      cache.applyValidatorResults(result.validators, {
        contentFiles: allContentFiles,
        entryKeys: [VALIDATOR_ONLY_ENTRY_KEY],
        markSiteWide: false,
      });
    } finally {
      context.contentFiles = allContentFiles;
    }
    processed = 1;
    await cache.flush();
    onProgress({
      processed,
      total,
      staleUrlCount: 0,
      urlCount: 0,
      message: "Shared-template validator pass done",
    });
  }

  for (const target of !validatorOnly && pageValidators.length > 0 ? staleTargets : []) {
    const normalizedTarget = target.url.toLowerCase().replace(/\/$/, "") || "/";
    const filteredFiles = allContentFiles.filter((file) => {
      const fileUrl = getCanonicalUrl(file).toLowerCase().replace(/\/$/, "") || "/";
      return fileUrl === normalizedTarget;
    });
    context.contentFiles = filteredFiles;
    try {
      const result = await service.runValidators({
        validators: pageValidators,
        includeArtifacts,
      });
      allValidatorResults.push(...result.validators);

      const entryKeys = filteredFiles.map((f) => entryKeyFromContentFile(f));
      cache.applyValidatorResults(result.validators, {
        contentFiles: allContentFiles,
        entryKeys,
        markSiteWide: false,
      });
    } finally {
      context.contentFiles = allContentFiles;
    }
    processed += 1;
    if (processed % 5 === 0 || processed === total) {
      await cache.flush();
    }
    onProgress({
      processed,
      total,
      staleUrlCount: staleTargets.length,
      urlCount: allTargets.length,
      message: `Validated ${target.url}`,
    });
  }

  if (siteWideValidators.length > 0) {
    context.contentFiles = allContentFiles;
    const result = await service.runValidators({
      validators: siteWideValidators,
      includeArtifacts,
    });
    allValidatorResults.push(...result.validators);

    cache.applyValidatorResults(result.validators, {
      contentFiles: allContentFiles,
      markSiteWide: true,
    });

    const { applyValidationRunToCache } = await import(
      "../../server/services/validationCachePostProcess"
    );
    const dbOnly = result.validators.filter((v) => getValidatorRunClass(v.name) === "database");
    if (dbOnly.length > 0) {
      await applyValidationRunToCache(
        cache,
        {
          summary: { total: dbOnly.length, passed: 0, failed: 0, warnings: 0, duration: 0 },
          validators: dbOnly,
        },
        context,
        { partial: true },
      );
    }

    processed += 1;
    onProgress({
      processed,
      total,
      staleUrlCount: staleTargets.length,
      urlCount: allTargets.length,
      message: "Site-wide validators done",
    });
  }

  if (!partial) {
    cache.markFullRunAt(nowIso());
  }
  await cache.flush();

  const byName = new Map<string, ValidatorResult>();
  for (const v of allValidatorResults) {
    const prev = byName.get(v.name);
    if (!prev) {
      byName.set(v.name, { ...v, errors: [...v.errors], warnings: [...v.warnings] });
    } else {
      prev.errors.push(...v.errors);
      prev.warnings.push(...v.warnings);
      prev.duration += v.duration;
      if (v.status === "failed") prev.status = "failed";
      else if (v.status === "warning" && prev.status === "passed") prev.status = "warning";
      if (v.artifacts && includeArtifacts) {
        prev.artifacts = { ...(prev.artifacts ?? {}), ...v.artifacts };
      }
    }
  }
  const validatorResults = [...byName.values()];

  const { issuesBySlug } = issuesBySlugFromTargets(cache, allTargets, categories);

  let errorCount = 0;
  let warningCount = 0;
  for (const issues of Object.values(issuesBySlug)) {
    for (const i of issues) {
      if (i.severity === "error") errorCount += 1;
      else warningCount += 1;
    }
  }
  const summary = { errorCount, warningCount };

  const resultsPayload: DiagnosticsJobResultsFile = {
    summary,
    validatorResults: includeArtifacts ? validatorResults : validatorResults.map((v) => ({
      name: v.name,
      status: v.status,
      duration: v.duration,
      errors: v.errors,
      warnings: v.warnings,
    })),
    issuesBySlug,
  };

  return { summary, validatorResults, issuesBySlug, resultsPayload };
}
