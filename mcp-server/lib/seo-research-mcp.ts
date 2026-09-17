/**
 * MCP SEO research: get_or_refresh_seo_research (cache + paid fetch with budget).
 * Vendor-neutral agent envelopes — no "openrush" in codes/messages.
 */

import { loadPage, resolveContentType } from "./content.js";
import type { McpWarning, NextAction, McpSideEffect } from "./respond.js";

export type SeoResearchAction =
  | "keyword_metrics"
  | "serp"
  | "keyword_ideas"
  | "competitors"
  | "keyword_gaps";

export type SeoResearchOk = {
  ok: true;
  action: SeoResearchAction;
  outcome: "cache_hit" | "fetched";
  credits_spent: number;
  credits_note?: string;
  budget: Record<string, unknown>;
  data: Record<string, unknown>;
  warnings: McpWarning[];
  side_effects: McpSideEffect[];
  next_actions: NextAction[];
};

export type SeoResearchFail = {
  ok: false;
  code: string;
  message: string;
  warnings?: McpWarning[];
  next_actions?: NextAction[];
  details?: Record<string, unknown>;
  action_required?: string;
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
  if (!page?.data) return "";
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

async function resolveEntryKeyword(opts: {
  contentPath: string;
  contentType?: string;
  slug?: string;
  locale?: string;
  keywordOverride?: string;
}): Promise<string> {
  if (opts.keywordOverride?.trim()) return opts.keywordOverride.trim();
  if (!opts.contentType || !opts.slug || !opts.locale) return "";
  return (
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
    }))
  );
}

function siteArg(site?: string): Record<string, string> {
  return site ? { site } : {};
}

