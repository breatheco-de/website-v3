/**
 * Scoped on-save validation: debounced entry-local validators after content save;
 * queue redirects full-graph job when redirect config changes.
 */

import { ValidationService } from "../../scripts/validation/service";
import { ENTRY_LOCAL_VALIDATOR_NAMES } from "../../scripts/validation/shared/runClass";
import {
  buildEntryKey,
  entryKeyFromContentFile,
} from "../../scripts/validation/shared/entryKey";
import { filterContentFilesForEntry } from "../jobs/definitions/on-save-validation";
import { getCanonicalUrl } from "../../scripts/validation/shared/canonicalUrls";
import { isVariantLayerFile } from "../../scripts/validation/shared/draftFiles";
import type { ContentIndex } from "../content-index";
import type { ValidationCacheService } from "./validationCacheService";
import { startDiagnosticsJob, isDiagnosticsRunning } from "./diagnosticsJobService";
import { getVersioningManager } from "../versioning";
import { ON_SAVE_VALIDATION_DEBOUNCE_MS } from "./onSaveValidationScheduler";
import { child } from "../logger";

const log = child({ module: "onSaveValidation" });

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = ON_SAVE_VALIDATION_DEBOUNCE_MS;

export type OnSaveValidationArgs = {
  contentRoot: string;
  contentRootName: string;
  ci: ContentIndex;
  cache: ValidationCacheService;
  /** Absolute or site-relative path that was written */
  filePath?: string;
  contentType?: string;
  slug?: string;
  locale?: string;
  /** When true, also queue redirects full-graph job */
  redirectsChanged?: boolean;
};

type ResolvedSaveTarget = {
  contentType: string;
  slug: string;
  locale: string;
  variant?: string;
};

function parseLocaleVariantFromBasename(basename: string): {
  locale: string;
  variant?: string;
} | null {
  // single.es.yml | single.draft.es.yml | es.yml | draft.es.yml
  const noExt = basename.replace(/\.ya?ml$/i, "");
  if (noExt === "_common") return null;
  if (noExt.startsWith("single.") || noExt.startsWith("template.")) {
    const rest = noExt.slice("single.".length);
    if (!rest.includes(".")) return { locale: rest };
    const parts = rest.split(".");
    const locale = parts[parts.length - 1]!;
    const variant = parts.slice(0, -1).join(".");
    return { locale, variant };
  }
  if (!noExt.includes(".")) return { locale: noExt };
  const parts = noExt.split(".");
  const locale = parts[parts.length - 1]!;
  const variant = parts.slice(0, -1).join(".");
  return { locale, variant };
}

function resolveEntryFromPath(
  ci: ContentIndex,
  filePath: string | undefined,
  contentType?: string,
  slug?: string,
  locale?: string,
): ResolvedSaveTarget | null {
  if (contentType && slug && locale) {
    return { contentType, slug, locale };
  }
  if (!filePath) return null;
  const norm = filePath.replace(/\\/g, "/");
  const m = norm.match(
    /\/(programs|landings|locations|pages|blog|workshops|events|courses)\/([^/]+)\/([^/]+)\.ya?ml$/i,
  );
  if (!m) return null;
  const folder = m[1]!.toLowerCase();
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
  const ct = typeMap[folder] ?? folder.replace(/s$/, "");
  const sl = m[2]!;
  const parsed = parseLocaleVariantFromBasename(m[3]!);
  if (!parsed || parsed.locale === "_common") return null;
  return {
    contentType: ct,
    slug: sl,
    locale: parsed.locale,
    variant: parsed.variant,
  };
}

function isVariantPublished(
  contentType: string,
  slug: string,
  locale: string,
  variant: string,
): boolean {
  const versioningManager = getVersioningManager();
  const ver = versioningManager.getVersioningForContent(contentType, slug) || {};
  const row = (ver[locale]?.variants ?? []).find((v) => v.slug === variant);
  return (row?.allocation ?? 0) > 0;
}

