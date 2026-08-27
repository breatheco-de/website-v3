/**
 * Detach / re-attach shared-layout entries from the type template.
 * Detach bakes live single.{locale}.yml structure into the entry (keeping {{ single.* }}).
 * Re-attach strips sections + layout and clears entry versioning (lossy for structure).
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { escapeObjectVars, unescapeYamlDump } from "@shared/templateVars";
import { getFolder, isValidType, getContentTypeConfig } from "./content-types";
import { contentIndex } from "./content-index";
import { getDefaultContentRoot } from "./site-config";
import { markFileAsModified } from "./sync-state";
import { mergeSingleTemplate } from "./database-single-loader";
import {
  isEntryDetached,
  isSharedLayoutType,
  isTemplateVersioningSlug,
  stripStructuralOverlayKeys,
} from "./shared-layout-entry";
import { canonicalSectionId } from "./utils/sectionIdentity";
import { child } from "./logger";
import { deepMerge } from "./utils/deepMerge";
import {
  validateRequiredFields,
  type EditorRequiredHint,
} from "@shared/validateRequiredFields";
import { getTrackingSettings } from "./settings";

export const REATTACH_MISSING_REQUIRED_FIELDS_CODE =
  "reattach_missing_required_fields" as const;

export class ReattachRequiredFieldsError extends Error {
  readonly code = REATTACH_MISSING_REQUIRED_FIELDS_CODE;
  readonly missing_fields: string[];
  readonly per_locale: Record<string, string[]>;

  constructor(opts: {
    message: string;
    missing_fields: string[];
    per_locale: Record<string, string[]>;
  }) {
    super(opts.message);
    this.name = "ReattachRequiredFieldsError";
    this.missing_fields = opts.missing_fields;
    this.per_locale = opts.per_locale;
  }
}

const LIVE_LOCALE_FILE_RE = /^[a-z]{2}(?:-[a-zA-Z]+)?\.ya?ml$/i;

function listLiveLocaleStems(entryDir: string): string[] {
  if (!fs.existsSync(entryDir)) return [];
  const out: string[] = [];
  for (const f of fs.readdirSync(entryDir)) {
    if (!LIVE_LOCALE_FILE_RE.test(f)) continue;
    out.push(f.replace(/\.ya?ml$/i, ""));
  }
  return out.sort();
}

function trackingSemantics(contentRoot: string): {
  conversionNames: string[];
  crmTags: string[];
} {
  try {
    const tracking = getTrackingSettings(contentRoot);
    const conversionNames = (tracking.conversion_events || [])
      .map((e) => (typeof e === "string" ? e : (e as { name?: string })?.name))
      .filter((n): n is string => typeof n === "string" && n.trim().length > 0);
    const crmTags = Array.isArray(tracking.leads_expected_tags)
      ? tracking.leads_expected_tags.filter((t): t is string => typeof t === "string")
      : [];
    return { conversionNames, crmTags };
  } catch {
    return { conversionNames: [], crmTags: [] };
  }
}

/**
 * Before re-attach: every live locale must satisfy editor.required fields that will
 * apply once attached (isDetached: false). Draft/variant files are ignored.
 */
export function assertReattachRequiredFields(opts: {
  contentType: string;
  slug: string;
  contentRoot: string;
  entryDir: string;
}): void {
  const { contentType, slug, contentRoot, entryDir } = opts;
  const config = getContentTypeConfig(contentType, contentRoot);
  const editor = (config?.editor || {}) as Record<string, EditorRequiredHint>;
  const semantics = trackingSemantics(contentRoot);
  const common = loadYamlFile(path.join(entryDir, "_common.yml")) ?? {};
  const { detached: _d, ...commonSansDetached } = common;

  const liveLocales = listLiveLocaleStems(entryDir);
  if (liveLocales.length === 0) {
    throw new Error(
      `Cannot re-attach "${slug}": no live locale files found under ${contentType}/${slug}.`,
    );
  }

  const per_locale: Record<string, string[]> = {};
  const missing_fields: string[] = [];
  const okLocales: string[] = [];
  const badSummaries: string[] = [];

  for (const locale of liveLocales) {
    const localeData =
      loadYamlFile(path.join(entryDir, `${locale}.yml`)) ??
      loadYamlFile(path.join(entryDir, `${locale}.yaml`)) ??
      {};
    const merged = deepMerge(commonSansDetached, localeData) as Record<string, unknown>;
    const result = validateRequiredFields(editor, merged, "publish", {
      isSharedLayout: true,
      isDetached: false,
      ...semantics,
    });
    if (result.ok) {
      per_locale[locale] = [];
      okLocales.push(locale);
      continue;
    }
    const fields = result.errors.map((e) => e.field);
    per_locale[locale] = fields;
    for (const f of fields) {
      missing_fields.push(`${locale}.${f}`);
    }
    badSummaries.push(
      `live locale \`${locale}\` is missing or invalid attached-required fields: ${fields.map((f) => `\`${f}\``).join(", ")}`,
    );
  }

  if (missing_fields.length === 0) return;

  const okBit =
    okLocales.length > 0
      ? ` Locale${okLocales.length === 1 ? "" : "s"} ${okLocales.map((l) => `\`${l}\``).join(", ")} ${okLocales.length === 1 ? "is" : "are"} OK.`
      : "";

  throw new ReattachRequiredFieldsError({
    message:
      `Cannot re-attach \`${contentType}/${slug}\`: ${badSummaries.join(". ")}.` +
      okBit +
      ` Fill Fields on each live locale, then retry reattach. (\`editor.required: attached\` / \`true\` as configured)`,
    missing_fields,
    per_locale,
  });
}

