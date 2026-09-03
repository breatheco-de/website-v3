/**
 * SEO cluster / hub graph validator.
 * Pillar paths, orphans, duplicate hubs, and seo: on _common.yml.
 * Funnel intent / focus features stay in seo-intent.
 */

import fs from "fs";
import path from "path";
import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { contentIndex } from "../../../server/content-index";
import { createPublicUrlResolver } from "../../../server/redirects";
import { isClusterRequired, isSeoMonitoringEnabled } from "../../../server/seo-monitoring";
import { loadSeoIndex, seoEntryId } from "../../../server/seo-index";
import { classifyClusterEntry } from "../../../server/seo-cluster-stats";
import { yamlHasSeoKey } from "../../../server/seo-fields";
import { liveFilesForSeo } from "../shared/seoValidationScope";

function effectivePillar(
  seo: NonNullable<ValidationContext["contentFiles"][0]["seo"]>,
): string | null | "opted_out" {
  if (seo.pillar_path === null) return "opted_out";
  const fromPath = typeof seo.pillar_path === "string" ? seo.pillar_path.trim() : "";
  if (fromPath) return fromPath;
  const legacy = typeof seo.pillar === "string" ? seo.pillar.trim() : "";
  if (legacy) return legacy;
  return null;
}

function commonYmlPath(filePath: string): string {
  return path.join(path.dirname(filePath), "_common.yml");
}

function researchMetricPresent(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value);
}

