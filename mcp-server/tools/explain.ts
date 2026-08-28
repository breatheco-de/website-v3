import fs from "fs";
import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import yaml from "js-yaml";
import { resolveSiteContext } from "../lib/content.js";
import { SITE_PARAM_DESC, siteFailResult } from "../lib/entry-helpers.js";
import { denyUnlessContentView } from "../lib/auth.js";
import type { CatalogGrant } from "../lib/tool-catalog.js";

// Use cwd so this resolves correctly both under tsx (mcp-server/…) and the
// production bundle (dist/mcp-server.js).
const EXPLAIN_DIR = path.join(process.cwd(), "mcp-server", "explain");

const VALID_TOPICS = [
  "overview",
  "content_system",
  "routing",
  "images",
  "sections",
  "semantic_search",
  "local_databases",
  "component-behaviors",
  "ecommerce",
  "shared-layout",
  "relation-fields",
  "lead-forms",
  "redirects",
] as const;
type Topic = (typeof VALID_TOPICS)[number];

const TOPIC_DESC: Record<string, string> = {
  overview: "Start here — architectural summary and guide to all topics",
  content_system: "YAML content files, _common.yml merge, SEO clustering inventory + links, safeYamlLoad",
  routing:
    "URL patterns, locale prefixes (/en/, /es/), dynamic routes, ?cache=false HTML cache bypass",
  images: "Image registry, UniversalImage, image_id, get_or_set_image_to_gallery MCP",
  sections: "SectionRenderer, component registry, in-page CTA hashes (#section_id modal/scroll, inline#, #top/#bottom)",
  semantic_search:
    "Qdrant vector store, local embeddings, database vector_search, keyword fallback",
  local_databases:
    "Local YAML private DBs; MCP item CRUD; global index; FAQ database; sync + reindex",
  "component-behaviors": "CTA tracking, conversion_events catalog, CRM tags allowlist",
  ecommerce: "products, funnels, product scope property paths, no CMS plans",
  "shared-layout":
    "single_template / shared shell, create_entry playbook, blog as example",
  "relation-fields":
    "relation editor type, authors hubs, listing deslugify vs page hydrate, delete_entries reassign",
  "lead-forms":
    "catalog source content_type/database/related_field, required value_path/label_path, required query on ecommerce catalogs, purchasable vs actively_selling",
  redirects:
    "CMS 301/302: two stores, first-match, test_redirect (read_redirects) + update_redirect (edit_redirects), before_from custom-only",
};

type TagResolver = (contentPath: string) => string;

// ─── Dynamic tag resolvers ────────────────────────────────────────────────────

function resolveContentTypes(contentPath: string): string {
  const filePath = path.join(contentPath, "content-types.yml");
  if (!fs.existsSync(filePath)) return "_content-types.yml not found_";
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = yaml.load(raw) as Record<string, Record<string, unknown>> | null;
    if (!parsed) return "_could not parse content-types.yml_";
    const lines: string[] = [
      "| Type | Directory | URL pattern | DB-backed | single_template |",
      "|---|---|---|---|---|",
    ];
    for (const [type, config] of Object.entries(parsed)) {
      const dir = (config.directory as string | undefined) || type;
      const pattern = config.url_pattern
        ? Object.entries(config.url_pattern as Record<string, string>)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ")
        : "—";
      const dbBacked = config.database ? "yes" : "no";
      const singleTemplate = config.single_template ? "yes" : "no";
      lines.push(`| \`${type}\` | \`${dir}\` | ${pattern} | ${dbBacked} | ${singleTemplate} |`);
    }
    return lines.join("\n");
  } catch {
    return "_error reading content-types.yml_";
  }
}

function resolveActiveLocales(contentPath: string): string {
  const filePath = path.join(contentPath, "settings.yml");
  if (!fs.existsSync(filePath)) return "_settings.yml not found_";
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = yaml.load(raw) as Record<string, unknown> | null;
    if (!parsed) return "_could not parse settings.yml_";
    const i18n = parsed.i18n as Record<string, unknown> | undefined;
    if (!i18n) return "_no i18n section in settings.yml_";
    const defaultLocale = i18n.default_locale as string | undefined;
    const supported = i18n.supported_locales as Array<{ code: string; label: string }> | undefined;
    if (!supported || !supported.length) return "_no supported_locales defined_";
    const lines: string[] = ["| Code | Label | Default |", "|---|---|---|"];
    for (const locale of supported) {
      const isDefault = locale.code === defaultLocale ? "yes" : "";
      lines.push(`| \`${locale.code}\` | ${locale.label} | ${isDefault} |`);
    }
    return lines.join("\n");
  } catch {
    return "_error reading settings.yml_";
  }
}