const log = child({ module: "shared-layout-detach" });

function safeYamlDump(obj: unknown): string {
  const { escaped, map } = escapeObjectVars(obj);
  const dumped = yaml.dump(escaped, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });
  return unescapeYamlDump(dumped, map);
}

function writeYamlFile(filePath: string, data: Record<string, unknown>, author?: string | null, contentRoot?: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, safeYamlDump(data), "utf-8");
  markFileAsModified(filePath, author ?? undefined, undefined, contentRoot);
}

function loadYamlFile(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = contentIndex.safeYamlLoad(fs.readFileSync(filePath, "utf-8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (err) {
    log.warn({ err, filePath }, "[detach] Failed to parse YAML");
  }
  return null;
}

/** Entry variant files look like `{variant}.{locale}.yml` (not `en.yml`, not `_common.yml`). */
function isEntryVariantYaml(fileName: string): boolean {
  if (!fileName.endsWith(".yml") || fileName === "versioning.yml" || fileName.startsWith("_")) {
    return false;
  }
  const base = fileName.slice(0, -4);
  if (!base.includes(".")) return false;
  // Exclude shared template names if they ever appear under an entry
  if (base.startsWith("single.") || base.startsWith("template.")) return false;
  return true;
}

export interface DetachEntryParams {
  contentType: string;
  slug: string;
  contentRoot?: string;
  author?: string | null;
  locales?: string[];
}

export interface DetachEntryResult {
  success: true;
  locales: string[];
  filesWritten: string[];
}

/**
 * Bake live template structure into the entry and set detached: true.
 * Preserves {{ single.* }} expressions (does not resolve them).
 */
export function detachEntry(params: DetachEntryParams): DetachEntryResult {
  const { contentType, slug, author } = params;
  const contentRoot = params.contentRoot ?? getDefaultContentRoot();

  if (!isValidType(contentType, contentRoot)) {
    throw new Error(`Unknown content type: ${contentType}`);
  }
  if (!isSharedLayoutType(contentType, contentRoot)) {
    throw new Error(`Content type "${contentType}" is not a shared-layout type`);
  }
  if (!slug || isTemplateVersioningSlug(slug)) {
    throw new Error("Invalid entry slug for detach");
  }
  if (isEntryDetached(contentType, slug, contentRoot)) {
    throw new Error(`Entry "${slug}" is already detached`);
  }

  const folder = getFolder(contentType, contentRoot);
  const entryDir = path.join(contentRoot, folder, slug);

  // Only bake locales that already exist on the entry (or an explicit list).
  // Never invent sibling locales from site supported_locales / single templates.
  let locales: string[];
  if (params.locales?.length) {
    locales = params.locales;
  } else {
    const existing: string[] = [];
    if (fs.existsSync(entryDir)) {
      for (const f of fs.readdirSync(entryDir)) {
        if (!f.endsWith(".yml") && !f.endsWith(".yaml")) continue;
        const stem = f.replace(/\.ya?ml$/, "");
        if (/^[a-z]{2}(-[a-z]{2})?$/i.test(stem)) existing.push(stem);
      }
    }
    locales = existing;
  }

  if (locales.length === 0) {
    throw new Error(
      `Cannot detach "${slug}": no live locale files found. Create a locale file first, then detach.`,
    );
  }

  const filesWritten: string[] = [];
  const localesWritten: string[] = [];

  for (const locale of locales) {
    // Live template only — never a draft variant
    const template = mergeSingleTemplate(contentType, locale, undefined, undefined, contentRoot);
    if (!template) {
      log.warn(`[detach] No live single template for ${contentType}/${locale}; skipping`);
      continue;
    }

    const entryLocalePath = path.join(entryDir, `${locale}.yml`);
    const existing = loadYamlFile(entryLocalePath) ?? {};
    const dataFields = stripStructuralOverlayKeys(existing);

    const detachedLocale: Record<string, unknown> = {
      ...dataFields,
    };
    if (Array.isArray(template.sections)) {
      detachedLocale.sections = template.sections;
    }
    if (template.layout !== undefined && template.layout !== null) {
      detachedLocale.layout = template.layout;
    }

    writeYamlFile(entryLocalePath, detachedLocale, author, contentRoot);
    filesWritten.push(entryLocalePath);
    localesWritten.push(locale);
  }

  if (localesWritten.length === 0) {
    throw new Error(`No live template.{locale}.yml found for content type "${contentType}"`);
  }

  const commonPath = path.join(entryDir, "_common.yml");
  const common = loadYamlFile(commonPath) ?? {};
  // Detached entries own structure in locale files — strip structural keys from common too
  const commonData = stripStructuralOverlayKeys(common);
  commonData.detached = true;
  writeYamlFile(commonPath, commonData, author, contentRoot);
  filesWritten.push(commonPath);

  log.info(
    `[detach] Detached ${contentType}/${slug} for locales: ${localesWritten.join(", ")}`,
  );

  return { success: true, locales: localesWritten, filesWritten };
}

export interface ReattachEntryParams {
  contentType: string;
  slug: string;
  contentRoot?: string;
  author?: string | null;
  confirm: boolean;
}

export interface ReattachEntryResult {
  success: true;
  hadTrafficVariants: boolean;
  filesModified: string[];
}

/**
 * Hard re-attach: strip sections + layout, clear detached flag, delete entry versioning.
 */
export function reattachEntry(params: ReattachEntryParams): ReattachEntryResult {
  const { contentType, slug, author, confirm } = params;
  const contentRoot = params.contentRoot ?? getDefaultContentRoot();

  if (confirm !== true) {
    throw new Error("Re-attach requires confirm: true");
  }
  if (!isValidType(contentType, contentRoot)) {
    throw new Error(`Unknown content type: ${contentType}`);
  }
  if (!isSharedLayoutType(contentType, contentRoot)) {
    throw new Error(`Content type "${contentType}" is not a shared-layout type`);
  }
  if (!slug || isTemplateVersioningSlug(slug)) {
    throw new Error("Invalid entry slug for re-attach");
  }
  if (!isEntryDetached(contentType, slug, contentRoot)) {
    throw new Error(`Entry "${slug}" is not detached`);
  }

  const folder = getFolder(contentType, contentRoot);
  const entryDir = path.join(contentRoot, folder, slug);
  if (!fs.existsSync(entryDir) || !fs.statSync(entryDir).isDirectory()) {
    throw new Error(`Entry folder not found: ${contentType}/${slug}`);
  }

  assertReattachRequiredFields({ contentType, slug, contentRoot, entryDir });

  const filesModified: string[] = [];
  let hadTrafficVariants = false;

  // Inspect versioning before delete
  const versioningPath = path.join(entryDir, "versioning.yml");
  if (fs.existsSync(versioningPath)) {
    const versioning = loadYamlFile(versioningPath);
    if (versioning) {
      for (const localeData of Object.values(versioning)) {
        if (!localeData || typeof localeData !== "object") continue;
        const variants = (localeData as { variants?: Array<{ allocation?: number }> }).variants;
        if (!Array.isArray(variants)) continue;
        if (variants.some((v) => typeof v.allocation === "number" && v.allocation > 0)) {
          hadTrafficVariants = true;
          break;
        }
      }
    }
  }

  const entries = fs.readdirSync(entryDir);
  for (const fileName of entries) {
    const fullPath = path.join(entryDir, fileName);
    if (!fs.statSync(fullPath).isFile()) continue;

    if (fileName === "versioning.yml" || isEntryVariantYaml(fileName)) {
      fs.unlinkSync(fullPath);
      markFileAsModified(fullPath, author ?? undefined, undefined, contentRoot);
      filesModified.push(fullPath);
      continue;
    }

    if (!fileName.endsWith(".yml")) continue;

    // _common.yml and locale files (en.yml, es.yml, …)
    const data = loadYamlFile(fullPath);
    if (!data) continue;

    let next = stripStructuralOverlayKeys(data);
    if (fileName === "_common.yml") {
      const { detached: _d, ...rest } = next;
      next = rest;
      // Explicit false is fine; prefer omit for cleanliness
    }

    writeYamlFile(fullPath, next, author, contentRoot);
    filesModified.push(fullPath);
  }

  log.info(
    `[reattach] Re-attached ${contentType}/${slug}` +
      (hadTrafficVariants ? " (had traffic-allocated variants)" : ""),
  );

  return { success: true, hadTrafficVariants, filesModified };
}

export interface ReattachSectionLossItem {
  sectionId: string | null;
  type: string;
  label: string;
}

export interface ReattachVariantLossItem {
  slug: string;
  locale: string;
  allocation: number;
}

/**
 * Preview what hard re-attach will discard: custom sections (not on live template),
 * layout override, and entry-level variants from versioning.yml / variant files.
 */
export function getReattachSectionLossPreview(opts: {
  contentType: string;
  slug: string;
  locale: string;
  contentRoot?: string;
}): {
  sectionsThatWillBeLost: ReattachSectionLossItem[];
  variantsThatWillBeLost: ReattachVariantLossItem[];
  hasLayoutOverride: boolean;
} {
  const contentRoot = opts.contentRoot ?? getDefaultContentRoot();
  const folder = getFolder(opts.contentType, contentRoot);
  const entryDir = path.join(contentRoot, folder, opts.slug);

  let entrySections: Record<string, unknown>[] = [];
  let hasLayoutOverride = false;

  const mergeEntryLayer = (filePath: string) => {
    const data = loadYamlFile(filePath);
    if (!data) return;
    if (data.layout !== undefined && data.layout !== null) hasLayoutOverride = true;
    if (Array.isArray(data.sections)) {
      entrySections = [...entrySections, ...(data.sections as Record<string, unknown>[])];
    }
  };

  if (fs.existsSync(entryDir)) {
    mergeEntryLayer(path.join(entryDir, "_common.yml"));
    mergeEntryLayer(path.join(entryDir, `${opts.locale}.yml`));
  }

  const template = mergeSingleTemplate(
    opts.contentType,
    opts.locale,
    undefined,
    undefined,
    contentRoot,
  );
  const templateSections = Array.isArray(template?.sections)
    ? (template!.sections as Record<string, unknown>[])
    : [];
  const templateIds = new Set(
    templateSections
      .map((s) => canonicalSectionId(s))
      .filter((id): id is string => !!id),
  );

  const sectionsThatWillBeLost: ReattachSectionLossItem[] = [];
  const seen = new Set<string>();
  for (const section of entrySections) {
    if (section?._remove === true) continue;
    const sectionId = canonicalSectionId(section);
    // Matching template id → not lost (comes back from shared template)
    if (sectionId && templateIds.has(sectionId)) continue;
    const key = sectionId || JSON.stringify(section.type);
    if (seen.has(key)) continue;
    seen.add(key);
    const type = typeof section.type === "string" ? section.type : "section";
    const label =
      (typeof section.heading === "string" && section.heading) ||
      (typeof section.title === "string" && section.title) ||
      (typeof section.name === "string" && section.name) ||
      sectionId ||
      type;
    sectionsThatWillBeLost.push({ sectionId, type, label: String(label) });
  }

  const variantsThatWillBeLost: ReattachVariantLossItem[] = [];
  const versioningPath = path.join(entryDir, "versioning.yml");
  if (fs.existsSync(versioningPath)) {
    const versioning = loadYamlFile(versioningPath);
    if (versioning) {
      for (const [locale, localeData] of Object.entries(versioning)) {
        if (!localeData || typeof localeData !== "object") continue;
        const variants = (localeData as { variants?: Array<{ slug?: string; allocation?: number }> }).variants;
        if (!Array.isArray(variants)) continue;
        for (const v of variants) {
          if (!v?.slug || typeof v.slug !== "string") continue;
          variantsThatWillBeLost.push({
            slug: v.slug,
            locale,
            allocation: typeof v.allocation === "number" ? v.allocation : 0,
          });
        }
      }
    }
  }
  // Also surface orphan variant YAML files not registered in versioning.yml
  if (fs.existsSync(entryDir)) {
    const registered = new Set(variantsThatWillBeLost.map((v) => `${v.slug}.${v.locale}`));
    for (const fileName of fs.readdirSync(entryDir)) {
      if (!isEntryVariantYaml(fileName)) continue;
      const base = fileName.slice(0, -4);
      const lastDot = base.lastIndexOf(".");
      if (lastDot <= 0) continue;
      const variantSlug = base.slice(0, lastDot);
      const locale = base.slice(lastDot + 1);
      const key = `${variantSlug}.${locale}`;
      if (registered.has(key)) continue;
      variantsThatWillBeLost.push({ slug: variantSlug, locale, allocation: 0 });
      registered.add(key);
    }
  }

  return { sectionsThatWillBeLost, variantsThatWillBeLost, hasLayoutOverride };
}
