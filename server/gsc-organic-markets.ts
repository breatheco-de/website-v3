/**
 * Configurable organic traffic markets (GSC country codes on day-cache rows).
 */

export type OrganicMarketKind = "rollup" | "country";

export type OrganicMarket = {
  id: string;
  label: string;
  /** Empty = worldwide (all rows). GSC 3-letter codes, lowercase. */
  countries: string[];
  kind: OrganicMarketKind;
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

export const DEFAULT_ORGANIC_MARKETS: OrganicMarket[] = [
  { id: "worldwide", label: "Worldwide", countries: [], kind: "rollup" },
  {
    id: "latam",
    label: "LatAm",
    countries: ["mex", "chl", "col", "ven", "ury", "arg"],
    kind: "rollup",
  },
  { id: "spain", label: "Spain", countries: ["esp"], kind: "country" },
  { id: "usa", label: "USA", countries: ["usa"], kind: "country" },
  { id: "mexico", label: "Mexico", countries: ["mex"], kind: "country" },
  { id: "chile", label: "Chile", countries: ["chl"], kind: "country" },
  { id: "colombia", label: "Colombia", countries: ["col"], kind: "country" },
  { id: "venezuela", label: "Venezuela", countries: ["ven"], kind: "country" },
  { id: "uruguay", label: "Uruguay", countries: ["ury"], kind: "country" },
  { id: "argentina", label: "Argentina", countries: ["arg"], kind: "country" },
];

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

    out.push({
      id,
      label,
      countries: id === "worldwide" ? [] : countries,
      kind: id === "worldwide" ? "rollup" : kind,
    });
  }

  if (!out.some((m) => m.id === "worldwide")) {
    out.unshift({ id: "worldwide", label: "Worldwide", countries: [], kind: "rollup" });
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

export function marketsForUi(markets: OrganicMarket[]): {
  rollups: OrganicMarket[];
  countries: OrganicMarket[];
} {
  const rollups = markets.filter((m) => m.kind === "rollup");
  const countries = markets.filter((m) => m.kind === "country");
  return { rollups, countries };
}