export async function runSeoResearch(opts: {
  action: SeoResearchAction;
  contentPath: string;
  contentFolder: string;
  contentType?: string;
  slug?: string;
  locale?: string;
  keyword?: string;
  seed?: string;
  mode?: string;
  domain?: string;
  seed_keywords?: string[];
  competitors?: string[];
  limit?: number;
  min_volume?: number;
  intent?: string;
  force?: boolean;
  confirm_seo_research_budget?: boolean;
  agent_session_id: string;
  site?: string;
  /** Staff HTTP path: daily-only budget. */
  staffMode?: boolean;
}): Promise<SeoResearchOk | SeoResearchFail> {
  const {
    isOpenRushConfigured,
    inspectKeywordQuery,
    inspectSerpQuery,
    researchKeywordsQuery,
    discoverCompetitorsQuery,
    compareKeywordCoverageQuery,
    OPENRUSH_INSPECT_KEYWORD_CREDITS,
    OPENRUSH_INSPECT_SERP_CREDITS,
    OPENRUSH_RESEARCH_KEYWORDS_CREDITS,
    OPENRUSH_DISCOVER_COMPETITORS_CREDITS,
    OPENRUSH_COMPARE_KEYWORD_COVERAGE_CREDITS,
  } = await import("../../server/openrush-client.js");
  const { getOpenRushSettings } = await import("../../server/settings.js");
  const {
    wouldSpend,
    recordSpend,
    budgetSnapshot,
    STAFF_BUDGET_SESSION_KEY,
  } = await import("../../server/seo-research-budget.js");
  const { resolveSeoResearchDomain } = await import("../../server/seo-research-domain.js");

  const settings = getOpenRushSettings(opts.contentPath);
  const location = settings.location || "United States";
  const language = settings.language || "English";
  const sessionKey = opts.staffMode
    ? STAFF_BUDGET_SESSION_KEY
    : opts.agent_session_id.trim() || STAFF_BUDGET_SESSION_KEY;
  const applySessionCap = !opts.staffMode;
  const sArg = siteArg(opts.site);
  const toolName = "get_or_refresh_seo_research";

  if (!isOpenRushConfigured(opts.contentPath)) {
    return {
      ok: false,
      code: "seo_research_inactive",
      action_required: "seo_research_inactive",
      message:
        "SEO research is not configured. Do not invent seo.kw_monthly_volume / seo.kw_difficulty. " +
        "If you have staff_provided or external:<tool> metrics, use update_fields with seo_research_source; otherwise release blocked.",
      warnings: [
        {
          code: "seo_research_inactive",
          message: "SEO research disabled or API key missing — get_or_refresh_seo_research cannot run.",
        },
      ],
      next_actions: [
        {
          tool: "update_fields",
          priority: "optional",
          reason:
            "Only if you have reliable offline metrics: write both kw_* with seo_research_source staff_provided|external:<name>.",
          args_hint: { ...sArg, seo_research_source: "staff_provided" },
        },
        {
          tool: "update_issue",
          priority: "recommended",
          reason: "Release SEO_KEYWORD_RESEARCH_INCOMPLETE if you lack a reliable source.",
          args_hint: { action: "release", ...sArg },
        },
      ],
    };
  }

  const gatePaid = (cost: number): SeoResearchFail | null => {
    const gate = wouldSpend({
      contentFolder: opts.contentFolder,
      contentRoot: opts.contentPath,
      sessionKey,
      applySessionCap,
      cost,
      confirm: opts.confirm_seo_research_budget === true,
      settings,
    });
    if (gate.ok) return null;
    return {
      ok: false,
      code: gate.code,
      action_required: gate.code,
      message: gate.message,
      details: { budget: gate.snapshot, credits_estimated: cost, force: Boolean(opts.force) },
      warnings: [],
      next_actions:
        gate.code === "confirm_seo_research_budget"
          ? [
              {
                tool: toolName,
                priority: "required",
                reason: "Re-call with confirm_seo_research_budget: true to accept budget risk until 100%.",
                args_hint: {
                  action: opts.action,
                  confirm_seo_research_budget: true,
                  force: opts.force === true,
                  ...sArg,
                },
              },
            ]
          : [],
    };
  };

  const snap = () =>
    budgetSnapshot({
      contentFolder: opts.contentFolder,
      contentRoot: opts.contentPath,
      sessionKey,
      applySessionCap,
      settings,
    });

  // —— keyword_metrics ——
  if (opts.action === "keyword_metrics") {
    const {
      getKeywordEntry,
      keywordMetricsCompleteAndFresh,
    } = await import("../../server/openrush-keyword-cache.js");

    const keyword = await resolveEntryKeyword({
      contentPath: opts.contentPath,
      contentType: opts.contentType,
      slug: opts.slug,
      locale: opts.locale || "en",
      keywordOverride: opts.keyword,
    });
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
            args_hint: {
              contentType: opts.contentType,
              slug: opts.slug,
              locale: opts.locale,
              ...sArg,
            },
          },
        ],
      };
    }

    const cached = getKeywordEntry(keyword, location, language, opts.contentFolder);
    if (!opts.force && keywordMetricsCompleteAndFresh(cached)) {
      return {
        ok: true,
        action: "keyword_metrics",
        outcome: "cache_hit",
        credits_spent: 0,
        budget: snap() as unknown as Record<string, unknown>,
        data: {
          keyword: cached!.keyword,
          kw_monthly_volume: cached!.monthly_volume,
          kw_difficulty: cached!.kw_difficulty,
          fetched_at: cached!.fetched_at,
          notes: cached!.notes,
          source: "seo_research_cache",
        },
        warnings: [
          {
            code: "seo_research_cache_hit",
            message: "Returned fresh keyword metrics from cache (no credits spent).",
          },
        ],
        side_effects: [],
        next_actions: [
          {
            tool: "get_entry_seo",
            priority: "optional",
            reason: "Confirm keyword_metrics on the entry.",
            args_hint: {
              contentType: opts.contentType,
              slug: opts.slug,
              locale: opts.locale,
              ...sArg,
            },
          },
        ],
      };
    }

    const blocked = gatePaid(OPENRUSH_INSPECT_KEYWORD_CREDITS);
    if (blocked) return blocked;

    const inspected = await inspectKeywordQuery({
      keyword,
      contentRoot: opts.contentPath,
      contentFolder: opts.contentFolder,
    });
    if (!inspected.ok || !inspected.metrics) {
      return {
        ok: false,
        code: "seo_research_keyword_failed",
        message: inspected.error || "Keyword research lookup failed",
        details: { keyword },
        warnings: [
          {
            code: "seo_research_pull_failed",
            message: "Provider pull failed — local budget not charged. Do not invent YAML kw_* metrics.",
          },
        ],
        next_actions: [
          {
            tool: toolName,
            priority: "optional",
            reason: "Retry keyword_metrics after fixing config/credits.",
            args_hint: { action: "keyword_metrics", keyword, ...sArg },
          },
        ],
      };
    }

    const volume = inspected.entry?.monthly_volume ?? inspected.metrics.monthly_volume;
    const difficulty = inspected.entry?.kw_difficulty ?? inspected.metrics.kw_difficulty;
    if (volume == null && difficulty == null && !inspected.entry) {
      return {
        ok: false,
        code: "seo_research_metrics_empty",
        message: "Provider returned no volume or difficulty for this keyword",
        details: { keyword, metrics: inspected.metrics },
        next_actions: [],
      };
    }

    const budget = recordSpend({
      contentFolder: opts.contentFolder,
      sessionKey,
      cost: OPENRUSH_INSPECT_KEYWORD_CREDITS,
    });

    return {
      ok: true,
      action: "keyword_metrics",
      outcome: "fetched",
      credits_spent: OPENRUSH_INSPECT_KEYWORD_CREDITS,
      credits_note: inspected.credits_note,
      budget: budget as unknown as Record<string, unknown>,
      data: {
        keyword: inspected.metrics.keyword,
        kw_monthly_volume: volume ?? null,
        kw_difficulty: difficulty ?? null,
        fetched_at: inspected.entry?.fetched_at ?? null,
        notes: inspected.entry?.notes ?? null,
        source: "seo_research_cache",
      },
      warnings: [
        {
          code: "seo_research_cache_only",
          message:
            "Refreshed keyword research cache only — did not write seo.kw_monthly_volume / seo.kw_difficulty YAML.",
        },
      ],
      side_effects: [
        {
          kind: "seo_research_keyword_cache",
          summary: `Upserted keyword cache for "${inspected.metrics.keyword}" (no locale YAML change).`,
        },
      ],
      next_actions: [
        {
          tool: "get_entry_seo",
          priority: "recommended",
          reason: "Confirm keyword_metrics.source with both metrics.",
          args_hint: {
            contentType: opts.contentType,
            slug: opts.slug,
            locale: opts.locale,
            ...sArg,
          },
        },
      ],
    };
  }

  // —— serp ——
  if (opts.action === "serp") {
    const { loadSerpCache, serpEntryFreshForMarket } = await import(
      "../../server/openrush-serp-cache.js"
    );
    const query = await resolveEntryKeyword({
      contentPath: opts.contentPath,
      contentType: opts.contentType,
      slug: opts.slug,
      locale: opts.locale || "en",
      keywordOverride: opts.keyword,
    });
    if (!query) {
      return {
        ok: false,
        code: "no_keyword",
        message: "No query/keyword for SERP — set seo.main_keyword or pass keyword.",
        next_actions: [],
      };
    }

    const entry = loadSerpCache(opts.contentFolder).entries[query];
    if (!opts.force && serpEntryFreshForMarket(entry, location, language)) {
      return {
        ok: true,
        action: "serp",
        outcome: "cache_hit",
        credits_spent: 0,
        budget: snap() as unknown as Record<string, unknown>,
        data: { ...entry, query },
        warnings: [
          { code: "seo_research_cache_hit", message: "Returned fresh SERP from cache (no credits spent)." },
        ],
        side_effects: [],
        next_actions: [],
      };
    }

    const blocked = gatePaid(OPENRUSH_INSPECT_SERP_CREDITS);
    if (blocked) return blocked;

    const inspected = await inspectSerpQuery({
      query,
      contentRoot: opts.contentPath,
      contentFolder: opts.contentFolder,
    });
    if (!inspected.ok || !inspected.entry) {
      return {
        ok: false,
        code: "seo_research_serp_failed",
        message: inspected.error || "SERP lookup failed",
        details: { query },
        warnings: [
          {
            code: "seo_research_pull_failed",
            message: "Provider pull failed — local budget not charged.",
          },
        ],
        next_actions: [],
      };
    }

    const budget = recordSpend({
      contentFolder: opts.contentFolder,
      sessionKey,
      cost: OPENRUSH_INSPECT_SERP_CREDITS,
    });

    return {
      ok: true,
      action: "serp",
      outcome: "fetched",
      credits_spent: OPENRUSH_INSPECT_SERP_CREDITS,
      credits_note: inspected.credits_note,
      budget: budget as unknown as Record<string, unknown>,
      data: { ...inspected.entry, query },
      warnings: [],
      side_effects: [
        { kind: "seo_research_serp_cache", summary: `Upserted SERP cache for "${query}".` },
      ],
      next_actions: [],
    };
  }

  // —— keyword_ideas ——
  if (opts.action === "keyword_ideas") {
    const {
      ideasCacheKey,
      getIdeasEntry,
      ideasEntryFresh,
      upsertIdeasEntry,
    } = await import("../../server/seo-research-cache.js");

    const seed =
      opts.seed?.trim() ||
      (await resolveEntryKeyword({
        contentPath: opts.contentPath,
        contentType: opts.contentType,
        slug: opts.slug,
        locale: opts.locale || "en",
        keywordOverride: opts.keyword,
      }));
    if (!seed) {
      return {
        ok: false,
        code: "no_seed",
        message: "keyword_ideas requires seed (or entry main_keyword).",
        next_actions: [],
      };
    }
    const mode = opts.mode || "ideas";
    const limit = opts.limit ?? 25;
    const key = ideasCacheKey({
      seed,
      mode,
      location,
      language,
      limit,
      min_volume: opts.min_volume,
      intent: opts.intent,
    });
    const cached = getIdeasEntry(key, opts.contentFolder);
    if (!opts.force && ideasEntryFresh(cached)) {
      return {
        ok: true,
        action: "keyword_ideas",
        outcome: "cache_hit",
        credits_spent: 0,
        budget: snap() as unknown as Record<string, unknown>,
        data: cached!.payload,
        warnings: [
          { code: "seo_research_cache_hit", message: "Returned keyword ideas from cache (no credits spent)." },
        ],
        side_effects: [],
        next_actions: [],
      };
    }

    const blocked = gatePaid(OPENRUSH_RESEARCH_KEYWORDS_CREDITS);
    if (blocked) return blocked;

    const result = await researchKeywordsQuery({
      seed,
      contentRoot: opts.contentPath,
      mode,
      limit,
      min_volume: opts.min_volume,
      intent: opts.intent,
    });
    if (!result.ok || !result.data) {
      return {
        ok: false,
        code: "seo_research_ideas_failed",
        message: result.error || "Keyword ideas lookup failed",
        warnings: [
          {
            code: "seo_research_pull_failed",
            message: "Provider pull failed — local budget not charged.",
          },
        ],
        next_actions: [],
      };
    }

    upsertIdeasEntry(
      { key, location, language, payload: result.data },
      opts.contentFolder,
    );
    const budget = recordSpend({
      contentFolder: opts.contentFolder,
      sessionKey,
      cost: OPENRUSH_RESEARCH_KEYWORDS_CREDITS,
    });

    return {
      ok: true,
      action: "keyword_ideas",
      outcome: "fetched",
      credits_spent: OPENRUSH_RESEARCH_KEYWORDS_CREDITS,
      credits_note: result.credits_note,
      budget: budget as unknown as Record<string, unknown>,
      data: result.data,
      warnings: [],
      side_effects: [{ kind: "seo_research_ideas_cache", summary: `Cached keyword ideas for seed "${seed}".` }],
      next_actions: [],
    };
  }

  // —— competitors ——
  if (opts.action === "competitors") {
    const {
      competitorsCacheKey,
      getCompetitorsEntry,
      competitorsEntryFresh,
      upsertCompetitorsEntry,
    } = await import("../../server/seo-research-cache.js");

    const seeds = (opts.seed_keywords || []).map((s) => s.trim()).filter(Boolean);
    let domain = opts.domain?.trim() || "";
    if (!domain && seeds.length === 0) {
      domain =
        resolveSeoResearchDomain({
          contentRoot: opts.contentPath,
          contentFolder: opts.contentFolder,
        }) || "";
    }
    if (!domain && seeds.length === 0) {
      return {
        ok: false,
        code: "domain_required",
        message:
          "competitors requires domain or seed_keywords (or a resolvable Search Console / site domain).",
        next_actions: [],
      };
    }

    const limit = opts.limit ?? 10;
    const key = competitorsCacheKey({
      domain: domain || undefined,
      seed_keywords: seeds.length ? seeds : undefined,
      location,
      language,
      limit,
    });
    const cached = getCompetitorsEntry(key, opts.contentFolder);
    if (!opts.force && competitorsEntryFresh(cached)) {
      return {
        ok: true,
        action: "competitors",
        outcome: "cache_hit",
        credits_spent: 0,
        budget: snap() as unknown as Record<string, unknown>,
        data: cached!.payload,
        warnings: [
          { code: "seo_research_cache_hit", message: "Returned competitors from cache (no credits spent)." },
        ],
        side_effects: [],
        next_actions: [],
      };
    }

    const blocked = gatePaid(OPENRUSH_DISCOVER_COMPETITORS_CREDITS);
    if (blocked) return blocked;

    const result = await discoverCompetitorsQuery({
      contentRoot: opts.contentPath,
      domain: domain || undefined,
      seed_keywords: seeds.length ? seeds : undefined,
      limit,
    });
    if (!result.ok || !result.data) {
      return {
        ok: false,
        code: "seo_research_competitors_failed",
        message: result.error || "Competitors lookup failed",
        warnings: [
          {
            code: "seo_research_pull_failed",
            message: "Provider pull failed — local budget not charged.",
          },
        ],
        next_actions: [],
      };
    }

    upsertCompetitorsEntry(
      { key, location, language, payload: result.data },
      opts.contentFolder,
    );
    const budget = recordSpend({
      contentFolder: opts.contentFolder,
      sessionKey,
      cost: OPENRUSH_DISCOVER_COMPETITORS_CREDITS,
    });

    return {
      ok: true,
      action: "competitors",
      outcome: "fetched",
      credits_spent: OPENRUSH_DISCOVER_COMPETITORS_CREDITS,
      credits_note: result.credits_note,
      budget: budget as unknown as Record<string, unknown>,
      data: result.data,
      warnings: [],
      side_effects: [{ kind: "seo_research_competitors_cache", summary: "Cached competitor discovery result." }],
      next_actions: [
        {
          tool: toolName,
          priority: "optional",
          reason: "Run keyword_gaps with these competitor domains when ready.",
          args_hint: { action: "keyword_gaps", domain: domain || undefined, ...sArg },
        },
      ],
    };
  }

  // —— keyword_gaps ——
  if (opts.action === "keyword_gaps") {
    const {
      gapsCacheKey,
      getGapsEntry,
      gapsEntryFresh,
      upsertGapsEntry,
    } = await import("../../server/seo-research-cache.js");

    const competitors = (opts.competitors || []).map((c) => c.trim()).filter(Boolean);
    if (competitors.length === 0) {
      return {
        ok: false,
        code: "competitors_required",
        message:
          "keyword_gaps requires a non-empty competitors list. Discover rivals first or pass competitor domains.",
        next_actions: [
          {
            tool: toolName,
            priority: "recommended",
            reason: "Discover competitors, then re-call keyword_gaps with competitors[].",
            args_hint: { action: "competitors", ...sArg },
          },
        ],
      };
    }

    const domain =
      opts.domain?.trim() ||
      resolveSeoResearchDomain({
        contentRoot: opts.contentPath,
        contentFolder: opts.contentFolder,
        override: opts.domain,
      }) ||
      "";
    if (!domain) {
      return {
        ok: false,
        code: "domain_required",
        message: "keyword_gaps needs our domain (pass domain or configure Search Console / sites.yml).",
        next_actions: [],
      };
    }

    const limit = opts.limit ?? 50;
    const key = gapsCacheKey({ domain, competitors, location, language, limit });
    const cached = getGapsEntry(key, opts.contentFolder);
    if (!opts.force && gapsEntryFresh(cached)) {
      return {
        ok: true,
        action: "keyword_gaps",
        outcome: "cache_hit",
        credits_spent: 0,
        budget: snap() as unknown as Record<string, unknown>,
        data: cached!.payload,
        warnings: [
          { code: "seo_research_cache_hit", message: "Returned keyword gaps from cache (no credits spent)." },
        ],
        side_effects: [],
        next_actions: [],
      };
    }

    const blocked = gatePaid(OPENRUSH_COMPARE_KEYWORD_COVERAGE_CREDITS);
    if (blocked) return blocked;

    const result = await compareKeywordCoverageQuery({
      contentRoot: opts.contentPath,
      domain,
      competitors,
      limit,
    });
    if (!result.ok || !result.data) {
      return {
        ok: false,
        code: "seo_research_gaps_failed",
        message: result.error || "Keyword gaps lookup failed",
        warnings: [
          {
            code: "seo_research_pull_failed",
            message: "Provider pull failed — local budget not charged.",
          },
        ],
        next_actions: [],
      };
    }

    upsertGapsEntry({ key, location, language, payload: result.data }, opts.contentFolder);
    const budget = recordSpend({
      contentFolder: opts.contentFolder,
      sessionKey,
      cost: OPENRUSH_COMPARE_KEYWORD_COVERAGE_CREDITS,
    });

    return {
      ok: true,
      action: "keyword_gaps",
      outcome: "fetched",
      credits_spent: OPENRUSH_COMPARE_KEYWORD_COVERAGE_CREDITS,
      credits_note: result.credits_note,
      budget: budget as unknown as Record<string, unknown>,
      data: result.data,
      warnings: [],
      side_effects: [{ kind: "seo_research_gaps_cache", summary: `Cached keyword gaps for ${domain}.` }],
      next_actions: [],
    };
  }

  return {
    ok: false,
    code: "unknown_action",
    message: `Unknown action: ${opts.action}`,
  };
}

