/**
 * MCP tools for CMS products: list / get / create_or_update sidecar + funnel journey reads.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, fail, actionRequired, type DiscoveryPath } from "../lib/respond.js";
import { resolveSiteContext } from "../lib/content.js";
import { denyUnlessContentView, checkCap, denyResponse } from "../lib/auth.js";
import { hasCapAnyScope, type CatalogGrant } from "../lib/tool-catalog.js";
import { registerEcommerceTools } from "./ecommerce.js";
import { buildLoopbackHeaders } from "../lib/loopback.js";
import { requiredAgentSessionIdField } from "../lib/page-tool-helpers.js";

const MAIN_SERVER_PORT = process.env.PORT || "5000";

function siteQuery(domain: string | null | undefined, extra?: Record<string, string>): string {
  const params = new URLSearchParams();
  if (domain) params.set("__site", domain);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) params.set(k, v);
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

function buildProductDiscoveryPath(opts: {
  slug: string;
  content_type: string;
  mode: "create" | "audience";
  canList: boolean;
  canGet: boolean;
}): DiscoveryPath {
  return {
    goal:
      opts.mode === "create"
        ? "Decide sellable identity, then research peers before inventing audience"
        : "Clarify audience with the user and compare peer products/personas before writing",
    items: [
      {
        kind: "think",
        id: "clarify_audience",
        title: "Clarify what you do not know",
        why: "Vague who-it’s-for invents weak personas",
        look_for: ["who it’s for / not for", "outcomes", "differentiators", "ask the user in chat"],
      },
      {
        kind: "think",
        id: "differentiate_offer",
        title: "Differentiate from sibling products",
        why: "Avoid clone one-liners across the catalog",
        look_for: ["how this offer differs", "unique outcomes"],
      },
      {
        kind: "think",
        id: "reuse_or_split_personas",
        title: "Reuse vs invent personas",
        why: "Do not copy avatar fears/objections verbatim from peers",
        look_for: ["similar roles", "new persona id only when needed"],
      },
      {
        kind: "tool",
        id: "list_peer_products",
        tool: "list_products",
        why: "Inventory selling flags, audience status, persona ids",
        look_for: ["audience_status", "persona ids", "paused vs selling"],
        available: opts.canList,
        ...(opts.canList ? {} : { hint: "Needs content_view — ask staff to enable, then refresh MCP" }),
      },
      {
        kind: "tool",
        id: "read_peer_product",
        tool: "get_product",
        why: "Depth on 1–2 peers for offer/persona/avatar comparison",
        look_for: ["offer.one_liner", "persona avatar fears/objections"],
        available: opts.canGet,
        ...(opts.canGet ? {} : { hint: "Needs content_view — ask staff to enable, then refresh MCP" }),
      },
      {
        kind: "tool",
        id: "product_mental_model",
        tool: "explain_site",
        why: "Minimal audience fields and non-effects",
        look_for: ["topic product", "purchasable vs actively_selling"],
        available: opts.canList,
      },
    ],
    non_effects: [
      "Skip is allowed — discovery_path does not block confirm: true",
      "Does not bind funnel pages or edit page YAML",
      "Creating sellable without audience remains allowed",
      "Billing plans stay outside CMS",
    ],
  };
}

export function registerProductTools(
  mcp: McpServer,
  mcpToken?: string,
  grants?: CatalogGrant[],
): void {
  registerEcommerceTools(mcp, mcpToken, grants);

  mcp.tool(
    "list_products",
    "List CMS products (selling flag, audience status, persona ids). " +
      "Removed (not sellable) products are hidden unless include_removed: true. " +
      "Use first for what we sell / who for; then get_product for offer/avatar depth. " +
      "Paused included by default. Requires content_view.",
    {
      include_paused: z
        .boolean()
        .optional()
        .describe("Default true — include paused products"),
      include_removed: z
        .boolean()
        .optional()
        .describe("Default false — omit soft-removed (purchasable:false) products"),
      content_type: z.string().optional(),
      site: z.string().optional().describe("Site domain when multi-site"),
    },
    async ({ include_paused, include_removed, content_type, site }) => {
      const viewDenied = await denyUnlessContentView(mcpToken, undefined, grants);
      if (viewDenied) return viewDenied;
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return fail(siteResult.error);
      try {
        const extra: Record<string, string> = {
          include_paused: include_paused === false ? "false" : "true",
          include_removed: include_removed === true ? "true" : "false",
        };
        if (content_type) extra.content_type = content_type;
        const url = `http://127.0.0.1:${MAIN_SERVER_PORT}/api/product${siteQuery(siteResult.domain, extra)}`;
        const res = await fetch(url, { headers: buildLoopbackHeaders(mcpToken) });
        const data = (await res.json()) as {
          products?: Array<{ content_slug: string; audience_status?: string; purchasable?: boolean }>;
          error?: string;
        };
        if (!res.ok) {
          return fail(data.error || `Server error: ${res.status}`);
        }
        const products = data.products ?? [];
        const canEdit =
          hasCapAnyScope(grants ?? [], "content_edit_structure") ||
          (await checkCap(mcpToken || "", "content_edit_structure", content_type || "program"));
        const canManage =
          hasCapAnyScope(grants ?? [], "product_manage") ||
          (await checkCap(mcpToken || "", "product_manage", content_type || "program"));
        const first = products[0];
        const next =
          products.length === 0
            ? [
                {
                  tool: "explain_site",
                  args_hint: { topic: "product" },
                  reason: "No products in list — read product mental model (try include_removed if expecting soft-removed)",
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
                  "Rows are summaries (no avatar text). Use get_product for offer/persona depth. Removed products omitted unless include_removed:true.",
              },
              ...(canManage
                ? []
                : [
                    {
                      code: "sellable_needs_product_manage",
                      message:
                        "Make sellable / remove / pause need product_manage. Audience edits need content_edit_structure via create_or_update_product.",
                    },
                  ]),
              ...(canEdit
                ? []
                : [
                    {
                      code: "read_only_grants",
                      message:
                        "This agent cannot create_or_update_product audience (needs content_edit_structure).",
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
      "Works for soft-removed (not sellable) products too — response warns when not sellable. " +
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
        const res = await fetch(url, { headers: buildLoopbackHeaders(mcpToken) });
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          return fail((data.error as string) || `Server error: ${res.status}`);
        }
        const status = data.status as string;
        const product = data.product as { purchasable?: boolean } | undefined;
        const canEdit =
          hasCapAnyScope(grants ?? [], "content_edit_structure") ||
          (await checkCap(mcpToken || "", "content_edit_structure", ct));
        const canManage =
          hasCapAnyScope(grants ?? [], "product_manage") ||
          (await checkCap(mcpToken || "", "product_manage", ct));
        const next =
          product?.purchasable === false
            ? canManage
              ? [
                  {
                    tool: "create_or_update_product",
                    args_hint: { slug, content_type: ct, purchasable: true },
                    reason: "Make sellable again (preview then confirm: true)",
                  },
                ]
              : [
                  {
                    tool: "propose_change",
                    args_hint: {
                      title: `Make ${slug} sellable again`,
                      summary: "Product is not sellable (removed). Staff with product_manage should re-enable.",
                    },
                    reason: "No product_manage",
                  },
                ]
            : status === "missing"
              ? canEdit
                ? [
                    {
                      tool: "create_or_update_product",
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
                          "Product audience is missing. Staff or a structure agent should set offer + personas.",
                      },
                      reason: "No content_edit_structure",
                    },
                  ]
              : [
                  {
                    tool: "get_product_funnel",
                    args_hint: { slug },
                    reason: "Optional: conversion journey pages for this product",
                  },
                ];
        const warnings: { code: string; message: string }[] = [
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
            message:
              "Journey membership is not in this payload — use get_product_funnel to read; write with update_fields / update_entry_attributes (funnel.*) or Funnel tab.",
          },
        ];
        if (Array.isArray(data.warnings)) {
          for (const w of data.warnings as { code: string; message: string }[]) {
            warnings.push(w);
          }
        } else if (product?.purchasable === false) {
          warnings.push({
            code: "not_sellable",
            message:
              "This product is not sellable right now (removed). Distinct from paused. Audience can still be edited.",
          });
        }
        return ok(
          {
            message: `Product ${slug} (${status}${product?.purchasable === false ? ", not sellable" : ""})`,
            ...data,
          },
          {
            warnings,
            next_actions: next,
          },
        );
      } catch (e) {
        return fail(`get_product failed: ${(e as Error).message}`);
      }
    },
  );

  mcp.tool(
    "create_or_update_product",
    "Create or patch product sidecar (_product.yml). " +
      "Audience/name/description need content_edit_structure. " +
      "purchasable / actively_selling need product_manage (make sellable, remove, pause/resume). " +
      "Preview unless confirm:true. " +
      "Persona ids immutable while funnel pages bind; cannot remove last persona while bound. " +
      "Tracking short_key (product + personas): missing keys are filled with a suggestion on every write; " +
      "saved keys are locked unless rename_short_key: true (old key retired, never reused). " +
      "Not update_fields — sidecar only.",
    {
      slug: z.string(),
      content_type: z.string().optional().describe("Default program"),
      product_id: z.string().optional(),
      name: z.string().optional(),
      short_key: z
        .string()
        .optional()
        .describe("Product tracking code for GA4: 2-6 [a-z0-9], unique among the site's products; not all/none"),
      rename_short_key: z
        .boolean()
        .optional()
        .describe("Allow changing saved product/persona short_key; the old key is retired (old reports keep it)"),
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
            short_key: z
              .string()
              .optional()
              .describe("Persona tracking code: 2-6 [a-z0-9], unique across ALL personas on the site"),
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
      actively_selling: z.boolean().optional(),
      purchasable: z.boolean().optional(),
      site: z.string().optional(),
      confirm: z.boolean().optional().describe("Preview when omitted; set true to write"),
      ...requiredAgentSessionIdField,
    },
    async (args) => {
      const siteResult = resolveSiteContext(args.site);
      if (!siteResult.ok) return fail(siteResult.error);
      const domain = siteResult.domain;
      const ct = args.content_type || "program";
      const touchesSellable =
        args.actively_selling !== undefined || args.purchasable !== undefined;
      const touchesAudience =
        args.offer !== undefined ||
        args.personas !== undefined ||
        (args.clear_personas !== undefined && args.clear_personas.length > 0) ||
        args.replace_personas === true ||
        args.name !== undefined ||
        args.description !== undefined ||
        args.product_id !== undefined ||
        args.short_key !== undefined;

      if (touchesSellable) {
        if (!(await checkCap(mcpToken || "", "product_manage", ct))) {
          return actionRequired(
            {
              action_required: "need_product_manage",
              message:
                "Making sellable, removing from the index, or pause/resume requires product_manage. Ask staff to grant it or propose_change notes.",
              code: "need_product_manage",
            },
            [
              {
                tool: "propose_change",
                args_hint: {
                  title: `Product visibility for ${args.slug}`,
                  summary:
                    args.actively_selling === false
                      ? `Please pause product ${args.slug} in the Store.`
                      : args.purchasable === false
                        ? `Please remove purchasable for ${args.slug} (or pause if temporary).`
                        : `Please make ${args.slug} sellable / update store visibility.`,
                },
                reason: "Ask staff with product_manage",
              },
            ],
          );
        }
      }
      if (touchesAudience || !touchesSellable) {
        if (!(await checkCap(mcpToken || "", "content_edit_structure", ct))) {
          return denyResponse("content_edit_structure", ct);
        }
      }

      const patchBody: Record<string, unknown> = {
        content_type: ct,
      };
      if (args.product_id !== undefined) patchBody.product_id = args.product_id;
      if (args.name !== undefined) patchBody.name = args.name;
      if (args.short_key !== undefined) patchBody.short_key = args.short_key;
      if (args.rename_short_key !== undefined) patchBody.rename_short_key = args.rename_short_key;
      if (args.description !== undefined) patchBody.description = args.description;
      if (args.offer !== undefined) patchBody.offer = args.offer;
      if (args.personas !== undefined) patchBody.personas = args.personas;
      if (args.clear_personas !== undefined) patchBody.clear_personas = args.clear_personas;
      if (args.replace_personas !== undefined) patchBody.replace_personas = args.replace_personas;
      if (args.actively_selling !== undefined) patchBody.actively_selling = args.actively_selling;
      if (args.purchasable !== undefined) patchBody.purchasable = args.purchasable;

      const discoveryNeeded =
        args.purchasable === true ||
        args.offer !== undefined ||
        args.personas !== undefined ||
        args.replace_personas === true;
      const canView =
        hasCapAnyScope(grants ?? [], "content_view") ||
        (await checkCap(mcpToken || "", "content_view", ct));

      if (!args.confirm) {
        const warnings: { code: string; message: string }[] = [
          {
            code: "preview",
            message: "No files written. confirm: true persists to _product.yml.",
          },
        ];
        if (args.purchasable === true && !args.offer && !args.personas) {
          warnings.push({
            code: "thin_create",
            message:
              "Thin create is allowed — product becomes sellable without audience. Prefer setting offer + personas next so funnel landings can bind personas.",
          });
        }
        const discovery_path = discoveryNeeded
          ? buildProductDiscoveryPath({
              slug: args.slug,
              content_type: ct,
              mode: args.purchasable === true && !args.offer && !args.personas ? "create" : "audience",
              canList: canView,
              canGet: canView,
            })
          : undefined;
        return ok(
          {
            message: "Preview only — pass confirm: true to write product sidecar",
            slug: args.slug,
            content_type: ct,
            patch: patchBody,
            ...(discovery_path ? { discovery_path } : {}),
          },
          {
            warnings,
            next_actions: [
              {
                tool: "create_or_update_product",
                args_hint: { slug: args.slug, confirm: true },
                reason: "Confirm write (discovery_path is optional — skip allowed)",
              },
            ],
          },
        );
      }

      try {
        const url = `http://127.0.0.1:${MAIN_SERVER_PORT}/api/product/${encodeURIComponent(args.slug)}${siteQuery(domain)}`;
        const res = await fetch(url, {
          method: "PUT",
          headers: buildLoopbackHeaders(mcpToken, { agentSessionId: args.agent_session_id }),
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
          if (code === "short_key_locked" || code === "short_key_conflict" || code === "invalid_short_key") {
            return actionRequired(
              {
                action_required:
                  code === "short_key_locked" ? "confirm_short_key_rename" : "pick_another_short_key",
                message:
                  (data.error as string) ||
                  "Tracking key rejected. Keys are 2-6 [a-z0-9], unique per site (retired keys count), locked once saved.",
                details: data.details,
                property_path:
                  (data.details as { persona?: string } | undefined)?.persona
                    ? "_product.yml personas[].short_key"
                    : "_product.yml short_key",
              },
              [
                {
                  tool: "get_product",
                  args_hint: { slug: args.slug },
                  reason:
                    code === "short_key_locked"
                      ? "Keep the saved key, or retry with rename_short_key: true (old key retired; reports split)"
                      : "Read tracking_keys.taken_* to pick a free key",
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
          if (code === "blocking_products") {
            return actionRequired(
              {
                action_required: "remove_blocking_products",
                message: (data.error as string) || "Type still has sellable products",
                blocking_products: data.blocking_products,
              },
              [
                {
                  tool: "list_products",
                  args_hint: { content_type: ct },
                  reason: "List sellable products blocking the type toggle",
                },
              ],
            );
          }
          return fail((data.error as string) || `Server error: ${res.status}`, { code });
        }
        const product = data.product as { purchasable?: boolean } | undefined;
        const warnings: { code: string; message: string }[] = Array.isArray(data.warnings)
          ? [...(data.warnings as { code: string; message: string }[])]
          : [];
        if (product?.purchasable === false) {
          warnings.push({
            code: "not_sellable",
            message:
              "Product is not sellable right now. Store/journey treat it as off until Make sellable again.",
          });
        }
        return ok(
          {
            message: `Product updated for ${args.slug}`,
            ...data,
          },
          {
            warnings,
            side_effects: [
              {
                kind: "content_write",
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
        return fail(`create_or_update_product failed: ${(e as Error).message}`);
      }
    },
  );
}
