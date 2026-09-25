import fs from "fs";
import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import yaml from "js-yaml";
import { resolveSiteContext, hasMultipleSites } from "../lib/content.js";
import { SITE_PARAM_DESC, siteFailResult } from "../lib/entry-helpers.js";
import { denyUnlessContentView, getActiveRoleId } from "../lib/auth.js";
import type { CatalogGrant } from "../lib/tool-catalog.js";
import { buildConnectorTeachFields } from "../lib/role-connector-guide.js";
import { listProductRows } from "../../server/product/product-io.js";
import { actionRequired, fail, ok } from "../lib/respond.js";
import {
  EXPLAIN_TOPIC_ALIASES,
  PROPOSALS_INDEX_HUB,
  getProposalsSubtopic,
  listProposalsSubtopicsPublic,
  resolveExplainTopicAlias,
} from "../lib/explain-proposals.js";

// Use cwd so this resolves correctly both under tsx (mcp-server/…) and the
// production bundle (dist/mcp-server.js).
const EXPLAIN_DIR = path.join(process.cwd(), "mcp-server", "explain");

/** Advertised topics only (legacy *-proposals ids are aliases, not listed). */
const VALID_TOPICS = [
  "overview",
  "content_system",
  "routing",
  "images",
  "sections",
  "semantic_search",
  "local_databases",
  "component-behaviors",
  "seo",
  "funnel",
  "product",
  "ecommerce",
  "shared-layout",
  "relation-fields",
  "lead-forms",
  "redirects",
  "proposals",
  "analytics",
] as const;
type Topic = (typeof VALID_TOPICS)[number];

const TOPIC_DESC: Record<string, string> = {
  overview: "Start here — architectural summary and guide to all topics",
  content_system: "YAML content files, _common.yml merge, safeYamlLoad (SEO → topic seo)",
  routing:
    "URL patterns, locale prefixes (/en/, /es/), dynamic routes, ?cache=false HTML cache bypass",
  images: "Image registry, UniversalImage, media_id / image_id fields, list_media + get_or_set_media_to_gallery MCP",
  sections: "SectionRenderer, component registry, in-page CTA hashes (#section_id modal/scroll, inline#, #top/#bottom)",
  semantic_search:
    "Qdrant vector store, local embeddings, database vector_search, keyword fallback",
  local_databases:
    "Local YAML private DBs; MCP item CRUD; global index; FAQ database; sync + reindex",
  "component-behaviors": "CTA tracking, conversion_events catalog, CRM tags allowlist",
  seo: "meta gates, locale seo:, clustering inventory, GSC/Bing reads, organic traffic, SEO diagnostics",
  funnel:
    "funnel.stage / products bindings on _common.yml, money pages (decision), list_entries filters, inventory vs journey",
  product:
    "what we sell / who for: list_products, get_product, create_or_update_product (audience + product_manage sellable); journey",
  ecommerce:
    "Alias of topic product (legacy name) — list_products, get_product, create_or_update_product, get_product_funnel",
  "shared-layout":
    "single_template / shared shell, create_entry playbook, blog as example",
  "relation-fields":
    "relation editor type, authors hubs, listing deslugify vs page hydrate, delete_entries reassign",
  "lead-forms":
    "catalog source content_type/database/related_field, required value_path/label_path, required query on ecommerce catalogs, purchasable vs actively_selling",
  redirects:
    "CMS 301/302: two stores, first-match, test_redirect (read_redirects) + update_redirect (edit_redirects), before_from custom-only",
  proposals:
    "Entry proposals hub — omit subtopic for index; subtopics: overview, reading, situations, internal-links, serp-title-description, funnel-classification, idea-opportunity-harm, existing-demand, broken-url, translations",
  analytics:
    "GA4 BigQuery reports via get_analytics_report; vs get_organic_traffic (GSC) and get_product_funnel_analytics (journey)",
};

