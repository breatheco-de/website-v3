import * as fs from "fs";
import * as yaml from "js-yaml";
import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { isEmptyLocaleContent } from "@shared/isEmptyLocaleContent";
import { isEntryDetached, isSharedLayoutType } from "../../../server/shared-layout-entry";
import { isValidAttachedOverlayPatch } from "@shared/sectionLeftovers";
import { contentIndex } from "../../../server/content-index";
import { createPublicUrlResolver } from "../../../server/redirects";
import {
  collectOutboundPathsFromData,
  entryIdFromContentFile,
  findInternalLinks,
  type InternalLinkHit,
} from "../../../server/link-extract";
import { queueLinkIndexSet } from "../../../server/link-index";
import {
  collectOutboundRelationTargets,
  relationEntryKey,
} from "../../../server/relation-extract";
import { queueRelationIndexSet } from "../../../server/relation-index";
import { liveFilesForSeo } from "../shared/seoValidationScope";
import * as path from "path";
import { CONTENT_QUALITY_ISSUE_CODES } from "./content-quality.issueCodes";

const CRITICAL_FIELDS = new Set(["title", "heading", "description", "subtitle", "tagline"]);

function findEmptyFields(obj: unknown, results: string[], currentPath: string = ""): void {
  if (!obj || typeof obj !== "object") return;

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      findEmptyFields(item, results, `${currentPath}[${index}]`);
    });
    return;
  }

  const record = obj as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    const fieldPath = currentPath ? `${currentPath}.${key}` : key;
    if (CRITICAL_FIELDS.has(key) && typeof value === "string" && value.trim() === "") {
      results.push(fieldPath);
    } else if (typeof value === "object" && value !== null) {
      findEmptyFields(value, results, fieldPath);
    }
  }
}

function isAttachedOverlayFile(
  file: { type: string; slug: string; filePath: string },
  contentRoot?: string,
): boolean {
  const base = path.basename(file.filePath);
  if (base.startsWith("single.") || base.startsWith("template.")) return false;
  if (!isSharedLayoutType(file.type, contentRoot)) return false;
  if (isEntryDetached(file.type, file.slug, contentRoot)) return false;
  return true;
}

