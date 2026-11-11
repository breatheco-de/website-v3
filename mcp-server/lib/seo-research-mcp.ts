/**
 * MCP SEO research: get_or_refresh_seo_research (cache + paid fetch with budget).
 * Vendor-neutral agent envelopes — no vendor names in codes/messages (provider ids appear only
 * as data values). Keyword metrics route to DataForSEO when configured, otherwise OpenRush.
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
  /** Provider credits spent (credit-billed providers); 0 for USD-billed lookups. */
  credits_spent: number;
  /** USD spent (USD-billed providers); present when such a provider ran. */
  cost_usd?: number;
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

function difficultyProvenanceWarnings(
  source: string | null,
  competition: string | number | null,
): McpWarning[] {
  if (source !== "derived_from_competition") return [];
  const label = competition == null ? "a competition score" : `competition "${competition}"`;
  return [
    {
      code: "seo_research_difficulty_derived",
      message:
        `kw_difficulty was not reported by the provider — it is mapped from ${label} ` +
        "(low→20, medium→50, high→80, very high→90; 0–1 scores ×100). Competition measures ad bidding, " +
        "not how hard the keyword is to rank for. Treat kw_difficulty as a rough proxy and say so to staff. " +
        "Pass force: true to refetch from the current keyword provider (may return a real score or unknown).",
    },
  ];
}

function difficultyUnavailableWarnings(difficulty: number | null, volume: number | null): McpWarning[] {
  if (difficulty != null) return [];
  return [
    {
      code: "seo_research_difficulty_unavailable",
      message:
        "The provider has no ranking-difficulty score for this keyword in this market" +
        (volume == null ? " (and no volume)" : "") +
        ". Leave kw_difficulty unknown — do not estimate it from competition, CPC or volume.",
    },
  ];
}

function sandboxWarnings(mode: string | null): McpWarning[] {
  if (mode !== "sandbox") return [];
  return [
    {
      code: "seo_research_sandbox",
      message:
        "This server uses the keyword provider's free sandbox (not the live server): numbers are sample data. " +
        "Never file ideas or claim demand from them.",
    },
  ];
}

