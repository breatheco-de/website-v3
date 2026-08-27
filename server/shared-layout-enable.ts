/**
 * Gate + bootstrap when enabling shared layout (single_template / DB link).
 * Writes canonical template.{locale}.yml; dual-reads legacy single.*.
 */

import * as fs from "fs";
import * as path from "path";
import {
  EXACT_ENTRY_OR_SINGLE_VAR_PATTERN,
  rewriteSingleVarsToEntryDeep,
} from "@shared/entryTemplateVars";
import { COMMON_TEMPLATE_BASENAME } from "@shared/sharedLayoutPaths";
import { deepMerge } from "./utils/deepMerge";
import { canonicalSectionId } from "./utils/sectionIdentity";
import { getFolder } from "./content-types";
import {
  resolveCommonTemplatePath,
  resolveTemplateLocalePath,
} from "./shared-layout-paths";
import {
  SHARED_LAYOUT_KEYS,
  alignSiblingSinglesToBase,
  listAllSinglePaths,
  type FanOutResult,
} from "./shared-layout-sync";

export type TemplateMode = "keep_existing" | "from_entry";

export interface TemplateLocaleSummary {
  locale: string;
  sectionCount: number;
  sectionIds: string[];
  basename: string;
  naming: "template" | "single";
}

export interface SharedLayoutEnableInput {
  contentType: string;
  contentRoot: string;
  templateMode?: TemplateMode | string;
  templateEntrySourceSlug?: string;
  templateEntrySourceLocale?: string;
  sharedLayoutBaseLocale?: string;
  confirm?: boolean;
  safeYamlLoad: (raw: string) => Record<string, unknown> | null;
  dumpYaml: (data: unknown) => string;
  getAvailableLocales: (contentType: string, slug: string) => string[];
  onWritten?: (filePath: string) => void;
  requesterId?: string;
}

export type SharedLayoutEnableOk = {
  ok: true;
  writtenPaths: string[];
  align?: FanOutResult;
  sourceSlug?: string;
  sourceLocale?: string;
  templateMode: TemplateMode;
};

export type SharedLayoutEnableErr = {
  ok: false;
  status: number;
  code: string;
  error: string;
  locales?: string[];
  preview?: SharedLayoutReplacePreview;
  invalidSections?: Array<{ sectionId: string | null; index: number; reason: string }>;
};

export type SharedLayoutReplacePreview = {
  current: TemplateLocaleSummary[];
  proposed: {
    locale: string;
    sectionCount: number;
    sectionIds: string[];
  };
  paths_to_overwrite: string[];
  template_entry_source_slug: string;
  template_entry_source_locale: string;
};

function valueIsEntryBagExprOrEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return true;
    EXACT_ENTRY_OR_SINGLE_VAR_PATTERN.lastIndex = 0;
    return EXACT_ENTRY_OR_SINGLE_VAR_PATTERN.test(trimmed);
  }
  if (Array.isArray(value)) {
    return value.every((v) => valueIsEntryBagExprOrEmpty(v));
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every((v) =>
      valueIsEntryBagExprOrEmpty(v),
    );
  }
  return false;
}

/** Strict 1B: every content prop is exactly `{{ entry.* }}` / legacy `{{ single.* }}` or empty. */
export function sectionIsEntryBagExpressionsOnly(
  section: Record<string, unknown>,
): boolean {
  const skip = new Set<string>([
    "type",
    "version",
    "variant",
    "section_id",
    "id",
    "_label",
    "_insertAfterSectionId",
    "_perEntrySource",
    "_perEntryPatched",
    ...SHARED_LAYOUT_KEYS,
  ]);

  for (const [key, value] of Object.entries(section)) {
    if (skip.has(key) || key.startsWith("_")) continue;
    if (!valueIsEntryBagExprOrEmpty(value)) return false;
  }
  return true;
}

