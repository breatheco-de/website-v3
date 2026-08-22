/**
 * MCP sync reads for SEO cluster hubs / buckets (inventory only).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveSiteContext } from "../lib/content.js";
import { denyUnlessContentViewOrSeo } from "../lib/auth.js";
import type { CatalogGrant } from "../lib/tool-catalog.js";
import { SITE_PARAM_DESC, MULTI_SITE_TOOL_BLURB, siteFailResult } from "../lib/entry-helpers.js";
import {
  buildGetSeoCluster,
  buildListSeoClusterEntries,
  buildListSeoClusters,
  isClusterFilterBucket,
} from "../lib/seo-cluster-inventory.js";

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
}
