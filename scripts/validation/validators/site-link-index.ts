/**
 * Cross-entry validator: rebuild site-wide link-index.json from YAML + DB rows.
 */

import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { liveFilesForSeo } from "../shared/seoValidationScope";
import { entryIdFromContentFile, collectOutboundPathsFromData, collectDbBackedOutboundByEntry } from "../../../server/link-extract";
import { rebuildLinkIndex } from "../../../server/link-index";
import { createPublicUrlResolver } from "../../../server/redirects";
import { contentIndex } from "../../../server/content-index";

export const siteLinkIndexValidator: Validator = {
  name: "site-link-index",
  description:
    "Rebuilds derived link-index.json from all live locale content files and database-backed body fields",
  apiExposed: true,
  estimatedDuration: "medium",
  category: "integrity",
  runClass: "cross-entry",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const contentRoot = context.contentRoot;
    const publicUrls = createPublicUrlResolver(contentIndex);
    const outboundByEntry: Record<string, string[]> = {};

    for (const file of liveFilesForSeo(context)) {
      const locale = file.locale === "_common" ? "en" : file.locale;
      const data = {
        ...(file.entryFields || {}),
      } as Record<string, unknown>;
      const paths = collectOutboundPathsFromData(data, locale, publicUrls);
      const entryId = entryIdFromContentFile(file.type, file.slug, locale);
      outboundByEntry[entryId] = paths;
    }

    const dbOutbound = collectDbBackedOutboundByEntry(contentRoot, publicUrls);
    for (const [entryId, paths] of Object.entries(dbOutbound)) {
      outboundByEntry[entryId] = paths;
    }

    try {
      rebuildLinkIndex(outboundByEntry, contentRoot);
    } catch {
      /* best-effort derived index */
    }

    const entryCount = Object.keys(outboundByEntry).length;
    const duration = Date.now() - startTime;
    return {
      name: this.name,
      description: this.description,
      status: "passed",
      errors: [] as ValidationIssue[],
      warnings: [],
      duration,
      category: this.category,
      artifacts: { entryCount },
    };
  },
};