export function summarizeTemplateLocales(
  templateDir: string,
  safeYamlLoad: (raw: string) => Record<string, unknown> | null,
): TemplateLocaleSummary[] {
  return listAllSinglePaths(templateDir).map(({ locale, filePath }) => {
    const basename = path.basename(filePath);
    const naming: "template" | "single" = /^template\./i.test(basename)
      ? "template"
      : "single";
    try {
      const data = safeYamlLoad(fs.readFileSync(filePath, "utf-8"));
      const sections = Array.isArray(data?.sections)
        ? (data!.sections as Record<string, unknown>[])
        : [];
      const sectionIds = sections
        .map((s) => canonicalSectionId(s))
        .filter((id): id is string => !!id);
      return { locale, sectionCount: sections.length, sectionIds, basename, naming };
    } catch {
      return { locale, sectionCount: 0, sectionIds: [], basename, naming };
    }
  });
}

/** A2: usable = at least one live shell with non-empty sections. */
export function hasUsableSharedTemplate(
  templateDir: string,
  safeYamlLoad: (raw: string) => Record<string, unknown> | null,
): boolean {
  return summarizeTemplateLocales(templateDir, safeYamlLoad).some(
    (l) => l.sectionCount > 0,
  );
}

export function loadClassicEntryMerged(
  typeDir: string,
  slug: string,
  locale: string,
  safeYamlLoad: (raw: string) => Record<string, unknown> | null,
): Record<string, unknown> | null {
  const entryDir = path.join(typeDir, slug);
  if (!fs.existsSync(entryDir) || !fs.statSync(entryDir).isDirectory()) {
    return null;
  }
  const commonPath = path.join(entryDir, "_common.yml");
  const localePath = path.join(entryDir, `${locale}.yml`);
  if (!fs.existsSync(localePath)) return null;

  let base: Record<string, unknown> = {};
  if (fs.existsSync(commonPath)) {
    const parsed = safeYamlLoad(fs.readFileSync(commonPath, "utf-8"));
    if (parsed) base = parsed;
  }
  const localeData = safeYamlLoad(fs.readFileSync(localePath, "utf-8"));
  if (!localeData) return null;
  return Object.keys(base).length > 0 ? deepMerge(base, localeData) : { ...localeData };
}

function ensureCommonTemplateStub(
  typeDir: string,
  onWritten?: (filePath: string) => void,
): string | null {
  const writePath = resolveCommonTemplatePath(typeDir, { forWrite: true });
  if (fs.existsSync(writePath)) return null;
  const legacy = path.join(typeDir, "_common.single.yml");
  if (fs.existsSync(legacy)) return null;
  fs.writeFileSync(
    writePath,
    `# Layout defaults for shared-layout templates (no sections — structure lives in template.{locale}.yml)\n`,
    "utf-8",
  );
  onWritten?.(writePath);
  return writePath;
}

function relativeContentPath(contentRoot: string, absPath: string): string {
  const rootName = path.basename(contentRoot);
  const rel = path.relative(contentRoot, absPath).split(path.sep).join("/");
  return `${rootName}/${rel}`;
}

/**
 * Run keep/from_entry bootstrap before flipping single_template.
 * Call only when shared layout is being newly enabled.
 */
