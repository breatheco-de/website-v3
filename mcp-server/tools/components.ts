import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  listComponents,
  getComponentSchema,
  getComponentVariant,
  resolveSiteContext,
  getMcpSiteConfigs,
} from "../lib/content.js";
import { assertSafeSegment, assertWithinBase } from "../lib/sanitize.js";
import { getTokenUsername } from "../lib/oauth.js";
import { resolveComponentPath } from "../../shared/registry-resolve.js";
import { denyUnlessContentView } from "../lib/auth.js";
import type { CatalogGrant } from "../lib/tool-catalog.js";
import { SITE_PARAM_DESC } from "../lib/entry-helpers.js";
import { ok, fail } from "../lib/respond.js";

const MAIN_SERVER_PORT = process.env.PORT || "5000";
const MCP_SERVER_SECRET = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";

function internalHeaders(mcpToken?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (MCP_SERVER_SECRET) {
    headers["Authorization"] = `Bearer ${MCP_SERVER_SECRET}`;
  }
  if (mcpToken) {
    const username = getTokenUsername(mcpToken);
    if (username) headers["x-mcp-author"] = username;
  }
  return headers;
}

function inheritForMcpFolder(contentFolder: string): string | undefined {
  const want = contentFolder.replace(/\\/g, "/").replace(/\/+$/, "");
  for (const c of getMcpSiteConfigs()) {
    const folder = c.contentFolder.replace(/\\/g, "/").replace(/\/+$/, "");
    if (folder === want) return (c as { inheritComponentsFrom?: string }).inheritComponentsFrom;
  }
  return undefined;
}

