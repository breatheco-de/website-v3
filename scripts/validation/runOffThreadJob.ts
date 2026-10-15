/**
 * Checks that must not call buildContext or write the issues cache.
 * The diagnostics worker runs these and leaves a results file for the web process.
 */

import * as fs from "fs";
import * as path from "path";
import type { ContentIndex } from "../../server/content-index";
import { ValidationService } from "./service";
import { ENTRY_LOCAL_VALIDATOR_NAMES } from "./shared/runClass";
import { entryKeyFromContentFile } from "./shared/entryKey";
import type { ContentFile, ValidationContext, ValidatorResult } from "./shared/types";
import type {
  DeferredCacheApply,
  DiagnosticsJobResultsFile,
  DiagnosticsWorkerStartMessage,
  SlimContentFile,
} from "./diagnosticsIpc";
import { getCanonicalUrl } from "./shared/canonicalUrls";

const IMAGE_VALIDATORS = ["images", "image-tags", "hero-image-tags", "image-optimization"];

function emptyContext(contentRoot: string, ci: ContentIndex, files: ContentFile[]): ValidationContext {
  return {
    contentIndex: ci,
    contentFiles: files,
    redirectMap: new Map(),
    availableSchemas: new Set(),
    sitemapEntries: [],
    contentRoot,
  };
}

function slim(files: ContentFile[]): SlimContentFile[] {
  return files.map((f) => ({
    slug: f.slug,
    title: f.title || f.slug,
    type: f.type,
    locale: f.locale,
    filePath: f.filePath,
    url: f.url ?? getCanonicalUrl(f),
    variant: f.variant,
    isDraft: f.isDraft,
  }));
}

function payloadFromValidators(
  validators: ValidatorResult[],
  files: ContentFile[],
  opts?: { entryKeys?: string[]; hold?: boolean; markSiteWide?: boolean },
): DiagnosticsJobResultsFile {
  let errorCount = 0;
  let warningCount = 0;
  for (const v of validators) {
    errorCount += v.errors.length;
    warningCount += v.warnings.length;
  }
  const cacheApply: DeferredCacheApply = {
    hold: opts?.hold,
    batches: [
      {
        validators,
        contentFiles: slim(files),
        entryKeys: opts?.entryKeys,
        markSiteWide: opts?.markSiteWide ?? false,
      },
    ],
  };
  return {
    summary: { errorCount, warningCount },
    outcome: "ran",
    cacheApply,
    validatorResults: validators.map((v) => ({
      name: v.name,
      status: v.status,
      duration: v.duration,
      errors: v.errors,
      warnings: v.warnings,
    })),
    issuesBySlug: {},
  };
}

function fileForEntry(
  ci: ContentIndex,
  contentType: string,
  slug: string,
  locale: string,
  variant?: string,
): ContentFile | null {
  const merged = ci.loadMergedContent(contentType, slug, locale, variant);
  if (!merged.data) return null;
  const data = merged.data;
  const urls = ci.getLocaleUrls(slug, contentType);
  return {
    slug,
    title: typeof data.title === "string" ? data.title : slug,
    description: typeof data.description === "string" ? data.description : undefined,
    meta: data.meta as ContentFile["meta"],
    schema: data.schema as ContentFile["schema"],
    seo: data.seo as ContentFile["seo"],
    type: contentType,
    locale,
    filePath: merged.filePath,
    url: urls[locale] || ci.buildUrl(contentType, locale, slug),
    variant,
    entryFields: data,
  };
}

async function runWithFiles(
  contentRoot: string,
  ci: ContentIndex,
  files: ContentFile[],
  validators: string[],
  opts?: { entryKeys?: string[]; hold?: boolean; markSiteWide?: boolean },
): Promise<DiagnosticsJobResultsFile> {
  const service = new ValidationService();
  service.useContext(emptyContext(contentRoot, ci, files));
  const result = await service.runValidators({ validators, includeArtifacts: false });
  const entryKeys = opts?.entryKeys ?? files.map((f) => entryKeyFromContentFile(f));
  return payloadFromValidators(result.validators, files, { ...opts, entryKeys });
}