/** @deprecated Use runSeoResearch({ action: "keyword_metrics", ... }) */
export async function runRefreshKeywordMetrics(opts: {
  contentPath: string;
  contentFolder: string;
  contentType: string;
  slug: string;
  locale: string;
  keywordOverride?: string;
  site?: string;
  agent_session_id?: string;
  force?: boolean;
  confirm_seo_research_budget?: boolean;
}): Promise<
  | {
      ok: true;
      keyword: string;
      kw_monthly_volume: number | null;
      kw_difficulty: number | null;
      fetched_at: string | null;
      notes: string | null;
      source: "openrush_cache" | "seo_research_cache";
      credits: number;
      credits_note?: string;
      warnings: McpWarning[];
      side_effects: McpSideEffect[];
      next_actions: NextAction[];
    }
  | SeoResearchFail
> {
  const result = await runSeoResearch({
    action: "keyword_metrics",
    contentPath: opts.contentPath,
    contentFolder: opts.contentFolder,
    contentType: opts.contentType,
    slug: opts.slug,
    locale: opts.locale,
    keyword: opts.keywordOverride,
    site: opts.site,
    agent_session_id: opts.agent_session_id || "legacy",
    force: opts.force,
    confirm_seo_research_budget: opts.confirm_seo_research_budget,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    keyword: String(result.data.keyword || ""),
    kw_monthly_volume: (result.data.kw_monthly_volume as number | null) ?? null,
    kw_difficulty: (result.data.kw_difficulty as number | null) ?? null,
    fetched_at: (result.data.fetched_at as string | null) ?? null,
    notes: (result.data.notes as string | null) ?? null,
    source: "seo_research_cache",
    credits: result.credits_spent,
    credits_note: result.credits_note,
    warnings: result.warnings,
    side_effects: result.side_effects,
    next_actions: result.next_actions,
  };
}
