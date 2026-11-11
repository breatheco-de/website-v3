/**
 * Configurable organic markets: GSC country codes on day-cache rows, and the country +
 * language keyword research (DataForSEO / OpenRush) is scored in.
 */

export type OrganicMarketKind = "rollup" | "country";

export type OrganicMarket = {
  id: string;
  label: string;
  /** Empty = worldwide (all rows). GSC 3-letter codes, lowercase. */
  countries: string[];
  kind: OrganicMarketKind;
  /** Search language for keyword research (e.g. "English", "Spanish"). Parse fills a default. */
  language?: string;
};

/** Common ISO-3166 alpha-2 → GSC/Search Console alpha-3 (lowercase). */
const ALPHA2_TO_ALPHA3: Record<string, string> = {
  us: "usa",
  es: "esp",
  mx: "mex",
  cl: "chl",
  co: "col",
  ve: "ven",
  uy: "ury",
  ar: "arg",
  ca: "can",
  br: "bra",
  pe: "per",
  cr: "cri",
  ec: "ecu",
  bo: "bol",
  py: "pry",
  gt: "gtm",
  pa: "pan",
  do: "dom",
  cu: "cub",
  pt: "prt",
  gb: "gbr",
  uk: "gbr",
  de: "deu",
  fr: "fra",
  it: "ita",
};

/** GSC alpha-3 → location name accepted by keyword research providers (location_name). */
const ALPHA3_TO_RESEARCH_LOCATION: Record<string, string> = {
  usa: "United States",
  esp: "Spain",
  mex: "Mexico",
  chl: "Chile",
  col: "Colombia",
  ven: "Venezuela",
  ury: "Uruguay",
  arg: "Argentina",
  can: "Canada",
  bra: "Brazil",
  per: "Peru",
  cri: "Costa Rica",
  ecu: "Ecuador",
  bol: "Bolivia",
  pry: "Paraguay",
  gtm: "Guatemala",
  pan: "Panama",
  dom: "Dominican Republic",
  prt: "Portugal",
  gbr: "United Kingdom",
  deu: "Germany",
  fra: "France",
  ita: "Italy",
};

const ALPHA3_DEFAULT_LANGUAGE: Record<string, string> = {
  usa: "English",
  can: "English",
  gbr: "English",
  bra: "Portuguese",
  prt: "Portuguese",
  deu: "German",
  fra: "French",
  ita: "Italian",
};

export function researchLocationForCountry(alpha3: string): string | null {
  return ALPHA3_TO_RESEARCH_LOCATION[alpha3.trim().toLowerCase()] ?? null;
}

/** Default search language for a market's countries (Spanish unless every country maps elsewhere). */
export function defaultMarketLanguage(countries: string[]): string {
  if (countries.length === 0) return "English";
  const langs = new Set(countries.map((c) => ALPHA3_DEFAULT_LANGUAGE[c] ?? "Spanish"));
  return langs.size === 1 ? [...langs][0]! : "Spanish";
}

export const DEFAULT_ORGANIC_MARKETS: OrganicMarket[] = [
  { id: "worldwide", label: "Worldwide", countries: [], kind: "rollup", language: "English" },
  {
    id: "latam",
    label: "LatAm",
    countries: ["mex", "chl", "col", "ven", "ury", "arg"],
    kind: "rollup",
    language: "Spanish",
  },
  { id: "spain", label: "Spain", countries: ["esp"], kind: "country", language: "Spanish" },
  { id: "usa", label: "USA", countries: ["usa"], kind: "country", language: "English" },
  { id: "mexico", label: "Mexico", countries: ["mex"], kind: "country", language: "Spanish" },
  { id: "chile", label: "Chile", countries: ["chl"], kind: "country", language: "Spanish" },
  { id: "colombia", label: "Colombia", countries: ["col"], kind: "country", language: "Spanish" },
  { id: "venezuela", label: "Venezuela", countries: ["ven"], kind: "country", language: "Spanish" },
  { id: "uruguay", label: "Uruguay", countries: ["ury"], kind: "country", language: "Spanish" },
  { id: "argentina", label: "Argentina", countries: ["arg"], kind: "country", language: "Spanish" },
];

/** Page locale → country market id used for keyword research when the caller names none. */
export type ResearchMarketDefaults = Record<string, string>;

export const DEFAULT_RESEARCH_MARKET_DEFAULTS: ResearchMarketDefaults = { en: "usa", es: "spain" };

