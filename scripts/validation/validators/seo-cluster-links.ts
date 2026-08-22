/**
 * SEO cluster bidirectional in-body links (hub ↔ members).
 * Entry-local so slug-scoped diagnostics recheck the page being edited.
 */

import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { contentIndex } from "../../../server/content-index";
import { loadSeoIndex, seoEntryId } from "../../../server/seo-index";
import { isSeoMonitoringEnabled } from "../../../server/seo-monitoring";
import { liveFilesForSeo } from "../shared/seoValidationScope";
import {
  CLUSTER_LINK_ANCHOR_ONLY_HINT,
  collectInternalPathsFromData,
} from "../../../server/cluster-hub-links";
import {
  checkHubOutboundLinks,
  checkMemberBackLink,
  HUB_MISSING_MEMBER_LINKS,
  MEMBER_MISSING_HUB_LINK,
} from "../../../server/seo-cluster-link-check";
import { patchLinkIndexOutbound } from "../../../server/link-index";

export const seoClusterLinksValidator: Validator = {
  name: "seo-cluster-links",
  description:
    "Validates bidirectional SEO cluster links: hub pages link to members; members link back to the hub (anchors / url fields / markdown only)",
  apiExposed: true,
  estimatedDuration: "medium",
  category: "seo",
  runClass: "entry-local",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const contentRoot = context.contentRoot;
    const index = loadSeoIndex(contentRoot);
    const liveFiles = liveFilesForSeo(context);
    let hubsChecked = 0;
    let membersChecked = 0;

    for (const file of liveFiles) {
      if (!isSeoMonitoringEnabled(file.type, contentRoot)) continue;

      const seo = file.seo || {};
      if (seo.pillar_path === null) continue;

      const id = seoEntryId(file.type, file.slug, file.locale);
      const row = index.entries[id];
      const pageData = (file.entryFields && typeof file.entryFields === "object"
        ? { ...file.entryFields, seo: file.seo ?? (file.entryFields as { seo?: unknown }).seo }
        : { seo: file.seo }) as Record<string, unknown>;

      const fromData = collectInternalPathsFromData(pageData);
      if (fromData.length) {
        try {
          patchLinkIndexOutbound(id, fromData, contentRoot);
        } catch {
          /* index write is best-effort */
        }
      }

      const isPillar = seo.is_pillar === true || row?.is_pillar === true;

      if (isPillar) {
        hubsChecked++;
        const hubPath = (row?.path || "").trim();
        const issue = checkHubOutboundLinks({
          hubId: id,
          hubPath,
          hubLocale: file.locale,
          hubFile: file.filePath,
          pageData,
          index,
          ci: contentIndex,
        });
        if (issue) {
          errors.push({
            type: "error",
            code: HUB_MISSING_MEMBER_LINKS,
            message: `${issue.message} ${CLUSTER_LINK_ANCHOR_ONLY_HINT}`,
            file: file.filePath,
            suggestion: issue.suggestion,
            category: "seo",
            validator: this.name,
          });
        }
        continue;
      }

      const pillarPath =
        (typeof seo.pillar_path === "string" && seo.pillar_path.trim()) ||
        (typeof row?.pillar_path === "string" && row.pillar_path.trim()) ||
        "";
      if (!pillarPath) continue;

      membersChecked++;
      const back = checkMemberBackLink({
        memberFile: file.filePath,
        memberLocale: file.locale,
        pillarPath,
        pageData,
        ci: contentIndex,
      });
      if (back) {
        errors.push({
          type: "error",
          code: MEMBER_MISSING_HUB_LINK,
          message: `${back.message} ${CLUSTER_LINK_ANCHOR_ONLY_HINT}`,
          file: file.filePath,
          suggestion: back.suggestion,
          category: "seo",
          validator: this.name,
        });
      }
    }

    const duration = Date.now() - startTime;
    return {
      name: this.name,
      description: this.description,
      status: errors.length > 0 ? "failed" : "passed",
      errors,
      warnings: [],
      duration,
      category: this.category,
      artifacts: { hubsChecked, membersChecked, anchorOnly: true },
    };
  },
};
