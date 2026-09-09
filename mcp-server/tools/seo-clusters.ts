/**
 * MCP sync reads for SEO cluster hubs / buckets (inventory only).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveSiteContext, resolveContentType } from "../lib/content.js";
import { checkCap, denyResponse, denyUnlessContentViewOrSeo } from "../lib/auth.js";
import type { CatalogGrant } from "../lib/tool-catalog.js";
import { SITE_PARAM_DESC, MULTI_SITE_TOOL_BLURB, siteFailResult } from "../lib/entry-helpers.js";
import {
  buildGetSeoCluster,
  buildListSeoClusterEntries,
  buildListSeoClusters,
  isClusterFilterBucket,
} from "../lib/seo-cluster-inventory.js";
import { assertSafeLocale, assertSafeSegment } from "../lib/sanitize.js";
import { ok, fail, actionRequired } from "../lib/respond.js";
import { requireMutateWhyHighlights } from "../lib/page-tool-helpers.js";
import { AGENT_WHY_DESC } from "../lib/agent-report.js";
import { runRefreshKeywordMetrics } from "../lib/refresh-keyword-metrics-mcp.js";

const CLUSTER_BUCKETS = [
  "unclustered",
  "partiallySet",
  "brokenRefs",
  "emptyHubs",
  "clustered",
] as const;

export function registerSeoClusterTools(
  mcp: McpServer,
  mcpToken?: string,
  grants?: CatalogGrant[],
): void {
  mcp.tool(
    "list_seo_clusters",
    "List SEO topic-cluster hubs from seo-index.json (sync inventory). " +
      "Returns hubId, pillar URL, keyword, member counts, clusterHealth, and sibling_locales per hub. " +
      "Does not mutate. Membership writes: update_fields (seo.pillar_path / seo.is_pillar / seo.include_in_clustering). " +
      "Verify issues via run_entry_diagnostics (SEO category) or get_entry_seo.validation_issues — cache may lag after writes. " +
      "Requires content_view or seo_edit. " +
      MULTI_SITE_TOOL_BLURB,
    {
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ site }) => {
      const denied = await denyUnlessContentViewOrSeo(mcpToken, undefined, grants);
      if (denied) return denied;
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error, "list_seo_clusters", {});
      try {
        const data = buildListSeoClusters(siteResult.contentPath);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ...data,
                  warnings: [
                    {
                      code: "cluster_inventory_not_diagnostics",
                      message:
                        "This is seo-index inventory, not validation-cache issues. After update_fields, re-list here for membership; diagnostics cache may lag until a metrics job runs.",
                    },
                  ],
                  next_actions: [
                    {
                      tool: "get_seo_cluster",
                      priority: "recommended",
                      reason: "Inspect one hub and its members",
                      args_hint: {
                        hubId: data.clusters[0]?.hubId,
                        ...(site ? { site } : {}),
                      },
                    },
                    {
                      tool: "list_seo_cluster_entries",
                      priority: "recommended",
                      reason: "Work queue by health bucket",
                      args_hint: { bucket: "unclustered", ...(site ? { site } : {}) },
                    },
                  ],
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return { content: [{ type: "text", text: String(err) }], isError: true };
      }
    },
  );

  mcp.tool(
    "list_seo_cluster_entries",
    "Paginated SEO cluster work-queue from seo-index (sync). " +
      `bucket: ${CLUSTER_BUCKETS.join(" | ")}. ` +
      "Each row includes sibling_locales (other locales for the same slug — loop yourself; no write fan-out). " +
      "Mutate membership via update_fields only. " +
      "Requires content_view or seo_edit. " +
      MULTI_SITE_TOOL_BLURB,
    {
      bucket: z
        .enum(CLUSTER_BUCKETS)
        .describe("Health bucket: unclustered | partiallySet | brokenRefs | emptyHubs | clustered"),
      q: z.string().optional().describe("Optional search over slug/path/keyword/id"),
      page: z.number().int().min(1).optional().describe("Page number (default 1)"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Page size (default 25, max 100)"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ bucket, q, page, pageSize, site }) => {
      const denied = await denyUnlessContentViewOrSeo(mcpToken, undefined, grants);
      if (denied) return denied;
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) {
        return siteFailResult(siteResult.error, "list_seo_cluster_entries", { bucket, q, page, pageSize });
      }
      if (!isClusterFilterBucket(bucket)) {
        return {
          content: [{ type: "text", text: `Invalid bucket. Must be one of: ${CLUSTER_BUCKETS.join(", ")}` }],
          isError: true,
        };
      }
      try {
        const data = buildListSeoClusterEntries(siteResult.contentPath, {
          bucket,
          q,
          page,
          pageSize,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ...data,
                  warnings: [
                    {
                      code: "cluster_inventory_not_diagnostics",
                      message:
                        "Bucket list is from seo-index. Fix via update_fields; re-list to confirm membership. validation_issues may lag until diagnostics refresh.",
                    },
                  ],
                  next_actions: data.items[0]
                    ? [
                        {
                          tool: "get_entry_seo",
                          priority: "recommended",
                          reason: "Inspect SEO + cached issues for the first row",
                          args_hint: {
                            slug: data.items[0].slug,
                            contentType: data.items[0].contentType,
                            locale: data.items[0].locale,
                            ...(site ? { site } : {}),
                          },
                        },
                        {
                          tool: "update_fields",
                          priority: "optional",
                          reason: "Assign pillar_path / is_pillar / include_in_clustering",
                          args_hint: {
                            slug: data.items[0].slug,
                            contentType: data.items[0].contentType,
                            locale: data.items[0].locale,
                            ...(site ? { site } : {}),
                          },
                        },
                      ]
                    : [],
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return { content: [{ type: "text", text: String(err) }], isError: true };
      }
    },
  );

  mcp.tool(
    "get_seo_cluster",
    "Get one SEO cluster hub and its members from seo-index (sync). " +
      "Pass hubId (contentType/slug/locale) or pillar public path. " +
      "Includes sibling_locales on hub and members. " +
      "Mutate via update_fields; verify links/issues via SEO diagnostics. " +
      "Requires content_view or seo_edit. " +
      MULTI_SITE_TOOL_BLURB,
    {
      hubId: z
        .string()
        .describe("Hub entry id (contentType/slug/locale) or pillar public path (e.g. /en/...)"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ hubId, site }) => {
      const denied = await denyUnlessContentViewOrSeo(mcpToken, undefined, grants);
      if (denied) return denied;
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error, "get_seo_cluster", { hubId });
      try {
        const data = buildGetSeoCluster(siteResult.contentPath, hubId.trim());
        if (!data) {
          return {
            content: [{ type: "text", text: `Cluster not found for hubId/path '${hubId}'` }],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ...data,
                  warnings: [
                    {
                      code: "cluster_inventory_not_diagnostics",
                      message:
                        "Membership from seo-index. Bidirectional in-body links are seo-cluster-links diagnostics, not this payload.",
                    },
                  ],
                  next_actions: [
                    {
                      tool: "get_entry_seo",
                      priority: "recommended",
                      reason: "Hub SEO + cached validation_issues",
                      args_hint: {
                        slug: data.hubId.split("/")[1],
                        contentType: data.hubId.split("/")[0],
                        locale: data.locale || "en",
                        ...(site ? { site } : {}),
                      },
                    },
                  ],
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return { content: [{ type: "text", text: String(err) }], isError: true };
      }
    },
  );

  mcp.tool(
    "refresh_keyword_metrics",
    "Force OpenRush inspect_keyword for an entry's main keyword (or keyword override). " +
      "Upserts the shared OpenRush keyword cache only — does NOT write seo.kw_monthly_volume / seo.kw_difficulty YAML. " +
      "When OpenRush is on, this is the valid fix for SEO_KEYWORD_RESEARCH_INCOMPLETE (B1); do not invent YAML metrics. " +
      "When OpenRush is inactive → openrush_inactive (use update_fields + seo_research_source only with staff_provided|external:<name>, else release). " +
      "Spends OpenRush credits. Requires seo_edit. " +
      MULTI_SITE_TOOL_BLURB,
    {
      contentType: z.string().describe("Content type (e.g. locations, blog)"),
      slug: z.string().describe("Page slug"),
      locale: z.string().default("en").describe("Locale code"),
      keyword: z
        .string()
        .optional()
        .describe("Optional keyword override; default = seo.main_keyword from locale YAML / seo-index"),
      why: z.string().describe(AGENT_WHY_DESC),
      agent_session_id: z
        .string()
        .optional()
        .describe("Optional. From agent_session start — groups this call for staff monitoring."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ contentType, slug, locale, keyword, why, agent_session_id, site }) => {
      void agent_session_id;
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) {
        return siteFailResult(siteResult.error, "refresh_keyword_metrics", {
          contentType,
          slug,
          locale,
        });
      }
      const reportCheck = requireMutateWhyHighlights(why, undefined, { mode: "mutate_structural" });
      if (!reportCheck.ok) return reportCheck.result;
      try {
        assertSafeSegment(slug, "slug");
        assertSafeLocale(locale);
        assertSafeSegment(contentType, "contentType");
      } catch (e) {
        return fail((e as Error).message);
      }
      const resolved = resolveContentType(slug, contentType, siteResult.contentPath, {
        allowSharedLayout: true,
      });
      if (!resolved) {
        return fail(
          `Page not found for slug '${slug}' (contentType: ${contentType})`,
          { code: "not_found" },
        );
      }
      if (mcpToken && !(await checkCap(mcpToken, "seo_edit", resolved.contentType))) {
        return denyResponse("seo_edit", resolved.contentType);
      }

      const result = await runRefreshKeywordMetrics({
        contentPath: siteResult.contentPath,
        contentFolder: siteResult.contentFolder,
        contentType: resolved.contentType,
        slug,
        locale,
        keywordOverride: keyword,
        site,
      });

      if (!result.ok) {
        if (result.code === "openrush_inactive") {
          return actionRequired(
            {
              success: false,
              action_required: result.code,
              code: result.code,
              message: result.message,
              warnings: result.warnings ?? [],
            },
            result.next_actions ?? [],
          );
        }
        return fail(result.message, {
          code: result.code,
          ...(result.details ?? {}),
          warnings: result.warnings ?? [],
          next_actions: result.next_actions ?? [],
        });
      }

      return ok(
        {
          message: `OpenRush keyword cache refreshed for "${result.keyword}".`,
          keyword: result.keyword,
          kw_monthly_volume: result.kw_monthly_volume,
          kw_difficulty: result.kw_difficulty,
          fetched_at: result.fetched_at,
          notes: result.notes,
          source: result.source,
          credits: result.credits,
          credits_note: result.credits_note,
          why: reportCheck.why,
        },
        {
          warnings: result.warnings,
          side_effects: result.side_effects,
          next_actions: result.next_actions,
        },
      );
    },
  );
}