export function parseResearchMarketDefaults(raw: unknown): ResearchMarketDefaults {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_RESEARCH_MARKET_DEFAULTS };
  }
  const out: ResearchMarketDefaults = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const locale = k.trim().toLowerCase().split(/[-_]/)[0] || "";
    if (!/^[a-z]{2,3}$/.test(locale) || typeof v !== "string" || !v.trim()) continue;
    out[locale] = slugifyMarketId(v);
  }
  return Object.keys(out).length > 0 ? out : { ...DEFAULT_RESEARCH_MARKET_DEFAULTS };
}

export function normalizeGscCountryCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  if (t.length === 2) return ALPHA2_TO_ALPHA3[t] ?? null;
  if (t.length === 3 && /^[a-z]{3}$/.test(t)) return t;
  return null;
}

function slugifyMarketId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function inferKind(id: string, countries: string[]): OrganicMarketKind {
  if (id === "worldwide" || countries.length === 0) return "rollup";
  if (id === "latam" || countries.length > 1) return "rollup";
  return "country";
}

export function parseOrganicMarkets(raw: unknown): OrganicMarket[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_ORGANIC_MARKETS.map((m) => ({ ...m, countries: [...m.countries] }));
  }

  const out: OrganicMarket[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const label =
      typeof o.label === "string" && o.label.trim()
        ? o.label.trim()
        : typeof o.id === "string" && o.id.trim()
          ? o.id.trim()
          : "";
    if (!label) continue;
    const idRaw =
      typeof o.id === "string" && o.id.trim() ? o.id.trim() : slugifyMarketId(label);
    const id = slugifyMarketId(idRaw) || slugifyMarketId(label);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const countriesRaw = Array.isArray(o.countries) ? o.countries : [];
    const countries: string[] = [];
    const countrySeen = new Set<string>();
    for (const c of countriesRaw) {
      const n = normalizeGscCountryCode(c);
      if (!n || countrySeen.has(n)) continue;
      countrySeen.add(n);
      countries.push(n);
    }

    const kindRaw = o.kind === "rollup" || o.kind === "country" ? o.kind : inferKind(id, countries);
    const kind: OrganicMarketKind =
      id === "worldwide" || countries.length === 0 ? "rollup" : kindRaw;
    const finalCountries = id === "worldwide" ? [] : countries;
    const language =
      typeof o.language === "string" && o.language.trim()
        ? o.language.trim()
        : defaultMarketLanguage(finalCountries);

    out.push({
      id,
      label,
      countries: finalCountries,
      kind: id === "worldwide" ? "rollup" : kind,
      language,
    });
  }

  if (!out.some((m) => m.id === "worldwide")) {
    out.unshift({ id: "worldwide", label: "Worldwide", countries: [], kind: "rollup", language: "English" });
  }

  return out.length > 0
    ? out
    : DEFAULT_ORGANIC_MARKETS.map((m) => ({ ...m, countries: [...m.countries] }));
}

export function serializeOrganicMarkets(markets: OrganicMarket[]): Array<Record<string, unknown>> {
  return markets.map((m) => ({
    id: m.id,
    label: m.label,
    kind: m.kind,
    countries: [...m.countries],
    ...(m.language ? { language: m.language } : {}),
  }));
}

/** Union of all non-worldwide market country codes (for ingest truncation preference). */
export function configuredCountrySet(markets: OrganicMarket[]): Set<string> {
  const set = new Set<string>();
  for (const m of markets) {
    if (m.id === "worldwide" || m.countries.length === 0) continue;
    for (const c of m.countries) set.add(c);
  }
  return set;
}

export function resolveMarket(
  markets: OrganicMarket[],
  marketId: string | null | undefined,
): { market: OrganicMarket; warning?: string } {
  const list =
    markets.length > 0
      ? markets
      : DEFAULT_ORGANIC_MARKETS.map((m) => ({ ...m, countries: [...m.countries] }));
  const worldwide = list.find((m) => m.id === "worldwide") ?? {
    id: "worldwide",
    label: "Worldwide",
    countries: [] as string[],
    kind: "rollup" as const,
  };
  const id = typeof marketId === "string" ? marketId.trim().toLowerCase() : "";
  if (!id || id === "worldwide") return { market: worldwide };
  const found = list.find((m) => m.id === id);
  if (!found) {
    return { market: worldwide, warning: `Unknown market "${marketId}"; using worldwide.` };
  }
  return { market: found };
}

