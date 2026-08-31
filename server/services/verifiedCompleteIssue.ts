/**
 * Verified complete: re-run validators for the issue's entry (and seo-duplicates when needed),
 * soft-complete only if the target id is gone; report siblings cleared on that entry;
 * refuse + record attempt forensics when the issue still reproduces.
 */

import { ValidationService } from "../../scripts/validation/service";
import { ENTRY_LOCAL_VALIDATOR_NAMES } from "../../scripts/validation/shared/runClass";
import {
  entryKeyFromContentFile,
  parseEntryKey,
} from "../../scripts/validation/shared/entryKey";
import { getCanonicalUrl } from "../../scripts/validation/shared/canonicalUrls";
import { filterContentFilesForEntry } from "../jobs/definitions/on-save-validation";
import type { ContentIndex } from "../content-index";
import type {
  StoredValidationIssue,
  ValidationIssueActor,
  ValidationIssueAttempt,
  ValidationIssueCompletion,
} from "../../scripts/validation/shared/types";
import {
  ValidationCacheService,
  completionToApiRow,
} from "./validationCacheService";
import { child } from "../logger";

const log = child({ module: "verifiedCompleteIssue" });

const DUPLICATE_CODES = new Set(["DUPLICATE_TITLE", "DUPLICATE_DESCRIPTION"]);

export type VerifiedCompleteResult =
  | {
      ok: true;
      action: "complete";
      completed: ReturnType<typeof completionToApiRow>;
      claimed: null;
      auto_completed_ids: string[];
    }
  | {
      ok: false;
      error: string;
      code: string;
      status: number;
      attempt?: ValidationIssueAttempt | null;
      issue?: StoredValidationIssue;
    };

function entryKeysForIssue(issue: StoredValidationIssue): string[] {
  const keys: string[] = [];
  for (const t of issue.targets) {
    if (t.type === "entry" && t.entryKey) keys.push(t.entryKey);
  }
  return keys;
}