async function runEntryLocalNow(args: OnSaveValidationArgs): Promise<void> {
  const resolved = resolveEntryFromPath(
    args.ci,
    args.filePath,
    args.contentType,
    args.slug,
    args.locale,
  );
  if (!resolved) {
    log.info("[OnSaveValidation] Could not resolve entry from save; marking dirty only");
    return;
  }

  // Path-based variant detection when callers only passed type/slug/locale
  let variant = resolved.variant;
  if (!variant && args.filePath && isVariantLayerFile(args.filePath)) {
    const base = args.filePath.split(/[/\\]/).pop() || "";
    const parsed = parseLocaleVariantFromBasename(base);
    if (parsed?.variant) variant = parsed.variant;
  }

  if (variant) {
    if (!isVariantPublished(resolved.contentType, resolved.slug, resolved.locale, variant)) {
      log.info(
        { resolved, variant },
        "[OnSaveValidation] Unpublished variant save — skipping validation",
      );
      return;
    }
  }

  const targetKey = buildEntryKey(
    resolved.contentType,
    resolved.slug,
    resolved.locale,
    variant,
  );

  const service = new ValidationService();
  await service.buildContext({ contentRoot: args.contentRoot, ci: args.ci });
  const context = service.getContext();
  if (!context) return;

  const allFiles = context.contentFiles;
  const filtered = filterContentFilesForEntry(allFiles, resolved);
  if (filtered.length === 0) {
    log.warn(
      { resolved, variant, targetKey },
      "[OnSaveValidation] No contentFiles matched entry",
    );
    return;
  }

  const entryKeys = filtered.map((f) => entryKeyFromContentFile(f));
  for (const ek of entryKeys) {
    args.cache.markEntryDirty(ek);
  }

  if (isDiagnosticsRunning(args.contentRoot)) {
    log.info(
      { entryKeys },
      "[OnSaveValidation] Diagnostics job running — deferred entry-local apply (dirty only)",
    );
    return;
  }

  context.contentFiles = filtered;
  try {
    const result = await service.runValidators({
      validators: [...ENTRY_LOCAL_VALIDATOR_NAMES],
      includeArtifacts: false,
    });
    context.contentFiles = allFiles;
    for (const file of filtered) {
      if (!file.variant) {
        args.cache.registerUrl(getCanonicalUrl(file), entryKeyFromContentFile(file));
      }
    }
    args.cache.applyValidatorResults(result.validators, {
      contentFiles: allFiles,
      entryKeys,
      markSiteWide: false,
    });
    await args.cache.flush();
    log.info(
      { entryKeys, errorCount: result.summary.failed },
      "[OnSaveValidation] Entry-local validation applied",
    );
  } catch (err) {
    context.contentFiles = allFiles;
    log.warn({ err }, "[OnSaveValidation] Entry-local run failed");
  }
}

async function queueRedirectsJob(args: OnSaveValidationArgs): Promise<void> {
  args.cache.markScopeDirty("redirects");
  try {
    const result = await startDiagnosticsJob({
      contentRoot: args.contentRoot,
      contentRootName: args.contentRootName,
      ci: args.ci,
      cache: args.cache,
      validators: ["redirects"],
      freshness: "hard",
      include_artifacts: false,
      confirm: true,
    });
    if (result.status === "busy") {
      log.info(
        { job_id: result.job_id },
        "[OnSaveValidation] Redirects job deferred — diagnostics busy (scope left dirty)",
      );
      return;
    }
    log.info("[OnSaveValidation] Queued redirects diagnostics job");
  } catch (err) {
    log.warn({ err }, "[OnSaveValidation] Failed to queue redirects job");
  }
}

/**
 * Schedule debounced entry-local validation after a content save.
 * If redirectsChanged, also queues a redirects full-graph job (not debounced with entry).
 */
export function scheduleOnSaveValidation(args: OnSaveValidationArgs): void {
  const key = [
    args.contentRoot,
    args.contentType,
    args.slug,
    args.locale,
    args.filePath,
  ]
    .filter(Boolean)
    .join("|");

  if (args.redirectsChanged) {
    void queueRedirectsJob(args);
  }

  const existing = debounceTimers.get(key);
  if (existing) clearTimeout(existing);

  debounceTimers.set(
    key,
    setTimeout(() => {
      debounceTimers.delete(key);
      void runEntryLocalNow(args);
    }, DEBOUNCE_MS),
  );
}

/** Immediate redirects-only (e.g. custom-redirects.yml editor). */
export function scheduleRedirectsValidation(args: OnSaveValidationArgs): void {
  void queueRedirectsJob(args);
}
