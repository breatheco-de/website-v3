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
import { runSeoResearch } from "../lib/seo-research-mcp.js";

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
        const [hubType, hubSlug, hubLocale] = data.hubId.split("/");
        const thinOrEmpty =
          data.members.length === 0 || !data.keyword || data.keyword.trim().length < 3;
        const siteArg = site ? { site } : {};
        const next_actions: Array<{
          tool: string;
          priority: string;
          reason: string;
          args_hint: Record<string, unknown>;
        }> = [
          {
            tool: "get_entry_seo",
            priority: "recommended",
            reason: "Hub SEO + cached validation_issues",
            args_hint: {
              slug: hubSlug,
              contentType: hubType,
              locale: data.locale || hubLocale || "en",
              ...siteArg,
            },
          },
        ];
        const discovery_path = thinOrEmpty
          ? {
              goal: "Optional SEO research to grow this hub. Not next_actions — skip does not block.",
              items: [
                {
                  kind: "tool" as const,
                  id: "cluster_competitors",
                  tool: "get_or_refresh_seo_research",
                  why: "Discover rival domains for this hub’s keyword/domain (cache-first; budgeted).",
                  look_for: ["competitor domains to feed keyword_gaps"],
                  available: true,
                  args_hint: {
                    action: "competitors",
                    ...(data.keyword ? { seed_keywords: [data.keyword] } : {}),
                    ...siteArg,
                  },
                },
                {
                  kind: "think" as const,
                  id: "then_gaps",
                  title: "Then run keyword gaps",
                  why: "keyword_gaps requires a non-empty competitors list — pass rivals from competitors action.",
                  look_for: [
                    "Call get_or_refresh_seo_research action:keyword_gaps with competitors[] after discovery",
                  ],
                },
              ],
              non_effects: [
                "discovery_path is optional; does not write YAML or cluster membership.",
                "Not a substitute for get_organic_traffic (measured GSC clicks).",
              ],
            }
          : undefined;

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
                  next_actions,
                  ...(discovery_path ? { discovery_path } : {}),
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
    "get_or_refresh_seo_research",
    "Get or refresh SEO research (cache-first; paid fetch when stale/missing or force:true). " +
      "Actions: keyword_metrics (volume/difficulty), serp, keyword_ideas, competitors, keyword_gaps. " +
      "keyword_metrics.kw_difficulty_source: reported | derived_from_competition (rough proxy mapped from competition) | null. " +
      "Results use the site's configured research market (data.market), not a per-call location. " +
      "Needs why only (read; no highlights). " +
      "Does NOT write seo.kw_* YAML. Cache hits spend 0 credits. " +
      "Session + daily budgets apply (warn % → confirm_seo_research_budget; 100% → exhausted). " +
      "force skips TTL only — never budget. keyword_gaps requires non-empty competitors[]. " +
      "When research inactive → seo_research_inactive. Requires seo_edit. " +
      MULTI_SITE_TOOL_BLURB,
    {
      action: z
        .enum(["keyword_metrics", "serp", "keyword_ideas", "competitors", "keyword_gaps"])
        .describe("Research action"),
      contentType: z.string().optional().describe("Content type (entry-scoped actions)"),
      slug: z.string().optional().describe("Page slug (entry-scoped)"),
      locale: z.string().default("en").describe("Locale code"),
      keyword: z.string().optional().describe("Keyword/query override (default seo.main_keyword)"),
      seed: z.string().optional().describe("Seed for keyword_ideas"),
      mode: z.string().optional().describe("keyword_ideas mode: ideas|suggestions|related"),
      domain: z.string().optional().describe("Our or target domain (competitors/gaps); default from Search Console / sites.yml"),
      seed_keywords: z.array(z.string()).optional().describe("Seed keywords for competitors discovery"),
      competitors: z.array(z.string()).optional().describe("Rival domains for keyword_gaps (required, non-empty)"),
      limit: z.number().optional().describe("Result limit where supported"),
      min_volume: z.number().optional().describe("keyword_ideas min volume filter"),
      intent: z.string().optional().describe("keyword_ideas intent filter"),
      force: z.boolean().optional().describe("Bypass TTL and re-fetch (still respects budget)"),
      confirm_seo_research_budget: z
        .boolean()
        .optional()
        .describe("Required in warn band (≥ budget_warn_percent) until 100%"),
      why: z.string().describe(AGENT_WHY_DESC),
      agent_session_id: z
        .string()
        .describe("Required. From agent_session start — session budget + staff monitoring."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async (args) => {
      const {
        action,
        contentType,
        slug,
        locale,
        keyword,
        seed,
        mode,
        domain,
        seed_keywords,
        competitors,
        limit,
        min_volume,
        intent,
        force,
        confirm_seo_research_budget,
        why,
        agent_session_id,
        site,
      } = args;
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) {
        return siteFailResult(siteResult.error, "get_or_refresh_seo_research", {
          action,
          contentType,
          slug,
          locale,
        });
      }
      const reportCheck = requireMutateWhyHighlights(why, undefined, { mode: "why_only" });
      if (!reportCheck.ok) return reportCheck.result;

      if (action === "keyword_metrics" || action === "serp") {
        if (!contentType || !slug) {
          return fail("contentType and slug are required for keyword_metrics and serp", {
            code: "args_required",
          });
        }
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
          return fail(`Page not found for slug '${slug}' (contentType: ${contentType})`, {
            code: "not_found",
          });
        }
        if (mcpToken && !(await checkCap(mcpToken, "seo_edit", resolved.contentType))) {
          return denyResponse("seo_edit", resolved.contentType);
        }

        const result = await runSeoResearch({
          action,
          contentPath: siteResult.contentPath,
          contentFolder: siteResult.contentFolder,
          contentType: resolved.contentType,
          slug,
          locale,
          keyword,
          force,
          confirm_seo_research_budget,
          agent_session_id,
          site,
        });

        if (!result.ok) {
          if (
            result.code === "seo_research_inactive" ||
            result.code === "confirm_seo_research_budget"
          ) {
            return actionRequired(
              {
                success: false,
                action_required: result.action_required || result.code,
                code: result.code,
                message: result.message,
                warnings: result.warnings ?? [],
                ...(result.details ?? {}),
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
            message: `SEO research ${result.action}: ${result.outcome}`,
            action: result.action,
            outcome: result.outcome,
            credits_spent: result.credits_spent,
            credits_note: result.credits_note,
            budget: result.budget,
            data: result.data,
            why: reportCheck.why,
          },
          {
            warnings: result.warnings,
            side_effects: result.side_effects,
            next_actions: result.next_actions,
          },
        );
      }

      // Planning actions — seo_edit on any grant (no entry required)
      if (mcpToken && !(await checkCap(mcpToken, "seo_edit"))) {
        return denyResponse("seo_edit");
      }

      const result = await runSeoResearch({
        action,
        contentPath: siteResult.contentPath,
        contentFolder: siteResult.contentFolder,
        contentType,
        slug,
        locale,
        keyword,
        seed,
        mode,
        domain,
        seed_keywords,
        competitors,
        limit,
        min_volume,
        intent,
        force,
        confirm_seo_research_budget,
        agent_session_id,
        site,
      });

      if (!result.ok) {
        if (
          result.code === "seo_research_inactive" ||
          result.code === "confirm_seo_research_budget"
        ) {
          return actionRequired(
            {
              success: false,
              action_required: result.action_required || result.code,
              code: result.code,
              message: result.message,
              warnings: result.warnings ?? [],
              ...(result.details ?? {}),
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
          message: `SEO research ${result.action}: ${result.outcome}`,
          action: result.action,
          outcome: result.outcome,
          credits_spent: result.credits_spent,
          credits_note: result.credits_note,
          budget: result.budget,
          data: result.data,
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
