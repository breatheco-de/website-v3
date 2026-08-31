/**
 * MCP tools for product funnels (authored conversion steps + traffic sources).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, fail } from "../lib/respond.js";
import { resolveSiteContext } from "../lib/content.js";
import { getTokenUsername } from "../lib/oauth.js";
import { denyUnlessContentView } from "../lib/auth.js";
import type { CatalogGrant } from "../lib/tool-catalog.js";

const MAIN_SERVER_PORT = process.env.PORT || "5000";
const INTERNAL_SECRET = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";

function internalHeaders(mcpToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (INTERNAL_SECRET) {
    headers.Authorization = `Bearer ${INTERNAL_SECRET}`;
    const username = mcpToken ? getTokenUsername(mcpToken) : undefined;
    if (username) headers["x-mcp-author"] = username;
  } else if (mcpToken) {
    const username = getTokenUsername(mcpToken);
    if (username) headers["x-mcp-author"] = username;
  }
  return headers;
}

export function registerEcommerceTools(
  mcp: McpServer,
  mcpToken?: string,
  grants?: CatalogGrant[],
): void {
  mcp.tool(
    "get_product_funnel",
    "Read-only conversion journey for a purchasable product: pages whose _common.yml funnel.products includes this SKU (or all), grouped by funnel.stage, plus the locked product page. Membership is edited per page (Funnel tab / funnel.stage + funnel.products on _common.yml) — not _ecommerce.yml funnel.steps. Does not read single.programs or seo.intent. Requires content_view.",
    {
      slug: z.string().describe("Product content slug, e.g. ai-fluency"),
      site: z.string().optional().describe('Site domain when multi-site. Always pass site when multiple sites are configured; call list_sites if unsure.'),
    },
    async ({ slug, site }) => {
      const viewDenied = await denyUnlessContentView(mcpToken, undefined, grants);
      if (viewDenied) return viewDenied;
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return fail(siteResult.error);
      const domain = siteResult.domain;

      try {
        const url = `http://localhost:${MAIN_SERVER_PORT}/api/ecommerce/funnel/${encodeURIComponent(slug)}${
          domain ? `?__site=${encodeURIComponent(domain)}` : ""
        }`;
        const res = await fetch(url, { headers: internalHeaders(mcpToken) });
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          return fail((data.error as string) || `Server error: ${res.status}`);
        }
        return ok(
          {
            message: `Effective funnel for ${slug}`,
            ...data,
          },
          {
            warnings: [
              {
                code: "membership_is_on_page",
                message:
                  "Journey membership is on each page's _common.yml (funnel.stage + funnel.products). Use content field write APIs or staff Funnel tab — not update_product_funnel.",
              },
              {
                code: "does_not_read_single_programs",
                message: "Landing single.programs is form-only and is not used for funnel membership.",
              },
              {
                code: "does_not_read_seo_intent",
                message: "seo.intent is removed; funnel.stage on _common.yml is the source of truth.",
              },
              {
                code: "cta_tracking_unchanged",
                message: "Enrollment programs[].id and CTA .tracking are unchanged by page funnel fields.",
              },
            ],
            next_actions: [],
          },
        );
      } catch (e) {
        return fail(`get_product_funnel failed: ${(e as Error).message}`);
      }
    },
  );

  mcp.tool(
    "get_product_funnel_analytics",
    "Page performance (or stage_flow stub) for a purchasable product journey from GA4 BigQuery. " +
      "Returns per-page sessions/views plus path-scoped lead conversions and ecommerce intent " +
      "(same event set on every stage), stage distinct sessions, shared vs product-specific session counts, " +
      "and product-scoped conversions/ecommerce intent (item_id). Does not imply stage-to-stage flow. " +
      "Requires content_view. Configure dataset at /private/tracking/bigquery.",
    {
      slug: z.string().describe("Product content slug, e.g. ai-fluency"),
      mode: z
        .enum(["page_performance", "stage_flow"])
        .optional()
        .describe("Default page_performance. stage_flow returns not_implemented."),
      days: z.number().int().min(1).max(90).optional().describe("Lookback days ending yesterday (default 28)"),
      site: z
        .string()
        .optional()
        .describe("Site domain when multi-site. Always pass site when multiple sites are configured; call list_sites if unsure."),
    },
    async ({ slug, mode, days, site }) => {
      const viewDenied = await denyUnlessContentView(mcpToken, undefined, grants);
      if (viewDenied) return viewDenied;
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return fail(siteResult.error);
      const domain = siteResult.domain;

      try {
        const params = new URLSearchParams();
        params.set("mode", mode || "page_performance");
        if (days) params.set("days", String(days));
        if (domain) params.set("__site", domain);
        const url = `http://localhost:${MAIN_SERVER_PORT}/api/ecommerce/funnel/${encodeURIComponent(slug)}/analytics?${params}`;
        const res = await fetch(url, { headers: internalHeaders(mcpToken) });
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          return fail((data.error as string) || `Server error: ${res.status}`);
        }
        const warnings: Array<{ code: string; message: string }> = Array.isArray(data.warnings)
          ? (data.warnings as Array<{ code: string; message: string }>)
          : [];
        if (data.status === "not_implemented") {
          warnings.push({
            code: "stage_flow_not_implemented",
            message: "Use mode=page_performance for live metrics.",
          });
        }
        warnings.push({
          code: "no_stage_to_stage_flow",
          message:
            "Page performance metrics do not prove traffic moved from one funnel stage to the next.",
        });
        return ok(
          {
            message: `Journey analytics for ${slug} (${data.mode || mode || "page_performance"})`,
            ...data,
          },
          {
            warnings,
            side_effects: [],
            next_actions:
              data.status === "unavailable"
                ? [
                    {
                      tool: "explain_site",
                      args: { topic: "ecommerce" },
                      reason: "BigQuery may be unconfigured — check tracking.bigquery / staff /private/tracking/bigquery",
                    },
                  ]
                : [],
          },
        );
      } catch (e) {
        return fail(`get_product_funnel_analytics failed: ${(e as Error).message}`);
      }
    },
  );

  // update_product_funnel retired — membership is on page _common.yml (410 from API)
}
