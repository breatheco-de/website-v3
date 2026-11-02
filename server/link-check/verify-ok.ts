/**
 * "This link works": mark one external URL as verified on every page that uses it, then
 * re-run the external-links validator for those pages so their issues clear right away.
 */

import { ValidationService } from "../../scripts/validation/service";
import { entryKeyFromContentFile } from "../../scripts/validation/shared/entryKey";
import type { StoredValidationIssue } from "../../scripts/validation/shared/types";
import { EXTERNAL_LINKS_VALIDATOR_NAME } from "../../scripts/validation/validators/external-links.issueCodes";
import type { ContentIndex } from "../content-index";
import type { ValidationCacheService } from "../services/validationCacheService";
import { getEntriesForExternalUrl } from "../link-index";
import { clearVerifiedOk, setVerifiedOk, type LinkStatusRecord } from "./status-store";

/** Issue codes "This link works" applies to (dead own-storage images are not overridable). */
export const VERIFY_OK_CODES = new Set(["EXTERNAL_LINK_GONE", "EXTERNAL_LINK_UNREACHABLE"]);

export type VerifyOkResult = {
  url: string;
  record: LinkStatusRecord | null;
  entry_keys: string[];
  cleared_issue_ids: string[];
};

function openIssuesForUrl(cache: ValidationCacheService, url: string): StoredValidationIssue[] {
  return cache.getAllIssues().filter((i) => VERIFY_OK_CODES.has(i.code) && i.externalLink?.url === url);
}

function entryKeysFor(issues: StoredValidationIssue[], url: string, contentRoot: string): string[] {
  const keys = new Set(getEntriesForExternalUrl(url, contentRoot));
  for (const issue of issues) {
    for (const t of issue.targets) if (t.type === "entry" && t.entryKey) keys.add(t.entryKey);
  }
  return [...keys].sort();
}

async function revalidate(args: {
  cache: ValidationCacheService;
  ci: ContentIndex;
  contentRoot: string;
  entryKeys: string[];
}): Promise<void> {
  if (args.entryKeys.length === 0) return;
  const service = new ValidationService();
  await service.buildContext({ contentRoot: args.contentRoot, ci: args.ci });
  const context = service.getContext();
  if (!context) return;
  const wanted = new Set(args.entryKeys);
  const allFiles = context.contentFiles;
  const filtered = allFiles.filter((f) => wanted.has(entryKeyFromContentFile(f)));
  if (filtered.length === 0) return;
  context.contentFiles = filtered;
  try {
    const result = await service.runValidators({ validators: [EXTERNAL_LINKS_VALIDATOR_NAME], includeArtifacts: false });
    args.cache.applyValidatorResults(result.validators, {
      contentFiles: allFiles,
      entryKeys: filtered.map((f) => entryKeyFromContentFile(f)),
      markSiteWide: false,
    });
    await args.cache.flush();
  } finally {
    context.contentFiles = allFiles;
  }
}

export async function markExternalLinkOk(args: {
  cache: ValidationCacheService;
  ci: ContentIndex;
  contentRoot: string;
  url: string;
  by: string;
  reason: string;
}): Promise<VerifyOkResult> {
  const before = openIssuesForUrl(args.cache, args.url);
  const entryKeys = entryKeysFor(before, args.url, args.contentRoot);
  const record = setVerifiedOk(args.contentRoot, args.url, { by: args.by, reason: args.reason });
  await revalidate({ cache: args.cache, ci: args.ci, contentRoot: args.contentRoot, entryKeys });
  const after = new Set(openIssuesForUrl(args.cache, args.url).map((i) => i.id));
  return {
    url: args.url,
    record,
    entry_keys: entryKeys,
    cleared_issue_ids: before.map((i) => i.id).filter((id) => !after.has(id)),
  };
}

/** Remove the mark; the URL is flagged again on the next pass if its saved check is still dead. */
export async function unmarkExternalLinkOk(args: {
  cache: ValidationCacheService;
  ci: ContentIndex;
  contentRoot: string;
  url: string;
}): Promise<{ url: string; removed: boolean; entry_keys: string[] }> {
  const removed = clearVerifiedOk(args.contentRoot, args.url);
  const entryKeys = entryKeysFor([], args.url, args.contentRoot);
  if (removed) await revalidate({ cache: args.cache, ci: args.ci, contentRoot: args.contentRoot, entryKeys });
  return { url: args.url, removed, entry_keys: entryKeys };
}
