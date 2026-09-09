/**
 * Shared OpenRush keyword refresh for MCP (cache only — no YAML seo.kw_* writes).
 */

import { loadPage, resolveContentType } from "./content.js";
import type { McpWarning, NextAction, McpSideEffect } from "./respond.js";

export type RefreshKeywordMetricsResult =
  | {
      ok: true;
      keyword: string;
      kw_monthly_volume: number | null;
      kw_difficulty: number | null;
      fetched_at: string | null;
      notes: string | null;
      source: "openrush_cache";
      credits: number;
      credits_note?: string;
      warnings: McpWarning[];
      side_effects: McpSideEffect[];
      next_actions: NextAction[];
    }
  | {
      ok: false;
      code: string;
      message: string;
      warnings?: McpWarning[];
      next_actions?: NextAction[];
      details?: Record<string, unknown>;
    };

function readMainKeywordFromYaml(opts: {
  contentPath: string;
  contentType: string;
  slug: string;
  locale: string;
}): string {
  const resolved = resolveContentType(opts.slug, opts.contentType, opts.contentPath, {
    allowSharedLayout: true,
  });
  if (!resolved) return "";
  const page = loadPage(resolved.contentType, opts.slug, opts.locale, opts.contentPath);
  if (!page.ok || !page.data) return "";
  const seo = (page.data as { seo?: Record<string, unknown> }).seo;
  if (!seo || typeof seo !== "object") return "";
  const kw = seo.main_keyword;
  return typeof kw === "string" && kw.trim() ? kw.trim() : "";
}

async function readMainKeywordFromIndex(opts: {
  contentPath: string;
  contentType: string;
  slug: string;
  locale: string;
}): Promise<string> {
  try {
    const { loadSeoIndex, seoEntryId } = await import("../../server/seo-index.js");
    const index = loadSeoIndex(opts.contentPath);
    const row = index.entries[seoEntryId(opts.contentType, opts.slug, opts.locale)];
    const kw = row?.main_keyword;
    return typeof kw === "string" && kw.trim() ? kw.trim() : "";
  } catch {
    return "";
  }
}

