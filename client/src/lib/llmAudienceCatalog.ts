import { getLocationBySlug, getRegionForLocation, getRegionLabel } from "@/lib/locations";
import {
  describeSectionAudience,
  type LlmLocationCatalog,
  type LlmRegionSlug,
  type SectionLlmAudience,
} from "@shared/llm-html-audience";

const catalog: LlmLocationCatalog = {
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

export function describePageSection(section: unknown, locale: string): SectionLlmAudience {
  return describeSectionAudience(section, locale, catalog);
}

export { catalog as llmLocationCatalog };
