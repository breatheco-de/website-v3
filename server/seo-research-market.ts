/**
 * Site-level keyword research market: Search Console markets + per-locale defaults, with the
 * OpenRush location/language as the last-resort fallback.
 */

import { getOpenRushSettings, getSearchConsoleSettings } from "./settings";
import {
  resolveResearchMarket,
  type ResearchMarket,
  type ResearchMarketResolution,
} from "./gsc-organic-markets";

export type { ResearchMarket, ResearchMarketResolution };

export function resolveSiteResearchMarket(opts: {
  contentRoot?: string;
  marketId?: string | null;
  locale?: string | null;
}): ResearchMarketResolution {
  const sc = getSearchConsoleSettings(opts.contentRoot);
  const openrush = getOpenRushSettings(opts.contentRoot);
  return resolveResearchMarket({
    markets: sc.organic_markets,
    defaults: sc.research_market_defaults,
    marketId: opts.marketId,
    locale: opts.locale,
    fallback: {
      location: openrush.location || "United States",
      language: openrush.language || "English",
    },
  });
}

/** Compact market shape for API / MCP payloads. */
export function marketSummary(m: ResearchMarket): {
  id: string | null;
  label: string;
  location: string;
  language: string;
  source: ResearchMarket["source"];
} {
  return { id: m.id, label: m.label, location: m.location, language: m.language, source: m.source };
}
