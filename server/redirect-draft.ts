/**
 * A page's own old addresses (`meta.redirects`) staged on one of its drafts.
 * They are never indexed: they take effect when the draft is published, and
 * publish re-checks the addresses it adds.
 */

import fs from "fs";
import path from "path";
import type { ContentIndex } from "./content-index";
import { entryLocaleFilePath } from "./entry-layer";
import { ownLocaleSlug } from "./locale-url-slug";
import { contentRelPath, readPageYaml, writePageYaml } from "./redirect-destination";
import { diffRedirectItems, hasRedirectChanges, normalizeRedirectPath, redirectItems } from "./redirect-items";
import { checkSimpleRedirectFrom } from "./redirect-simple-check";
import { safeDumpYaml, safeLoadYaml } from "./versioning/draft-meta";
import { variantHasTraffic } from "./versioning/variant-traffic";

export type DraftRedirectTarget = {
  contentType: string;
  slug: string;
  variant: string;
  locale: string;
};

export type DraftRedirectError = {
  ok: false;
  status: number;
  code: string;
  error: string;
  details?: Record<string, unknown>;
};

export type DraftRedirectResult =
  | { ok: true; from: string; file: string; alreadyAbsent?: boolean }
  | DraftRedirectError;

type ResolvedDraft = {
  ok: true;
  folderSlug: string;
  draftPath: string;
  livePath: string;
  file: string;
};

function resolveDraft(ci: ContentIndex, t: DraftRedirectTarget): ResolvedDraft | DraftRedirectError {
  if (!/^[a-z0-9-]+$/.test(t.variant) || t.variant === "default") {
    return { ok: false, status: 400, code: "invalid_variant", error: "variant must be a draft name (lowercase letters, numbers, hyphens)." };
  }
  if (!/^[a-z]{2}(-[a-zA-Z]{2})?$/.test(t.locale)) {
    return { ok: false, status: 400, code: "invalid_locale", error: "locale must be a language code (e.g. en, es)." };
  }
  if (!t.contentType || !t.slug) {
    return { ok: false, status: 400, code: "missing_page", error: "content_type and slug are required for draft redirects." };
  }
  const folderSlug = ci.resolveBaseSlug(t.slug, t.contentType);
  const livePath = entryLocaleFilePath(ci, t.contentType, t.slug, t.locale);
  const draftPath = path.join(path.dirname(livePath), `${t.variant}.${t.locale}.yml`);
  const root = path.resolve(ci.contentRoot);
  if (!path.resolve(draftPath).startsWith(root + path.sep)) {
    return { ok: false, status: 400, code: "invalid_path", error: "Invalid draft path." };
  }
  const file = contentRelPath(ci, draftPath);
  if (!fs.existsSync(draftPath)) {
    return {
      ok: false,
      status: 404,
      code: "draft_missing",
      error: `Draft ${file} does not exist. Create the draft first.`,
      details: { file },
    };
  }
  if (
    variantHasTraffic({
      contentType: t.contentType,
      slug: folderSlug,
      locale: t.locale,
      variant: t.variant,
      contentRoot: ci.contentRoot,
    })
  ) {
    return {
      ok: false,
      status: 400,
      code: "draft_has_traffic",
      error:
        `"${t.variant}" is getting visitors (traffic above 0%). Redirects cannot be split between visitors, ` +
        "so old addresses can only be changed on a draft at 0% traffic.",
    };
  }
  return { ok: true, folderSlug, draftPath, livePath, file };
}

/** The page's URL in `locale` today ("" when it is not live in that language). */
export function pageUrlForLocale(ci: ContentIndex, contentType: string, folderSlug: string, locale: string): string {
  return ci.getAlternateUrls(folderSlug, contentType)[locale] ?? "";
}

/**
 * The page's current live address in `locale` when the draft gives the page a
 * different address there; null otherwise.
 */
export function ownRenamedAddress(opts: {
  ci: ContentIndex;
  contentType: string;
  folderSlug: string;
  locale: string;
  draftData: Record<string, unknown> | null;
  liveData: Record<string, unknown> | null;
}): string | null {
  if (!opts.liveData) return null;
  const draftSlug = ownLocaleSlug(opts.draftData);
  if (!draftSlug) return null;
  const liveSlug = ownLocaleSlug(opts.liveData) ?? opts.folderSlug;
  if (draftSlug === liveSlug) return null;
  const url = pageUrlForLocale(opts.ci, opts.contentType, opts.folderSlug, opts.locale);
  return url ? normalizeRedirectPath(url) : null;
}