function resolveImageStorage(contentPath: string): string {
  const folder = path.basename(contentPath);
  const filePath = path.join(contentPath, "image-registry.json");
  if (!fs.existsSync(filePath)) return "_image-registry.json not found_";
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const registry = JSON.parse(raw) as Record<string, unknown>;
    const presets = registry.presets as Record<string, { description?: string }> | undefined;
    const presetNames = presets ? Object.keys(presets) : [];

    const lines: string[] = [
      `**New images:** \`${folder}/images/\` (served at \`/${folder}/images/\`)`,
      "",
      "**Legacy images:** `attached_assets/` (served at `/attached_assets/`). The `attached_assets/` folder also contains conversation screenshots which are excluded from the registry scanner.",
      "",
      `**Available presets:** ${presetNames.map((p) => `\`${p}\``).join(", ")}`,
    ];
    return lines.join("\n");
  } catch {
    return "_error reading image-registry.json_";
  }
}

function loadTrackingSettings(contentPath: string): Record<string, unknown> | null {
  const filePath = path.join(contentPath, "settings.yml");
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = yaml.load(raw) as Record<string, unknown> | null;
    if (!parsed) return null;
    const tracking = parsed.tracking;
    if (!tracking || typeof tracking !== "object" || Array.isArray(tracking)) return null;
    return tracking as Record<string, unknown>;
  } catch {
    return null;
  }
}

function resolveConversionEvents(contentPath: string): string {
  const tracking = loadTrackingSettings(contentPath);
  if (!tracking) return "_settings.yml tracking not found_";
  const events = tracking.conversion_events;
  if (!Array.isArray(events) || events.length === 0) {
    return "_No tracking.conversion_events defined in settings.yml_";
  }
  const lines: string[] = [
    "| Name | Default tags |",
    "|---|---|",
  ];
  const intentBlocks: string[] = ["", "### Intent", ""];
  for (const entry of events) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === "string" ? e.name : "";
    if (!name) continue;
    const tags = Array.isArray(e.tags)
      ? e.tags.filter((t): t is string => typeof t === "string").map((t) => `\`${t}\``).join(", ")
      : "—";
    lines.push(`| \`${name}\` | ${tags || "—"} |`);

    const whenToUse =
      typeof e.when_to_use === "string" && e.when_to_use.trim() ? e.when_to_use.trim() : "—";
    const whenNot =
      typeof e.when_not_to_use === "string" && e.when_not_to_use.trim()
        ? e.when_not_to_use.trim()
        : "—";
    intentBlocks.push(`#### \`${name}\``);
    intentBlocks.push(`- **when_to_use:** ${whenToUse}`);
    intentBlocks.push(`- **when_not_to_use:** ${whenNot}`);
    intentBlocks.push("");
  }
  return [...lines, ...intentBlocks].join("\n").trimEnd();
}

function resolveCrmTags(contentPath: string): string {
  const tracking = loadTrackingSettings(contentPath);
  if (!tracking) return "_settings.yml tracking not found_";
  const tags = tracking.leads_expected_tags;
  if (!Array.isArray(tags) || tags.length === 0) {
    return (
      "_`tracking.leads_expected_tags` is empty or missing._ " +
      "Agents **must ask a human** before setting form/`call_to_action` tags — **never invent** CRM tags. " +
      "Prefer omitting `tags` and relying on conversion-event defaults. " +
      "Staff can populate Expected CRM tags in Leads settings."
    );
  }
  const cleaned = tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
  if (cleaned.length === 0) {
    return (
      "_`tracking.leads_expected_tags` has no usable strings._ " +
      "Agents **must ask a human** — **never invent** tags."
    );
  }
  const lines: string[] = ["| CRM tag |", "|---|"];
  for (const t of cleaned) {
    lines.push(`| \`${t}\` |`);
  }
  lines.push("");
  lines.push(
    "Agents may only use tags from this list (or omit `tags`). If unsure which tag fits → **ask a human**. Never invent tags.",
  );
  return lines.join("\n");
}

// ─── Tag resolver ─────────────────────────────────────────────────────────────

const TAG_RESOLVERS: Record<string, TagResolver> = {
  content_types: resolveContentTypes,
  active_locales: resolveActiveLocales,
  image_storage: resolveImageStorage,
  conversion_events: resolveConversionEvents,
  crm_tags: resolveCrmTags,
};

