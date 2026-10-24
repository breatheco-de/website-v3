/**
 * Resolve the effective HTML-cache variant key for a document request.
 * Must run before HTML cache lookup so HIT/MISS is per A/B variant.
 *
 * Keys: `live` (no test, or request not in a test), a variant slug, `__default`
 * (Default group of an active test — same content as live, but labeled), or a
 * forced preview slug.
 */

import type { Request, Response } from "express";
import { contentIndex } from "./content-index";
import { versioningContentSlug } from "./shared-layout-entry";
import {
  assignForRequest,
  servedVariantSlug,
  type RequestAssignment,
  type ServedPageVersion,
} from "./versioning/assign-request";
import { DEFAULT_VARIANT_SLUG } from "./versioning/assignment";
import { getVersioningManager, type VersioningManager } from "./versioning/VersioningManager";

/** HTML cache key for the Default group of an active test (cannot collide with a variant slug). */
export const AB_DEFAULT_HTML_KEY = "__default";

function getQueryParam(url: string, name: string): string | null {
  const q = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  if (!q) return null;
  try {
    return new URLSearchParams(q).get(name);
  } catch {
    return null;
  }
}

function requestHasAuthToken(req: Request): boolean {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.trim()) return true;
  const debug = req.headers["x-debug-token"];
  if (typeof debug === "string" && debug.trim()) return true;
  return false;
}

type CiLike = typeof contentIndex;

export interface DocumentTarget {
  contentType: string;
  versioningSlug: string;
  locale: string;
}

/** Content entry + locale a public document URL renders (null for non-content URLs). */
export function resolveDocumentTarget(
  ci: CiLike,
  pathname: string,
  contentRoot?: string,
): DocumentTarget | null {
  const clean = pathname.split("?")[0].split("#")[0] || "/";
  let parsed: { contentType: string; slug: string; locale: string } | null = null;
  try {
    const resolved = ci.resolveUrl(clean);
    if (resolved) {
      parsed = {
        contentType: resolved.contentType,
        slug: resolved.slug,
        locale:
          resolved.params?.locale ||
          (resolved.patternLocale && resolved.patternLocale !== "default" ? resolved.patternLocale : "") ||
          (clean.match(/^\/(es)\b/) ? "es" : "en"),
      };
    } else {
      parsed = ci.parseContentUrl(clean);
    }
  } catch {
    parsed = null;
  }
  if (!parsed?.contentType || !parsed.slug) return null;
  return {
    contentType: parsed.contentType,
    versioningSlug: versioningContentSlug(parsed.contentType, parsed.slug, contentRoot),
    locale: parsed.locale || "en",
  };
}

export interface HtmlVariantResolution {
  /** HTML cache key: `live`, a variant slug, `__default`, or a forced preview slug. */
  key: string;
  /** Traffic assignment (null for forced previews, staff, bots, or pages without a test). */
  assignment: RequestAssignment | null;
}

function htmlKeyFor(assignment: RequestAssignment | null): string {
  if (!assignment) return "live";
  if (assignment.variant === DEFAULT_VARIANT_SLUG) return AB_DEFAULT_HTML_KEY;
  return servedVariantSlug(assignment) ?? "live";
}

/**
 * Resolve the HTML key and traffic assignment for a document request.
 * Sets the sticky cookie when assigning, and `res.locals.abTestedPage` when the
 * page has an active test (its HTML must never be shared between visitors).
 */
export function resolveHtmlVariant(req: Request, res: Response): HtmlVariantResolution {
  const url = req.originalUrl || req.url || "/";
  const force =
    getQueryParam(url, "force_variant") || getQueryParam(url, "variant");
  if (force) return { key: force, assignment: null };

  const site = (res.locals as { site?: { contentIndex?: CiLike; contentRoot?: string; versioningManager?: VersioningManager } }).site;
  const ci = site?.contentIndex ?? contentIndex;
  const target = resolveDocumentTarget(ci, url, site?.contentRoot);
  if (!target) return { key: "live", assignment: null };

  const vm = site?.versioningManager ?? getVersioningManager();
  if (vm.hasActiveTest(target.contentType, target.versioningSlug, target.locale)) {
    (res.locals as { abTestedPage?: boolean }).abTestedPage = true;
  }

  // Editors / authenticated: always live cache bucket (and usually bypass anyway)
  if (requestHasAuthToken(req)) return { key: "live", assignment: null };

  const assignment = assignForRequest(req, res, target.contentType, target.versioningSlug, target.locale);
  return { key: htmlKeyFor(assignment), assignment };
}

/** Returns `live` or a traffic-assigned / force_variant slug for cache keying. */
export function resolveHtmlVariantKey(req: Request, res: Response): string {
  return resolveHtmlVariant(req, res).key;
}

/**
 * For background rebuilds: what a cached HTML key renders. `live` and unknown keys
 * render the live page with no label; a variant key renders that variant labeled
 * when it has traffic; `__default` renders live labeled as the Default group.
 */
export function initialDataAssignmentForHtmlKey(
  site: { contentIndex?: unknown; contentRoot?: string; versioningManager?: VersioningManager },
  pathname: string,
  variantKey: string | undefined,
): { variant: string | null; pageVersion: ServedPageVersion | null } | undefined {
  if (!variantKey || variantKey === "live" || variantKey === "default") return undefined;
  const ci = (site.contentIndex as CiLike | undefined) ?? contentIndex;
  const target = resolveDocumentTarget(ci, pathname, site.contentRoot);
  if (!target) return undefined;
  const vm = site.versioningManager ?? getVersioningManager();
  const active = vm.hasActiveTest(target.contentType, target.versioningSlug, target.locale);
  const experiment_id = vm.getExperimentId(target.contentType, target.versioningSlug, target.locale);

  if (variantKey === AB_DEFAULT_HTML_KEY) {
    return { variant: null, pageVersion: active ? { experiment_id, variant: DEFAULT_VARIANT_SLUG } : null };
  }
  const allocation =
    vm.getVersioningForContent(target.contentType, target.versioningSlug)?.[target.locale]?.variants?.find(
      (v) => v.slug === variantKey,
    )?.allocation ?? 0;
  return {
    variant: variantKey,
    pageVersion: allocation > 0 ? { experiment_id, variant: variantKey } : null,
  };
}