function assertResolvedComponent(componentType: string, contentFolder: string): string | null {
  try {
    const resolved = resolveComponentPath(
      componentType,
      contentFolder,
      process.cwd(),
      inheritForMcpFolder(contentFolder),
    );
    if (!resolved) return `Component '${componentType}' not found in registry.`;
    assertWithinBase(resolved.componentDir, resolved.registryRoot);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

export function registerComponentTools(
  mcp: McpServer,
  mcpToken?: string,
  grants?: CatalogGrant[],
): void {
  // list_components
  mcp.tool(
    "list_components",
    "List section component types available for one site: shared (platform) ∪ that site's registry. Each entry includes origin ('shared'|'site'). With multiple sites, pass site (domain). Does not list other sites' private types. Shared and site must not share the same type name (server boot error). Requires content_view.",
    {
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ site }) => {
      const viewDenied = await denyUnlessContentView(mcpToken, undefined, grants);
      if (viewDenied) return viewDenied;
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return { content: [{ type: "text", text: siteResult.error }], isError: true };
      const { contentPath } = siteResult;
      const components = listComponents(contentPath);
      return { content: [{ type: "text", text: JSON.stringify(components, null, 2) }] };
    }
  );

  // get_component_schema
  mcp.tool(
    "get_component_schema",
    "Get the top-level schema info for a component: name, description, when_to_use, and the list of variants (each with name, description, best_for). Resolves from shared or the selected site's registry. Use this to understand which variant fits your use case. Call get_component_variant next. Shared Zod/yml live in the app repo (shared/component-registry); site packages are content-synced. Requires content_view.",
    {
      componentType: z.string().describe("Component type name, e.g. 'faq', 'hero', 'two_column'"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ componentType, site }) => {
      const viewDenied = await denyUnlessContentView(mcpToken, undefined, grants);
      if (viewDenied) return viewDenied;
      try {
        assertSafeSegment(componentType, "componentType");
      } catch (e) {
        return { content: [{ type: "text", text: (e as Error).message }], isError: true };
      }
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return { content: [{ type: "text", text: siteResult.error }], isError: true };
      const { contentPath, contentFolder } = siteResult;
      const pathErr = assertResolvedComponent(componentType, contentFolder);
      if (pathErr) {
        return { content: [{ type: "text", text: pathErr }], isError: true };
      }
      const schema = getComponentSchema(componentType, contentPath);
      if (!schema) {
        return { content: [{ type: "text", text: `Component '${componentType}' not found in registry.` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify({ componentType, ...schema }, null, 2) }] };
    }
  );

  // get_component_variant
  mcp.tool(
    "get_component_variant",
    "Get the field definitions (variant_props) and a worked YAML example for a specific component variant. Call get_component_schema first to see the available variants, then call this tool with your chosen variant to get everything you need to write the YAML. Requires content_view.",
    {
      componentType: z.string().describe("Component type name, e.g. 'hero', 'faq', 'two_column'"),
      variant: z.string().describe("Variant name as listed by get_component_schema, e.g. 'singleColumn', 'showcase'"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ componentType, variant, site }) => {
      const viewDenied = await denyUnlessContentView(mcpToken, undefined, grants);
      if (viewDenied) return viewDenied;
      try {
        assertSafeSegment(componentType, "componentType");
        assertSafeSegment(variant, "variant");
      } catch (e) {
        return { content: [{ type: "text", text: (e as Error).message }], isError: true };
      }
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return { content: [{ type: "text", text: siteResult.error }], isError: true };
      const { contentPath, contentFolder } = siteResult;
      const pathErr = assertResolvedComponent(componentType, contentFolder);
      if (pathErr) {
        return { content: [{ type: "text", text: pathErr }], isError: true };
      }
      const detail = getComponentVariant(componentType, variant, contentPath);
      if (!detail) {
        return { content: [{ type: "text", text: `Variant '${variant}' not found for component '${componentType}'.` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(detail, null, 2) }] };
    }
  );

  // get_component_usage
  mcp.tool(
    "get_component_usage",
    "Investigate how a specific section component is used across the site — which pages include it, what position it appears at, and which components typically come before/after it. Scope the query by 'intent' or 'contentType' to keep the response focused and token-efficient. If neither is provided, the tool returns an error listing the available intents and content types so you can pick one. Requires content_view.",
    {
      componentType: z.string().describe("Component type name, e.g. 'hero', 'faq', 'two_column'"),
      intent: z.string().optional().describe("Filter to pages with this intent slug (e.g. 'bootcamp'). Either intent or contentType is required."),
      contentType: z.string().optional().describe("Filter to pages of this content type (e.g. 'landing-page'). Either intent or contentType is required."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ componentType, intent, contentType, site }) => {
      const viewDenied = await denyUnlessContentView(mcpToken, contentType, grants);
      if (viewDenied) return viewDenied;
      try {
        assertSafeSegment(componentType, "componentType");
      } catch (e) {
        return { content: [{ type: "text", text: (e as Error).message }], isError: true };
      }

      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return { content: [{ type: "text", text: siteResult.error }], isError: true };
      const { domain } = siteResult;

      const params = new URLSearchParams();
      if (intent) params.set("intent", intent);
      if (contentType) params.set("contentType", contentType);
      params.set("__site", domain);

      const url = `http://localhost:${MAIN_SERVER_PORT}/api/private/component-insights/component/${encodeURIComponent(componentType)}?${params}`;
      try {
        const res = await fetch(url, { headers: internalHeaders(mcpToken) });
        const json = await res.json();
        if (!res.ok) {
          return { content: [{ type: "text", text: JSON.stringify(json, null, 2) }], isError: res.status !== 400 };
        }
        return { content: [{ type: "text", text: JSON.stringify(json, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Failed to fetch component usage: ${(e as Error).message}` }], isError: true };
      }
    }
  );

  // create_component_section_demo
  mcp.tool(
    "create_component_section_demo",
    "Create a disposable single-section preview for humans. Pass componentType plus YAML for exactly one section (use-case-specific copy/stats). Validates against the registry schema, writes `.cache/component-section-demos/{hash}.yml`, and returns preview_url at /private/demo/{hash}. Hash is the only access control (no staff login). Demos are wiped on every production redeploy and are not a page publish. Requires content_view.",
    {
      componentType: z.string().describe("Component type name, e.g. 'graduates_stats', 'value_proof_panel'"),
      yaml: z
        .string()
        .describe(
          "YAML for exactly one section object (or a one-element array / { sections: [one] }). Must include type matching componentType.",
        ),
      version: z
        .string()
        .optional()
        .describe("Registry version folder, e.g. 'v1.0'. Defaults to latest / section.version."),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ componentType, yaml: yamlText, version, site }) => {
      const viewDenied = await denyUnlessContentView(mcpToken, undefined, grants);
      if (viewDenied) return viewDenied;
      try {
        assertSafeSegment(componentType, "componentType");
      } catch (e) {
        return fail((e as Error).message);
      }

      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return fail(siteResult.error);
      const { domain, contentFolder } = siteResult;

      const pathErr = assertResolvedComponent(componentType, contentFolder);
      if (pathErr) return fail(pathErr);

      const url = `http://localhost:${MAIN_SERVER_PORT}/api/component-section-demos?__site=${encodeURIComponent(domain)}`;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: internalHeaders(mcpToken),
          body: JSON.stringify({
            componentType,
            yaml: yamlText,
            ...(version ? { version } : {}),
          }),
        });
        const json = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          return fail(
            typeof json.error === "string" ? json.error : `Failed to create demo (${res.status})`,
            {
              property_path: json.property_path,
              details: json.details,
              http_status: res.status,
            },
          );
        }

        const hash = typeof json.hash === "string" ? json.hash : "";
        const previewUrl = typeof json.preview_url === "string" ? json.preview_url : "";
        const relativePath =
          typeof json.path === "string"
            ? json.path
            : hash
              ? `.cache/component-section-demos/${hash}.yml`
              : undefined;

        return ok(
          {
            hash,
            preview_url: previewUrl,
            path: relativePath,
            componentType,
            version: json.version ?? version ?? null,
          },
          {
            warnings: [
              {
                code: "demo_not_a_publish",
                message:
                  "This does not write content YAML or publish a page — it only stores a temporary section preview.",
              },
              {
                code: "demo_world_readable_with_url",
                message:
                  "Anyone with the preview_url can view the section (hash is the access secret). Do not put secrets or private PII in the YAML.",
              },
              {
                code: "demo_wiped_on_redeploy",
                message:
                  "Demo files under .cache/component-section-demos/ are deleted on every production redeploy; the link will 404 afterward.",
              },
              {
                code: "demo_single_section_only",
                message: "v1 demos render exactly one section — no page chrome or multi-section layouts.",
              },
            ],
            side_effects: relativePath
              ? [
                  {
                    kind: "write_demo_file",
                    summary: "Wrote ephemeral component section demo YAML",
                    paths: [relativePath],
                  },
                ]
              : [
                  {
                    kind: "write_demo_file",
                    summary: "Wrote ephemeral component section demo YAML",
                  },
                ],
            next_actions: [],
          },
        );
      } catch (e) {
        return fail(`Failed to create component section demo: ${(e as Error).message}`);
      }
    }
  );

}