export const seoClusterValidator: Validator = {
  name: "seo-cluster",
  description:
    "Validates SEO cluster graph: pillar hubs, orphans, duplicate pillars, and seo: on _common.yml",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "seo",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    const publicUrls = createPublicUrlResolver(contentIndex);
    const seoIndex = loadSeoIndex(context.contentRoot);
    const orphanIds = new Set(seoIndex.orphans);
    const liveFiles = liveFilesForSeo(context);

    const seen = new Set<string>();
    const pillarRefs = new Map<string, string[]>();
    const commonChecked = new Set<string>();

    // Duplicate pillars: both hubs that claim the same path (from full index).
    const pathOwners = new Map<string, string[]>();
    for (const [id, row] of Object.entries(seoIndex.entries || {})) {
      if (!row.is_pillar) continue;
      const p = (row.path || row.pillar_path || "").trim();
      if (!p) continue;
      const list = pathOwners.get(p) || [];
      list.push(id);
      pathOwners.set(p, list);
    }
    const liveByEntryId = new Map(
      liveFiles.map((f) => [seoEntryId(f.type, f.slug, f.locale), f]),
    );
    for (const [pillarPath, owners] of pathOwners) {
      if (owners.length < 2) continue;
      for (const id of owners) {
        const file = liveByEntryId.get(id);
        const other = owners.filter((o) => o !== id).join(", ");
        errors.push({
          type: "error",
          code: "DUPLICATE_PILLAR",
          message: `Another hub already owns pillar path "${pillarPath}" (${other}).`,
          file: file?.filePath ?? seoIndex.entries[id]?.file,
          suggestion:
            "Keep seo.is_pillar on only one page per URL path, or change the other hub's path",
        });
      }
    }

    for (const file of liveFiles) {
      const key = `${file.slug}:${file.type}:${file.locale}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const monitored = isSeoMonitoringEnabled(file.type, context.contentRoot);
      if (!monitored) continue;

      const requireCluster = isClusterRequired(file.type, context.contentRoot);
      const seo = file.seo;

      // SEO_BLOCK_ON_COMMON_YML — once per folder among monitored live locales
      const commonPath = commonYmlPath(file.filePath);
      if (!commonChecked.has(commonPath)) {
        commonChecked.add(commonPath);
        try {
          if (fs.existsSync(commonPath) && yamlHasSeoKey(fs.readFileSync(commonPath, "utf-8"))) {
            // Fan-out to every live locale file in this folder that is in the run
            const dir = path.dirname(file.filePath);
            for (const sibling of liveFiles) {
              if (path.dirname(sibling.filePath) !== dir) continue;
              if (!isSeoMonitoringEnabled(sibling.type, context.contentRoot)) continue;
              errors.push({
                type: "error",
                code: "SEO_BLOCK_ON_COMMON_YML",
                message: `Shared _common.yml defines seo: for "${sibling.slug}" (${sibling.locale}). Move seo.* to the locale YAML file.`,
                file: sibling.filePath,
                suggestion: "Remove seo: from _common.yml and put cluster fields on en.yml / es.yml",
              });
            }
          }
        } catch {
          // ignore unreadable common
        }
      }

      if (!seo) {
        if (requireCluster) {
          warnings.push({
            type: "warning",
            code: "ORPHAN_PAGE",
            message: `${file.type} page "${file.slug}" (${file.locale}) has no seo block — it belongs to no cluster`,
            file: file.filePath,
            suggestion: "Add a seo: block with pillar_path (hub URL) or pillar_path: null to opt out",
          });
        }
        continue;
      }

      const keyword =
        typeof seo.main_keyword === "string" && seo.main_keyword.trim()
          ? seo.main_keyword.trim()
          : "";
      if (
        keyword &&
        (!researchMetricPresent(seo.kw_monthly_volume) || !researchMetricPresent(seo.kw_difficulty))
      ) {
        warnings.push({
          type: "warning",
          code: "SEO_KEYWORD_RESEARCH_INCOMPLETE",
          message: `${file.type} page "${file.slug}" (${file.locale}) has seo.main_keyword but incomplete keyword research (need seo.kw_monthly_volume and seo.kw_difficulty)`,
          file: file.filePath,
          suggestion:
            "Set integer seo.kw_monthly_volume (≥ 0) and seo.kw_difficulty (0–100) for the main keyword, or clear the keyword",
        });
      }

      if (seo.is_pillar === true) {
        continue;
      }

      const pillar = effectivePillar(seo);
      if (pillar === "opted_out") {
        continue;
      }

      if (pillar) {
        const pillarLocale = file.locale === "_common" ? "en" : file.locale;
        if (!publicUrls.isLive(pillar, pillarLocale)) {
          const hubEntry = Object.values(seoIndex.entries).find(
            (e) => e.path === pillar || e.pillar_path === pillar,
          );
          const reason = hubEntry && !hubEntry.is_pillar ? "hub_not_pillar" : "hub_not_found";
          errors.push({
            type: "error",
            code: "INVALID_PILLAR",
            message:
              reason === "hub_not_pillar"
                ? `seo.pillar_path "${pillar}" resolves to a live page that is not marked as a pillar hub for "${file.slug}" (${file.locale})`
                : `seo.pillar_path "${pillar}" does not resolve to a known pillar hub for "${file.slug}" (${file.locale})`,
            file: file.filePath,
            suggestion:
              reason === "hub_not_pillar"
                ? "Mark the target page as seo.is_pillar: true or pick another hub URL"
                : "Check the pillar URL matches a valid pillar hub in the site",
          });
        } else {
          const refs = pillarRefs.get(pillar) || [];
          refs.push(file.slug);
          pillarRefs.set(pillar, refs);
        }
      } else if (requireCluster) {
        const indexRow = seoIndex.entries[`${file.type}/${file.slug}/${file.locale}`];
        const bucket = indexRow
          ? classifyClusterEntry(indexRow, orphanIds)
          : typeof seo.main_keyword === "string" && seo.main_keyword.trim()
            ? "partiallySet"
            : "unclustered";
        const code = bucket === "partiallySet" ? "PARTIALLY_SET_CLUSTER" : "ORPHAN_PAGE";
        const detail =
          bucket === "partiallySet"
            ? "has seo.main_keyword but no seo.pillar_path"
            : "has no seo.pillar_path — it belongs to no cluster";
        warnings.push({
          type: "warning",
          code,
          message: `${file.type} page "${file.slug}" (${file.locale}) ${detail}`,
          file: file.filePath,
          suggestion: "Set seo.pillar_path to the hub URL, or seo.pillar_path: null to opt out",
        });
      }
    }

    const status = errors.length > 0 ? "failed" : warnings.length > 0 ? "warning" : "passed";

    return {
      name: this.name,
      description: this.description,
      status,
      errors,
      warnings,
      duration: Date.now() - startTime,
      artifacts: {
        pillarClusterSummary: Object.fromEntries(pillarRefs),
        clustersFound: pillarRefs.size,
      },
    };
  },
};