export function resolveDynamicTags(content: string, contentPath: string): string {
  return content.replace(
    /<!-- @dynamic:(\w+) -->([\s\S]*?)<!-- \/dynamic -->/g,
    (_match, tag: string) => {
      const resolver = TAG_RESOLVERS[tag];
      if (!resolver) return `_unknown dynamic tag: ${tag}_`;
      return resolver(contentPath);
    },
  );
}

import { buildAgentChangelogPayload } from "../lib/agent-changelog.js";

// ─── Tool registration ────────────────────────────────────────────────────────

export function registerExplainTools(
  mcp: McpServer,
  mcpToken?: string,
  grants?: CatalogGrant[],
): void {
  mcp.tool(
    "get_agent_changelog",
    "Returns recent MCP / agent-facing platform changes (last 6 days). " +
      "Call near the start of a content session or when behavior looks wrong. " +
      "Does NOT refresh the host MCP tool list — if tools look missing/stale after a deploy, " +
      "ask the human to refresh/reconnect the MCP connector (Cursor: refresh MCP server; Claude: reconnect). " +
      "Requires content_view.",
    {},
    async () => {
      const viewDenied = await denyUnlessContentView(mcpToken, undefined, grants);
      if (viewDenied) return viewDenied;
      const payload = buildAgentChangelogPayload();
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );

  mcp.tool(
    "explain_site",
    "Returns architectural context about this codebase for a given topic. " +
      "Call this tool BEFORE making any structural change to the codebase — it explains how key subsystems work. " +
      "Live catalogs (conversion_events, CRM tags, locales, content types, image presets) are loaded from that site's content folder (sites.yml content_folder, e.g. site_4geeks-com/). " +
      "Valid topics: 'overview' (start here — summary + list of all topics), 'content_system' (YAML content files, _common.yml merge, safeYamlLoad), " +
      "'routing' (URL patterns, locale prefixes, /en/ vs /es/, ?cache=false HTML cache bypass), " +
      "'images' (image registry, UniversalImage, image_id usage), " +
      "'sections' (SectionRenderer, component registry, how sections are authored), " +
      "'semantic_search' (Qdrant, local embeddings, vector_search config, keyword fallback), " +
      "'local_databases' (local YAML private DBs, MCP item CRUD, global index, FAQ database), " +
      "'component-behaviors' (CTA tracking, conversion_events, CRM tags allowlist), " +
      "'ecommerce' (products, funnels, product scope property paths, no CMS plans), " +
      "'shared-layout' (single_template / shared shell, create_entry playbook, blog as example), " +
      "'relation-fields' (relation editor, authors CT, listing vs hydrate, delete_entries reassign), " +
      "'lead-forms' (catalog source.content_type/database/related_field, required value_path/label_path, required query on ecommerce catalogs, purchasable vs actively_selling), " +
      "'redirects' (CMS 301/302, two stores, test_redirect / read_redirects, update_redirect / edit_redirects, first-match). " +
      "Requires content_view. " +
      "Calling an unknown topic returns a clear error listing the valid options. " +
      "Multi-site: always pass site. If unsure, call list_sites first.",
    {
      topic: z
        .string()
        .describe(
          "The architectural topic to explain. One of: overview, content_system, routing, images, sections, semantic_search, local_databases, component-behaviors, ecommerce, shared-layout, relation-fields, lead-forms, redirects. Topic routing includes ?cache=false HTML page-cache bypass.",
        ),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ topic, site }) => {
      const viewDenied = await denyUnlessContentView(mcpToken, undefined, grants);
      if (viewDenied) return viewDenied;
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) {
        return siteFailResult(siteResult.error, "explain_site", { topic });
      }

      if (!(VALID_TOPICS as readonly string[]).includes(topic)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: "unknown_topic",
                  message: `'${topic}' is not a valid topic. Call explain_site with one of the valid topics listed below.`,
                  valid_topics: VALID_TOPICS.map((t) => ({
                    topic: t,
                    description: TOPIC_DESC[t] ?? t,
                  })),
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      const filePath = path.join(EXPLAIN_DIR, `${topic as Topic}.md`);
      if (!fs.existsSync(filePath)) {
        return {
          content: [
            {
              type: "text",
              text: `explain file not found for topic '${topic}' at ${filePath}`,
            },
          ],
          isError: true,
        };
      }

      const raw = fs.readFileSync(filePath, "utf-8");
      const resolved = resolveDynamicTags(raw, siteResult.contentPath);
      return { content: [{ type: "text", text: resolved }] };
    },
  );
}
