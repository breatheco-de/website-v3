/**
 * MCP tools for product funnels (authored conversion steps + traffic sources).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, fail } from "../lib/respond.js";
import { resolveSiteContext } from "../lib/content.js";
import { denyUnlessContentView } from "../lib/auth.js";
import type { CatalogGrant } from "../lib/tool-catalog.js";
import { buildLoopbackHeaders } from "../lib/loopback.js";

const MAIN_SERVER_PORT = process.env.PORT || "5000";

function internalHeaders(mcpToken?: string, site?: string): Record<string, string> {
  return buildLoopbackHeaders(mcpToken, { site });
}

export function registerEcommerceTools(
  mcp: McpServer,
  mcpToken?: string,
  grants?: CatalogGrant[],
): void {
  mcp.tool(
    "get_product_funnel",
    "Read-only conversion journey for a purchasable product: pages whose _common.yml funnel.products includes this SKU (or all), grouped by funnel.stage, plus the locked product page. " +
      "Edit membership per page with update_fields (funnel.stage / funnel.products; content_edit_structure) or update_entry_attributes for many slugs — or Funnel tab. Not on _product.yml. " +
      "Audience is on _product.yml via get_product / create_or_update_product. Requires content_view.",
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
        const url = `http://127.0.0.1:${MAIN_SERVER_PORT}/api/ecommerce/funnel/${encodeURIComponent(slug)}`;
        const res = await fetch(url, { headers: internalHeaders(mcpToken, domain) });
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
                  "Journey membership is on each page's _common.yml (funnel.stage + funnel.products as { product, persona? } bindings, or all). " +
                    "Write via update_fields (one page) or update_entry_attributes (many slugs) or Funnel tab — not create_or_update_product / not update_product_funnel. Product declaration is _product.yml.",
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
            next_actions: [
              {
                tool: "get_product_funnel_analytics",
                priority: "optional",
                reason:
                  "Optional: load GA4 page performance for this product journey (sessions/views/conversions). Skip if you only needed membership.",
                args_hint: { slug, ...(site ? { site } : {}) },
              },
            ],
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
      "product-scoped lead conversions / ecommerce intent / purchases (item_id; purchase is product-level only, not path-scoped). " +
      "Lead events come from tracking.conversion_events counts_as_lead (signup always included). " +
      "Does not imply stage-to-stage flow. Requires content_view. Configure dataset at /private/tracking/ga4.",
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
        const url = `http://127.0.0.1:${MAIN_SERVER_PORT}/api/ecommerce/funnel/${encodeURIComponent(slug)}/analytics?${params}`;
        const res = await fetch(url, { headers: internalHeaders(mcpToken, domain) });
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
                      args_hint: { topic: "ecommerce" },
                      reason: "BigQuery may be unconfigured — check tracking.bigquery / staff /private/tracking/ga4",
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