export function addDraftRedirect(opts: {
  ci: ContentIndex;
  target: DraftRedirectTarget;
  from: string;
  statusCode: number;
  allowedHosts?: string[];
  onWrite?: (absPath: string) => void;
}): DraftRedirectResult {
  const { ci, target } = opts;
  const resolved = resolveDraft(ci, target);
  if (!resolved.ok) return resolved;

  const draft = readPageYaml(resolved.draftPath);
  const live = fs.existsSync(resolved.livePath) ? readPageYaml(resolved.livePath) : null;

  const check = checkSimpleRedirectFrom({
    from: opts.from,
    destUrl: pageUrlForLocale(ci, target.contentType, resolved.folderSlug, target.locale),
    locale: target.locale,
    ci,
    allowedHosts: opts.allowedHosts,
    allowOwnAddress: ownRenamedAddress({
      ci,
      contentType: target.contentType,
      folderSlug: resolved.folderSlug,
      locale: target.locale,
      draftData: draft,
      liveData: live,
    }),
  });
  const from = check.ok ? check.normalizedFrom : normalizeRedirectPath(opts.from);
  if (redirectItems(draft).has(from)) {
    return {
      ok: false,
      status: 409,
      code: "already_in_draft",
      error: `${from} is already an old address on this draft (${resolved.file}).`,
    };
  }
  if (!check.ok) {
    return {
      ok: false,
      status: 409,
      code: check.code,
      error: check.message,
      details: {
        ...(check.conflict_source ? { conflict_source: check.conflict_source } : {}),
        ...(check.conflict_from ? { conflict_from: check.conflict_from } : {}),
        ...(check.conflict_to ? { conflict_to: check.conflict_to } : {}),
      },
    };
  }

  const meta = (draft.meta && typeof draft.meta === "object" ? draft.meta : (draft.meta = {})) as Record<string, unknown>;
  const list = (Array.isArray(meta.redirects) ? meta.redirects : (meta.redirects = [])) as unknown[];
  list.push(opts.statusCode === 302 ? { path: from, status: 302 } : from);
  writePageYaml(resolved.draftPath, draft);
  opts.onWrite?.(resolved.draftPath);
  return { ok: true, from, file: resolved.file };
}

export type SkippedRedirect = { from: string; code: string; message: string };

/**
 * At publish: re-check the old addresses this publish adds to the live file.
 * Conflicting ones are dropped (live routing for them stays as it was); publish goes on.
 */
export function screenPublishedRedirects(opts: {
  ci: ContentIndex;
  contentType: string;
  folderSlug: string;
  locale: string;
  liveRaw: string | null;
  promotedRaw: string;
}): { content: string; changed: boolean; skipped: SkippedRedirect[] } {
  const live = opts.liveRaw ? safeLoadYaml(opts.liveRaw) : null;
  const promoted = safeLoadYaml(opts.promotedRaw);
  if (!promoted) return { content: opts.promotedRaw, changed: false, skipped: [] };

  const changes = diffRedirectItems(live, promoted);
  if (changes.added.length === 0) {
    return { content: opts.promotedRaw, changed: hasRedirectChanges(changes), skipped: [] };
  }
  const allowOwnAddress = ownRenamedAddress({
    ci: opts.ci,
    contentType: opts.contentType,
    folderSlug: opts.folderSlug,
    locale: opts.locale,
    draftData: promoted,
    liveData: live,
  });
  const destUrl = pageUrlForLocale(opts.ci, opts.contentType, opts.folderSlug, opts.locale);
  const skipped: SkippedRedirect[] = [];
  for (const item of changes.added) {
    const check = checkSimpleRedirectFrom({
      from: item.path,
      destUrl,
      locale: opts.locale,
      ci: opts.ci,
      allowOwnAddress,
    });
    if (!check.ok) skipped.push({ from: item.path, code: check.code, message: check.message });
  }

  let content = opts.promotedRaw;
  if (skipped.length > 0) {
    const drop = new Set(skipped.map((s) => s.from));
    const meta = promoted.meta as Record<string, unknown>;
    const kept = (meta.redirects as unknown[]).filter((r) => {
      const [p] = [...redirectItems([r]).keys()];
      return !p || !drop.has(p);
    });
    if (kept.length > 0) meta.redirects = kept;
    else delete meta.redirects;
    if (Object.keys(meta).length === 0) delete promoted.meta;
    content = safeDumpYaml(promoted);
  }
  return { content, changed: hasRedirectChanges(diffRedirectItems(live, promoted)), skipped };
}

export function removeDraftRedirect(opts: {
  ci: ContentIndex;
  target: DraftRedirectTarget;
  from: string;
  onWrite?: (absPath: string) => void;
}): DraftRedirectResult {
  const resolved = resolveDraft(opts.ci, opts.target);
  if (!resolved.ok) return resolved;
  const from = normalizeRedirectPath(opts.from);
  const draft = readPageYaml(resolved.draftPath);
  const meta = draft.meta as Record<string, unknown> | undefined;
  const list = meta && Array.isArray(meta.redirects) ? (meta.redirects as unknown[]) : [];
  const kept = list.filter((r) => !redirectItems([r]).has(from));
  if (kept.length === list.length) return { ok: true, from, file: resolved.file, alreadyAbsent: true };
  meta!.redirects = kept;
  writePageYaml(resolved.draftPath, draft);
  opts.onWrite?.(resolved.draftPath);
  return { ok: true, from, file: resolved.file };
}
