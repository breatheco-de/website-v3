/**
 * Map a content-index variable usage path to a staff URL (or null if unknown).
 * Paths use the on-disk folder (`pages`, `blog`); pass `resolveContentType` so
 * `pages` → `page` for `/private/preview` and `/private/type`.
 *
 * Examples:
 *   site_4geeks-com/blog/my-post/en.yml → /private/preview/blog/my-post?locale=en
 *   site_4geeks-com/pages/home/en.yml → /private/preview/page/home?locale=en
 *   site_4geeks-com/blog/template.en.yml → /private/type/blog
 */

export type ContentEntryFileRef = {
  contentType: string;
  slug: string;
  locale: string;
  /** `draft` for `draft.{locale}.yml`; A/B variant name for `{variant}.{locale}.yml`. */
  variant?: string;
};

function splitSitePath(filePath: string): string[] | null {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const parts = normalized.split("/").filter(Boolean);
  // Expect: site_*/{typeFolder}/{...}
  if (parts.length < 3) return null;
  if (!parts[0].startsWith("site_")) return null;
  return parts;
}

function parseEntryParts(
  parts: string[],
  resolveContentType: (directory: string) => string,
): ContentEntryFileRef | null {
  const rest = parts.slice(2);
  if (rest.length < 2) return null;

  const slug = rest[0];
  const file = rest[rest.length - 1];
  if (!/\.yml$/i.test(file)) return null;

  const simpleLocale = file.match(/^(draft\.)?([a-z]{2}(?:-[a-z]+)?)\.yml$/i);
  const variantLocale = file.match(
    /^(?:draft\.)?([a-z0-9_-]+)\.([a-z]{2}(?:-[a-z]+)?)\.yml$/i,
  );

  const contentType = resolveContentType(parts[1]);
  if (simpleLocale) {
    return {
      contentType,
      slug,
      locale: simpleLocale[2],
      ...(simpleLocale[1] ? { variant: "draft" } : {}),
    };
  }
  if (
    variantLocale &&
    variantLocale[1] !== "template" &&
    variantLocale[1] !== "single"
  ) {
    return { contentType, slug, locale: variantLocale[2], variant: variantLocale[1] };
  }
  return null;
}

/**
 * Parse an entry locale file (`site_x/{typeFolder}/{slug}/{locale}.yml`, `draft.{locale}.yml`,
 * `{variant}.{locale}.yml`). Returns null for templates, `_common.yml`, nested paths and unknown shapes.
 */
export function parseContentEntryFile(
  filePath: string,
  resolveContentType: (directory: string) => string = (d) => d,
): ContentEntryFileRef | null {
  const parts = splitSitePath(filePath);
  if (!parts || parts.length !== 4) return null;
  return parseEntryParts(parts, resolveContentType);
}

/** Private preview URL for an entry; variants (including `draft`) are forced via `force_variant`. */
export function entryPreviewHref(entry: {
  contentType: string;
  slug: string;
  locale: string;
  variant?: string | null;
}): string {
  const params = new URLSearchParams({ locale: entry.locale });
  if (entry.variant) params.set("force_variant", entry.variant);
  return `/private/preview/${encodeURIComponent(entry.contentType)}/${encodeURIComponent(entry.slug)}?${params.toString()}`;
}

export function variableUsagePathToStaffHref(
  filePath: string,
  resolveContentType: (directory: string) => string = (d) => d,
): string | null {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized === "schema-org.yml" || /(?:^|\/)schema-org\.yml$/i.test(normalized)) {
    return "/private/settings/seo/schema";
  }

  const parts = splitSitePath(filePath);
  if (!parts) return null;

  const contentType = resolveContentType(parts[1]);
  const rest = parts.slice(2);

  // Shared template: template.{locale}.yml or legacy single.{locale}.yml at type root
  if (rest.length === 1) {
    const file = rest[0];
    const templateMatch = file.match(/^(?:template|single)\.([a-z]{2}(?:-[a-z]+)?)\.yml$/i);
    if (templateMatch) {
      return `/private/type/${encodeURIComponent(contentType)}`;
    }
    if (
      /\.yml$/i.test(file) &&
      (file.startsWith("template") || file.startsWith("single") || file.startsWith("_common"))
    ) {
      return `/private/type/${encodeURIComponent(contentType)}`;
    }
    return null;
  }

  const entry = parseEntryParts(parts, resolveContentType);
  if (entry) {
    const params = new URLSearchParams({ locale: entry.locale });
    if (entry.variant && entry.variant !== "draft") {
      params.set("variant", entry.variant);
    }
    return `/private/preview/${encodeURIComponent(contentType)}/${encodeURIComponent(entry.slug)}?${params.toString()}`;
  }

  if (rest[rest.length - 1] === "_common.yml") {
    return `/private/preview/${encodeURIComponent(contentType)}/${encodeURIComponent(rest[0])}`;
  }

  return null;
}
