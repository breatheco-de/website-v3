/**
 * Proposals 1.0 draft integrity: attached draft structure, orphan versioning.yml,
 * `_draft` left in published files, stale / source-changed free drafts, unverified
 * proposal links, and field-scope mismatches between `_common.yml` and locale files.
 */

import fs from "fs";
import path from "path";
import { LOCALE_META_KEYS, LOCALE_TOP_LEVEL_KEYS, splitByFieldScope } from "@shared/field-scope";
import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { nullFieldPaths, resolveScanRoot, scanEntries, type ScannedEntry } from "../shared/draft-scan";
import { isEntryDetached, isSharedLayoutType } from "../../../server/shared-layout-entry";
import { readVariantAllocation } from "../../../server/versioning/variant-traffic";
import { DRAFT_META_KEY, readDraftMeta, safeLoadYaml } from "../../../server/versioning/draft-meta";
import { checkDraftBase, checkTranslationSource } from "../../../server/versioning/draft-base";
import { DRAFT_INTEGRITY_ISSUE_CODES, DRAFT_INTEGRITY_VALIDATOR_NAME } from "./draft-integrity.issueCodes";

export const STALE_DRAFT_DAYS = 30;

/** Data migration that moves every field to its scope's file; once it ran on a site, mismatches are errors. */
export const FIELD_SCOPE_MIGRATION_FILE = "006_reconcile_field_scope.ts";

async function fieldScopeMigrationCompleted(site: string): Promise<boolean> {
  try {
    const { isCompleted, ledgerDb } = await import("../../../server/data-migrations/ledger");
    return isCompleted(ledgerDb(site), FIELD_SCOPE_MIGRATION_FILE);
  } catch {
    return false;
  }
}

