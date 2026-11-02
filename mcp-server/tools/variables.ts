/**
 * MCP list_variables — site facts catalog (variables.yml) for writers and reviewers. Read-only.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, fail, actionRequired, type McpWarning, type NextAction } from "../lib/respond.js";
import { resolveSiteContext } from "../lib/content.js";
import { denyUnlessContentView } from "../lib/auth.js";
import type { CatalogGrant } from "../lib/tool-catalog.js";
import { buildLoopbackHeaders } from "../lib/loopback.js";

const MAIN_SERVER_PORT = process.env.PORT || "5000";

const CATEGORY_VALUES = [
  "price",
  "outcome_claim",
  "social_proof",
  "product_fact",
  "company_fact",
  "contact",
  "link",
  "copy",
  "system",
] as const;

/** Facts every response repeats so agents never drop a non-effect. */
export const LIST_VARIABLES_STANDING_WARNINGS: McpWarning[] = [
  {
    code: "do_not_hardcode_figures",
    message:
      "Paste the token (e.g. {{ global.price_fullstack | 16,999 }}) instead of typing the number. Tokens resolve per visitor location/region/locale; a literal freezes one region's value.",
  },
  {
    code: "read_only",
    message:
      "list_variables does not write. Values and metadata change only at /private/variables (staff). A stale fact → propose_change kind:\"notes\" (\"update global.x to Y, source …\") and keep the token.",
  },
  {
    code: "per_site_file",
    message:
      "Each site has its own site_*/variables.yml. Pass site for another site; values and names can differ.",
  },
  {
    code: "system_managed_in_settings",
    message: "brand.*, reserved.* and consent keys are read_only here — edited in Settings (Brand / Legal / Consent).",
  },
];

type CatalogBody = {
  mode: "catalog";
  rows: Array<Record<string, unknown>>;
  total: number;
  counts_by_category: Record<string, number>;
  missing_description_count: number;
  deprecated_hidden: number;
  context_ignored: boolean;
};

type DetailBody = {
  mode: "detail";
  variables: Array<Record<string, unknown> & { name: string }>;
  unknown_names: Array<{ name: string; close_matches: string[] }>;
  deprecated: Array<{ name: string; replaced_by: string | null }>;
  site_context: { regions: string[]; locations: string[]; locales: string[] };
  audience?: { regions: string[]; locations: string[]; source: string; warnings: string[] };
};

type ErrorBody = {
  error?: string;
  code?: string;
  unknown?: string[];
  valid_regions?: string[];
  valid_locations?: string[];
  valid_locales?: string[];
};

