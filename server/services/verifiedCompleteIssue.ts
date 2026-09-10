/**
 * Verified complete: re-run validators for the issue's entry (and seo-duplicates when needed),
 * soft-complete only if the target id is gone; report siblings cleared on that entry;
 * refuse + record attempt forensics when the issue still reproduces.
 *
 * Legacy v4→v5 synthetic entryKeys (`legacy__…`) cannot be parsed as type/slug/locale.
 * We resolve them via target URL / reverse encoding, revalidate the real entry when found,
 * then soft-complete the legacy row if the code is gone (or if no content matches — orphan).
 */

import { ValidationService } from "../../scripts/validation/service";
import { ENTRY_LOCAL_VALIDATOR_NAMES } from "../../scripts/validation/shared/runClass";
import {
  entryKeyFromContentFile,
  isLegacySyntheticEntryKey,
  parseEntryKey,
  urlFromLegacyEntryKey,
} from "../../scripts/validation/shared/entryKey";
import {
  getCanonicalUrl,
  matchContentFilesForUrl,
  normalizeUrl,
} from "../../scripts/validation/shared/canonicalUrls";
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
import type { ResolvedIssuesArchiveService } from "./resolvedIssuesArchiveService";
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

function issueTargetUrl(issue: StoredValidationIssue, entryKey: string): string | null {
  for (const t of issue.targets) {
    if (t.type === "entry" && t.url) return normalizeUrl(t.url);
  }
  const fromLegacy = urlFromLegacyEntryKey(entryKey);
  return fromLegacy ? normalizeUrl(fromLegacy) : null;
}

async function resolveParseableEntryKey(args: {
  entryKey: string;
  issue: StoredValidationIssue;
  cache: ValidationCacheService;
  contentRoot: string;
  ci: ContentIndex;
}): Promise<
  | { ok: true; entryKey: string }
  | { ok: false; orphan: true; error: string }
  | { ok: false; orphan?: false; error: string }
