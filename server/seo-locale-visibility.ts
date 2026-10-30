import { deepMerge } from "./utils/deepMerge";
import { hasLiveLocaleFile } from "./draft-entry";

export type LocaleVisibilityRow = {
  locale: string;
  robots: string;
  priority: string;
  change_frequency: string;
  /** Robots from the page-wide `_common.yml` meta (what applies when the locale file has none). */
  inherited_robots: string;
};

export type LocaleVisibilityResponse = {
  supported: boolean;
  locales: LocaleVisibilityRow[];
  current_inherited_robots: string;
};

type LocaleVisibilityIndex = {
  loadCommonData: (contentType: never, slug: string) => unknown;
  loadLocaleData: (contentType: string, slug: string, locale: string) => { data?: unknown; error?: unknown };
};

function metaOf(data: unknown): Record<string, unknown> {
  const meta = (data as { meta?: unknown } | null | undefined)?.meta;
  return meta && typeof meta === "object" && !Array.isArray(meta) ? { ...(meta as Record<string, unknown>) } : {};
}

function metaString(meta: Record<string, unknown>, key: string): string {
  const v = meta[key];
  return v == null ? "" : String(v);
}

/** Live languages other than `locale`, with their effective visibility meta. */
export function buildLocaleVisibility(opts: {
  ci: LocaleVisibilityIndex;
  contentType: string;
  slug: string;
  locale: string;
  contentDir: string;
  locales: string[];
}): LocaleVisibilityResponse {
  const commonMeta = metaOf(opts.ci.loadCommonData(opts.contentType as never, opts.slug));
  const inherited = metaString(commonMeta, "robots");
  const rows: LocaleVisibilityRow[] = [];
  for (const code of opts.locales) {
    if (code === opts.locale || !hasLiveLocaleFile(opts.contentDir, code)) continue;
    const file = opts.ci.loadLocaleData(opts.contentType, opts.slug, code);
    if (!file.data || file.error) continue;
    const meta = deepMerge(commonMeta, metaOf(file.data)) as Record<string, unknown>;
    rows.push({
      locale: code,
      robots: metaString(meta, "robots"),
      priority: metaString(meta, "priority"),
      change_frequency: metaString(meta, "change_frequency"),
      inherited_robots: inherited,
    });
  }
  return { supported: true, locales: rows, current_inherited_robots: inherited };
}
