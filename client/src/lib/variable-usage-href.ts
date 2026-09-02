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

export function variableUsagePathToStaffHref(
  filePath: string,
  resolveContentType: (directory: string) => string = (d) => d,
): string | null {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const parts = normalized.split("/").filter(Boolean);
  // Expect: site_*/{typeFolder}/{...}
  if (parts.length < 3) return null;
  if (!parts[0].startsWith("site_")) return null;

  const typeFolder = parts[1];
  const contentType = resolveContentType(typeFolder);
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

  // Entry locale: {slug}/{locale}.yml or {slug}/draft.{locale}.yml etc.
  if (rest.length >= 2) {
    const slug = rest[0];
    const file = rest[rest.length - 1];
    if (!/\.yml$/i.test(file)) return null;

    const simpleLocale = file.match(/^(?:draft\.)?([a-z]{2}(?:-[a-z]+)?)\.yml$/i);
    const variantLocale = file.match(
      /^(?:draft\.)?([a-z0-9_-]+)\.([a-z]{2}(?:-[a-z]+)?)\.yml$/i,
    );

    let locale: string | null = null;
    let variant: string | null = null;

    if (simpleLocale) {
      locale = simpleLocale[1];
    } else if (
      variantLocale &&
      variantLocale[1] !== "template" &&
      variantLocale[1] !== "single"
    ) {
      variant = variantLocale[1];
      locale = variantLocale[2];
    } else if (file === "_common.yml") {
      return `/private/preview/${encodeURIComponent(contentType)}/${encodeURIComponent(slug)}`;
    }

    if (!locale) return null;

    const params = new URLSearchParams({ locale });
    if (variant && variant !== "draft") {
      params.set("variant", variant);
    }
    return `/private/preview/${encodeURIComponent(contentType)}/${encodeURIComponent(slug)}?${params.toString()}`;
  }

  return null;
}
