/**
 * Data-driven MCP stress scenarios.
 * Append a row to SCENARIOS (and optional budgets.byId) to add tools/params.
 */

export type DiscoveryCtx = {
  site?: string;
  contentType: string;
  /** Heavy page (largest sampled payload). */
  slug: string;
  locale: string;
  /** Thin page when distinct from heavy. */
  slugLight?: string;
  localeLight?: string;
  hasDistinctLight: boolean;
  heavy: boolean;
  /** Second type for list_entries alt row (when available). */
  contentTypeAlt?: string;
  /** Entry count from primary-type list (for page-2 skip). */
  entryCount: number;
  /** Whether list_media page 1 was full enough to expect a page 2. */
  mediaHasPage2: boolean;
  productSku?: string;
  productContentType?: string;
  databaseId?: string;
  componentName?: string;
  seoClusterId?: string;
};

export type ScenarioClass = "normal" | "docs";
export type ScenarioPhase = "sequential" | "burst" | "both";

export type Scenario = {
  id: string;
  tool: string;
  /** Plain-English use case for the HTML report info popover. */
  about: string;
  args?: Record<string, unknown>;
  buildArgs?: (ctx: DiscoveryCtx) => Record<string, unknown>;
  reps?: number;
  class?: ScenarioClass;
  phase?: ScenarioPhase;
  skipIf?: (ctx: DiscoveryCtx) => string | null;
};

function withSite(ctx: DiscoveryCtx, args: Record<string, unknown>): Record<string, unknown> {
  if (ctx.site) return { ...args, site: ctx.site };
  return args;
}

function needLight(ctx: DiscoveryCtx): string | null {
  return ctx.hasDistinctLight ? null : "no distinct light slug";
}

function needProduct(ctx: DiscoveryCtx): string | null {
  return ctx.productSku ? null : "no product in inventory";
}

function needDatabase(ctx: DiscoveryCtx): string | null {
  return ctx.databaseId ? null : "no database in inventory";
}

function needComponent(ctx: DiscoveryCtx): string | null {
  return ctx.componentName ? null : "no component in inventory";
}

function needCluster(ctx: DiscoveryCtx): string | null {
  return ctx.seoClusterId ? null : "no seo cluster in inventory";
}

function needAltType(ctx: DiscoveryCtx): string | null {
  return ctx.contentTypeAlt ? null : "no alternate content type";
}

function needEntriesPage2(ctx: DiscoveryCtx): string | null {
  return ctx.entryCount > 200 ? null : "not enough entries for page 2 (limit 200)";
}

function needMediaPage2(ctx: DiscoveryCtx): string | null {
  return ctx.mediaHasPage2 ? null : "media page 1 not full";
}

