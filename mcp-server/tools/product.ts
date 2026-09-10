/**
 * MCP tools for CMS products: audience (offer + personas) and funnel journey reads.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, fail, actionRequired } from "../lib/respond.js";
import { resolveSiteContext } from "../lib/content.js";
import { getTokenUsername } from "../lib/oauth.js";
import { denyUnlessContentView, checkCap, denyResponse } from "../lib/auth.js";
import type { CatalogGrant } from "../lib/tool-catalog.js";
import { registerEcommerceTools } from "./ecommerce.js";

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

export function registerProductTools(
  mcp: McpServer,
  mcpToken?: string,
  grants?: CatalogGrant[],
): void {
  // Journey reads stay registered under the same tool names
  registerEcommerceTools(mcp, mcpToken, grants);

  mcp.tool(
    "get_product_audience",
    "Read product offer + personas (avatar nested) from entry _product.yml. " +
      "Returns audience_status (missing|minimal|complete). Locale-agnostic brief. Requires content_view.",
    {
      slug: z.string().describe("Product content slug, e.g. full-stack"),
      content_type: z.string().optional().describe("Default program"),
      site: z
        .string()
        .optional()
        .describe("Site domain when multi-site. Always pass site when multiple sites are configured."),
    },
    async ({ slug, content_type, site }) => {
      const viewDenied = await denyUnlessContentView(mcpToken, undefined, grants);
      if (viewDenied) return viewDenied;
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return fail(siteResult.error);
      const domain = siteResult.domain;
      const ct = content_type || "program";
      try {
        const params = new URLSearchParams();
        params.set("content_type", ct);
        if (domain) params.set("__site", domain);
        const url = `http://127.0.0.1:${MAIN_SERVER_PORT}/api/product/${encodeURIComponent(slug)}/audience?${params}`;
        const res = await fetch(url, { headers: internalHeaders(mcpToken) });
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          return fail((data.error as string) || `Server error: ${res.status}`);
        }
        const status = data.status as string;
        const next =
          status === "missing"
            ? [
                {
                  tool: "update_product_audience",
                  args_hint: { slug, content_type: ct },
                  reason: "Set minimal offer + persona before funnel landings can bind this product",
                },
              ]
            : [];
        return ok(
          {
            message: `Audience for ${slug} (${status})`,
            ...data,
          },
          {
            warnings: [
              {
                code: "locale_agnostic",
                message: "One brief per product; translate when writing page copy.",
              },
              {
                code: "does_not_edit_pages",
                message: "Reading audience does not change funnel membership or page YAML.",
              },
            ],
            next_actions: next,
          },
        );
      } catch (e) {
        return fail(`get_product_audience failed: ${(e as Error).message}`);
      }
    },
  );

  mcp.tool(
    "update_product_audience",
    "Write product offer + personas to entry _product.yml (always _product.yml, never legacy _ecommerce.yml). " +
      "Persona ids are immutable after create; cannot remove a persona (or demote below minimal) while pages bind it. " +
      "Does not edit page funnel or publish. Requires content_edit_structure.",
    {
      slug: z.string(),
      content_type: z.string().optional().describe("Default program"),
      offer: z.object({
        one_liner: z.string(),
        who_its_for: z.string(),
        who_its_not_for: z.string().optional(),
        outcomes: z.array(z.string()).optional(),
        differentiators: z.array(z.string()).optional(),
      }),
      personas: z.array(
        z.object({
          id: z.string(),
          label: z.string().optional(),
          role: z.string(),
          industry_or_context: z.string().optional(),
          demographics: z.string().optional(),
          buying_behavior: z.string().optional(),
          decision_criteria: z.array(z.string()).optional(),
          avatar: z.object({
            fears: z.array(z.string()),
            internal_dialogue: z.string(),
            objections: z.array(z.string()),
            aspirational_identity: z.string().optional(),
            jobs_to_be_done: z.array(z.string()).optional(),
          }),
        }),
      ),
      site: z.string().optional(),
      confirm: z.boolean().optional().describe("Preview when omitted; set true to write"),
    },
    async (args) => {
      if (!(await checkCap(mcpToken || "", "content_edit_structure", args.content_type || "program"))) {
        return denyResponse("content_edit_structure", args.content_type || "program");
      }
      const siteResult = resolveSiteContext(args.site);
      if (!siteResult.ok) return fail(siteResult.error);
      const domain = siteResult.domain;
      const ct = args.content_type || "program";

      if (!args.confirm) {
        return ok(
          {
            message: "Preview only — pass confirm: true to write audience",
            slug: args.slug,
            content_type: ct,
            offer: args.offer,
            personas: args.personas,
          },
          {
            warnings: [
              {
                code: "preview",
                message: "No files written. confirm: true persists to _product.yml.",
              },
            ],
            next_actions: [
              {
                tool: "update_product_audience",
                args_hint: { slug: args.slug, confirm: true },
                reason: "Confirm write",
              },
            ],
          },
        );
      }

      try {
        const url = `http://127.0.0.1:${MAIN_SERVER_PORT}/api/product/${encodeURIComponent(args.slug)}/audience${
          domain ? `?__site=${encodeURIComponent(domain)}` : ""
        }`;
        const res = await fetch(url, {
          method: "PUT",
          headers: internalHeaders(mcpToken),
          body: JSON.stringify({
            content_type: ct,
            offer: args.offer,
            personas: args.personas,
          }),
        });
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          const code = data.code as string | undefined;
          if (code === "persona_in_use" || code === "audience_in_use") {
            return actionRequired(
              {
                action_required: "fix_funnel_bindings",
                message: (data.error as string) || "Audience change blocked by funnel bindings",
                details: data.details,
              },
              [
                {
                  tool: "get_product_funnel",
                  args_hint: { slug: args.slug },
                  reason: "Find pages that still bind this product/persona",
                },
              ],
            );
          }
          return fail((data.error as string) || `Server error: ${res.status}`, { code });
        }
        return ok(
          {
            message: `Audience updated for ${args.slug}`,
            ...data,
          },
          {
            warnings: Array.isArray(data.warnings) ? (data.warnings as []) : [],
            side_effects: [
              {
                type: "content_write",
                summary: "Wrote offer + personas on product sidecar",
                paths: data.relativePath ? [String(data.relativePath)] : [],
              },
            ],
            next_actions: [
              {
                tool: "get_product_audience",
                args_hint: { slug: args.slug },
                reason: "Verify status",
              },
            ],
          },
        );
      } catch (e) {
        return fail(`update_product_audience failed: ${(e as Error).message}`);
      }
    },
  );
}
