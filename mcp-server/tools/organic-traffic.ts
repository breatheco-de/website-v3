/**
 * MCP get_organic_traffic — read-only GSC organic clicks/impressions.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { denyUnlessMetricsViewOrSeo } from "../lib/auth.js";
import type { CatalogGrant } from "../lib/tool-catalog.js";
import { ok, fail } from "../lib/respond.js";
import { resolveSiteContext } from "../lib/content.js";
import { SITE_PARAM_DESC, MULTI_SITE_TOOL_BLURB } from "../lib/entry-helpers.js";
import {
  assembleClustersMode,
  assembleOpportunitiesMode,
  assemblePathsMode,
  assembleSiteMode,
  MAX_ORGANIC_HUBS,
  MAX_ORGANIC_PATHS,
  OPPORTUNITIES_DEFAULT_LIMIT,
  OPPORTUNITIES_MAX_LIMIT,
} from "../lib/organic-traffic-mcp.js";

export function registerOrganicTrafficTools(
  mcp: McpServer,
  mcpToken?: string,
  grants?: CatalogGrant[],
): void {
  mcp.tool(
    "get_organic_traffic",
    "Read Google Search Console organic traffic (clicks/impressions) from the day cache / site BigQuery. " +
      "Exclusive mode per call: site | paths | clusters | opportunities. " +
      `paths: 1–${MAX_ORGANIC_PATHS} public paths or absolute URLs (not slugs; deduped). ` +
      `clusters: 1–${MAX_ORGANIC_HUBS} hub ids or pillar paths (deduped; selection_totals = unique paths, not site). ` +
      "opportunities: flattened work queue with kind (page2|low_ctr|link_gaps|decay|cannibalization|missing_serp), paginated. " +
      "Soft partial for unknown paths/hubs; empty batch fails. market only for paths/clusters. " +
      "include_series default false; series for site when requested, or paths/clusters when batch ≤ 5. " +
      "Read-only — does not backfill days, refresh SERP, or call URL Inspection. " +
      "Not keyword_metrics / kw_monthly_volume. Requires metrics_view or seo_edit. " +
      MULTI_SITE_TOOL_BLURB,
    {
      mode: z
        .enum(["site", "paths", "clusters", "opportunities"])
        .describe("Exclusive mode for this call"),
      paths: z
        .array(z.string())
        .optional()
        .describe(`Required for mode=paths. Public paths or URLs, max ${MAX_ORGANIC_PATHS} after dedupe.`),
      hub_ids: z
        .array(z.string())
        .optional()
        .describe(`Required for mode=clusters. Hub ids or pillar paths, max ${MAX_ORGANIC_HUBS} after dedupe.`),
      include_series: z
        .boolean()
        .optional()
        .describe("Default false. Daily series for site, or paths/clusters when batch size ≤ 5."),
      market: z
        .string()
        .optional()
        .describe("Organic market id (default worldwide). Honored only for paths/clusters."),
      decay_window: z
        .union([z.literal(7), z.literal(28)])
        .optional()
        .describe("Opportunities decay window (default 7)."),
      opportunities_limit: z
        .number()
        .int()
        .min(1)
        .max(OPPORTUNITIES_MAX_LIMIT)
        .optional()
        .describe(`Flattened opportunities page size (default ${OPPORTUNITIES_DEFAULT_LIMIT}, max ${OPPORTUNITIES_MAX_LIMIT}).`),
      opportunities_offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Flattened opportunities offset (default 0)."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({
      mode,
      paths,
      hub_ids,
      include_series,
      market,
      decay_window,
      opportunities_limit,
      opportunities_offset,
      site,
    }) => {
      const denied = await denyUnlessMetricsViewOrSeo(mcpToken, grants);
      if (denied) return denied;

      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return fail(siteResult.error);

      const { contentPath, contentFolder, domain } = siteResult;
      const marketProvided = typeof market === "string" && market.trim().length > 0;
      const siteDomain = site || domain;

      try {
        if (mode === "site") {
          const result = await assembleSiteMode({
            contentRoot: contentPath,
            contentFolder,
            include_series,
            marketProvided,
            site: siteDomain,
          });
          return ok(
            { message: "Site organic traffic", ...result.payload },
            { warnings: result.warnings, side_effects: [], next_actions: result.next_actions },
          );
        }

        if (mode === "paths") {
          if (!paths || !Array.isArray(paths)) {
            return fail("paths must be a non-empty array when mode=paths.");
          }
          const result = assemblePathsMode({
            contentRoot: contentPath,
            contentFolder,
            paths,
            market: marketProvided ? market!.trim() : undefined,
            include_series,
            site: siteDomain,
          });
          if ("error" in result) return fail(result.error);
          return ok(
            { message: "Path organic traffic", ...result.payload },
            { warnings: result.warnings, side_effects: [], next_actions: result.next_actions },
          );
        }

        if (mode === "clusters") {
          if (!hub_ids || !Array.isArray(hub_ids)) {
            return fail("hub_ids must be a non-empty array when mode=clusters.");
          }
          const result = assembleClustersMode({
            contentRoot: contentPath,
            contentFolder,
            hub_ids,
            market: marketProvided ? market!.trim() : undefined,
            include_series,
            site: siteDomain,
          });
          if ("error" in result) return fail(result.error);
          return ok(
            { message: "Cluster organic traffic", ...result.payload },
            { warnings: result.warnings, side_effects: [], next_actions: result.next_actions },
          );
        }

        // opportunities
        const result = await assembleOpportunitiesMode({
          contentRoot: contentPath,
          contentFolder,
          decay_window,
          opportunities_limit,
          opportunities_offset,
          marketProvided,
          site: siteDomain,
        });
        return ok(
          { message: "Organic opportunities", ...result.payload },
          { warnings: result.warnings, side_effects: [], next_actions: result.next_actions },
        );
      } catch (e) {
        return fail(`get_organic_traffic failed: ${(e as Error).message}`);
      }
    },
  );
}
