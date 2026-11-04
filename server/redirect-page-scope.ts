/**
 * Page-scoped live redirects (`edit_page_redirects`, scoped by content type).
 *
 * A page-scoped caller may add or remove old addresses on the live page they point to
 * (`meta.redirects` in that page's `{locale}.yml` / `_common.yml`). Everything else —
 * `custom-redirects.yml`, pattern rules, ordering, priority, moving a removed page's
 * addresses, or hiding a live page — stays behind the global `edit_redirects`.
 */

import path from "path";
import type { ContentIndex } from "./content-index";
import { findEntryPresence } from "./entry-layer";
import { resolveDestinationLocale } from "./redirect-destination";
import { checkSimpleRedirectFrom, redirectsPageUrl, type SimpleRedirectBlockCode } from "./redirect-simple-check";

export const PAGE_SCOPE_REFUSED = "page_scope_refused" as const;

export type PageScopeRefusalReason =
  | "wrong_content_type"
  | "custom_file"
  | "not_a_page"
  | "option_not_allowed"
  | SimpleRedirectBlockCode;

export type LiveRedirectAuth =
  | { ok: true; mode: "global" }
  | { ok: true; mode: "page"; contentType: string; slug: string; normalizedFrom?: string }
  | {
      ok: false;
      status: number;
      code: typeof PAGE_SCOPE_REFUSED;
      reason: PageScopeRefusalReason;
      error: string;
      contentType?: string;
      option?: string;
      redirects_page_url?: string;
      conflict_source?: string;
      conflict_from?: string;
      conflict_to?: string;
    };

/** Live-add options only a global `edit_redirects` caller may pass. */
const GLOBAL_ONLY_ADD_OPTIONS = ["isCustomDestination", "before_from", "removed_entry", "priority"] as const;

const STEWARD_HINT = "Ask a Platform Steward (Edit redirects) to change it.";

function refuse(
  status: number,
  reason: PageScopeRefusalReason,
  error: string,
  extra: Partial<Extract<LiveRedirectAuth, { ok: false }>> = {},
): Extract<LiveRedirectAuth, { ok: false }> {
  return { ok: false, status, code: PAGE_SCOPE_REFUSED, reason, error, ...extra };
}