export function rowMatchesMarket(
  country: string | undefined | null,
  market: OrganicMarket,
): boolean {
  if (market.id === "worldwide" || market.countries.length === 0) return true;
  const c = (country || "").trim().toLowerCase();
  if (!c) return false;
  return market.countries.includes(c);
}

/** One-country market keyword research can score in (location + language). */
export type ResearchMarket = {
  /** Market id from settings; null when the legacy OpenRush location/language fallback was used. */
  id: string | null;
  label: string;
  country: string | null;
  location: string;
  language: string;
  source: "explicit" | "locale_default" | "fallback";
};

export type ResearchMarketResolution =
  | { ok: true; market: ResearchMarket; warning?: string }
  | {
      ok: false;
      code: "market_not_researchable" | "unknown_market";
      message: string;
      /** Country market ids the caller can use instead. */
      country_markets: string[];
    };

export function isResearchableMarket(m: OrganicMarket): boolean {
  return (
    m.id !== "worldwide" &&
    m.countries.length === 1 &&
    researchLocationForCountry(m.countries[0]!) != null
  );
}

export function researchableMarketIds(markets: OrganicMarket[]): string[] {
  return markets.filter(isResearchableMarket).map((m) => m.id);
}

function toResearchMarket(m: OrganicMarket, source: ResearchMarket["source"]): ResearchMarket {
  const country = m.countries[0]!;
  return {
    id: m.id,
    label: m.label,
    country,
    location: researchLocationForCountry(country)!,
    language: m.language?.trim() || defaultMarketLanguage(m.countries),
    source,
  };
}

/** Page locale ("es", "es-ES") → two/three-letter language key used in research defaults. */
export function localeKey(locale: string | null | undefined): string {
  return (locale || "").trim().toLowerCase().split(/[-_]/)[0] || "";
}

/**
 * Which country + language keyword research runs in: explicit market → page-language default →
 * legacy location/language fallback. Rollups (LatAm, Worldwide) and unknown ids are refused.
 */
export function resolveResearchMarket(opts: {
  markets: OrganicMarket[];
  defaults: ResearchMarketDefaults;
  marketId?: string | null;
  locale?: string | null;
  fallback: { location: string; language: string };
}): ResearchMarketResolution {
  const list = opts.markets.length > 0 ? opts.markets : DEFAULT_ORGANIC_MARKETS;
  const countryMarkets = researchableMarketIds(list);
  const requested = typeof opts.marketId === "string" ? opts.marketId.trim().toLowerCase() : "";

  if (requested) {
    const found = list.find((m) => m.id === requested);
    if (!found) {
      return {
        ok: false,
        code: "unknown_market",
        message: `Unknown market "${opts.marketId}". Use one of: ${countryMarkets.join(", ")}.`,
        country_markets: countryMarkets,
      };
    }
    if (!isResearchableMarket(found)) {
      const why =
        found.countries.length === 1
          ? `country "${found.countries[0]}" has no keyword-research location`
          : "keyword tools score one country at a time";
      return {
        ok: false,
        code: "market_not_researchable",
        message: `Market "${found.label}" cannot be used for keyword research (${why}). Use a country market: ${countryMarkets.join(", ")}.`,
        country_markets: countryMarkets,
      };
    }
    return { ok: true, market: toResearchMarket(found, "explicit") };
  }

  const key = localeKey(opts.locale);
  const defaultId = key ? opts.defaults[key] : undefined;
  if (defaultId) {
    const found = list.find((m) => m.id === defaultId);
    if (found && isResearchableMarket(found)) {
      return { ok: true, market: toResearchMarket(found, "locale_default") };
    }
  }

  const market: ResearchMarket = {
    id: null,
    label: `${opts.fallback.location} / ${opts.fallback.language}`,
    country: null,
    location: opts.fallback.location,
    language: opts.fallback.language,
    source: "fallback",
  };
  const warning = defaultId
    ? `Default market "${defaultId}" for locale "${key}" is missing or not a country market; used ${market.label}.`
    : undefined;
  return { ok: true, market, ...(warning ? { warning } : {}) };
}

export function marketsForUi(markets: OrganicMarket[]): {
  rollups: OrganicMarket[];
  countries: OrganicMarket[];
} {
  const rollups = markets.filter((m) => m.kind === "rollup");
  const countries = markets.filter((m) => m.kind === "country");
  return { rollups, countries };
}
