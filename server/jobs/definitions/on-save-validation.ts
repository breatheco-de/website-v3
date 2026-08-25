import fs from "fs";
import path from "path";
import { Job } from "sidequest";
import { ContentIndex } from "../../content-index";
import { MediaGallery } from "../../media-gallery";
import { DatabaseManager } from "../../database";
import { ValidationService } from "../../../scripts/validation/service";
import { ENTRY_LOCAL_VALIDATOR_NAMES } from "../../../scripts/validation/shared/runClass";
import { entryKeyFromContentFile } from "../../../scripts/validation/shared/entryKey";
import type { ContentFile } from "../../../scripts/validation/shared/types";
import { ValidationCacheService } from "../../services/validationCacheService";
import {
  emitEvent,
  getEventById,
  getLatestWriteForEntry,
  listOpenWritesForEntry,
} from "../../events/event-store";
import { takePendingValidationWriteId } from "../../pipeline-state";
import { child } from "../../logger";

const log = child({ module: "job:on-save-validation" });

export type OnSaveValidationPayload = {
  site: string;
  contentRoot: string;
  entryKey: string;
  contentType: string;
  slug: string;
  locale: string;
  variant?: string;
  /** content_file_written id that enqueued this job — ready must close this write. */
  writeEventId?: number;
};

export function filterContentFilesForEntry(
  files: ContentFile[],
  opts: { contentType: string; slug: string; locale: string; variant?: string },
): ContentFile[] {
  const { contentType, slug, locale, variant } = opts;
  const localeMatches = (f: ContentFile) =>
    f.locale === locale || (locale === "en" && f.locale === "_common");

  const hasLiveLayer = files.some(
    (f) =>
      f.type === contentType &&
      f.slug === slug &&
      localeMatches(f) &&
      !f.variant,
  );

  return files.filter((f) => {
    if (f.type !== contentType || f.slug !== slug) return false;
    if (!localeMatches(f)) return false;
    if (variant) return f.variant === variant;
    if (!f.variant) return true;
    // Draft-only entry: include variant rows when no live locale file exists.
    return !hasLiveLayer;
  });
}

/**
 * Emit validation_results_ready for the triggering write (and any other still-open
 * writes for the same entry so the pipeline UI cannot spin on orphans).
 */
export function emitValidationSettled(
  site: string,
  entryKey: string,
  resource: { contentType: string; slug: string; locale: string },
  payload: {
    resultsPath?: string;
    skipped?: boolean;
    reason?: string;
    summary?: {
      total: number;
      passed: number;
      failed: number;
      warnings: number;
      duration: number;
    };
  },
  writeEventId?: number,
): void {
  const primary =
    (typeof writeEventId === "number" ? getEventById(site, writeEventId) : null) ??
    getLatestWriteForEntry(site, resource);

  emitEvent({
    site,
    type: "validation_results_ready",
    triggeredByEventId: primary?.id,
    attribution: primary?.attribution ?? [],
    resource: { ...resource, path: primary?.resource.path },
    payload: { entryKey, ...payload },
  });

  const openWrites = listOpenWritesForEntry(site, resource);
  for (const w of openWrites) {
    if (primary && w.id === primary.id) continue;
    emitEvent({
      site,
      type: "validation_results_ready",
      triggeredByEventId: w.id,
      attribution: w.attribution,
      resource: { ...resource, path: w.resource.path },
      payload: {
        entryKey,
        skipped: true,
        reason: "closed_with_validation_settle",
      },
    });
  }
}

export class OnSaveValidationJob extends Job {
  async run(payload: OnSaveValidationPayload): Promise<{ ok: boolean }> {
    const { site, contentRoot, contentType, slug, locale, variant } = payload;
    const resource = { contentType, slug, locale };
    const writeEventId =
      payload.writeEventId ?? takePendingValidationWriteId(site, payload.entryKey) ?? undefined;
    const contentRootName = path.relative(process.cwd(), contentRoot);
    const mg = new MediaGallery(contentRootName);
    const database = new DatabaseManager(contentRoot, mg);
    const ci = new ContentIndex(contentRootName, database);
    ci.scanFast();

    const cache = new ValidationCacheService(contentRoot);
    cache.setSkipGcsUpload(true);

    const service = new ValidationService();
    await service.buildContext({ contentRoot, ci });
    const context = service.getContext();
    if (!context) {
      emitValidationSettled(
        site,
        payload.entryKey,
        resource,
        {
          skipped: true,
          reason: "no_validation_context",
        },
        writeEventId,
      );
      log.warn({ site, entryKey: payload.entryKey }, "[OnSaveValidationJob] no validation context");
      return { ok: false };
    }

    const filtered = filterContentFilesForEntry(context.contentFiles, {
      contentType,
      slug,
      locale,
      variant,
    });
    if (filtered.length === 0) {
      emitValidationSettled(
        site,
        payload.entryKey,
        resource,
        {
          skipped: true,
          reason: "no_matching_files",
        },
        writeEventId,
      );
      log.warn(
        { site, entryKey: payload.entryKey, contentType, slug, locale, variant },
        "[OnSaveValidationJob] no content files matched entry",
      );
      return { ok: false };
    }

    context.contentFiles = filtered;
    const result = await service.runValidators({
      validators: [...ENTRY_LOCAL_VALIDATOR_NAMES],
      includeArtifacts: false,
    });

    const resultsDir = path.join(contentRoot, ".cache", "validation-results");
    fs.mkdirSync(resultsDir, { recursive: true });
    const resultsPath = path.join(resultsDir, `${payload.entryKey.replace(/[/:@]/g, "_")}.json`);
    const entryKeys = filtered.map((f) => entryKeyFromContentFile(f));
    const resultPayload = {
      validators: result.validators,
      entryKeys,
      contentRoot,
      summary: result.summary,
    };
    fs.writeFileSync(resultsPath, JSON.stringify(resultPayload), "utf-8");

    emitValidationSettled(
      site,
      payload.entryKey,
      resource,
      {
        resultsPath,
        summary: result.summary,
      },
      writeEventId,
    );

    log.info(
      { site, entryKey: payload.entryKey, writeEventId },
      "[OnSaveValidationJob] results written",
    );
    return { ok: true };
  }
}