export async function runRefreshKeywordMetrics(opts: {
  contentPath: string;
  contentFolder: string;
  contentType: string;
  slug: string;
  locale: string;
  keywordOverride?: string;
  site?: string;
}): Promise<RefreshKeywordMetricsResult> {
  const {
    isOpenRushConfigured,
    inspectKeywordQuery,
    OPENRUSH_INSPECT_KEYWORD_CREDITS,
  } = await import("../../server/openrush-client.js");

  const siteArg = opts.site ? { site: opts.site } : {};
  const baseHint = {
    slug: opts.slug,
    locale: opts.locale,
    contentType: opts.contentType,
    ...siteArg,
  };

  if (!isOpenRushConfigured(opts.contentPath)) {
    return {
      ok: false,
      code: "openrush_inactive",
      message:
        "OpenRush is not configured. Do not invent seo.kw_monthly_volume / seo.kw_difficulty. " +
        "If you have staff_provided or external:<tool> metrics, use update_fields with seo_research_source; otherwise release blocked.",
      warnings: [
        {
          code: "openrush_inactive",
          message: "OpenRush disabled or OPENRUSH_API_KEY missing — refresh_keyword_metrics cannot run.",
        },
      ],
      next_actions: [
        {
          tool: "update_fields",
          priority: "optional",
          reason:
            "Only if you have reliable offline metrics: write both kw_* with seo_research_source staff_provided|external:<name>.",
          args_hint: {
            ...baseHint,
            seo_research_source: "staff_provided",
          },
        },
        {
          tool: "update_issue",
          priority: "recommended",
          reason: "Release SEO_KEYWORD_RESEARCH_INCOMPLETE if you lack a reliable source.",
          args_hint: { action: "release", ...siteArg },
        },
      ],
    };
  }

  let keyword =
    typeof opts.keywordOverride === "string" && opts.keywordOverride.trim()
      ? opts.keywordOverride.trim()
      : "";
  if (!keyword) {
    keyword =
      readMainKeywordFromYaml({
        contentPath: opts.contentPath,
        contentType: opts.contentType,
        slug: opts.slug,
        locale: opts.locale,
      }) ||
      (await readMainKeywordFromIndex({
        contentPath: opts.contentPath,
        contentType: opts.contentType,
        slug: opts.slug,
        locale: opts.locale,
      }));
  }
  if (!keyword) {
    return {
      ok: false,
      code: "no_keyword",
      message: "No keyword configured for this entry — set seo.main_keyword first, or pass keyword.",
      next_actions: [
        {
          tool: "get_entry_seo",
          priority: "recommended",
          reason: "Inspect current seo.main_keyword.",
          args_hint: baseHint,
        },
      ],
    };
  }

  const inspected = await inspectKeywordQuery({
    keyword,
    contentRoot: opts.contentPath,
    contentFolder: opts.contentFolder,
  });
  if (!inspected.ok || !inspected.metrics) {
    return {
      ok: false,
      code: "openrush_keyword_failed",
      message: inspected.error || "OpenRush keyword lookup failed",
      details: { keyword },
      warnings: [
        {
          code: "openrush_pull_failed",
          message:
            "OpenRush pull failed or incomplete — do not invent YAML kw_* metrics. Release blocked or retry refresh.",
        },
      ],
      next_actions: [
        {
          tool: "refresh_keyword_metrics",
          priority: "optional",
          reason: "Retry OpenRush refresh after fixing config/credits.",
          args_hint: { ...baseHint, keyword },
        },
        {
          tool: "update_issue",
          priority: "recommended",
          reason: "Release if research remains unavailable — do not invent volume/difficulty.",
          args_hint: { action: "release", ...siteArg },
        },
      ],
    };
  }

  const volume = inspected.entry?.monthly_volume ?? inspected.metrics.monthly_volume;
  const difficulty = inspected.entry?.kw_difficulty ?? inspected.metrics.kw_difficulty;
  if (volume == null && difficulty == null && !inspected.entry) {
    return {
      ok: false,
      code: "openrush_metrics_empty",
      message: "OpenRush returned no volume or difficulty for this keyword",
      details: { keyword, metrics: inspected.metrics },
      warnings: [
        {
          code: "openrush_incomplete_metrics",
          message: "Incomplete OpenRush metrics — do not invent YAML fallback. Release or retry.",
        },
      ],
      next_actions: [
        {
          tool: "update_issue",
          priority: "recommended",
          reason: "Release blocked — no reliable metrics from OpenRush.",
          args_hint: { action: "release", ...siteArg },
        },
      ],
    };
  }

  return {
    ok: true,
    keyword: inspected.metrics.keyword,
    kw_monthly_volume: volume ?? null,
    kw_difficulty: difficulty ?? null,
    fetched_at: inspected.entry?.fetched_at ?? null,
    notes: inspected.entry?.notes ?? null,
    source: "openrush_cache",
    credits: OPENRUSH_INSPECT_KEYWORD_CREDITS,
    credits_note: inspected.credits_note,
    warnings: [
      {
        code: "openrush_cache_only",
        message:
          "Refreshed OpenRush keyword cache only — did not write seo.kw_monthly_volume / seo.kw_difficulty YAML. SEO_KEYWORD_RESEARCH_INCOMPLETE clears when cache has both metrics.",
      },
    ],
    side_effects: [
      {
        kind: "openrush_keyword_cache",
        summary: `Upserted OpenRush keyword cache for "${inspected.metrics.keyword}" (no locale YAML change).`,
      },
    ],
    next_actions: [
      {
        tool: "get_entry_seo",
        priority: "recommended",
        reason: "Confirm keyword_metrics.source is openrush_cache with both metrics.",
        args_hint: baseHint,
      },
      {
        tool: "run_entry_diagnostics",
        priority: "optional",
        reason: "Re-run SEO diagnostics so SEO_KEYWORD_RESEARCH_INCOMPLETE can clear in the issue queue.",
        args_hint: {
          slugs: [opts.slug],
          categories: ["seo"],
          freshness: "hard",
          ...siteArg,
        },
      },
    ],
  };
}