> {
  if (parseEntryKey(args.entryKey)) {
    return { ok: true, entryKey: args.entryKey };
  }

  const url = issueTargetUrl(args.issue, args.entryKey);
  if (!url) {
    return {
      ok: false,
      orphan: true,
      error: `Cannot parse entryKey and no URL to resolve: ${args.entryKey}`,
    };
  }

  const mapped = args.cache.resolveEntryKeyFromUrl(url);
  if (mapped && parseEntryKey(mapped)) {
    return { ok: true, entryKey: mapped };
  }

  const service = new ValidationService();
  await service.buildContext({ contentRoot: args.contentRoot, ci: args.ci });
  const context = service.getContext();
  if (!context) {
    return { ok: false, error: "No validation context" };
  }

  const matched = matchContentFilesForUrl(context.contentFiles, url);
  const live = matched.find((f) => !f.variant) ?? matched[0];
  if (!live) {
    return {
      ok: false,
      orphan: true,
      error: `No content entry matches ${url} (legacy cache key ${args.entryKey})`,
    };
  }
  return { ok: true, entryKey: entryKeyFromContentFile(live) };
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

async function softCompleteSuccess(args: {
  cache: ValidationCacheService;
  issueId: string;
  author: string;
  actor?: ValidationIssueActor;
  report?: string;
  auto_completed_ids?: string[];
}): Promise<VerifiedCompleteResult> {
  const completed = await args.cache.completeIssue(
    args.issueId,
    args.author,
    args.actor,
    args.report,
  );
  if (!completed.ok) {
    return { ok: false, error: completed.error, code: "complete_failed", status: 404 };
  }
  return {
    ok: true,
    action: "complete",
    completed: completionToApiRow(completed.completion),
    claimed: null,
    auto_completed_ids: args.auto_completed_ids ?? [],
  };
}

/**
 * Re-validate then complete (or refuse with attempt forensics).
 */
export async function verifiedCompleteIssue(args: {
  cache: ValidationCacheService;
  archive?: ResolvedIssuesArchiveService | null;
  ci: ContentIndex;
  contentRoot: string;
  issueId: string;
  author: string;
  actor?: ValidationIssueActor;
  report?: string;
  agent_session_id?: string;
}): Promise<VerifiedCompleteResult> {
  const { cache, archive, issueId, author, actor, report, agent_session_id } = args;
  const issue = cache.getIssueById(issueId);
  if (!issue) {
    return { ok: false, error: `Unknown issue id: ${issueId}`, code: "unknown_issue", status: 404 };
  }

  const entryKeys = entryKeysForIssue(issue);
  const primaryEntryKey = entryKeys[0];
  const openBeforeIssues =
    primaryEntryKey != null
      ? cache.getOpenIssuesByEntryKey(primaryEntryKey)
      : [issue];
  const snapshotById = new Map(openBeforeIssues.map((i) => [i.id, i]));
  const openBefore = openBeforeIssues.map((i) => i.id);
  const legacyKey = Boolean(primaryEntryKey && isLegacySyntheticEntryKey(primaryEntryKey));

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
    let keyForRevalidate = primaryEntryKey;
    if (!parseEntryKey(primaryEntryKey)) {
      const resolved = await resolveParseableEntryKey({
        entryKey: primaryEntryKey,
        issue,
        cache,
        contentRoot: args.contentRoot,
        ci: args.ci,
      });
      if (!resolved.ok) {
        if (resolved.orphan) {
          // Migration orphan with no matching content — dismiss instead of parse error.
          return softCompleteSuccess({
            cache,
            issueId,
            author,
            actor,
            report:
              report ??
              "Dismissed legacy validation cache issue (no matching content entry to re-check).",
          });
        }
        return { ok: false, error: resolved.error, code: "revalidate_failed", status: 500 };
      }
      keyForRevalidate = resolved.entryKey;
    }

    const local = await applyEntryLocalRevalidation({
      contentRoot: args.contentRoot,
      ci: args.ci,
      cache,
      entryKey: keyForRevalidate,
    });
    if (!local.ok) {
      return { ok: false, error: local.error, code: "revalidate_failed", status: 500 };
    }

    // Legacy rows are not rewritten by applyValidatorResults on the real entryKey.
    // If the same code is gone on the resolved entry, soft-complete the legacy issue.
    if (legacyKey && cache.getIssueById(issueId)) {
      const stillOnResolved = cache
        .getOpenIssuesByEntryKey(keyForRevalidate)
        .some((i) => i.code === issue.code);
      if (!stillOnResolved) {
        return softCompleteSuccess({
          cache,
          issueId,
          author,
          actor,
          report,
        });
      }
      // Same code still open on the real entry — fall through to refuse below.
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

  const archiveClearedIssues = (): StoredValidationIssue[] => {
    const clearedIds = openBefore.filter((id) => !openAfter.has(id));
    const out: StoredValidationIssue[] = [];
    for (const id of clearedIds) {
      const snap = snapshotById.get(id);
      if (snap) out.push(snap);
    }
    if (out.length === 0 && !openAfter.has(issueId)) {
      out.push(issue);
    }
    return out;
  };

  const archiveReport =
    report ?? (actor?.type !== "mcp" ? "Marked fixed in UI." : undefined);

  const writeArchive = async () => {
    if (!archive) return;
    const issues = archiveClearedIssues().filter((i) => !cache.getIssueById(i.id));
    if (issues.length === 0) return;
    await archive.appendResolvedBatch(issues, {
      resolvedBy: author,
      actor,
      report: archiveReport,
      agent_session_id,
      resolution: "verified_gone",
    });
  };

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
    await writeArchive();
    return {
      ok: true,
      action: "complete",
      completed: completionToApiRow(completed.completion),
      claimed: null,
      auto_completed_ids,
    };
  }

  await writeArchive();

  return {
    ok: true,
    action: "complete",
    completed: completionToApiRow(completion),
    claimed: null,
    auto_completed_ids,
  };
}