export const contentQualityValidator: Validator = {
  name: "content-quality",
  issueCodes: CONTENT_QUALITY_ISSUE_CODES,
  description: "Validates content quality: sections structure, translation coverage, empty fields, and internal links",
  apiExposed: true,
  estimatedDuration: "medium",
  category: "content",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    let pagesChecked = 0;
    let emptySections = 0;
    let missingTypes = 0;
    let emptyFields = 0;
    let brokenLinks = 0;

    const publicUrls = createPublicUrlResolver(contentIndex);
    const liveFileSet = new Set(liveFilesForSeo(context));

    for (const file of context.contentFiles) {
      if (!liveFileSet.has(file)) continue;
      pagesChecked++;

      let parsed: Record<string, unknown> | null = null;
      try {
        if (fs.existsSync(file.filePath)) {
          const content = fs.readFileSync(file.filePath, "utf-8");
          parsed = yaml.load(content) as Record<string, unknown>;
        }
      } catch {
        continue;
      }

      if (!parsed) continue;

      const contentRoot = context.contentRoot;
      const mergedForEmpty = {
        ...parsed,
        ...(file.entryFields || {}),
      } as Record<string, unknown>;
      // Prefer locale file sections/content when present; entryFields may hold mapping fields.
      if (Array.isArray(parsed.sections)) mergedForEmpty.sections = parsed.sections;
      if (typeof parsed.content === "string") mergedForEmpty.content = parsed.content;

      const detached = isEntryDetached(file.type, file.slug, contentRoot);
      const emptyContent = isEmptyLocaleContent(mergedForEmpty);

      if (detached && emptyContent) {
        emptySections++;
        errors.push({
          type: "error",
          code: "EMPTY_LOCALE",
          message: `Detached locale "${file.locale}" has no sections and no content — hidden from public site`,
          file: file.filePath,
          suggestion:
            "Translate this locale (draft until promote) or delete the stub file. Attached shared-layout entries are not flagged for empty entry sections.",
        });
      } else if (
        emptyContent &&
        !detached &&
        !isSharedLayoutType(file.type, contentRoot)
      ) {
        emptySections++;
        errors.push({
          type: "error",
          code: "EMPTY_SECTIONS",
          message: "Content file has no sections and no body content",
          file: file.filePath,
          suggestion: "Add a sections array with at least one section, or a non-empty content field",
        });
      }

      const sections = parsed.sections as Array<Record<string, unknown>> | undefined;
      if (sections && Array.isArray(sections) && sections.length > 0) {
        const overlay = isAttachedOverlayFile(file, contentRoot);
        for (let i = 0; i < sections.length; i++) {
          const sec = sections[i];
          if (!sec || typeof sec !== "object") continue;
          if (typeof sec.type === "string" && sec.type.length > 0) continue;
          if (overlay && isValidAttachedOverlayPatch(sec)) continue;

          missingTypes++;
          errors.push({
            type: "error",
            code: "SECTION_MISSING_TYPE",
            message: overlay
              ? `Section at index ${i} has no type and no section_id (identity-less stub)`
              : `Section at index ${i} is missing a type field (typeless leftover; it does not render)`,
            file: file.filePath,
            suggestion: overlay
              ? "Delete this stub, or add section_id / _remove if it is an overlay patch for template.{locale}.yml"
              : "Delete the leftover YAML item. It does not render. Do not add a type to a fragment that duplicates a real section.",
          });
        }
      }

      const emptyFieldPaths: string[] = [];
      findEmptyFields(parsed, emptyFieldPaths);
      for (const fieldPath of emptyFieldPaths) {
        emptyFields++;
        warnings.push({
          type: "warning",
          code: "EMPTY_FIELD_VALUE",
          message: `Critical field "${fieldPath}" has an empty value`,
          file: file.filePath,
          suggestion: "Fill in the empty field or remove it if not needed",
        });
      }

      const internalLinks: InternalLinkHit[] = [];
      findInternalLinks(parsed, internalLinks);
      const locale = file.locale === "_common" ? "en" : file.locale;
      for (const hit of internalLinks) {
        if (!publicUrls.isLive(hit.link, locale)) {
          brokenLinks++;
          const where = hit.component
            ? ` in component "${hit.component}"`
            : "";
          errors.push({
            type: "error",
            code: "BROKEN_INTERNAL_LINK",
            message: `Broken internal link: "${hit.link}"${where}`,
            file: file.filePath,
            suggestion: `Found at ${hit.fieldPath}. Fix the URL or remove the broken link. Confirm with Redirects → Test a URL.`,
          });
        }
      }

      try {
        const outboundPaths = collectOutboundPathsFromData(mergedForEmpty, locale, publicUrls);
        queueLinkIndexSet(
          entryIdFromContentFile(file.type, file.slug, locale),
          outboundPaths,
          contentRoot,
        );
      } catch {
        /* derived index is best-effort */
      }

      try {
        const targets = collectOutboundRelationTargets(mergedForEmpty, {
          contentType: file.type,
          contentRoot,
        });
        queueRelationIndexSet(
          relationEntryKey(file.type, file.slug),
          targets,
          contentRoot,
        );
      } catch {
        /* derived index is best-effort */
      }
    }

    let missingTranslations = 0;
    const groups = new Map<string, Set<string>>();
    for (const file of context.contentFiles) {
      const key = `${file.type}:${file.slug}`;
      const locales = groups.get(key) || new Set<string>();
      locales.add(file.locale);
      groups.set(key, locales);
    }

    groups.forEach((locales, key) => {
      if (!locales.has("en") || !locales.has("es")) {
        missingTranslations++;
        const missing = !locales.has("en") ? "en" : "es";
        warnings.push({
          type: "warning",
          code: "MISSING_TRANSLATION",
          message: `${key} is missing "${missing}" locale translation`,
          suggestion: `Add the ${missing} locale file for this content`,
        });
      }
    });

    const duration = Date.now() - startTime;
    return {
      name: this.name,
      description: this.description,
      status: errors.length > 0 ? "failed" : warnings.length > 0 ? "warning" : "passed",
      errors,
      warnings,
      duration,
      artifacts: {
        pagesChecked,
        emptySections,
        missingTypes,
        missingTranslations,
        brokenLinks,
        emptyFields,
      },
    };
  },
};
