/**
 * MCP tools for CMS products: list / get / update sidecar + funnel journey reads.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, fail, actionRequired } from "../lib/respond.js";
import { resolveSiteContext } from "../lib/content.js";
import { getTokenUsername } from "../lib/oauth.js";
import { denyUnlessContentView, checkCap, denyResponse } from "../lib/auth.js";
import { hasCapAnyScope, type CatalogGrant } from "../lib/tool-catalog.js";
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

function siteQuery(domain: string | null | undefined, extra?: Record<string, string>): string {
  const params = new URLSearchParams();
  if (domain) params.set("__site", domain);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) params.set(k, v);
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

const HUMAN_VISIBILITY_MSG =
  "Making a product sellable or showing/hiding it in the store is a human decision. " +
  "Create a propose_change notes proposal asking staff to act in the Store (or content YAML). " +
  "Do not set purchasable or actively_selling via update_product.";

export function registerProductTools(
  mcp: McpServer,
  mcpToken?: string,
  grants?: CatalogGrant[],
): void {
  registerEcommerceTools(mcp, mcpToken, grants);

  mcp.tool(
    "list_products",
    "List CMS products (selling flag, audience status, persona ids). " +
      "Use first for what we sell / who for; then get_product for offer/avatar depth. " +
      "Paused included by default. Requires content_view.",
    {
      include_paused: z
        .boolean()
        .optional()
        .describe("Default true — include paused products"),
      content_type: z.string().optional(),
      site: z.string().optional().describe("Site domain when multi-site"),
    },
    async ({ include_paused, content_type, site }) => {
      const viewDenied = await denyUnlessContentView(mcpToken, undefined, grants);
      if (viewDenied) return viewDenied;
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return fail(siteResult.error);
      try {
        const extra: Record<string, string> = {
          include_paused: include_paused === false ? "false" : "true",
        };
        if (content_type) extra.content_type = content_type;
        const url = `http://127.0.0.1:${MAIN_SERVER_PORT}/api/product${siteQuery(siteResult.domain, extra)}`;
        const res = await fetch(url, { headers: internalHeaders(mcpToken) });
        const data = (await res.json()) as {
          products?: Array<{ content_slug: string; audience_status?: string }>;
          error?: string;
        };
        if (!res.ok) {
          return fail(data.error || `Server error: ${res.status}`);
        }
        const products = data.products ?? [];
        const canEdit =
          hasCapAnyScope(grants ?? [], "content_edit_structure") ||
          (await checkCap(mcpToken || "", "content_edit_structure", content_type || "program"));
        const first = products[0];
        const next =
          products.length === 0
            ? [
                {
                  tool: "explain_site",
                  args_hint: { topic: "product" },
                  reason: "No purchasable products — read product sidecar mental model",
                },
              ]
            : [
                {
                  tool: "get_product",
                  args_hint: { slug: first.content_slug },
                  reason: "Read offer + personas for a product",
                },
              ];
        return ok(
          {
            message: `${products.length} product(s)`,
            products,
          },
          {
            warnings: [
              {
                code: "compact_rows",
                message:
                  "Rows are summaries (no avatar text). Use get_product for offer/persona depth. Paused products are included unless include_paused:false.",
              },
              {
                code: "human_visibility",
                message:
                  "Sellable and store visibility are human-only. Agents propose_change notes; staff toggle in Store.",
              },
              ...(canEdit
                ? []
                : [
                    {
                      code: "read_only_grants",
                      message:
                        "This agent cannot update_product (needs content_edit_structure). Ask staff or a layout/structure agent to change audience.",
                    },
                  ]),
            ],
            next_actions: next,
          },
        );
      } catch (e) {
        return fail(`list_products failed: ${(e as Error).message}`);
      }
    },
  );

  mcp.tool(
    "get_product",
    "Read full product sidecar (_product.yml): offer, personas/avatar, selling flags, audience_status. " +
      "Use for site positioning and who we sell to after list_products. " +
      "Does not return journey membership — use get_product_funnel. Requires content_view.",
    {
      slug: z.string().describe("Product content slug, e.g. full-stack"),
      content_type: z.string().optional().describe("Default program"),
      site: z.string().optional(),
    },
    async ({ slug, content_type, site }) => {
      const viewDenied = await denyUnlessContentView(mcpToken, undefined, grants);
      if (viewDenied) return viewDenied;
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return fail(siteResult.error);
      const ct = content_type || "program";
      try {
        const url = `http://127.0.0.1:${MAIN_SERVER_PORT}/api/product/${encodeURIComponent(slug)}${siteQuery(
          siteResult.domain,
          { content_type: ct },
        )}`;
        const res = await fetch(url, { headers: internalHeaders(mcpToken) });
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          return fail((data.error as string) || `Server error: ${res.status}`);
        }
        const status = data.status as string;
        const canEdit =
          hasCapAnyScope(grants ?? [], "content_edit_structure") ||
          (await checkCap(mcpToken || "", "content_edit_structure", ct));
        const next =
          status === "missing"
            ? canEdit
              ? [
                  {
                    tool: "update_product",
                    args_hint: { slug, content_type: ct },
                    reason: "Set minimal offer + persona (confirm: true to write)",
                  },
                ]
              : [
                  {
                    tool: "propose_change",
                    args_hint: {
                      title: `Audience needed for ${slug}`,
                      summary:
                        "Product audience is missing. Staff or a structure agent should set offer + personas on the product in the Store Audience panel so funnel landings can bind this product.",
                    },
                    reason: "No content_edit_structure — ask a human / structure agent via proposal notes",
                  },
                ]
            : [
                {
                  tool: "get_product_funnel",
                  args_hint: { slug },
                  reason: "Optional: conversion journey pages for this product",
                },
              ];
        return ok(
          {
            message: `Product ${slug} (${status})`,
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
                message: "Reading product does not change funnel membership or page YAML.",
              },
              {
                code: "journey_separate",
                message: "Journey membership is not in this payload — use get_product_funnel.",
              },
            ],
            next_actions: next,
          },
        );
      } catch (e) {
        return fail(`get_product failed: ${(e as Error).message}`);
      }
    },
  );

  mcp.tool(
    "update_product",
    "Patch product sidecar offer, personas, name, description, product_id (preview unless confirm:true). " +
      "Cannot set purchasable or actively_selling — those are human Store decisions; use propose_change notes. " +
      "Persona ids immutable while funnel pages bind (incl. product self if bound); rename OK when unbound; duplicate ids rejected. Cannot remove while pages bind. Requires content_edit_structure.",
    {
      slug: z.string(),
      content_type: z.string().optional().describe("Default program"),
      product_id: z.string().optional(),
      name: z.string().optional(),
      description: z.union([z.string(), z.null()]).optional(),
      offer: z
        .object({
          one_liner: z.string().optional(),
          who_its_for: z.string().optional(),
          who_its_not_for: z.string().optional(),
          outcomes: z.array(z.string()).optional(),
          differentiators: z.array(z.string()).optional(),
        })
        .optional(),
      personas: z
        .array(
          z.object({
            id: z.string(),
            label: z.string().optional(),
            role: z.string().optional(),
            industry_or_context: z.string().optional(),
            demographics: z.string().optional(),
            buying_behavior: z.string().optional(),
            decision_criteria: z.array(z.string()).optional(),
            avatar: z
              .object({
                fears: z.array(z.string()).optional(),
                internal_dialogue: z.string().optional(),
                objections: z.array(z.string()).optional(),
                aspirational_identity: z.string().optional(),
                jobs_to_be_done: z.array(z.string()).optional(),
              })
              .optional(),
          }),
        )
        .optional(),
      clear_personas: z.array(z.string()).optional(),
      replace_personas: z.boolean().optional(),
      /** Refused — human only */
      actively_selling: z.boolean().optional(),
      /** Refused — human only */
      purchasable: z.boolean().optional(),
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

      if (args.actively_selling !== undefined || args.purchasable !== undefined) {
        return actionRequired(
          {
            action_required: "human_product_visibility",
            message: HUMAN_VISIBILITY_MSG,
            code: "human_product_visibility",
          },
          [
            {
              tool: "propose_change",
              args_hint: {
                title: `Product visibility for ${args.slug}`,
                summary:
                  args.actively_selling === false
                    ? `Please pause product ${args.slug} in the Store (actively selling off). Agents cannot change store visibility.`
                    : args.purchasable === false
                      ? `Please review removing purchasable for ${args.slug} via manual content process — API refuses un-indexing. Prefer pause in Store if the goal is hide from selling.`
                      : `Please set sellable/store visibility for ${args.slug} in the Store or content YAML. Agents cannot set purchasable or actively_selling.`,
              },
              reason: "Ask staff to change sellable / store visibility",
            },
          ],
        );
      }

      const patchBody: Record<string, unknown> = {
        content_type: ct,
      };
      if (args.product_id !== undefined) patchBody.product_id = args.product_id;
      if (args.name !== undefined) patchBody.name = args.name;
      if (args.description !== undefined) patchBody.description = args.description;
      if (args.offer !== undefined) patchBody.offer = args.offer;
      if (args.personas !== undefined) patchBody.personas = args.personas;
      if (args.clear_personas !== undefined) patchBody.clear_personas = args.clear_personas;
      if (args.replace_personas !== undefined) patchBody.replace_personas = args.replace_personas;

      if (!args.confirm) {
        return ok(
          {
            message: "Preview only — pass confirm: true to write product sidecar",
            slug: args.slug,
            content_type: ct,
            patch: patchBody,
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
                tool: "update_product",
                args_hint: { slug: args.slug, confirm: true },
                reason: "Confirm write",
              },
            ],
          },
        );
      }

      try {
        const url = `http://127.0.0.1:${MAIN_SERVER_PORT}/api/product/${encodeURIComponent(args.slug)}${siteQuery(domain)}`;
        const res = await fetch(url, {
          method: "PUT",
          headers: internalHeaders(mcpToken),
          body: JSON.stringify(patchBody),
        });
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          const code = data.code as string | undefined;
          if (code === "last_persona") {
            return actionRequired(
              {
                action_required: "keep_one_persona",
                message:
                  (data.error as string) ||
                  "The product must keep at least one persona. Add another first, or edit the existing one.",
                details: data.details,
              },
              [
                {
                  tool: "get_product",
                  args_hint: { slug: args.slug },
                  reason: "Review current personas before removing",
                },
              ],
            );
          }
          if (code === "duplicate_persona_id") {
            return actionRequired(
              {
                action_required: "fix_duplicate_persona_id",
                message:
                  (data.error as string) ||
                  "Each persona on a product needs a unique id.",
                details: data.details,
              },
              [
                {
                  tool: "get_product",
                  args_hint: { slug: args.slug },
                  reason: "Review persona ids before retrying",
                },
              ],
            );
          }
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
            message: `Product updated for ${args.slug}`,
            ...data,
          },
          {
            warnings: Array.isArray(data.warnings) ? (data.warnings as []) : [],
            side_effects: [
              {
                type: "content_write",
                summary: "Patched product sidecar",
                paths: data.relativePath ? [String(data.relativePath)] : [],
              },
            ],
            next_actions: [
              {
                tool: "get_product",
                args_hint: { slug: args.slug },
                reason: "Verify product",
              },
            ],
          },
        );
      } catch (e) {
        return fail(`update_product failed: ${(e as Error).message}`);
      }
    },
  );
}
