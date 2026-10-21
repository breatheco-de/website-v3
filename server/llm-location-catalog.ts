import { getLocationBySlug, getRegionForLocation, getRegionLabel } from "../client/src/lib/locations";
import type { LlmLocationCatalog, LlmRegionSlug } from "../shared/llm-html-audience";

/** Same city and region names the page uses. Loaded from the server without the client alias. */
export const llmLocationCatalog: LlmLocationCatalog = {
  regionOf(slug) {
    return getRegionForLocation(slug) as LlmRegionSlug | null;
  },
  cityName(slug) {
    return getLocationBySlug(slug)?.name || slug;
  },
  regionLabel(slug, locale) {
    return getRegionLabel(slug, locale);
  },
};