function load(filePath: string): Record<string, unknown> | null {
  try {
    const parsed = safeLoadYaml(fs.readFileSync(filePath, "utf-8"));
    return parsed && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Variant slugs listed in versioning.yml (any locale). */
export function versioningVariants(data: Record<string, unknown> | null): Array<{ locale: string; slug: string }> {
  const out: Array<{ locale: string; slug: string }> = [];
  for (const [locale, block] of Object.entries(data ?? {})) {
    const variants = (block as { variants?: Array<{ slug?: unknown }> } | null)?.variants;
    if (!Array.isArray(variants)) continue;
    for (const v of variants) if (typeof v?.slug === "string") out.push({ locale, slug: v.slug });
  }
  return out;
}

export function isOrphanVersioning(entry: ScannedEntry): boolean {
  if (!entry.versioningPath) return false;
  const listed = versioningVariants(load(entry.versioningPath));
  if (listed.length === 0) return true;
  return listed.every((l) => !entry.variants.some((v) => v.variant === l.slug && v.locale === l.locale));
}

/** Locale-scoped keys (explicitly listed, incl. `meta.robots`) sitting in `_common.yml`. Unlisted keys stay page-wide. */
export function localeKeysInCommon(common: Record<string, unknown> | null): string[] {
  if (!common) return [];
  const { locale } = splitByFieldScope(common);
  const out: string[] = [];
  for (const [k, v] of Object.entries(locale)) {
    if (k === "meta" && v && typeof v === "object" && !Array.isArray(v)) {
      for (const mk of Object.keys(v as Record<string, unknown>)) {
        if (LOCALE_META_KEYS.has(mk)) out.push(`meta.${mk}`);
      }
      continue;
    }
    if (LOCALE_TOP_LEVEL_KEYS.has(k)) out.push(k);
  }
  return out;
}

/** Page-level keys sitting in a live locale file. */
export function commonKeysInLocale(data: Record<string, unknown> | null): string[] {
  if (!data) return [];
  const { common } = splitByFieldScope(data);
  const out: string[] = [];
  for (const [k, v] of Object.entries(common)) {
    if (k === "meta" && v && typeof v === "object") {
      for (const mk of Object.keys(v as Record<string, unknown>)) out.push(`meta.${mk}`);
    } else out.push(k);
  }
  return out;
}

export const draftIntegrityValidator: Validator = {
  name: DRAFT_INTEGRITY_VALIDATOR_NAME,
  issueCodes: DRAFT_INTEGRITY_ISSUE_CODES,
  description:
    "Drafts, versioning.yml and field scope: attached draft structure, orphan versioning, stale drafts, fields in the wrong file",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "integrity",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const root = resolveScanRoot(context.contentRoot);
    const entries = scanEntries(root);
    const scopeStrict = await fieldScopeMigrationCompleted(path.basename(path.resolve(root)));
    const staleCutoff = Date.now() - STALE_DRAFT_DAYS * 24 * 60 * 60 * 1000;
    const sharedTypes = new Map<string, boolean>();

    for (const entry of entries) {
      const { contentType, slug } = entry;
      if (!sharedTypes.has(contentType)) sharedTypes.set(contentType, isSharedLayoutType(contentType, root));
      const attached = sharedTypes.get(contentType)! && !isEntryDetached(contentType, slug, root);

      if (isOrphanVersioning(entry)) {
        warnings.push({
          type: "warning",
          code: "ORPHAN_ENTRY_VERSIONING",
          message: `${contentType}/${slug}: versioning.yml lists no existing variant files.`,
          file: entry.versioningPath!,
          fix: { type: "api", label: "Delete orphan versioning.yml", fixerName: "orphan-entry-versioning" },
        });
      }

      for (const v of entry.variants) {
        const ref = { contentType, slug, locale: v.locale, variant: v.variant, contentRoot: root };
        const data = load(v.filePath);
        if (attached) {
          const structure = ["sections", "layout"].filter((k) => data && data[k] != null);
          const alloc = readVariantAllocation(ref) ?? 0;
          if (structure.length || alloc > 0) {
            errors.push({
              type: "error",
              code: "ATTACHED_DRAFT_STRUCTURE",
              message: structure.length
                ? `${contentType}/${slug} uses the shared template but variant '${v.variant}' (${v.locale}) has ${structure.join(" and ")}.`
                : `${contentType}/${slug} uses the shared template but variant '${v.variant}' (${v.locale}) has ${alloc}% traffic.`,
              file: v.filePath,
            });
          }
        }
        const meta = readDraftMeta(v.filePath);
        if (meta?.proposal?.unverified_since) {
          warnings.push({
            type: "warning",
            code: "DRAFT_LINK_UNVERIFIED",
            message: `Draft '${v.variant}' of ${contentType}/${slug} (${v.locale}) is linked to proposal ${meta.proposal.id} (${meta.proposal.env}); production could not be asked since ${meta.proposal.unverified_since}.`,
            file: v.filePath,
          });
        }
        if (meta?.proposal) continue;
        const base = checkDraftBase(ref);
        if (base.status === "stale" && Date.parse(base.based_on.at) < staleCutoff) {
          warnings.push({
            type: "warning",
            code: "STALE_DRAFT",
            message: `Draft '${v.variant}' of ${contentType}/${slug} (${v.locale}) was created ${base.based_on.at.slice(0, 10)}; the published ${base.changed.join(" and ")} file changed since.`,
            file: v.filePath,
          });
        }
        const source = checkTranslationSource(ref, { withFields: true });
        if (source.status === "changed") {
          warnings.push({
            type: "warning",
            code: "TRANSLATION_SOURCE_CHANGED",
            message: `Draft '${v.variant}' of ${contentType}/${slug} (${v.locale}) was translated from ${source.source_locale}, which changed since${source.source_changed_fields?.length ? ` (${source.source_changed_fields.join(", ")})` : ""}.`,
            file: v.filePath,
          });
        }
      }

      const published = [
        ...(entry.commonPath ? [{ filePath: entry.commonPath, isCommon: true }] : []),
        ...entry.live.map((l) => ({ filePath: l.filePath, isCommon: false })),
      ];
      for (const p of published) {
        const data = load(p.filePath);
        if (!data) continue;
        if (DRAFT_META_KEY in data) {
          warnings.push({
            type: "warning",
            code: "DRAFT_META_IN_PUBLISHED",
            message: `${contentType}/${slug}: published file carries the internal _draft block.`,
            file: p.filePath,
            fix: { type: "api", label: "Strip _draft from published files", fixerName: "draft-meta-in-published" },
          });
        }
        const nulls = nullFieldPaths(data);
        if (nulls.length) {
          errors.push({
            type: "error",
            code: "FIELD_SCOPE_NULL_OUTSIDE_DRAFT",
            message: `${contentType}/${slug}: ${nulls.join(", ")} set to null in a published file.`,
            file: p.filePath,
          });
        }
        const misplaced = p.isCommon ? localeKeysInCommon(data) : commonKeysInLocale(data);
        if (misplaced.length) {
          (scopeStrict ? errors : warnings).push({
            type: scopeStrict ? "error" : "warning",
            code: "FIELD_SCOPE_MISMATCH",
            message: p.isCommon
              ? `${contentType}/${slug}: per-language field(s) ${misplaced.join(", ")} in _common.yml.`
              : `${contentType}/${slug}: page-wide field(s) ${misplaced.join(", ")} in a language file.`,
            file: p.filePath,
            fix: { type: "api", label: "Move fields to the right file", fixerName: "field-scope-mismatch" },
          });
        }
      }
    }

    return {
      name: this.name,
      description: this.description,
      status: errors.length > 0 ? "failed" : warnings.length > 0 ? "warning" : "passed",
      errors,
      warnings,
      duration: Date.now() - startTime,
      artifacts: { entries: entries.length },
    };
  },
};