export async function runSeoResearch(opts: {
  action: SeoResearchAction;
  contentPath: string;
  contentFolder: string;
  contentType?: string;
  slug?: string;
  locale?: string;
  keyword?: string;
  /** Country market id (spain, mexico, usa, …). Default: the page locale's research market. */
  market?: string;
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
    inspectSerpQuery,
    researchKeywordsQuery,
    discoverCompetitorsQuery,
    compareKeywordCoverageQuery,
    OPENRUSH_INSPECT_SERP_CREDITS,
    OPENRUSH_RESEARCH_KEYWORDS_CREDITS,
    OPENRUSH_DISCOVER_COMPETITORS_CREDITS,
    OPENRUSH_COMPARE_KEYWORD_COVERAGE_CREDITS,
  } = await import("../../server/openrush-client.js");
  const { providerFor, fetchKeywordMetrics, estimateKeywordMetricsCost } = await import(
    "../../server/seo-research-providers.js"
  );
  const { resolveSiteResearchMarket, marketSummary } = await import(
    "../../server/seo-research-market.js"
  );
  const {
    wouldSpend,
    recordSpend,
    budgetSnapshot,
    STAFF_BUDGET_SESSION_KEY,
  } = await import("../../server/seo-research-budget.js");
  const { resolveSeoResearchDomain } = await import("../../server/seo-research-domain.js");

  const sessionKey = opts.staffMode
    ? STAFF_BUDGET_SESSION_KEY
    : opts.agent_session_id.trim() || STAFF_BUDGET_SESSION_KEY;
  const applySessionCap = !opts.staffMode;
  const sArg = siteArg(opts.site);
  const toolName = "get_or_refresh_seo_research";

  const provider = providerFor(opts.action, opts.contentPath);
  if (!provider) {
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
          message: `No research provider is configured for ${opts.action} — get_or_refresh_seo_research cannot run.`,
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

  const marketRes = resolveSiteResearchMarket({
    contentRoot: opts.contentPath,
    marketId: opts.market,
    locale: opts.locale || "en",
  });
  if (!marketRes.ok) {
    const suggestion = marketRes.country_markets[0];
    return {
      ok: false,
      code: marketRes.code === "unknown_market" ? "unknown_market" : "market_not_researchable",
      message: marketRes.message,
      details: { market: opts.market ?? null, country_markets: marketRes.country_markets },
      warnings: [],
      next_actions: suggestion
        ? [
            {
              tool: toolName,
              priority: "recommended",
              reason: `Re-call with one country market (${marketRes.country_markets.join(", ")}); keyword tools score one country at a time.`,
              args_hint: { action: opts.action, market: suggestion, ...sArg },
            },
          ]
        : [],
    };
  }
  const market = marketRes.market;
  const { location, language } = market;
  const marketOut = marketSummary(market);
  const marketWarnings: McpWarning[] = marketRes.warning
    ? [{ code: "seo_research_market_fallback", message: marketRes.warning }]
    : [];

  const gatePaid = (cost: number): SeoResearchFail | null => {
    const gate = wouldSpend({
      provider,
      contentFolder: opts.contentFolder,
      contentRoot: opts.contentPath,
      sessionKey,
      applySessionCap,
      cost,
      confirm: opts.confirm_seo_research_budget === true,
    });
    if (gate.ok) return null;
    return {
      ok: false,
      code: gate.code,
      action_required: gate.code,
      message: gate.message,
      details: {
        budget: gate.snapshot,
        ...(gate.snapshot.unit === "usd" ? { cost_usd_estimated: cost } : { credits_estimated: cost }),
        force: Boolean(opts.force),
      },
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
                  ...(opts.market ? { market: opts.market } : {}),
                  ...sArg,
                },
              },
            ]
          : [],
    };
  };

  const snap = () =>
    budgetSnapshot({
      provider,
      contentFolder: opts.contentFolder,
      contentRoot: opts.contentPath,
      sessionKey,
      applySessionCap,
    });

  const spend = (cost: number) =>
    recordSpend({
      provider,
      contentFolder: opts.contentFolder,
      contentRoot: opts.contentPath,
      sessionKey,
      cost,
    });

  // —— keyword_metrics ——
  if (opts.action === "keyword_metrics") {
    const {
      getKeywordEntry,
      keywordMetricsCompleteAndFresh,
      keywordDifficultySourceOf,
      competitionLevelOf,
      volumeProviderOf,
      difficultyProviderOf,
    } = await import("../../server/openrush-keyword-cache.js");
    const { dataForSeoMode } = await import("../../server/dataforseo-client.js");

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

    const entrySeoNext: NextAction = {
      tool: "get_entry_seo",
      priority: "optional",
      reason: "Confirm keyword_metrics on the entry.",
      args_hint: {
        contentType: opts.contentType,
        slug: opts.slug,
        locale: opts.locale,
        ...sArg,
      },
    };

    const cached = getKeywordEntry(keyword, location, language, opts.contentFolder);
    if (!opts.force && keywordMetricsCompleteAndFresh(cached)) {
      const difficultySource = keywordDifficultySourceOf(cached);
      const competition = competitionLevelOf(cached);
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
          kw_difficulty_source: difficultySource,
          competition_level: competition,
          market: marketOut,
          providers: { volume: volumeProviderOf(cached), difficulty: difficultyProviderOf(cached) },
          fetched_at: cached!.fetched_at,
          notes: cached!.notes,
          source: "seo_research_cache",
        },
        warnings: [
          {
            code: "seo_research_cache_hit",
            message: "Returned fresh keyword metrics from cache (no spend).",
          },
          ...marketWarnings,
          ...difficultyProvenanceWarnings(difficultySource, competition),
          ...difficultyUnavailableWarnings(cached!.kw_difficulty, cached!.monthly_volume),
        ],
        side_effects: [],
        next_actions: [entrySeoNext],
      };
    }

    const estimate = estimateKeywordMetricsCost(provider, 1);
    const blocked = gatePaid(estimate);
    if (blocked) return blocked;

    const fetched = await fetchKeywordMetrics({
      provider,
      keywords: [keyword],
      market,
      contentRoot: opts.contentPath,
      contentFolder: opts.contentFolder,
    });
    const row = fetched.rows[0];
    if (!row || !row.ok) {
      const error = row && !row.ok ? row.error : "Keyword research lookup failed";
      if (fetched.fatal) {
        return {
          ok: false,
          code: "seo_research_provider_unavailable",
          message: error,
          details: {
            keyword,
            provider,
            error_kind: fetched.fatal.error_kind,
            market: marketOut,
          },
          warnings: [
            {
              code: "seo_research_provider_unavailable",
              message:
                "The keyword provider is unavailable (login, funds or outage). Do not retry this session and do not " +
                "switch to another source or estimate metrics — tell staff the message above. Local budget not charged.",
            },
          ],
          next_actions: [],
        };
      }
      return {
        ok: false,
        code: "seo_research_keyword_failed",
        message: error,
        details: { keyword, provider, market: marketOut },
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
            args_hint: { action: "keyword_metrics", keyword, ...(opts.market ? { market: opts.market } : {}), ...sArg },
          },
        ],
      };
    }

    const budget = spend(fetched.cost);
    const entry = row.entry;
    const difficultySource = keywordDifficultySourceOf(entry);
    const competition = competitionLevelOf(entry);
    const mode = provider === "dataforseo" ? dataForSeoMode() : null;

    return {
      ok: true,
      action: "keyword_metrics",
      outcome: "fetched",
      credits_spent: provider === "openrush" ? fetched.cost : 0,
      ...(provider === "dataforseo" ? { cost_usd: fetched.cost } : {}),
      budget: budget as unknown as Record<string, unknown>,
      data: {
        keyword: entry.keyword,
        kw_monthly_volume: entry.monthly_volume,
        kw_difficulty: entry.kw_difficulty,
        kw_difficulty_source: difficultySource,
        competition_level: competition,
        market: marketOut,
        providers: { volume: volumeProviderOf(entry), difficulty: difficultyProviderOf(entry) },
        provider_had_data: row.found,
        ...(mode ? { mode } : {}),
        fetched_at: entry.fetched_at,
        notes: entry.notes,
        source: "seo_research_cache",
      },
      warnings: [
        {
          code: "seo_research_cache_only",
          message:
            "Refreshed keyword research cache only — did not write seo.kw_monthly_volume / seo.kw_difficulty YAML.",
        },
        ...marketWarnings,
        ...sandboxWarnings(mode),
        ...difficultyProvenanceWarnings(difficultySource, competition),
        ...difficultyUnavailableWarnings(entry.kw_difficulty, entry.monthly_volume),
      ],
      side_effects: [
        {
          kind: "seo_research_keyword_cache",
          summary: `Upserted keyword cache for "${entry.keyword}" in ${market.label} (no locale YAML change).`,
        },
      ],
      next_actions: [
        {
          ...entrySeoNext,
          priority: "recommended",
          reason: "Confirm keyword_metrics.source with both metrics.",
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
        data: { ...entry, query, market: marketOut },
        warnings: [
          { code: "seo_research_cache_hit", message: "Returned fresh SERP from cache (no credits spent)." },
          ...marketWarnings,
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
      market: { location, language },
    });
    if (!inspected.ok || !inspected.entry) {
      return {
        ok: false,
        code: "seo_research_serp_failed",
        message: inspected.error || "SERP lookup failed",
        details: { query, market: marketOut },
        warnings: [
          {
            code: "seo_research_pull_failed",
            message: "Provider pull failed — local budget not charged.",
          },
        ],
        next_actions: [],
      };
    }

    const budget = spend(OPENRUSH_INSPECT_SERP_CREDITS);

    return {
      ok: true,
      action: "serp",
      outcome: "fetched",
      credits_spent: OPENRUSH_INSPECT_SERP_CREDITS,
      credits_note: inspected.credits_note,
      budget: budget as unknown as Record<string, unknown>,
      data: { ...inspected.entry, query, market: marketOut },
      warnings: [...marketWarnings],
      side_effects: [
        { kind: "seo_research_serp_cache", summary: `Upserted SERP cache for "${query}" in ${market.label}.` },
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
        data: { ...cached!.payload, market: marketOut },
        warnings: [
          { code: "seo_research_cache_hit", message: "Returned keyword ideas from cache (no credits spent)." },
          ...marketWarnings,
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
      market: { location, language },
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
    const budget = spend(OPENRUSH_RESEARCH_KEYWORDS_CREDITS);

    return {
      ok: true,
      action: "keyword_ideas",
      outcome: "fetched",
      credits_spent: OPENRUSH_RESEARCH_KEYWORDS_CREDITS,
      credits_note: result.credits_note,
      budget: budget as unknown as Record<string, unknown>,
      data: { ...result.data, market: marketOut },
      warnings: [...marketWarnings],
      side_effects: [{ kind: "seo_research_ideas_cache", summary: `Cached keyword ideas for seed "${seed}" in ${market.label}.` }],
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
        data: { ...cached!.payload, market: marketOut },
        warnings: [
          { code: "seo_research_cache_hit", message: "Returned competitors from cache (no credits spent)." },
          ...marketWarnings,
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
      market: { location, language },
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
    const budget = spend(OPENRUSH_DISCOVER_COMPETITORS_CREDITS);

    return {
      ok: true,
      action: "competitors",
      outcome: "fetched",
      credits_spent: OPENRUSH_DISCOVER_COMPETITORS_CREDITS,
      credits_note: result.credits_note,
      budget: budget as unknown as Record<string, unknown>,
      data: { ...result.data, market: marketOut },
      warnings: [...marketWarnings],
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
        data: { ...cached!.payload, market: marketOut },
        warnings: [
          { code: "seo_research_cache_hit", message: "Returned keyword gaps from cache (no credits spent)." },
          ...marketWarnings,
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
      market: { location, language },
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
    const budget = spend(OPENRUSH_COMPARE_KEYWORD_COVERAGE_CREDITS);

    return {
      ok: true,
      action: "keyword_gaps",
      outcome: "fetched",
      credits_spent: OPENRUSH_COMPARE_KEYWORD_COVERAGE_CREDITS,
      credits_note: result.credits_note,
      budget: budget as unknown as Record<string, unknown>,
      data: { ...result.data, market: marketOut },
      warnings: [...marketWarnings],
      side_effects: [{ kind: "seo_research_gaps_cache", summary: `Cached keyword gaps for ${domain} in ${market.label}.` }],
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
      kw_difficulty_source: string | null;
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
    kw_difficulty_source: (result.data.kw_difficulty_source as string | null) ?? null,
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
