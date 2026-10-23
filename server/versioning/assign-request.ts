/**
 * One place that decides whether a request takes part in a page test and which
 * version it gets. Used by API page routes, the HTML variant key, and SSR initial data.
 */

import type { Request, Response } from "express";
import { AB_CHECK_HEADER, isExperimentExcludedUa } from "@shared/experiment-audience";
import { getDefaultContentRoot } from "../site-config";
import {
  isAbCheckPage,
  isAbTestingSetUp,
  verifyCheckToken,
} from "../ab-testing/state";
import { DEFAULT_VARIANT_SLUG, experimentId } from "./assignment";
import {
  getVersioningCookie,
  readUserId,
  setVersioningCookie,
  type VersioningAssignment,
} from "./cookie-utils";
import { getVersioningManager, type VersioningManager } from "./VersioningManager";

export type ServedPageVersion = { experiment_id: string; variant: string };

export interface RequestAssignment {
  contentType: string;
  versioningSlug: string;
  locale: string;
  /** Variant slug, or `"default"` for the live share of an active test. */
  variant: string;
  run: string | null;
  experimentId: string;
}

interface SiteLike {
  contentRoot?: string;
  contentRootName?: string;
  versioningManager?: VersioningManager;
}

function siteOf(res: Response): { contentRoot: string; contentRootName: string; vm: VersioningManager } {
  const site = (res.locals as { site?: SiteLike }).site;
  const contentRoot = site?.contentRoot ?? getDefaultContentRoot();
  const contentRootName = site?.contentRootName ?? contentRoot.split(/[/\\]/).pop() ?? contentRoot;
  return { contentRoot, contentRootName, vm: site?.versioningManager ?? getVersioningManager() };
}

function headerValue(req: Request, name: string): string | undefined {
  const v = req.headers?.[name];
  return Array.isArray(v) ? v[0] : v;
}

function hasStaffToken(req: Request): boolean {
  const auth = headerValue(req, "authorization");
  const debug = headerValue(req, "x-debug-token");
  return !!(auth && auth.trim()) || !!(debug && debug.trim());
}

export type AssignDecision =
  | { ok: true; record: boolean }
  | { ok: false; reason: "staff" | "bot" | "not_set_up" };

/**
 * Who may be put in a test. Staff and bots never are. While A/B testing is not set
 * up for the site, only the hidden check page assigns. Check requests (valid
 * X-AB-Check token) are served like visitors but never counted.
 */
export function canAssignExperiment(
  req: Request,
  res: Response,
  target: { contentType: string; slug: string },
): AssignDecision {
  if (hasStaffToken(req)) return { ok: false, reason: "staff" };
  const { contentRoot, contentRootName } = siteOf(res);
  const isCheck = verifyCheckToken(contentRootName, headerValue(req, AB_CHECK_HEADER));
  if (!isCheck && isExperimentExcludedUa(headerValue(req, "user-agent"))) {
    return { ok: false, reason: "bot" };
  }
  const checkPage = isAbCheckPage(target.contentType, target.slug, contentRoot);
  if (!checkPage && !isAbTestingSetUp({ contentRoot, contentRootName })) {
    return { ok: false, reason: "not_set_up" };
  }
  return { ok: true, record: !isCheck };
}

/** Remember which page version this response serves (JSON `_page_version`, SSR seed, cache header). */
export function markServedPageVersion(res: Response, assignment: RequestAssignment): void {
  res.locals.pageVersion = {
    experiment_id: assignment.experimentId,
    variant: assignment.variant,
  } satisfies ServedPageVersion;
}

/**
 * Assign this request for (contentType, versioningSlug, locale). Returns null when the
 * request is excluded or the locale has no active test. Sticky via `4g_versioning_v2`.
 * Memoized per response so HTML key, SSR seed, and API handlers agree.
 */
export function assignForRequest(
  req: Request,
  res: Response,
  contentType: string,
  versioningSlug: string,
  locale: string,
): RequestAssignment | null {
  const memoKey = `${contentType}:${versioningSlug}:${locale}`;
  const locals = res.locals as { abAssignments?: Map<string, RequestAssignment | null> };
  locals.abAssignments ??= new Map();
  if (locals.abAssignments.has(memoKey)) return locals.abAssignments.get(memoKey) ?? null;

  const result = computeAssignment(req, res, contentType, versioningSlug, locale);
  locals.abAssignments.set(memoKey, result);
  return result;
}

function computeAssignment(
  req: Request,
  res: Response,
  contentType: string,
  versioningSlug: string,
  locale: string,
): RequestAssignment | null {
  const decision = canAssignExperiment(req, res, { contentType, slug: versioningSlug });
  if (!decision.ok) return null;

  const { vm } = siteOf(res);
  if (!vm.hasActiveTest(contentType, versioningSlug, locale)) return null;

  const userId = readUserId(req, res);
  const cookie = getVersioningCookie(req);
  const assignments: VersioningAssignment[] = cookie?.assignments ?? [];
  const existing = assignments.find(
    (a) => a.contentType === contentType && a.slug === versioningSlug && a.locale === locale,
  );
  const run = vm.getRun(contentType, versioningSlug, locale);

  let variant = vm.getAssignment(
    contentType,
    versioningSlug,
    locale,
    userId,
    existing ? { variantSlug: existing.variantSlug, run: existing.run ?? null } : undefined,
    { record: decision.record },
  );
  if (!variant) return null;

  // A variant missing in this language serves the live page and is not a valid assignment.
  if (
    variant !== DEFAULT_VARIANT_SLUG &&
    !vm.getVariantContentResult(contentType, versioningSlug, variant, locale).ok
  ) {
    variant = null;
  }
  if (!variant) return null;

  const updated: VersioningAssignment[] = [
    ...assignments.filter(
      (a) => !(a.contentType === contentType && a.slug === versioningSlug && a.locale === locale),
    ),
    { contentType, slug: versioningSlug, locale, variantSlug: variant, run, assignedAt: Date.now() },
  ];
  setVersioningCookie(res, userId, updated);

  const assignment: RequestAssignment = {
    contentType,
    versioningSlug,
    locale,
    variant,
    run,
    experimentId: experimentId(contentType, versioningSlug, locale, run),
  };
  markServedPageVersion(res, assignment);
  return assignment;
}

/** Real variant slug to serve (null = live page, including the Default group). */
export function servedVariantSlug(assignment: RequestAssignment | null): string | null {
  if (!assignment || assignment.variant === DEFAULT_VARIANT_SLUG) return null;
  return assignment.variant;
}
