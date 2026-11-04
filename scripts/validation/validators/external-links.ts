/**
 * External links and images: reports URLs whose saved check (`link-status.json`) is
 * confirmed dead. Offline by design — the diagnostics worker refreshes statuses before
 * validators run; save, publish and verify-complete never make network requests here.
 */

import type {
  ExternalLinkIssueDetails,
  ValidationContext,
  ValidationIssue,
  Validator,
  ValidatorResult,
} from "../shared/types";
import { liveFilesForSeo } from "../shared/seoValidationScope";
import { entryLinkSource } from "../shared/entryLinkSource";
import { entryIdFromContentFile, extractExternalLinkHits } from "../../../server/link-extract";
import { isOwnMediaUrl, ownHostsForContentRoot, ownMediaBuckets } from "../../../server/link-check/hosts";
import { invertExternalLinks } from "../../../server/link-index";
import {
  isConfirmedGone,
  isConfirmedUnreachable,
  loadLinkStatus,
  type LinkStatusRecord,
} from "../../../server/link-check/status-store";
import { EXTERNAL_LINKS_ISSUE_CODES, EXTERNAL_LINKS_VALIDATOR_NAME } from "./external-links.issueCodes";

export function archiveLookupUrl(url: string): string {
  return `https://web.archive.org/web/${url}`;
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

function details(
  url: string,
  fieldPaths: string[],
  media: "link" | "image",
  rec: LinkStatusRecord,
  status: "gone" | "unreachable",
  others: number,
): ExternalLinkIssueDetails {
  return {
    url,
    field_paths: fieldPaths,
    media,
    status,
    ...(rec.reason ? { reason: rec.reason } : {}),
    ...(rec.http_status !== undefined ? { http_status: rec.http_status } : {}),
    ...(rec.final_url ? { final_url: rec.final_url } : {}),
    checked_at: rec.checked_at,
    gone_streak: rec.gone_streak,
    unreachable_streak: rec.unreachable_streak,
    other_entries_using_url: others,
    archive_lookup: archiveLookupUrl(url),
  };
}

function alsoUsed(others: number): string {
  return others > 0 ? ` Also used on ${others} other page${others === 1 ? "" : "s"}.` : "";
}

export const externalLinksValidator: Validator = {
  name: EXTERNAL_LINKS_VALIDATOR_NAME,
  description:
    "Flags external links and images whose saved check is confirmed dead (not found, sent to the homepage, or unreachable). Reads saved results only.",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "content",
  issueCodes: EXTERNAL_LINKS_ISSUE_CODES,

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const contentRoot = context.contentRoot;
    const ownHosts = ownHostsForContentRoot(contentRoot);
    const buckets = ownMediaBuckets();
    const statuses = loadLinkStatus(contentRoot).urls;
    const usage = invertExternalLinks(contentRoot);
    let linksChecked = 0;

    for (const file of liveFilesForSeo(context)) {
      const locale = file.locale === "_common" ? "en" : file.locale;
      const entryId = entryIdFromContentFile(file.type, file.slug, locale);
      const byUrl = new Map<string, { fields: string[]; media: "link" | "image" }>();
      for (const hit of extractExternalLinkHits(entryLinkSource(file), { ownHosts })) {
        const row = byUrl.get(hit.url) ?? { fields: [], media: hit.media };
        if (!row.fields.includes(hit.fieldPath)) row.fields.push(hit.fieldPath);
        if (hit.media === "image") row.media = "image";
        byUrl.set(hit.url, row);
      }

      for (const [url, { fields, media }] of byUrl) {
        linksChecked++;
        const rec = statuses[url];
        if (!rec || rec.verified_ok) continue;
        const others = (usage.get(url) ?? []).filter((id) => id !== entryId).length;
        const where = `Found at ${fields.join(", ")}.`;

        if (media === "image" && isOwnMediaUrl(url, buckets)) {
          if (rec.status === "gone" && rec.reason === "not_found") {
            errors.push({
              type: "error",
              code: "OWN_MEDIA_GONE",
              message: `Image missing from our storage: ${url} (not found, checked ${day(rec.checked_at)}).${alsoUsed(others)}`,
              file: file.filePath,
              suggestion: `${where} Upload the image again or pick another, then update the field.`,
              externalLink: details(url, fields, media, rec, "gone", others),
            });
          }
          continue;
        }

        if (isConfirmedGone(rec)) {
          const homepage = rec.reason === "redirected_to_home";
          warnings.push({
            type: "warning",
            code: "EXTERNAL_LINK_GONE",
            message: homepage
              ? `External link now sends visitors to the site's homepage: ${url} (checked ${rec.gone_streak} times, last ${day(rec.checked_at)}).${alsoUsed(others)}`
              : `External ${media === "image" ? "image" : "page"} no longer exists: ${url} (not found ${rec.gone_streak} times, last ${day(rec.checked_at)}).${alsoUsed(others)}`,
            file: file.filePath,
            suggestion: `${where} Replace it with a live source or an archived copy (${archiveLookupUrl(url)}), or remove it. If it works for visitors, mark it as working.`,
            externalLink: details(url, fields, media, rec, "gone", others),
          });
        } else if (isConfirmedUnreachable(rec)) {
          warnings.push({
            type: "warning",
            code: "EXTERNAL_LINK_UNREACHABLE",
            message: `External site could not be reached: ${url} (${rec.error ?? "domain or certificate failure"}, ${rec.unreachable_streak} checks, last ${day(rec.checked_at)}).${alsoUsed(others)}`,
            file: file.filePath,
            suggestion: `${where} Open it yourself: replace or remove it if the site is gone, or mark it as working if it opens normally.`,
            externalLink: details(url, fields, media, rec, "unreachable", others),
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
      category: this.category,
      artifacts: { linksChecked },
    };
  },
};