function present(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

/** The page a live add points to, or null when `destUrl` is not a page on this site. */
export function resolveRedirectDestinationPage(
  ci: ContentIndex,
  destUrl: string,
): { contentType: string; slug: string; locale: string } | null {
  const parsed = ci.parseContentUrl(destUrl.split(/[?#]/)[0] ?? destUrl);
  if (!parsed) return null;
  if (!findEntryPresence(ci, parsed.contentType, parsed.slug)) return null;
  return { contentType: parsed.contentType, slug: parsed.slug, locale: parsed.locale };
}

/**
 * The page that owns a redirect source file, from its path relative to the content root
 * (`{directory}/{slug}/{locale}.yml` or `_common.yml`). Null for `custom-redirects.yml`,
 * draft files (`{variant}.{locale}.yml`) and anything else.
 */
export function resolveRedirectSourcePage(
  ci: ContentIndex,
  sourceRelToContentRoot: string,
): { contentType: string; slug: string } | null {
  const parts = sourceRelToContentRoot.split(/[\\/]/).filter(Boolean);
  if (parts.length !== 3) return null;
  const [folder, slug, file] = parts as [string, string, string];
  const stem = file.replace(/\.ya?ml$/, "");
  if (stem === file) return null;
  if (stem !== "_common" && (stem.startsWith("_") || stem.includes("."))) return null;
  const contentType = ci.normalizeType(folder);
  if (!ci.getContentTypeConfig(contentType)) return null;
  if (ci.getFolderName(contentType) !== folder) return null;
  return { contentType, slug };
}

export function isCustomRedirectsFile(sourceRelToContentRoot: string): boolean {
  return sourceRelToContentRoot.replace(/\\/g, "/").replace(/^\/+/, "") === "custom-redirects.yml";
}

/**
 * Decide whether a live redirect add/delete may proceed.
 *
 * - `hasGlobal` (edit_redirects) → existing behavior, no extra checks.
 * - Otherwise page mode: the target must be a page whose content type `canEditPage`
 *   allows, and an add must be a free exact address (same rules as the SEO modal's
 *   simple add). Callers without either capability are refused before this runs.
 */
export function authorizeLiveRedirectWrite(opts: {
  ci: ContentIndex;
  action: "add" | "delete";
  hasGlobal: boolean;
  canEditPage: (contentType: string) => boolean;
  /** Live add: request body (`from`, `to`, options). */
  body?: Record<string, unknown>;
  /** Live delete: source path relative to the content root. */
  sourceRelToContentRoot?: string;
  allowedHosts?: string[];
}): LiveRedirectAuth {
  if (opts.hasGlobal) return { ok: true, mode: "global" };
  const { ci } = opts;

  if (opts.action === "delete") {
    const rel = opts.sourceRelToContentRoot ?? "";
    if (isCustomRedirectsFile(rel)) {
      return refuse(403, "custom_file", `Site-wide redirect rules (custom-redirects.yml) cannot be changed with page access. ${STEWARD_HINT}`);
    }
    const page = resolveRedirectSourcePage(ci, rel);
    if (!page) {
      return refuse(403, "not_a_page", `This redirect is not stored on a live page. ${STEWARD_HINT}`);
    }
    if (!opts.canEditPage(page.contentType)) {
      return refuse(403, "wrong_content_type", `You can only change redirects on pages you manage (${page.contentType} is not one of them).`, {
        contentType: page.contentType,
      });
    }
    return { ok: true, mode: "page", contentType: page.contentType, slug: page.slug };
  }

  const body = opts.body ?? {};
  for (const option of GLOBAL_ONLY_ADD_OPTIONS) {
    if (present(body[option])) {
      return refuse(400, "option_not_allowed", `"${option}" needs Edit redirects. With page access you can only add an exact old address to your page.`, {
        option,
      });
    }
  }

  const destUrl = typeof body.to === "string" ? body.to.trim() : "";
  const dest = destUrl ? resolveRedirectDestinationPage(ci, destUrl) : null;
  if (!dest) {
    return refuse(403, "not_a_page", `The destination is not a page on this site, so the rule would be site-wide. ${STEWARD_HINT}`);
  }
  if (!opts.canEditPage(dest.contentType)) {
    return refuse(403, "wrong_content_type", `You can only add redirects to pages you manage (${dest.contentType} is not one of them).`, {
      contentType: dest.contentType,
    });
  }

  const from = typeof body.from === "string" ? body.from : "";
  const localeHint = typeof body.locale === "string" && body.locale.trim() ? body.locale.trim().toLowerCase() : null;
  const check = checkSimpleRedirectFrom({
    from,
    destUrl,
    locale: resolveDestinationLocale(ci, dest, destUrl, localeHint),
    ci,
    allowedHosts: opts.allowedHosts,
  });
  if (!check.ok) {
    const status = check.code === "invalid_path" ? 400 : 409;
    const takeover = check.code === "live_content" || check.code === "already_redirected" || check.code === "pattern_match";
    return refuse(status, check.code, takeover ? `${check.message} ${STEWARD_HINT}` : check.message, {
      contentType: dest.contentType,
      ...(check.normalizedFrom ? { redirects_page_url: redirectsPageUrl(check.normalizedFrom) } : {}),
      ...(check.conflict_source ? { conflict_source: check.conflict_source } : {}),
      ...(check.conflict_from ? { conflict_from: check.conflict_from } : {}),
      ...(check.conflict_to ? { conflict_to: check.conflict_to } : {}),
    });
  }
  return { ok: true, mode: "page", contentType: dest.contentType, slug: dest.slug, normalizedFrom: check.normalizedFrom };
}

/** Content-root-relative path for a resolved absolute source file. */
export function relToContentRoot(contentRootAbs: string, absPath: string): string {
  return path.relative(contentRootAbs, absPath).split(path.sep).join("/");
}
