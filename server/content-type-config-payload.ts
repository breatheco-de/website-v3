/**
 * Body of GET /api/content-types/:type/config. Shared with SSR initial data so the
 * lead form renders its location setting on the server (no layout jump on load).
 */

import { getContentTypeConfig, getLabel } from "./content-types";
import { effectiveAllowSellableEntries } from "./product/products-type-config";

export function contentTypeConfigQueryKey(type: string): string {
  return `/api/content-types/${type}/config`;
}

export function buildContentTypeConfigPayload(
  type: string,
  contentRoot: string | undefined,
  staticEntryCount: number,
): Record<string, unknown> | null {
  const config = getContentTypeConfig(type, contentRoot);
  if (!config) return null;
  const eff = effectiveAllowSellableEntries(type, contentRoot);
  return {
    name: type,
    label: getLabel(type, contentRoot),
    directory: config.directory,
    field_mapping: config.field_mapping || null,
    editor: config.editor || null,
    indexes: config.indexes || null,
    unique_fields: config.unique_fields || null,
    database: config.database || null,
    url_pattern: config.url_pattern,
    single_template: !!config.single_template,
    protected_slugs: config.protected_slugs || [],
    preview: config.preview || null,
    schema_org_requirements: config.schema_org_requirements || [],
    seo_monitoring: config.seo_monitoring || null,
    funnel: config.funnel || null,
    products: {
      allow_sellable_entries: eff.allow_sellable_entries,
      ...(eff.coerced_from_inventory ? { coerced_from_inventory: true } : {}),
    },
    strategy: config.strategy || null,
    ads: config.ads?.optimize ? { optimize: true } : null,
    forms: config.forms?.location ? { location: config.forms.location } : null,
    static_entry_count: staticEntryCount,
  };
}
