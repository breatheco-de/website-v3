/**
 * Redirect Validator
 * 
 * Validates redirect configurations:
 * - Detects conflicts (same URL claimed by multiple pages)
 * - Checks for self-redirects
 * - Detects redirect loops
 * - Validates redirects don't conflict with existing content URLs
 * - Validates custom redirects from custom-redirects.yml
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import type { Validator, ValidatorResult, ValidationContext, ValidationIssue, RedirectEntry } from "../shared/types";
import { normalizeUrl, getCanonicalUrl } from "../shared/canonicalUrls";
import { isLiveRedirectSource } from "../shared/draftFiles";
import { formatSitePath } from "../../../shared/formatSitePath";
import { isLocaleHomeAlias } from "@shared/public-app-routes";
import { REDIRECTS_ISSUE_CODES } from "./redirects.issueCodes";

interface CustomRedirectEntry {
  from: string;
  to: string;
  status?: number;
}

function formatRedirectSourceLabel(filePath: string): string {
  return `${formatSitePath(filePath)} (live)`;
}

/** Appended to every redirects-validator suggestion so agents/staff know how to refresh the cache. */
const REDIRECTS_SITE_WIDE_REFRESH =
  ' Then re-run site-wide redirects validation (Redirects admin / Global Health, or POST /api/validation/run with validators: ["redirects"]). Page Diagnostics "Run validation" does not refresh redirect issues.';

function redirectSuggestion(action: string): string {
  const base = action.trim().replace(/\.+\s*$/, "");
  return `${base}.${REDIRECTS_SITE_WIDE_REFRESH}`;
}

function isRegexPattern(p: string): boolean {
  return /\(.*\)|\[.*\]|\.\*|\.\+|\\d|\\w|\\s|\{\d+[,}]/.test(p);
}

function getStaticPrefix(pattern: string): string {
  let prefix = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "(" || ch === "[" || ch === "." || ch === "\\" || ch === "{" || ch === "*" || ch === "+" || ch === "?") break;
    prefix += ch;
  }
  return prefix;
}

function loadCustomRedirects(contentRoot?: string): CustomRedirectEntry[] {
  const root = contentRoot ?? path.join(process.cwd(), "4geeks-com");
  const filePath = path.join(root, "custom-redirects.yml");
  if (!fs.existsSync(filePath)) return [];

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = yaml.load(raw) as { redirects?: unknown[] } | null;
    if (!parsed || !Array.isArray(parsed.redirects)) return [];

    return parsed.redirects.filter(
      (r): r is CustomRedirectEntry =>
        typeof r === "object" && r !== null && "from" in r && "to" in r
    );
  } catch {
    return [];
  }
}