/** Topics that support optional subtopic (hubs). */
const TOPICS_WITH_SUBTOPICS = new Set<string>(["proposals"]);

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
    "| Name | Counts as lead | Default tags |",
    "|---|---|---|",
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
    const counts =
      typeof e.counts_as_lead === "boolean" ? (e.counts_as_lead ? "yes" : "no") : "—";
    lines.push(`| \`${name}\` | ${counts} | ${tags || "—"} |`);

    const whenToUse =
      typeof e.when_to_use === "string" && e.when_to_use.trim() ? e.when_to_use.trim() : "—";
    const whenNot =
      typeof e.when_not_to_use === "string" && e.when_not_to_use.trim()
        ? e.when_not_to_use.trim()
        : "—";
    intentBlocks.push(`#### \`${name}\``);
    intentBlocks.push(`- **when_to_use:** ${whenToUse}`);
    intentBlocks.push(`- **when_not_to_use:** ${whenNot}`);
    intentBlocks.push(
      `- **counts_as_lead:** ${typeof e.counts_as_lead === "boolean" ? String(e.counts_as_lead) : "unset"}`,
    );
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

function resolveProducts(_contentPath: string): string {
  try {
    const rows = listProductRows({ includePaused: true });
    if (rows.length === 0) {
      return "_No purchasable products._";
    }
    const lines: string[] = [
      "| Name | Entry | Selling | Audience | Persona ids |",
      "|---|---|---|---|---|",
    ];
    for (const p of rows) {
      const personas =
        p.personas.length > 0
          ? p.personas.map((x) => `\`${x.id}\``).join(", ")
          : "—";
      lines.push(
        `| ${p.name} | \`${p.content_type}/${p.content_slug}\` | ${p.actively_selling ? "yes" : "paused"} | ${p.audience_status} | ${personas} |`,
      );
    }
    lines.push("");
    lines.push("Depth: `get_product` on a slug. Inventory tool: `list_products`.");
    return lines.join("\n");
  } catch {
    return "_Could not load product index_";
  }
}

// ─── Tag resolver ─────────────────────────────────────────────────────────────

