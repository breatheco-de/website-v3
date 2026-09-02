import fs from "fs";
import path from "path";
import { Job } from "sidequest";
import {
  invalidateSeoIndexCache,
  rebuildSeoIndex,
  patchSeoIndexAfterLiveWrite,
  loadSeoIndex,
} from "../../seo-index";
import { contentIndex } from "../../content-index";
import { emitEvent } from "../../events/event-store";
import { resolveEffectiveSeo } from "../../seo-effective-seo";
import { localeYamlRelPath } from "../../seo-effective-seo";
import { validateSeoSave } from "../../seo-fields";
import { child } from "../../logger";
import { markJobFinished, markJobStarted } from "../heartbeat";

const log = child({ module: "job:seo-index-refresh" });

export type SeoIndexRefreshPayload = {
  site: string;
  contentRoot: string;
  generation: number;
  mode: "patch" | "rebuild";
  triggeredByEventId?: number;
  entryKeys?: string[];
};

function parseEntryKey(key: string): { contentType: string; slug: string; locale: string } | null {
  const parts = key.split("/");
  if (parts.length < 3) return null;
  return { contentType: parts[0]!, slug: parts[1]!, locale: parts[2]! };
}

export class SeoIndexRefreshJob extends Job {
  async run(payload: SeoIndexRefreshPayload): Promise<{ ok: boolean }> {
    markJobStarted("seo_index_refresh");
    try {
      const { site, contentRoot, mode } = payload;
      const ci = contentIndex;

      if (mode === "rebuild") {
        rebuildSeoIndex({ contentRoot });
      } else {
        const keys = payload.entryKeys ?? [];
        if (keys.length === 0) {
          rebuildSeoIndex({ contentRoot });
        } else {
          for (const key of keys) {
            const parsed = parseEntryKey(key);
            if (!parsed) continue;
            const relFile = localeYamlRelPath(
              parsed.contentType,
              parsed.slug,
              parsed.locale,
              contentRoot,
            );
            const abs = path.isAbsolute(relFile)
              ? relFile
              : path.join(process.cwd(), relFile);
            if (!fs.existsSync(abs)) continue;
            const effective = resolveEffectiveSeo({
              contentType: parsed.contentType,
              slug: parsed.slug,
              locale: parsed.locale,
              contentRoot,
            });
            const validated = validateSeoSave({
              next: effective,
              locale: parsed.locale,
              contentType: parsed.contentType,
              slug: parsed.slug,
              ci,
            });
            if (!validated.ok) continue;
            patchSeoIndexAfterLiveWrite({
              contentRoot,
              contentType: parsed.contentType,
              slug: parsed.slug,
              locale: parsed.locale,
              file: relFile.replace(/\\/g, "/"),
              seo: validated.coerced,
              pillarLive: validated.pillarLive,
              extraWarnings: validated.warnings,
              ci,
            });
          }
        }
      }

      invalidateSeoIndexCache();
      try {
        const index = loadSeoIndex(contentRoot);
        log.info(
          { site, mode, entries: Object.keys(index.entries).length },
          "[SeoIndexRefreshJob] completed",
        );
      } catch {
        /* non-fatal */
      }

      emitEvent({
        site,
        type: "seo_index_ready",
        triggeredByEventId: payload.triggeredByEventId,
        payload: {
          generation: payload.generation,
          mode,
          entryKeys: payload.entryKeys ?? [],
        },
      });

      return { ok: true };
    } finally {
      markJobFinished("seo_index_refresh");
    }
  }
}