/** Core allowlist — extend by appending objects. */
export const SCENARIOS: Scenario[] = [
  {
    id: "list_sites",
    tool: "list_sites",
    about: "Lists configured sites. Cheap identity/bootstrap control with empty args.",
    args: {},
  },
  {
    id: "get_current_user",
    tool: "get_current_user",
    about: "Returns the authenticated agent identity, caps, and allowed_tools. Empty args.",
    args: {},
  },
  {
    id: "check_capability",
    tool: "check_capability",
    about: "Permission probe: cap=content_view. Tiny payload control for latency floor.",
    args: { cap: "content_view" },
  },

  {
    id: "list_entries_stats",
    tool: "list_entries",
    about: "Type-stats mode: list_entries with no contentType — counts per type, no entry rows.",
    buildArgs: (ctx) => withSite(ctx, {}),
  },
  {
    id: "list_entries_type",
    tool: "list_entries",
    about: "Entry rows for the primary content type (blog preferred). limit 50, or 100 with --heavy.",
    buildArgs: (ctx) =>
      withSite(ctx, {
        contentType: ctx.contentType,
        limit: ctx.heavy ? 100 : 50,
      }),
  },
  {
    id: "list_entries_limit_200",
    tool: "list_entries",
    about: "Large list: primary type with limit 200. Also runs in the concurrent burst phase.",
    buildArgs: (ctx) =>
      withSite(ctx, {
        contentType: ctx.contentType,
        limit: 200,
      }),
    phase: "both",
  },
  {
    id: "list_entries_page_2",
    tool: "list_entries",
    about: "Pagination: page 2 of primary type at limit 200. Skipped if fewer than 201 entries.",
    buildArgs: (ctx) =>
      withSite(ctx, {
        contentType: ctx.contentType,
        limit: 200,
        page: 2,
      }),
    skipIf: needEntriesPage2,
  },
  {
    id: "list_entries_type_alt",
    tool: "list_entries",
    about: "Second content type (next largest by count). Skipped if only one type exists.",
    buildArgs: (ctx) =>
      withSite(ctx, {
        contentType: ctx.contentTypeAlt!,
        limit: ctx.heavy ? 100 : 50,
      }),
    skipIf: needAltType,
  },

  {
    id: "list_media",
    tool: "list_media",
    about: "Media gallery page 1. page_size 50, or 100 with --heavy.",
    buildArgs: (ctx) =>
      withSite(ctx, {
        page: 1,
        page_size: ctx.heavy ? 100 : 50,
      }),
  },
  {
    id: "list_media_100",
    tool: "list_media",
    about: "Large media page: page_size 100. Also runs in the concurrent burst phase.",
    buildArgs: (ctx) =>
      withSite(ctx, {
        page: 1,
        page_size: 100,
      }),
    phase: "both",
  },
  {
    id: "list_media_page_2",
    tool: "list_media",
    about: "Media pagination: page 2 at page_size 100. Skipped if page 1 was not full.",
    buildArgs: (ctx) =>
      withSite(ctx, {
        page: 2,
        page_size: 100,
      }),
    skipIf: needMediaPage2,
  },

  {
    id: "get_entry_content",
    tool: "get_entry_content",
    about: "Full body/sections for the heavy page (largest sampled YAML). Also in burst.",
    buildArgs: (ctx) =>
      withSite(ctx, {
        slug: ctx.slug,
        locale: ctx.locale,
      }),
    phase: "both",
  },
  {
    id: "get_entry_content_light",
    tool: "get_entry_content",
    about: "Full body for the light page (smallest sampled). Contrast vs heavy payload.",
    buildArgs: (ctx) =>
      withSite(ctx, {
        slug: ctx.slugLight!,
        locale: ctx.localeLight ?? ctx.locale,
      }),
    skipIf: needLight,
  },
  {
    id: "get_entry_seo",
    tool: "get_entry_seo",
    about: "SEO/meta only for the heavy page (no body). Baseline vs search-engines variant.",
    buildArgs: (ctx) =>
      withSite(ctx, {
        slug: ctx.slug,
        locale: ctx.locale,
      }),
  },
  {
    id: "get_entry_seo_light",
    tool: "get_entry_seo",
    about: "SEO/meta only for the light page.",
    buildArgs: (ctx) =>
      withSite(ctx, {
        slug: ctx.slugLight!,
        locale: ctx.localeLight ?? ctx.locale,
      }),
    skipIf: needLight,
  },
  {
    id: "get_entry_seo_search_engines",
    tool: "get_entry_seo",
    about:
      "Heavy-page SEO with include_search_engines:true — adds cached Google/Bing status. Often slower than plain get_entry_seo; does not refresh live APIs.",
    buildArgs: (ctx) =>
      withSite(ctx, {
        slug: ctx.slug,
        locale: ctx.locale,
        include_search_engines: true,
      }),
  },
  {
    id: "get_entry_fields",
    tool: "get_entry_fields",
    about:
      "Selected field provenance for the heavy page (fields: title + seo.refresh_tier). Also in burst.",
    buildArgs: (ctx) =>
      withSite(ctx, {
        slug: ctx.slug,
        locale: ctx.locale,
        fields: ["title", "seo.refresh_tier"],
      }),
    phase: "both",
  },
  {
    id: "get_entry_fields_catalog",
    tool: "get_entry_fields",
    about:
      "Omit fields → select_fields catalog (names only). Measures the cheap discovery gate payload.",
    buildArgs: (ctx) =>
      withSite(ctx, {
        slug: ctx.slug,
        locale: ctx.locale,
      }),
  },
  {
    id: "get_entry_fields_light",
    tool: "get_entry_fields",
    about: "Selected field provenance for the light page — token contrast vs heavy.",
    buildArgs: (ctx) =>
      withSite(ctx, {
        slug: ctx.slugLight!,
        locale: ctx.localeLight ?? ctx.locale,
        fields: ["title", "seo.refresh_tier"],
      }),
    skipIf: needLight,
  },

  {
    id: "get_content_type_info",
    tool: "get_content_type_info",
    about: "Schema/contract for the primary content type (field_mapping, editor, create_via).",
    buildArgs: (ctx) => withSite(ctx, { contentType: ctx.contentType }),
  },
  {
    id: "list_variants",
    tool: "list_variants",
    about: "Draft/A-B variants for the heavy slug. Empty variants[] when no versioning.yml.",
    buildArgs: (ctx) =>
      withSite(ctx, {
        contentType: ctx.contentType,
        slug: ctx.slug,
      }),
  },
  {
    id: "get_section_bindings",
    tool: "get_section_bindings",
    about: "Binding group for sectionIndex 0 on the heavy page. Read-only membership lookup.",
    buildArgs: (ctx) =>
      withSite(ctx, {
        contentType: ctx.contentType,
        slug: ctx.slug,
        sectionIndex: 0,
        locale: ctx.locale,
      }),
  },
  {
    id: "list_entry_seo",
    tool: "list_entry_seo",
    about: "SEO sample for the primary type (limit 20, no slugs) — not a full-type dump.",
    buildArgs: (ctx) =>
      withSite(ctx, {
        contentType: ctx.contentType,
        locale: ctx.locale,
        limit: 20,
      }),
  },

  {
    id: "list_components",
    tool: "list_components",
    about: "All section component types for the site (shared ∪ site registry).",
    buildArgs: (ctx) => withSite(ctx, {}),
  },
  {
    id: "get_component_schema",
    tool: "get_component_schema",
    about: "Top-level schema + variants for one discovered component type.",
    buildArgs: (ctx) => withSite(ctx, { componentType: ctx.componentName! }),
    skipIf: needComponent,
  },
  {
    id: "get_component_usage",
    tool: "get_component_usage",
    about: "Where a component appears, scoped to the primary contentType.",
    buildArgs: (ctx) =>
      withSite(ctx, {
        componentType: ctx.componentName!,
        contentType: ctx.contentType,
      }),
    skipIf: needComponent,
  },

  {
    id: "list_seo_clusters",
    tool: "list_seo_clusters",
    about: "SEO cluster hub inventory from seo-index (sync, no diagnostics recompute).",
    buildArgs: (ctx) => withSite(ctx, {}),
  },
  {
    id: "list_seo_cluster_entries",
    tool: "list_seo_cluster_entries",
    about: "Cluster work-queue bucket=clustered, page 1, pageSize 50. Needs a discovered hub.",
    buildArgs: (ctx) =>
      withSite(ctx, {
        bucket: "clustered",
        page: 1,
        pageSize: 50,
      }),
    skipIf: needCluster,
  },
  {
    id: "get_seo_cluster",
    tool: "get_seo_cluster",
    about: "One hub + members by discovered hubId.",
    buildArgs: (ctx) => withSite(ctx, { hubId: ctx.seoClusterId! }),
    skipIf: needCluster,
  },

  {
    id: "list_products",
    tool: "list_products",
    about: "CMS product catalog (selling flags, audience). Includes paused by default.",
    buildArgs: (ctx) => withSite(ctx, {}),
  },
  {
    id: "get_product",
    tool: "get_product",
    about: "Full product sidecar (_product.yml) for the first discovered SKU.",
    buildArgs: (ctx) =>
      withSite(ctx, {
        slug: ctx.productSku!,
        ...(ctx.productContentType ? { content_type: ctx.productContentType } : {}),
      }),
    skipIf: needProduct,
  },
  {
    id: "get_product_funnel",
    tool: "get_product_funnel",
    about: "Conversion journey pages for the discovered product slug (funnel stages).",
    buildArgs: (ctx) => withSite(ctx, { slug: ctx.productSku! }),
    skipIf: needProduct,
  },
  {
    id: "get_product_funnel_analytics",
    tool: "get_product_funnel_analytics",
    about:
      "GA4 page performance for the discovered product journey (default page_performance). Soft N.C. when BigQuery tracking is unset.",
    buildArgs: (ctx) => withSite(ctx, { slug: ctx.productSku! }),
    skipIf: needProduct,
  },

  {
    id: "list_databases",
    tool: "list_databases",
    about: "Private databases for the site (local vs remote).",
    buildArgs: (ctx) => withSite(ctx, {}),
  },
  {
    id: "list_database_items",
    tool: "list_database_items",
    about: "Summary rows for the first discovered database (page 1, limit 50).",
    buildArgs: (ctx) =>
      withSite(ctx, {
        database: ctx.databaseId!,
        page: 1,
        limit: 50,
      }),
    skipIf: needDatabase,
  },

  {
    id: "get_validation_issues",
    tool: "get_validation_issues",
    about: "Open validation issues scoped to the heavy slug (set=open, limit 50). Read-only; does not run diagnostics.",
    buildArgs: (ctx) =>
      withSite(ctx, {
        slug: ctx.slug,
        locale: ctx.locale,
        contentType: ctx.contentType,
        set: "open",
        limit: 50,
      }),
  },
  {
    id: "get_organic_traffic",
    tool: "get_organic_traffic",
    about: "Site-mode GSC organic traffic from day cache (mode=site). Read-only.",
    buildArgs: (ctx) => withSite(ctx, { mode: "site" }),
  },
  {
    id: "get_organic_traffic_leaderboard",
    tool: "get_organic_traffic",
    about:
      "Top paths by clicks from organic day cache (mode=leaderboard, default limit). Soft N.C. when day cache is empty.",
    buildArgs: (ctx) => withSite(ctx, { mode: "leaderboard" }),
  },
  {
    id: "get_analytics_report_site_summary",
    tool: "get_analytics_report",
    about:
      "GA4 BigQuery site_summary report (default 28-day window). Soft N.C. when tracking.bigquery is unset.",
    buildArgs: (ctx) => withSite(ctx, { report: "site_summary" }),
  },
  {
    id: "get_analytics_report_top_pages",
    tool: "get_analytics_report",
    about:
      "GA4 BigQuery top_pages report (default limit). Soft N.C. when tracking.bigquery is unset.",
    buildArgs: (ctx) => withSite(ctx, { report: "top_pages" }),
  },
  {
    id: "get_analytics_report_traffic_source_conversions",
    tool: "get_analytics_report",
    about:
      "GA4 BigQuery traffic_source_conversions (default session_last_click, no item_id). Soft N.C. when tracking.bigquery is unset.",
    buildArgs: (ctx) => withSite(ctx, { report: "traffic_source_conversions" }),
  },
  {
    id: "list_proposals",
    tool: "list_proposals",
    about: "Unscoped proposals call — returns proposal_stats only (no filter).",
    buildArgs: (ctx) => withSite(ctx, {}),
  },
  {
    id: "list_proposals_open_attention",
    tool: "list_proposals",
    about:
      "Scoped open proposals list — default attention sort + summary rows (attention triage hot path).",
    buildArgs: (ctx) => withSite(ctx, { status: "open", limit: 20 }),
  },
  {
    id: "get_entry_activity",
    tool: "get_entry_activity",
    about: "Recent write history for the heavy entry (14-day window, limit 20).",
    buildArgs: (ctx) =>
      withSite(ctx, {
        contentType: ctx.contentType,
        slug: ctx.slug,
        locale: ctx.locale,
        limit: 20,
      }),
  },

  {
    id: "bootstrap_agent",
    tool: "bootstrap_agent",
    about: "Agent bootstrap with include_skill_content:true (docs band — large skills payload).",
    buildArgs: (ctx) =>
      withSite(ctx, {
        include_skill_content: true,
      }),
    reps: 1,
    class: "docs",
  },
  {
    id: "bootstrap_agent_no_skills",
    tool: "bootstrap_agent",
    about: "Agent bootstrap with include_skill_content:false — same setup, smaller payload.",
    buildArgs: (ctx) =>
      withSite(ctx, {
        include_skill_content: false,
      }),
    reps: 1,
    class: "docs",
  },
  {
    id: "explain_site_overview",
    tool: "explain_site",
    about: "Architecture docs: topic=overview.",
    buildArgs: (ctx) => withSite(ctx, { topic: "overview" }),
    reps: 1,
    class: "docs",
  },
  {
    id: "explain_site_proposals_index",
    tool: "explain_site",
    about: "Proposals hub index — omit subtopic; returns pick_subtopic menu.",
    buildArgs: (ctx) => withSite(ctx, { topic: "proposals" }),
    reps: 1,
    class: "docs",
  },
  {
    id: "explain_site_review_situations",
    tool: "explain_site",
    about:
      "Proposals hub: topic=proposals subtopic=situations (edits catalog + ideas default-on idea_opportunity_harm).",
    buildArgs: (ctx) => withSite(ctx, { topic: "proposals", subtopic: "situations" }),
    reps: 1,
    class: "docs",
  },
  {
    id: "explain_site_internal_links_proposals",
    tool: "explain_site",
    about: "Proposals hub: subtopic=internal-links (hub link author/reviewer guide).",
    buildArgs: (ctx) => withSite(ctx, { topic: "proposals", subtopic: "internal-links" }),
    reps: 1,
    class: "docs",
  },
  {
    id: "explain_site_serp_title_description_proposals",
    tool: "explain_site",
    about: "Proposals hub: subtopic=serp-title-description (SERP title/description guide).",
    buildArgs: (ctx) =>
      withSite(ctx, { topic: "proposals", subtopic: "serp-title-description" }),
    reps: 1,
    class: "docs",
  },
  {
    id: "explain_site_funnel_classification_proposals",
    tool: "explain_site",
    about:
      "Proposals hub: subtopic=funnel-classification (persona → product → stage).",
    buildArgs: (ctx) =>
      withSite(ctx, { topic: "proposals", subtopic: "funnel-classification" }),
    reps: 1,
    class: "docs",
  },
  {
    id: "explain_site_translations_proposals",
    tool: "explain_site",
    about: "Proposals hub: subtopic=translations (locale draft→promote playbook).",
    buildArgs: (ctx) => withSite(ctx, { topic: "proposals", subtopic: "translations" }),
    reps: 1,
    class: "docs",
  },
  {
    id: "explain_site_seo",
    tool: "explain_site",
    about: "Architecture docs: topic=seo.",
    buildArgs: (ctx) => withSite(ctx, { topic: "seo" }),
    reps: 1,
    class: "docs",
  },
  {
    id: "explain_site_content_system",
    tool: "explain_site",
    about: "Architecture docs: topic=content_system (YAML merge / safeYamlLoad).",
    buildArgs: (ctx) => withSite(ctx, { topic: "content_system" }),
    reps: 1,
    class: "docs",
  },
  {
    id: "explain_site_sections",
    tool: "explain_site",
    about: "Architecture docs: topic=sections.",
    buildArgs: (ctx) => withSite(ctx, { topic: "sections" }),
    reps: 1,
    class: "docs",
  },
  {
    id: "explain_site_component_behaviors",
    tool: "explain_site",
    about: "Architecture docs: topic=component-behaviors.",
    buildArgs: (ctx) => withSite(ctx, { topic: "component-behaviors" }),
    reps: 1,
    class: "docs",
  },
  {
    id: "explain_site_local_databases",
    tool: "explain_site",
    about: "Architecture docs: topic=local_databases.",
    buildArgs: (ctx) => withSite(ctx, { topic: "local_databases" }),
    reps: 1,
    class: "docs",
  },
];

/** Extra high-limit alt-type row when --heavy. */
export const HEAVY_EXTRA_SCENARIO: Scenario = {
  id: "list_entries_type_alt_heavy",
  tool: "list_entries",
  about: "--heavy only: alternate content type at limit 100.",
  buildArgs: (ctx) =>
    withSite(ctx, {
      contentType: ctx.contentTypeAlt!,
      limit: 100,
    }),
  skipIf: needAltType,
};

export function scenariosForRun(heavy: boolean): Scenario[] {
  if (!heavy) return SCENARIOS;
  return [...SCENARIOS, HEAVY_EXTRA_SCENARIO];
}

export function resolveArgs(
  scenario: Scenario,
  ctx: DiscoveryCtx,
): Record<string, unknown> {
  if (scenario.buildArgs) return scenario.buildArgs(ctx);
  return { ...(scenario.args ?? {}) };
}

export function scenariosInPhase(
  scenarios: Scenario[],
  phase: "sequential" | "burst",
): Scenario[] {
  return scenarios.filter((s) => {
    const p = s.phase ?? "sequential";
    return p === phase || p === "both";
  });
}
