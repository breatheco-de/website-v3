/**
 * Delete confirmation preview — CMS entries that link to URLs being removed.
 */

import { contentIndex } from "./content-index";
import {
  getReferrersForTargetPath,
  loadLinkIndex,
  normalizeReferrerTargetPath,
} from "./link-index";

export type DeleteReferrerPreview = {
  entryKey: string;
  url?: string;
  title?: string;
};

export function getDeleteReferrersPreview(opts: {
  contentType: string;
  slug: string;
  locales?: string[];
  contentRoot?: string;
  limit?: number;
}): {
  targetUrls: string[];
  referrers: DeleteReferrerPreview[];
  indexUpdatedAt: string | null;
  suggestions: string[];
} {
  const { contentType, slug, contentRoot } = opts;
  const localeFilter =
    opts.locales && opts.locales.length > 0 ? new Set(opts.locales) : null;
  const limit = opts.limit ?? 25;

  const altUrls = contentIndex.getAlternateUrls(slug, contentType);
  const targetUrls: string[] = [];
  for (const [locale, url] of Object.entries(altUrls)) {
    if (!url) continue;
    if (localeFilter && !localeFilter.has(locale)) continue;
    targetUrls.push(normalizeReferrerTargetPath(url));
  }

  const seenReferrers = new Set<string>();
  const referrers: DeleteReferrerPreview[] = [];

  for (const targetUrl of [...new Set(targetUrls)]) {
    const batch = getReferrersForTargetPath(targetUrl, contentRoot, { limit });
    for (const ref of batch.referrers) {
      if (seenReferrers.has(ref.entryKey)) continue;
      seenReferrers.add(ref.entryKey);
      referrers.push(ref);
      if (referrers.length >= limit) break;
    }
    if (referrers.length >= limit) break;
  }

  const index = loadLinkIndex(contentRoot);
  const suggestions: string[] = [];
  if (referrers.length > 0) {
    suggestions.push(
      "Update or remove internal links in the listed entries before delete, or add redirects for the deleted URL(s).",
    );
    if (targetUrls[0]) {
      suggestions.push(`Consider a redirect from ${targetUrls[0]} to a replacement page.`);
    }
  } else if (targetUrls.length === 0) {
    suggestions.push(
      "No public URLs found for this entry — referrer preview may be incomplete until index refresh.",
    );
  }

  return {
    targetUrls: [...new Set(targetUrls)],
    referrers,
    indexUpdatedAt: index.updated_at ?? null,
    suggestions,
  };
}