export async function runOffThreadJob(
  msg: DiagnosticsWorkerStartMessage,
  ci: ContentIndex,
): Promise<DiagnosticsJobResultsFile> {
  const kind = msg.kind ?? "diagnostics";
  const contentRoot = msg.contentRoot;

  if (kind === "images") {
    const names = msg.validators?.length ? msg.validators : IMAGE_VALIDATORS;
    return runWithFiles(contentRoot, ci, [], names);
  }

  if (kind === "redirects") {
    // This process has its own index. The web snapshot is never applied here,
    // so the slow maps stay empty unless this job builds them.
    if (!ci.isSlowPhaseReady()) ci.scanSlow();
    const entries = ci.getRedirects().filter((e) => e.type !== "custom");
    const grouped = new Map<string, { froms: string[]; to: string; type: string }>();
    for (const entry of entries) {
      const to = typeof entry.to === "string" ? entry.to : Object.values(entry.to)[0] ?? "";
      const row = grouped.get(entry.source) ?? { froms: [], to, type: entry.type };
      row.froms.push(entry.from);
      grouped.set(entry.source, row);
    }
    const files: ContentFile[] = [...grouped.entries()].map(([source, row]) => ({
      slug: path.basename(path.dirname(source)) || "redirects",
      title: source,
      type: row.type.replace(/-common$/, "") || "page",
      locale: row.type.endsWith("-common") ? "_common" : "en",
      filePath: source,
      url: row.to,
      meta: { redirects: row.froms },
    }));
    return runWithFiles(contentRoot, ci, files, ["redirects"], { markSiteWide: true });
  }

  if (kind === "section-variants") {
    const files: ContentFile[] = [];
    for (const entry of ci.listAll()) {
      for (const name of entry.files) {
        const locale = name.replace(/\.ya?ml$/i, "");
        files.push({
          slug: entry.slug,
          title: entry.title || entry.slug,
          type: entry.contentType,
          locale,
          filePath: path.join(process.cwd(), entry.directory, name),
        });
      }
    }
    return runWithFiles(contentRoot, ci, files, ["section-variants"], { markSiteWide: true });
  }

  if (kind === "run-page" || kind === "entry-complete") {
    const entry = msg.entry;
    let contentType = entry?.contentType;
    let slug = entry?.slug;
    let locale = entry?.locale;
    const variant = entry?.variant;
    if ((!contentType || !slug) && msg.urls?.[0]) {
      const resolved = ci.resolveUrl(msg.urls[0].split("?")[0]);
      contentType = contentType || resolved?.contentType;
      slug = slug || resolved?.slug;
      locale =
        locale ||
        (resolved?.patternLocale && resolved.patternLocale !== "default"
          ? resolved.patternLocale
          : "en");
    }
    if (!contentType || !slug || !locale) {
      return {
        summary: { errorCount: 0, warningCount: 0 },
        outcome: "not_found",
        code: "diagnostics_slug_not_found",
        message: "No page found for this check.",
        validatorResults: [],
        issuesBySlug: {},
      };
    }
    const file = fileForEntry(ci, contentType, slug, locale, variant);
    if (!file) {
      return {
        summary: { errorCount: 0, warningCount: 0 },
        outcome: "not_found",
        code: "diagnostics_slug_not_found",
        message: `No content for ${contentType}/${slug}/${locale}`,
        validatorResults: [],
        issuesBySlug: {},
      };
    }
    const names =
      kind === "entry-complete"
        ? [...ENTRY_LOCAL_VALIDATOR_NAMES]
        : msg.validators?.length
          ? msg.validators
          : [...ENTRY_LOCAL_VALIDATOR_NAMES];
    const built = await runWithFiles(contentRoot, ci, [file], names);
    built.targets = [
      {
        url: file.url || getCanonicalUrl(file),
        slug: file.slug,
        filePath: file.filePath,
        locale: file.locale,
        type: file.type,
      },
    ];
    return built;
  }

  if (kind === "traffic") {
    const entry = msg.entry;
    if (!entry?.contentType || !entry.slug || !entry.locale || !entry.variant) {
      return {
        summary: { errorCount: 1, warningCount: 0 },
        outcome: "ran",
        message: "Traffic check is missing the variant.",
        validatorResults: [],
        issuesBySlug: {},
      };
    }
    const { validatePublishedVariantLayer } = await import(
      "../../server/services/validatePublishedVariant"
    );
    const commonData =
      (ci.loadCommonData(entry.contentType as never, entry.slug) as Record<string, unknown>) || {};
    const filePath = ci.getContentFilePath(
      entry.contentType,
      entry.slug,
      entry.locale,
      entry.variant,
    );
    const variantRaw = fs.existsSync(filePath)
      ? ((ci.safeYamlLoad(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>) || {})
      : {};
    const result = await validatePublishedVariantLayer({
      contentType: entry.contentType,
      slug: entry.slug,
      locale: entry.locale,
      variantSlug: entry.variant,
      contentRoot,
      ci,
      variantRaw,
      commonData,
    });
    const validators = result.validators ?? [];
    const body = payloadFromValidators(
      validators,
      result.contentFile ? [result.contentFile] : [],
      { entryKeys: [result.entryKey], hold: true },
    );
    body.summary = {
      errorCount: result.errors.length,
      warningCount: result.warnings.length,
    };
    if (!result.ok) body.cacheApply = undefined;
    body.message = result.ok ? "Variant checks passed." : "Variant checks failed.";
    return body;
  }

  if (kind === "save-report") {
    const { formatAsJson } = await import("./reporting/json");
    const service = new ValidationService();
    await service.buildContext({ contentRoot, ci });
    const result = await service.runValidators({ includeArtifacts: true });
    const timestamp = new Date().toISOString();
    const fileName = `report-${timestamp.replace(/[:.]/g, "-")}.json`;
    const dir = "/tmp/validation-reports";
    const filePath = path.join(dir, fileName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, formatAsJson(result, { pretty: true, includeTimestamp: true }), "utf-8");
    let errorCount = 0;
    let warningCount = 0;
    for (const v of result.validators) {
      errorCount += v.errors.length;
      warningCount += v.warnings.length;
    }
    return {
      summary: { errorCount, warningCount },
      outcome: "ran",
      reportPath: filePath,
      message: filePath,
      validatorResults: result.validators.map((v) => ({
        name: v.name,
        status: v.status,
        duration: v.duration,
        errors: v.errors,
        warnings: v.warnings,
      })),
      issuesBySlug: {},
    };
  }

  return {
    summary: { errorCount: 0, warningCount: 0 },
    outcome: "ran",
    message: `Unhandled diagnostics kind: ${kind}`,
    validatorResults: [],
    issuesBySlug: {},
  };
}