export function enableSharedLayoutFromEntry(
  input: SharedLayoutEnableInput,
): SharedLayoutEnableOk | SharedLayoutEnableErr {
  const {
    contentType,
    contentRoot,
    safeYamlLoad,
    dumpYaml,
    getAvailableLocales,
    onWritten,
    requesterId,
  } = input;

  const folder = getFolder(contentType, contentRoot);
  const typeDir = path.join(contentRoot, folder);
  if (!fs.existsSync(typeDir)) {
    fs.mkdirSync(typeDir, { recursive: true });
  }

  const summaries = summarizeTemplateLocales(typeDir, safeYamlLoad);
  const usable = summaries.some((l) => l.sectionCount > 0);
  const modeRaw = input.templateMode;
  const mode =
    modeRaw === "keep_existing" || modeRaw === "from_entry"
      ? modeRaw
      : undefined;

  if (!mode) {
    return {
      ok: false,
      status: 400,
      code: "template_mode_required",
      error: usable
        ? 'Choose template_mode: "keep_existing" or "from_entry".'
        : 'No usable template.{locale}.yml (non-empty sections). template_mode must be "from_entry" with template_entry_source_slug.',
    };
  }

  if (!usable && mode === "keep_existing") {
    return {
      ok: false,
      status: 400,
      code: "no_usable_template",
      error:
        "No usable shared template (empty or missing template.*/single.* sections). Use template_mode: \"from_entry\" with template_entry_source_slug.",
    };
  }

  if (mode === "keep_existing") {
    const writtenPaths: string[] = [];
    const stub = ensureCommonTemplateStub(typeDir, onWritten);
    if (stub) writtenPaths.push(relativeContentPath(contentRoot, stub));

    let align: FanOutResult | undefined;
    const baseLocale =
      (typeof input.sharedLayoutBaseLocale === "string" &&
        input.sharedLayoutBaseLocale.trim()) ||
      summaries.find((s) => s.sectionCount > 0 && s.locale === "en")?.locale ||
      summaries.find((s) => s.sectionCount > 0)?.locale ||
      "en";
    if (input.sharedLayoutBaseLocale || usable) {
      align = alignSiblingSinglesToBase({
        templateDir: typeDir,
        baseLocale,
        safeYamlLoad,
        dumpYaml,
        requesterId,
        onWritten: (fp) => onWritten?.(fp),
      });
      for (const loc of align.succeeded) {
        const p = resolveTemplateLocalePath(typeDir, loc, {
          forWrite: true,
          fallbackLocale: "",
        });
        if (fs.existsSync(p)) {
          writtenPaths.push(relativeContentPath(contentRoot, p));
        }
      }
    }

    return {
      ok: true,
      writtenPaths: [...new Set(writtenPaths)],
      align,
      templateMode: "keep_existing",
    };
  }

  // from_entry
  const slug =
    typeof input.templateEntrySourceSlug === "string"
      ? input.templateEntrySourceSlug.trim()
      : "";
  if (!slug) {
    return {
      ok: false,
      status: 400,
      code: "template_entry_source_slug_required",
      error: "template_entry_source_slug is required when template_mode is \"from_entry\".",
    };
  }

  const entryLocales = getAvailableLocales(contentType, slug);
  if (entryLocales.length === 0) {
    return {
      ok: false,
      status: 404,
      code: "template_entry_not_found",
      error: `Entry "${slug}" not found or has no live locale files under ${folder}/.`,
    };
  }

  let sourceLocale =
    typeof input.templateEntrySourceLocale === "string"
      ? input.templateEntrySourceLocale.trim()
      : "";
  if (entryLocales.length > 1 && !sourceLocale) {
    return {
      ok: false,
      status: 400,
      code: "template_entry_source_locale_required",
      error: `Entry "${slug}" has multiple live locales; pass template_entry_source_locale.`,
      locales: entryLocales,
    };
  }
  if (!sourceLocale) {
    sourceLocale = entryLocales.includes("en") ? "en" : entryLocales[0];
  }
  if (!entryLocales.includes(sourceLocale)) {
    return {
      ok: false,
      status: 400,
      code: "template_entry_source_locale_invalid",
      error: `Locale "${sourceLocale}" is not a live locale for "${slug}".`,
      locales: entryLocales,
    };
  }

  const merged = loadClassicEntryMerged(typeDir, slug, sourceLocale, safeYamlLoad);
  if (!merged) {
    return {
      ok: false,
      status: 404,
      code: "template_entry_locale_missing",
      error: `Could not load ${folder}/${slug}/${sourceLocale}.yml`,
    };
  }

  const sections = Array.isArray(merged.sections)
    ? (merged.sections as Record<string, unknown>[])
    : [];
  if (sections.length === 0) {
    return {
      ok: false,
      status: 400,
      code: "template_entry_empty_sections",
      error: `Entry "${slug}" (${sourceLocale}) has no sections to use as the shared template.`,
    };
  }

  const invalidSections: SharedLayoutEnableErr["invalidSections"] = [];
  sections.forEach((sec, index) => {
    if (!sec || typeof sec !== "object") {
      invalidSections!.push({
        sectionId: null,
        index,
        reason: "invalid section object",
      });
      return;
    }
    if (!sectionIsEntryBagExpressionsOnly(sec)) {
      invalidSections!.push({
        sectionId: canonicalSectionId(sec),
        index,
        reason:
          "Content props must be exact {{ entry.* }} (or legacy {{ single.* }}) expressions, or empty",
      });
    }
  });
  if (invalidSections.length > 0) {
    return {
      ok: false,
      status: 400,
      code: "template_entry_not_template_shaped",
      error:
        "Source entry sections are not fully template-shaped. Bind every content prop to {{ entry.* }} before enabling shared layout.",
      invalidSections,
    };
  }

  const writePath = resolveTemplateLocalePath(typeDir, sourceLocale, {
    forWrite: true,
    fallbackLocale: "",
  });
  const pathsToOverwrite = [relativeContentPath(contentRoot, writePath)];
  if (usable && input.confirm !== true) {
    const proposedIds = sections
      .map((s) => canonicalSectionId(s))
      .filter((id): id is string => !!id);
    return {
      ok: false,
      status: 409,
      code: "confirm_template_replace",
      error:
        "Replacing an existing usable shared template requires confirm: true. Review the preview and re-call.",
      preview: {
        current: summaries,
        proposed: {
          locale: sourceLocale,
          sectionCount: sections.length,
          sectionIds: proposedIds,
        },
        paths_to_overwrite: pathsToOverwrite,
        template_entry_source_slug: slug,
        template_entry_source_locale: sourceLocale,
      },
    };
  }

  const rewritten = rewriteSingleVarsToEntryDeep({
    meta:
      merged.meta && typeof merged.meta === "object"
        ? merged.meta
        : {
            page_title: "{{ entry.title }}",
            description: "{{ entry.description }}",
          },
    sections,
  }) as Record<string, unknown>;

  const writtenPaths: string[] = [];
  const stub = ensureCommonTemplateStub(typeDir, onWritten);
  if (stub) writtenPaths.push(relativeContentPath(contentRoot, stub));

  const body = dumpYaml(rewritten);
  const next = body.endsWith("\n") ? body : `${body}\n`;
  fs.writeFileSync(writePath, next, "utf-8");
  onWritten?.(writePath);
  writtenPaths.push(relativeContentPath(contentRoot, writePath));

  const baseLocale =
    (typeof input.sharedLayoutBaseLocale === "string" &&
      input.sharedLayoutBaseLocale.trim()) ||
    sourceLocale;

  const align = alignSiblingSinglesToBase({
    templateDir: typeDir,
    baseLocale,
    safeYamlLoad,
    dumpYaml,
    requesterId,
    onWritten: (fp) => onWritten?.(fp),
  });
  for (const loc of align.succeeded) {
    const p = resolveTemplateLocalePath(typeDir, loc, {
      forWrite: true,
      fallbackLocale: "",
    });
    if (fs.existsSync(p)) {
      writtenPaths.push(relativeContentPath(contentRoot, p));
    }
  }

  return {
    ok: true,
    writtenPaths: [...new Set(writtenPaths)],
    align,
    sourceSlug: slug,
    sourceLocale,
    templateMode: "from_entry",
  };
}

export function isEnablingSharedLayout(opts: {
  priorSingleTemplate: boolean;
  bodySingleTemplate?: boolean;
  linkingDatabaseEnablesShared: boolean;
}): boolean {
  if (opts.linkingDatabaseEnablesShared && !opts.priorSingleTemplate) return true;
  if (opts.bodySingleTemplate === true && !opts.priorSingleTemplate) return true;
  return false;
}

/** @deprecated use COMMON_TEMPLATE_BASENAME — kept for tests */
export const _COMMON_TEMPLATE = COMMON_TEMPLATE_BASENAME;