const TAG_RESOLVERS: Record<string, TagResolver> = {
  content_types: resolveContentTypes,
  active_locales: resolveActiveLocales,
  image_storage: resolveImageStorage,
  conversion_events: resolveConversionEvents,
  crm_tags: resolveCrmTags,
  products: resolveProducts,
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


import { buildBootstrapPayload } from "../lib/agent-changelog.js";

// ─── Tool registration ────────────────────────────────────────────────────────

export function registerExplainTools(
  mcp: McpServer,
  mcpToken?: string,
  grants?: CatalogGrant[],
): void {
  mcp.tool(
    "bootstrap_agent",
    "Call once near the start of any Website MCP content run (Claude.ai, Grok, or any connector), " +
      "before mutates or agent_session start. Returns: technical playbook, agent conventions (how to read responses, gates, proposals, reporting) " +
      "(skill.content on first call; branded with brand.title + domain when site is passed or only one site is configured), " +
      "and recent agent changelog (last 6 days). " +
      "First call: omit params (or include_skill_content: true); pass site when multi-site so link examples match that brand. " +
      "Later calls in the same chat: include_skill_content: false and/or known_skill_version from the prior response " +
      "(changelog + playbook still returned; conventions body omitted). " +
      "Does NOT refresh the host MCP tool list — if tools look missing/stale after a deploy, " +
      "ask the human to refresh/reconnect the MCP connector. Requires content_view.",
    {
      include_skill_content: z
        .boolean()
        .optional()
        .describe(
          "Default true. When false, omit skill.content (conventions markdown). Pass false on later bootstraps in the same chat.",
        ),
      known_skill_version: z
        .string()
        .optional()
        .describe(
          "If equal to skill.version from a prior bootstrap, omit skill.content even when include_skill_content is true.",
        ),
      site: z
        .string()
        .optional()
        .describe(SITE_PARAM_DESC),
    },
    async ({ include_skill_content, known_skill_version, site }) => {
      const viewDenied = await denyUnlessContentView(mcpToken, undefined, grants);
      if (viewDenied) return viewDenied;
      const result = buildBootstrapPayload({
        include_skill_content,
        known_skill_version,
        site,
      });
      if (!result.ok) {
        return siteFailResult(result.error, "bootstrap_agent", { site });
      }
      const { payload } = result;
      const teach = await buildConnectorTeachFields({
        mcpToken,
        activeRoleId: getActiveRoleId() ?? null,
      });
      const multiSiteNoBrand =
        payload.skill.branding.mode === "generic" && hasMultipleSites();
      const next_actions = [
        ...(teach.primary_blocker === "role_connector_required"
          ? []
          : [
              {
                tool: "agent_session",
                reason: "Start a content session; pass returned agent_session_id on mutates.",
                priority: "recommended" as const,
                args_hint: { action: "start" },
              },
            ]),
        ...(multiSiteNoBrand
          ? [
              {
                tool: "list_sites",
                reason:
                  "Pick a domain, then re-call bootstrap_agent with site so skill.content uses that brand and public links.",
                priority: "recommended" as const,
              },
            ]
          : []),
      ];
      const warnings = [
        ...(multiSiteNoBrand
          ? [
              {
                code: "conventions_generic_no_site",
                message:
                  "Conventions are generic (no site brand). Pass site on bootstrap_agent after list_sites so link examples use the correct domain.",
              },
            ]
          : []),
        ...(teach.primary_blocker === "role_connector_required"
          ? [
              {
                code: "role_connector_required",
                message:
                  "Production plain /mcp cannot write. Reconnect with role URLs from connector_guide before mutates.",
              },
            ]
          : []),
        ...(teach.mcp_write_guide
          ? [
              {
                code: "mcp_write_disabled",
                message: teach.mcp_write_guide.message,
              },
            ]
          : []),
      ];
      const session_guidance = [
        ...payload.session_guidance,
        ...teach.session_guidance_extra,
      ];
      return ok(
        {
          ...payload,
          session_guidance,
          primary_blocker: teach.primary_blocker,
          production_unscoped: teach.production_unscoped,
          ...(teach.connector_guide ? { connector_guide: teach.connector_guide } : {}),
          ...(teach.mcp_write_guide ? { mcp_write_guide: teach.mcp_write_guide } : {}),
          message:
            teach.primary_blocker === "role_connector_required"
              ? "Bootstrapped on production plain /mcp (read-only for writes). See connector_guide — reconnect with role URLs before mutates."
              : teach.mcp_write_guide
                ? "Bootstrapped. MCP write is off for this user — see mcp_write_guide.course_of_action. Keep skill.content as standing conventions."
                : "Bootstrapped. Keep skill.content (when present) as standing conventions for this chat; " +
                  "call agent_session start next; pass agent_session_id + report on mutates.",
        },
        {
          warnings,
          next_actions,
        },
      );
    },
  );

  mcp.tool(
    "explain_site",
    "Returns architectural context about this codebase for a given topic. " +
      "Call this tool BEFORE making any structural change to the codebase — it explains how key subsystems work. " +
      "Live catalogs (conversion_events, CRM tags, locales, content types, image presets) are loaded from that site's content folder (sites.yml content_folder, e.g. site_example-com/). " +
      "Valid topics: 'overview' (start here), 'content_system', 'routing', 'images', 'sections', 'semantic_search', " +
      "'local_databases', 'component-behaviors', 'seo', 'funnel', 'ecommerce'/'product', 'shared-layout', 'relation-fields', " +
      "'lead-forms', 'redirects', 'proposals' (hub — optional subtopic), 'analytics'. " +
      "For proposals: omit subtopic for a light index of playbooks; pass subtopic " +
      "(overview|reading|situations|internal-links|serp-title-description|funnel-classification|idea-opportunity-harm|existing-demand|broken-url|translations) for a pack. " +
      "Legacy flat ids (e.g. internal-links-proposals) still resolve with a deprecation warning. " +
      "Passing subtopic on a topic that has no subtopics fails — omit subtopic and retry. " +
      "Requires content_view. Multi-site: always pass site. If unsure, call list_sites first.",
    {
      topic: z
        .string()
        .describe(
          "Architectural topic. Advertised: overview, content_system, routing, images, sections, semantic_search, local_databases, component-behaviors, seo, funnel, product, ecommerce, shared-layout, relation-fields, lead-forms, redirects, proposals, analytics. Legacy proposal playbook ids still resolve as aliases.",
        ),
      subtopic: z
        .string()
        .optional()
        .describe(
          'Optional playbook under a hub topic. For topic "proposals": overview | reading | situations | internal-links | serp-title-description | funnel-classification | idea-opportunity-harm | existing-demand | broken-url | translations. Omit for the proposals index. Do not pass on topics without subtopics.',
        ),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ topic: topicRaw, subtopic: subtopicRaw, site }) => {
      const viewDenied = await denyUnlessContentView(mcpToken, undefined, grants);
      if (viewDenied) return viewDenied;
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) {
        return siteFailResult(siteResult.error, "explain_site", { topic: topicRaw });
      }

      const siteHint = site ? { site } : {};
      const aliasResolved = resolveExplainTopicAlias(topicRaw.trim());
      let topic = aliasResolved.topic;
      let subtopic =
        typeof subtopicRaw === "string" && subtopicRaw.trim()
          ? subtopicRaw.trim()
          : aliasResolved.subtopic;
      const deprecatedFrom = aliasResolved.deprecated_from;

      const knownAdvertised = (VALID_TOPICS as readonly string[]).includes(topic);
      const knownAlias = Boolean(EXPLAIN_TOPIC_ALIASES[topicRaw.trim()]);
      if (!knownAdvertised && !knownAlias) {
        return fail(`'${topicRaw}' is not a valid topic. Call explain_site with one of the valid topics listed.`, {
          code: "unknown_topic",
          valid_topics: VALID_TOPICS.map((t) => ({
            topic: t,
            description: TOPIC_DESC[t] ?? t,
          })),
        });
      }

      const warnings: Array<{ code: string; message: string }> = [];
      if (deprecatedFrom) {
        warnings.push({
          code: "explain_topic_deprecated",
          message:
            `Topic "${deprecatedFrom}" is deprecated. Prefer topic: "proposals", subtopic: "${aliasResolved.subtopic}". ` +
            "Reconnect MCP so tools/list shows the shorter topic menu.",
        });
      }

      if (subtopic && !TOPICS_WITH_SUBTOPICS.has(topic)) {
        return fail(
          `Topic "${topic}" has no subtopics. Omit subtopic and call again with topic only — do not invent subtopic names.`,
          {
            code: "topic_has_no_subtopics",
            topic,
            subtopic,
            hint: "Retry with the same topic and no subtopic argument.",
          },
        );
      }

      if (topic === "proposals") {
        const subtopics = listProposalsSubtopicsPublic();
        if (!subtopic) {
          return actionRequired(
            {
              success: true,
              action_required: "pick_subtopic",
              code: "pick_subtopic",
              topic: "proposals",
              message:
                "Proposals hub index — pick a subtopic for the playbook you need (translations, internal-links, situations, …).",
              hub: PROPOSALS_INDEX_HUB,
              subtopics,
              ...(warnings.length ? { warnings } : {}),
            },
            subtopics.map((s) => ({
              tool: "explain_site",
              reason: s.description,
              args_hint: { topic: "proposals", subtopic: s.id, ...siteHint },
              priority: s.id === "overview" || s.id === "translations" ? "recommended" : "optional",
            })),
          );
        }

        const def = getProposalsSubtopic(subtopic);
        if (!def) {
          return actionRequired(
            {
              success: false,
              action_required: "pick_subtopic",
              code: "unknown_subtopic",
              topic: "proposals",
              message: `Unknown proposals subtopic "${subtopic}". Pick one of the valid ids below.`,
              valid_subtopics: subtopics,
              ...(warnings.length ? { warnings } : {}),
            },
            subtopics.map((s) => ({
              tool: "explain_site",
              reason: s.description,
              args_hint: { topic: "proposals", subtopic: s.id, ...siteHint },
              priority: "required" as const,
            })),
          );
        }

        const filePath = path.join(EXPLAIN_DIR, `${def.fileStem}.md`);
        if (!fs.existsSync(filePath)) {
          return fail(`explain file not found for proposals subtopic '${subtopic}' at ${filePath}`, {
            code: "explain_file_missing",
          });
        }
        const raw = fs.readFileSync(filePath, "utf-8");
        const resolved = resolveDynamicTags(raw, siteResult.contentPath);
        return ok(
          {
            topic: "proposals",
            subtopic: def.id,
            markdown: resolved,
          },
          {
            warnings,
            next_actions: [],
          },
        );
      }

      const fileTopic = topic === "ecommerce" ? "product" : (topic as Topic);
      const filePath = path.join(EXPLAIN_DIR, `${fileTopic}.md`);
      if (!fs.existsSync(filePath)) {
        return fail(`explain file not found for topic '${topic}' at ${filePath}`, {
          code: "explain_file_missing",
        });
      }

      const raw = fs.readFileSync(filePath, "utf-8");
      const resolved = resolveDynamicTags(raw, siteResult.contentPath);
      if (warnings.length) {
        return ok({ topic, markdown: resolved }, { warnings, next_actions: [] });
      }
      return { content: [{ type: "text", text: resolved }] };
    },
  );
}
