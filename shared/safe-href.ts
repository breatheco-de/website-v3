/**
 * Guards against CSS values and reserved tokens being used as navigation hrefs/slugs.
 */

const CSS_HREF_PREFIXES = [
  "linear-gradient(",
  "radial-gradient(",
  "repeating-linear-gradient(",
  "repeating-radial-gradient(",
  "conic-gradient(",
  "hsl(",
  "hsla(",
  "rgb(",
  "rgba(",
  "url(",
] as const;

const RESERVED_SLUGS = new Set(["null", "undefined", "inline", "none", "inherit"]);

export function isCssLikeHref(href: string): boolean {
  const s = href.trim().toLowerCase();
  if (!s) return false;
  return CSS_HREF_PREFIXES.some((prefix) => s.startsWith(prefix));
}

export function isReservedContentSlug(slug: string): boolean {
  const s = slug.trim().toLowerCase();
  return !s || RESERVED_SLUGS.has(s);
}

/** True when the value must not be used as an in-app navigation target. */
export function isNonNavigableHref(href: string): boolean {
  const s = href.trim();
  if (!s) return true;
  if (isCssLikeHref(s)) return true;
  if (s === "null" || s === "undefined" || s === "inline") return true;
  return false;
}

export function coerceProgramSlug(
  slug: unknown,
  contentSlug?: string,
): string | null {
  const candidates = [slug, contentSlug];
  for (const raw of candidates) {
    if (typeof raw !== "string") continue;
    const s = raw.trim();
    if (!s || isReservedContentSlug(s)) continue;
    return s;
  }
  return null;
}

export function buildCareerProgramPath(
  locale: string,
  slug: unknown,
  contentSlug?: string,
): string | null {
  const resolved = coerceProgramSlug(slug, contentSlug);
  if (!resolved) return null;
  const loc = locale === "es" ? "es" : "en";
  return loc === "es"
    ? `/es/programas-de-carrera/${resolved}`
    : `/en/career-programs/${resolved}`;
}

/** Paths recorded from mistaken relative CSS / layout-variant hrefs. */
export function isJunkRuntimeNotFoundPath(path: string): boolean {
  const p = path.toLowerCase();
  if (p.includes("linear-gradient(") || p.includes("radial-gradient(")) return true;
  if (/\/(null|inline|undefined)$/.test(p)) return true;
  if (p === "/en/null" || p === "/es/null" || p === "/en/inline" || p === "/es/inline") {
    return true;
  }
  return false;
}