export const redirectValidator: Validator = {
  name: "redirects",
  issueCodes: REDIRECTS_ISSUE_CODES,
  description: "Validates redirect configurations for conflicts, loops, and self-redirects",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "integrity",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const redirectMap = new Map<string, RedirectEntry>();

    function getContentFolder(filePath: string): string {
      const parts = filePath.split("/");
      return parts.slice(0, -1).join("/");
    }

    for (const file of context.contentFiles) {
      if (!isLiveRedirectSource(file)) continue;

      const redirects = file.meta?.redirects || [];
      if (redirects.length === 0) continue;

      const isCommon = file.locale === "_common";
      const targetUrl = getCanonicalUrl(file);
      const fileLabel = formatRedirectSourceLabel(file.filePath);

      for (const redirect of redirects) {
        const normalizedRedirect = normalizeUrl(redirect);

        if (normalizedRedirect === targetUrl) {
          errors.push({
            type: "error",
            code: "SELF_REDIRECT",
            message: `Self-redirect detected: "${normalizedRedirect}" redirects to itself`,
            file: file.filePath,
            suggestion: redirectSuggestion("Remove this redirect or change the target URL"),
          });
          continue;
        }

        if (redirectMap.has(normalizedRedirect)) {
          const existing = redirectMap.get(normalizedRedirect)!;
          const sameFolder = getContentFolder(file.filePath) === getContentFolder(existing.source.filePath);

          if (sameFolder) {
            // Both files are sibling locale files within the same content folder.
            // The redirect is inherited from the shared _common.yml parent. Silently
            // skip — this is not a conflict.
            continue;
          }

          const bothFromSameContent = isCommon || existing.source.locale === "_common";
          const existingLabel = formatRedirectSourceLabel(existing.source.filePath);

          if (!bothFromSameContent) {
            errors.push({
              type: "error",
              code: "REDIRECT_CONFLICT",
              message: `Redirect conflict: "${normalizedRedirect}" is claimed by both "${fileLabel}" and "${existingLabel}"`,
              file: file.filePath,
              suggestion: redirectSuggestion("Remove one of the conflicting redirects"),
            });
          } else {
            const commonPath = isCommon ? fileLabel : existingLabel;
            const localePath = isCommon ? existingLabel : fileLabel;
            warnings.push({
              type: "warning",
              code: "REDIRECT_OVERLAP",
              message: `Redirect "${normalizedRedirect}" exists in both "${commonPath}" and "${localePath}"`,
              file: file.filePath,
              suggestion: redirectSuggestion(
                "Keep the redirect in only one place: _common.yml for all languages, or locale file for a specific language",
              ),
            });
          }
          continue;
        }

        if (context.validUrls.has(normalizedRedirect) && !isLocaleHomeAlias(normalizedRedirect)) {
          errors.push({
            type: "error",
            code: "REDIRECT_OVERWRITES_CONTENT",
            message: `Redirect "${normalizedRedirect}" conflicts with an existing content URL`,
            file: file.filePath,
            suggestion: redirectSuggestion("Choose a different redirect source URL"),
          });
          continue;
        }

        redirectMap.set(normalizedRedirect, {
          from: normalizedRedirect,
          to: targetUrl,
          source: file,
        });
      }
    }

    const customRedirects = loadCustomRedirects(context.contentRoot);
    const customFile = `${path.basename(context.contentRoot ?? path.join(process.cwd(), "4geeks-com"))}/custom-redirects.yml`;

    const customSource = {
      slug: "_custom",
      title: "Custom Redirects",
      type: "page" as const,
      locale: "_common",
      filePath: customFile,
    };

    for (const entry of customRedirects) {
      const normalizedFrom = normalizeUrl(entry.from);

      if (redirectMap.has(normalizedFrom)) {
        const existing = redirectMap.get(normalizedFrom)!;
        errors.push({
          type: "error",
          code: "REDIRECT_CONFLICT",
          message: `Redirect conflict: "${normalizedFrom}" in custom-redirects.yml conflicts with "${existing.source.filePath}"`,
          file: customFile,
          suggestion: redirectSuggestion("Remove one of the conflicting redirects"),
        });
        continue;
      }

      if (context.validUrls.has(normalizedFrom) && !isLocaleHomeAlias(normalizedFrom)) {
        errors.push({
          type: "error",
          code: "REDIRECT_OVERWRITES_CONTENT",
          message: `Custom redirect "${normalizedFrom}" conflicts with an existing content URL`,
          file: customFile,
          suggestion: redirectSuggestion("Choose a different redirect source URL"),
        });
        continue;
      }

      if (!entry.to || entry.to.trim() === "") {
        errors.push({
          type: "error",
          code: "CUSTOM_REDIRECT_MISSING_DEST",
          message: `Custom redirect "${normalizedFrom}" has no destination URL`,
          file: customFile,
          suggestion: redirectSuggestion("Add a valid destination URL"),
        });
        continue;
      }

      redirectMap.set(normalizedFrom, {
        from: normalizedFrom,
        to: entry.to,
        source: customSource,
      });
    }

    const getTargetUrls = (to: string | Record<string, string>): string[] => {
      if (typeof to === "string") return [to];
      return Object.values(to);
    };

    for (const [redirectUrl, { to: target }] of redirectMap) {
      const targetUrls = getTargetUrls(target);

      const queue = targetUrls.map((url) => ({ url, path: [redirectUrl] }));
      while (queue.length > 0) {
        const item = queue.shift()!;
        if (!redirectMap.has(item.url)) continue;

        if (item.path.includes(item.url)) {
          errors.push({
            type: "error",
            code: "REDIRECT_LOOP",
            message: `Redirect loop detected: ${item.path.join(" -> ")} -> ${item.url}`,
            suggestion: redirectSuggestion("Break the redirect chain by removing one of the redirects"),
          });
          continue;
        }

        const nextPath = [...item.path, item.url];
        const nextTargets = getTargetUrls(redirectMap.get(item.url)!.to);
        for (const next of nextTargets) {
          queue.push({ url: next, path: nextPath });
        }
      }
    }

    const regexCustom = customRedirects
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => isRegexPattern(entry.from));

    for (let i = 0; i < regexCustom.length; i++) {
      const broader = regexCustom[i];
      const broaderPrefix = getStaticPrefix(broader.entry.from);
      try {
        const broaderRegex = new RegExp(`^${broader.entry.from}$`, "i");
        for (let j = i + 1; j < regexCustom.length; j++) {
          const specific = regexCustom[j];
          const specificPrefix = getStaticPrefix(specific.entry.from);
          if (specificPrefix.startsWith(broaderPrefix) && specificPrefix.length > broaderPrefix.length) {
            const samplePath = specific.entry.from.replace(/\(.*?\)/g, "test-value").replace(/\[.*?\]/g, "x").replace(/\.\*/g, "sample").replace(/\.\+/g, "sample");
            if (broaderRegex.test(samplePath)) {
              warnings.push({
                type: "warning",
                code: "REGEX_SHADOWED",
                message: `Pattern "${specific.entry.from}" (position ${specific.index + 1}) is shadowed by broader pattern "${broader.entry.from}" (position ${broader.index + 1}) — the specific rule will never match`,
                file: customFile,
                suggestion: redirectSuggestion(
                  `Move "${specific.entry.from}" above "${broader.entry.from}" in custom-redirects.yml, or use the reorder arrows in the Redirects editor`,
                ),
              });
            }
          }
        }
      } catch {
      }
    }

    context.redirectMap = redirectMap;

    const duration = Date.now() - startTime;
    return {
      name: this.name,
      description: this.description,
      status: errors.length > 0 ? "failed" : warnings.length > 0 ? "warning" : "passed",
      errors,
      warnings,
      duration,
      artifacts: {
        totalRedirects: redirectMap.size,
        customRedirects: customRedirects.length,
        redirectMap: Object.fromEntries(
          Array.from(redirectMap.entries()).map(([k, v]) => [k, v.to])
        ),
      },
    };
  },
};
