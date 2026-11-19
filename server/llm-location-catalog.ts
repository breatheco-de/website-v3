import { loadLocationsFromDatabase, loadSessionLocationCatalog } from "./session-location-catalog";
import { getDefaultContentRoot } from "./site-config";
import type { LlmLocationCatalog, LlmRegionSlug } from "../shared/llm-html-audience";

const REGION_LABELS: Record<string, { en: string; es: string }> = {
  "usa-canada": { en: "US & Canada", es: "EE.UU. y Canadá" },
  europe: { en: "Europe", es: "Europa" },
  latam: { en: "Latin America", es: "Latinoamérica" },
};

function resolveCatalog(contentRoot?: string) {
  const root = contentRoot ?? getDefaultContentRoot();
  const fromSession = loadSessionLocationCatalog(root);
  if (fromSession.length > 0) return fromSession;
  // Fallback: prefer the locations bank even when Session source is None (LLM labels).
  return loadLocationsFromDatabase("locations", root);
}

/** Same city and region names the page uses — backed by the locations database. */
export const llmLocationCatalog: LlmLocationCatalog = {
  regionOf(slug) {
    const loc = resolveCatalog().find((l) => l.slug === slug);
    return (loc?.region as LlmRegionSlug) || null;
  },
  cityName(slug) {
    return resolveCatalog().find((l) => l.slug === slug)?.name || slug;
  },
  regionLabel(slug, locale) {
    const entry = REGION_LABELS[slug];
    if (!entry) return slug;
    return locale === "es" ? entry.es : entry.en;
  },
};