export function buildVariablesQuery(args: {
  domain?: string | null;
  category?: string | string[];
  figures_only?: boolean;
  facts_only?: boolean;
  query?: string;
  include_deprecated?: boolean;
  names?: string[];
  context?: {
    region?: string;
    locale?: string;
    location?: string;
    entry?: { contentType: string; slug: string; locale?: string };
  };
}): string {
  const p = new URLSearchParams();
  const cats = Array.isArray(args.category) ? args.category : args.category ? [args.category] : [];
  if (cats.length) p.set("category", cats.join(","));
  if (args.figures_only) p.set("figures_only", "true");
  if (args.facts_only) p.set("facts_only", "true");
  if (args.query) p.set("query", args.query);
  if (args.include_deprecated) p.set("include_deprecated", "true");
  if (args.names?.length) p.set("names", args.names.join(","));
  const c = args.context;
  if (c?.region) p.set("region", c.region);
  if (c?.location) p.set("location", c.location);
  if (c?.locale) p.set("locale", c.locale);
  if (c?.entry) {
    p.set("entry_type", c.entry.contentType);
    p.set("entry_slug", c.entry.slug);
    if (c.entry.locale) p.set("entry_locale", c.entry.locale);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function registerVariableTools(
  mcp: McpServer,
  mcpToken?: string,
  grants?: CatalogGrant[],
): void {
  mcp.tool(
    "list_variables",
    "Site facts catalog (variables.yml): prices, outcome claims, social proof, product/company facts, contacts, links. " +
      "Without names → compact catalog (description, category, unit, default, varies_by). " +
      "With names (≤20) → full definitions, condition order, paste-ready token, usage_count; " +
      "context {region|location|locale} adds resolved value; context.entry adds the page audience and literal_ok. " +
      "Check facts here before writing numbers. Read-only. Requires content_view.",
    {
      site: z.string().optional().describe("Site domain when multi-site"),
      category: z
        .union([z.enum(CATEGORY_VALUES), z.array(z.enum(CATEGORY_VALUES))])
        .optional()
        .describe("Filter catalog rows by category (one or many)"),
      figures_only: z.boolean().optional().describe("Catalog rows limited to price, outcome_claim, social_proof"),
      facts_only: z
        .boolean()
        .optional()
        .describe("Catalog rows limited to fact categories (figures + product_fact, company_fact, contact)"),
      query: z.string().optional().describe("Search names and descriptions (catalog mode)"),
      include_deprecated: z.boolean().optional().describe("Default false — deprecated rows hidden in catalog mode"),
      names: z
        .array(z.string())
        .max(20)
        .optional()
        .describe("Detail mode: variable names (global.x or bare x). Deprecated names always returned."),
      context: z
        .object({
          region: z.string().optional(),
          locale: z.string().optional(),
          location: z.string().optional(),
          entry: z
            .object({
              contentType: z.string(),
              slug: z.string(),
              locale: z.string().optional(),
            })
            .optional()
            .describe("Page whose hand-set region/locations decide the audience. Not combinable with region/location."),
        })
        .optional()
        .describe("Detail mode only. Unknown values fail with the valid lists."),
    },
    async (args) => {
      const viewDenied = await denyUnlessContentView(mcpToken, undefined, grants);
      if (viewDenied) return viewDenied;
      const siteResult = resolveSiteContext(args.site);
      if (!siteResult.ok) return fail(siteResult.error);

      try {
        const url = `http://127.0.0.1:${MAIN_SERVER_PORT}/api/variables/catalog${buildVariablesQuery({
          ...args,
          domain: siteResult.domain,
        })}`;
        const res = await fetch(url, { headers: buildLoopbackHeaders(mcpToken, { site: siteResult.domain }) });
        const data = (await res.json()) as CatalogBody | DetailBody | ErrorBody;

        if (!res.ok) {
          const err = data as ErrorBody;
          if (err.code === "unknown_context_value") {
            return actionRequired(
              {
                action_required: "unknown_context_value",
                message: err.error,
                unknown: err.unknown ?? [],
                valid_regions: err.valid_regions ?? [],
                valid_locations: err.valid_locations ?? [],
                valid_locales: err.valid_locales ?? [],
              },
              [
                {
                  tool: "list_variables",
                  reason: "Retry with a context value from the valid lists (or drop context)",
                  args_hint: { names: args.names, context: {} },
                },
              ],
            );
          }
          if (err.code === "context_conflict" || err.code === "entry_not_found") {
            return actionRequired(
              { action_required: err.code, message: err.error },
              [
                err.code === "entry_not_found"
                  ? {
                      tool: "list_entries",
                      reason: "Find the entry's contentType/slug, then retry list_variables with context.entry",
                    }
                  : {
                      tool: "list_variables",
                      reason: "Pass either context.entry or region/location, not both",
                      args_hint: { names: args.names, context: { entry: args.context?.entry } },
                    },
              ],
            );
          }
          return fail(err.error || `Server error: ${res.status}`, err.code ? { code: err.code } : undefined);
        }

        const warnings: McpWarning[] = [...LIST_VARIABLES_STANDING_WARNINGS];

        if ((data as CatalogBody).mode === "catalog") {
          const cat = data as CatalogBody;
          if (cat.missing_description_count > 0) {
            warnings.unshift({
              code: "missing_description_count",
              message: `${cat.missing_description_count} variable(s) lack a description or category (missing_description: true). Guess cautiously; staff fill them at /private/variables. Diagnostics carries VARIABLE_MISSING_* (coding_agent_only → notes handoff).`,
            });
          }
          if (cat.context_ignored) {
            warnings.push({
              code: "context_ignored",
              message: "context applies only with names (detail mode). Catalog rows show defaults.",
            });
          }
          if (cat.deprecated_hidden > 0) {
            warnings.push({
              code: "deprecated_hidden",
              message: `${cat.deprecated_hidden} deprecated row(s) hidden. include_deprecated:true to list them; names always returns them.`,
            });
          }
          const firstFigure = cat.rows.find((r) => typeof r.name === "string")?.name as string | undefined;
          const next: NextAction[] = [
            {
              tool: "list_variables",
              reason: "Get conditions, paste-ready token and the value a page's audience sees",
              args_hint: {
                names: firstFigure ? [firstFigure] : ["global.<name>"],
                context: { entry: { contentType: "<type>", slug: "<slug>", locale: "<locale>" } },
              },
            },
          ];
          return ok(
            {
              message: `${cat.total} variable(s)`,
              mode: "catalog",
              counts_by_category: cat.counts_by_category,
              missing_description_count: cat.missing_description_count,
              variables: cat.rows,
            },
            { warnings, next_actions: next },
          );
        }

        const det = data as DetailBody;
        for (const d of det.deprecated) {
          warnings.unshift({
            code: "deprecated_variable",
            message: d.replaced_by
              ? `${d.name} is deprecated — use ${d.replaced_by} for new writes (existing pages still resolve it).`
              : `${d.name} is deprecated — do not use it for new writes (existing pages still resolve it).`,
          });
        }
        if (det.unknown_names.length) {
          warnings.unshift({
            code: "unknown_variable_names",
            message: det.unknown_names
              .map((u) =>
                u.close_matches.length ? `${u.name} (close: ${u.close_matches.join(", ")})` : `${u.name} (no close match)`,
              )
              .join("; "),
          });
        }
        if (det.audience?.warnings?.length) {
          for (const w of det.audience.warnings) warnings.push({ code: "audience_location_unknown", message: w });
        }
        if (det.audience) {
          warnings.push({
            code: "page_audience",
            message:
              det.audience.source === "none"
                ? "Entry sets no region/locations: literal_ok is null for facts that vary by region — use the token. Staff can add region or locations: [slug] to the entry."
                : `Audience from hand-set ${det.audience.source}: ${[...det.audience.regions, ...det.audience.locations].join(", ")}. literal_ok is the only literal allowed on this page; tokens still resolve per visitor.`,
          });
        }
        return ok(
          {
            message: `${det.variables.length} variable(s)`,
            mode: "detail",
            variables: det.variables,
            unknown_names: det.unknown_names,
            site_context: det.site_context,
            ...(det.audience ? { audience: det.audience } : {}),
          },
          { warnings, next_actions: [] },
        );
      } catch (e) {
        return fail(`list_variables failed: ${(e as Error).message}`);
      }
    },
  );
}
