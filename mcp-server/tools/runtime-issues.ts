/**
 * MCP get_runtime_issues — read-only public 404 log (http.not_found).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { denyUnlessMetricsViewOrProposalsReview } from "../lib/auth.js";
import type { CatalogGrant } from "../lib/tool-catalog.js";
import { ok, fail } from "../lib/respond.js";
import { resolveSiteContext } from "../lib/content.js";
import { SITE_PARAM_DESC, MULTI_SITE_TOOL_BLURB } from "../lib/entry-helpers.js";
import { FILTER_ALL, SOURCE_FILTER_TAGS } from "../../shared/runtime-issues-list-filters.js";
import {
  RUNTIME_ISSUES_DEFAULT_LIMIT,
  RUNTIME_ISSUES_MAX_LIMIT,
  queryRuntimeIssuesForMcp,
} from "../lib/runtime-issues-mcp.js";

const SOURCE_ENUM = [
  "search_crawler",
  "llm_crawler",
  "social_preview",
  "search_referrer",
  "llm_referrer",
  "internal",
  "human",
] as const;

export function registerRuntimeIssuesTools(
  mcp: McpServer,
  mcpToken?: string,
  grants?: CatalogGrant[],
): void {
  mcp.tool(
    "get_runtime_issues",
    "Read the site public 404 log (runtime issues). Required kind:404 (stored as http.not_found). " +
      "Filters match Diagnostics → Runtime issues: path, referrer, locale, device (uaBucket), source tag, " +
      "pages_only (default true), query_params_only, window_days 7|30 (default 30), tz, sort count|lastSeen. " +
      `Default limit ${RUNTIME_ISSUES_DEFAULT_LIMIT}, max ${RUNTIME_ISSUES_MAX_LIMIT}. ` +
      "Each row includes windowed count, count30, sources, sampleReferrer, queryAttribution (utm_source/medium/campaign + other; click ids are not stored plaintext), " +
      "lastProbe, cmsReferrerCount, and recent_samples (last hits for the path: source chip, referrerHost, hashed click id when present; legacy rows may omit fields). " +
      "Windowed count mixes people, previews, and crawlers — use sources / byHour / recent_samples for proof; do not treat total as paid humans. " +
      "For broken_url idea briefs: call this first and paste path, count, sources, sampleReferrer, queryAttribution, and a short recent_samples note into the summary. " +
      "Empty attribution on the row → say none; do not invent dropped secrets/staff params. " +
      "Requires metrics_view or proposals_review. Read-only — does not change ignore rules or dropScrapers. " +
      MULTI_SITE_TOOL_BLURB,
    {
      kind: z
        .literal("404")
        .describe("Issue kind. Only 404 (http.not_found) in this release."),
      path: z
        .string()
        .optional()
        .describe("Substring match on the missing path."),
      referrer: z
        .string()
        .optional()
        .describe("Substring match on sampleReferrer."),
      locale: z.string().optional().describe("Exact locale filter (e.g. en, es)."),
      device: z
        .string()
        .optional()
        .describe("uaBucket filter (desktop, mobile, unknown, …)."),
      source: z
        .enum(SOURCE_ENUM)
        .optional()
        .describe(
          `Source tag with hits inside the window. One of: ${SOURCE_FILTER_TAGS.join(", ")}.`,
        ),
      pages_only: z
        .boolean()
        .optional()
        .describe("Hide asset paths. Default true."),
      query_params_only: z
        .boolean()
        .optional()
        .describe("Only rows that have queryAttribution. Default false."),
      window_days: z
        .union([z.literal(7), z.literal(30)])
        .optional()
        .describe("Hit window in days. Default 30."),
      tz: z
        .string()
        .optional()
        .describe("IANA timezone for the window. Default UTC."),
      sort: z
        .enum(["count", "lastSeen"])
        .optional()
        .describe("Sort key. Default count (desc)."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(RUNTIME_ISSUES_MAX_LIMIT)
        .optional()
        .describe(`Max rows to return. Default ${RUNTIME_ISSUES_DEFAULT_LIMIT}, max ${RUNTIME_ISSUES_MAX_LIMIT}.`),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async (args) => {
      const denied = await denyUnlessMetricsViewOrProposalsReview(mcpToken, grants);
      if (denied) return denied;

      try {
        const siteResult = resolveSiteContext(args.site);
        if (!siteResult.ok) return fail(siteResult.error);
        const siteName = siteResult.contentFolder || "default";
        const contentRoot = siteResult.contentPath;

        const { listRuntimeIssues } = await import("../../server/runtime-issues-store.js");
        const {
          loadLinkIndex,
          invertLinkIndex,
          normalizeReferrerTargetPath,
        } = await import("../../server/link-index.js");

        const data = listRuntimeIssues(siteName, { contentRoot });
        const linkIndex = loadLinkIndex(contentRoot);
        const inverted = invertLinkIndex(linkIndex.outbound);

        const withCms = data.issues.map((issue) => ({
          ...issue,
          cmsReferrerCount: (inverted.get(normalizeReferrerTargetPath(issue.path)) ?? []).length,
        }));

        const queried = queryRuntimeIssuesForMcp(withCms, args, data.recent);
        if (!queried.ok) {
          return fail(queried.error, { code: queried.code });
        }

        const { filters, sortKey, limit, total_matching, issues } = queried;

        return ok({
          kind: "404",
          site: siteName,
          updatedAt: data.updatedAt,
          total_matching,
          returned: issues.length,
          limit,
          filters: {
            path: filters.pathQuery || null,
            referrer: filters.referrerQuery || null,
            locale: filters.locale === FILTER_ALL ? null : filters.locale,
            device: filters.device === FILTER_ALL ? null : filters.device,
            source: filters.source === FILTER_ALL ? null : filters.source,
            pages_only: filters.pagesOnly,
            query_params_only: filters.queryParamsOnly,
            window_days: filters.windowDays,
            tz: filters.tz,
            sort: sortKey,
          },
          issues,
          linkIndexUpdatedAt: linkIndex.updated_at ?? null,
          warnings: [
            {
              code: "broken_url_brief_fields",
              message:
                "For a broken_url idea summary, paste path, windowed count, sources, sampleReferrer, queryAttribution (or say none), and note recent_samples (preview vs human). Windowed count mixes sources — do not treat it as paid humans only. Do not invent dropped params.",
            },
            {
              code: "recent_samples_partial",
              message:
                "recent_samples may omit source/click on legacy rows (before sampling). Missing fields mean before sampling, not zero traffic.",
            },
          ],
          next_actions: [],
        });
      } catch (e) {
        return fail(`get_runtime_issues failed: ${(e as Error).message}`);
      }
    },
  );
}