async function applyEntryLocalRevalidation(args: {
  contentRoot: string;
  ci: ContentIndex;
  cache: ValidationCacheService;
  entryKey: string;
}): Promise<{ ok: true; entryKeys: string[] } | { ok: false; error: string }> {
  const parsed = parseEntryKey(args.entryKey);
  if (!parsed) {
    return { ok: false, error: `Cannot parse entryKey: ${args.entryKey}` };
  }

  const service = new ValidationService();
  await service.buildContext({ contentRoot: args.contentRoot, ci: args.ci });
  const context = service.getContext();
  if (!context) {
    return { ok: false, error: "No validation context" };
  }

  const allFiles = context.contentFiles;
  const filtered = filterContentFilesForEntry(allFiles, parsed);
  if (filtered.length === 0) {
    return { ok: false, error: `No content files matched entry ${args.entryKey}` };
  }

  const entryKeys = filtered.map((f) => entryKeyFromContentFile(f));
  context.contentFiles = filtered;
  try {
    const result = await service.runValidators({
      validators: [...ENTRY_LOCAL_VALIDATOR_NAMES],
      includeArtifacts: false,
    });
    context.contentFiles = allFiles;
    for (const file of filtered) {
      if (!file.variant) {
        args.cache.registerUrl(getCanonicalUrl(file), entryKeyFromContentFile(file));
      }
    }
    args.cache.applyValidatorResults(result.validators, {
      contentFiles: allFiles,
      entryKeys,
      markSiteWide: false,
    });
    await args.cache.flush();
    return { ok: true, entryKeys };
  } catch (err) {
    context.contentFiles = allFiles;
    log.warn({ err, entryKey: args.entryKey }, "[VerifiedComplete] Entry-local revalidate failed");
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function applySeoDuplicatesRevalidation(args: {
  contentRoot: string;
  ci: ContentIndex;
  cache: ValidationCacheService;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const service = new ValidationService();
  await service.buildContext({ contentRoot: args.contentRoot, ci: args.ci });
  const context = service.getContext();
  if (!context) {
    return { ok: false, error: "No validation context" };
  }
  try {
    const result = await service.runValidators({
      validators: ["seo-duplicates"],
      includeArtifacts: false,
    });
    args.cache.applyValidatorResults(result.validators, {
      contentFiles: context.contentFiles,
      markSiteWide: true,
    });
    await args.cache.flush();
    return { ok: true };
  } catch (err) {
    log.warn({ err }, "[VerifiedComplete] seo-duplicates revalidate failed");
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function clearedSiblingIds(
  openBefore: string[],
  openAfter: Set<string>,
  excludeId: string,
): string[] {
  return openBefore.filter((id) => id !== excludeId && !openAfter.has(id));
}

/**
 * Re-validate then complete (or refuse with attempt forensics).
 */
export async function verifiedCompleteIssue(args: {
  cache: ValidationCacheService;
  ci: ContentIndex;
  contentRoot: string;
  issueId: string;
  author: string;
  actor?: ValidationIssueActor;
  report?: string;
  agent_session_id?: string;
}): Promise<VerifiedCompleteResult> {
  const { cache, issueId, author, actor, report, agent_session_id } = args;
  const issue = cache.getIssueById(issueId);
  if (!issue) {
    return { ok: false, error: `Unknown issue id: ${issueId}`, code: "unknown_issue", status: 404 };
  }

  const entryKeys = entryKeysForIssue(issue);
  const primaryEntryKey = entryKeys[0];
  const openBefore =
    primaryEntryKey != null
      ? cache.getOpenIssuesByEntryKey(primaryEntryKey).map((i) => i.id)
      : [issueId];

  if (DUPLICATE_CODES.has(issue.code)) {
    const dup = await applySeoDuplicatesRevalidation({
      contentRoot: args.contentRoot,
      ci: args.ci,
      cache,
    });
    if (!dup.ok) {
      return { ok: false, error: dup.error, code: "revalidate_failed", status: 500 };
    }
  } else if (primaryEntryKey) {
    const local = await applyEntryLocalRevalidation({
      contentRoot: args.contentRoot,
      ci: args.ci,
      cache,
      entryKey: primaryEntryKey,
    });
    if (!local.ok) {
      return { ok: false, error: local.error, code: "revalidate_failed", status: 500 };
    }
  } else {
    return {
      ok: false,
      error:
        "Cannot verify complete: issue has no entry target for revalidation. Run site diagnostics first.",
      code: "complete_unverified",
      status: 400,
      issue,
    };
  }

  const stillPresent = cache.getIssueById(issueId);
  if (stillPresent) {
    const existingClaim = cache.getActiveClaim(issueId);
    const attempt = cache.recordCompleteRejectedAttempt(issueId, {
      by: author,
      claimedBy: existingClaim?.claimedBy,
      actor,
      report,
      claimedAt: existingClaim?.claimedAt,
      claimReport: existingClaim?.report,
      agent_session_id,
    });
    await cache.flush();
    return {
      ok: false,
      error: "Issue still present after revalidation — complete refused",
      code: "complete_rejected_still_open",
      status: 409,
      attempt,
      issue: stillPresent,
    };
  }

  const openAfter = new Set(
    primaryEntryKey != null
      ? cache.getOpenIssuesByEntryKey(primaryEntryKey).map((i) => i.id)
      : [],
  );
  const auto_completed_ids = clearedSiblingIds(openBefore, openAfter, issueId);

  // Target row was removed by revalidation — soft-complete overlay is optional audit;
  // completeIssue requires the row. Record a synthetic completion for the API envelope.
  const completion: ValidationIssueCompletion = {
    completedBy: author,
    completedAt: new Date().toISOString(),
    ...(actor ? { actor } : {}),
    ...(report ? { report } : {}),
  };
  // If somehow the id was re-inserted, soft-complete it; otherwise just return success.
  if (cache.getIssueById(issueId)) {
    const completed = await cache.completeIssue(issueId, author, actor, report);
    if (!completed.ok) {
      return { ok: false, error: completed.error, code: "complete_failed", status: 404 };
    }
    // Soft-complete any sibling that still has a row but is no longer "open" (shouldn't happen)
    for (const id of auto_completed_ids) {
      if (cache.getIssueById(id) && !cache.isIssueCompleted(id)) {
        await cache.completeIssue(id, author, actor, report);
      }
    }
    return {
      ok: true,
      action: "complete",
      completed: completionToApiRow(completed.completion),
      claimed: null,
      auto_completed_ids,
    };
  }

  return {
    ok: true,
    action: "complete",
    completed: completionToApiRow(completion),
    claimed: null,
    auto_completed_ids,
  };
}
