/**
 * Cheap EN/ES function-word heuristic for public URL slugs.
 * Warns when clear opposite-locale function words appear; tech/brand/cognates are neutral.
 */

export const SLUG_LOCALE_MISMATCH_CODE = "slug_locale_mismatch" as const;

/** English function / glue words that rarely belong in a Spanish URL slug. */
export const EN_SLUG_FUNCTION_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "how",
  "in",
  "into",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "vs",
  "what",
  "when",
  "where",
  "why",
  "with",
  "without",
  "your",
]);

/** Spanish function / glue words that rarely belong in an English URL slug. */
export const ES_SLUG_FUNCTION_WORDS = new Set([
  "al",
  "como",
  "con",
  "contra",
  "de",
  "del",
  "el",
  "en",
  "entre",
  "la",
  "las",
  "lo",
  "los",
  "para",
  "por",
  "que",
  "se",
  "sin",
  "sobre",
  "un",
  "una",
  "unas",
  "unos",
  "y",
]);

export type SlugLocaleMatchOk = { ok: true };

export type SlugLocaleMatchMismatch = {
  ok: false;
  code: typeof SLUG_LOCALE_MISMATCH_CODE;
  markers: string[];
  expectedLocale: "en" | "es";
  inferredOpposite: "en" | "es";
};

export type SlugLocaleMatchResult = SlugLocaleMatchOk | SlugLocaleMatchMismatch;

function tokenizeSlug(slug: string): string[] {
  return slug
    .trim()
    .toLowerCase()
    .split(/-+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Assess whether a public URL slug looks like the wrong language for the entry locale.
 * Unknown locales → ok. Neutral tokens (no list hit) never trigger a mismatch alone.
 */
export function assessSlugLocaleMatch(
  slug: string,
  locale: string,
): SlugLocaleMatchResult {
  const loc = locale.trim().toLowerCase();
  if (loc !== "en" && loc !== "es") return { ok: true };

  const tokens = tokenizeSlug(slug);
  if (tokens.length === 0) return { ok: true };

  const enHits = tokens.filter((t) => EN_SLUG_FUNCTION_WORDS.has(t));
  const esHits = tokens.filter((t) => ES_SLUG_FUNCTION_WORDS.has(t));

  if (loc === "es" && enHits.length > 0) {
    return {
      ok: false,
      code: SLUG_LOCALE_MISMATCH_CODE,
      markers: [...new Set(enHits)],
      expectedLocale: "es",
      inferredOpposite: "en",
    };
  }

  if (loc === "en" && esHits.length > 0) {
    return {
      ok: false,
      code: SLUG_LOCALE_MISMATCH_CODE,
      markers: [...new Set(esHits)],
      expectedLocale: "en",
      inferredOpposite: "es",
    };
  }

  return { ok: true };
}

/** Staff-facing one-liner (no jargon). */
export function slugLocaleMismatchHint(
  result: SlugLocaleMatchMismatch,
): string {
  const looksLike = result.inferredOpposite === "en" ? "English" : "Spanish";
  const forLang = result.expectedLocale === "en" ? "English" : "Spanish";
  return `This slug looks like ${looksLike} for a ${forLang} entry.`;
}

/** Dense agent/MCP warning message (facts + non-effect). */
export function slugLocaleMismatchWarningMessage(
  slug: string,
  result: SlugLocaleMatchMismatch,
): string {
  const looksLike = result.inferredOpposite === "en" ? "English" : "Spanish";
  return (
    `Slug "${slug}" looks ${looksLike} for locale ${result.expectedLocale} ` +
    `(markers: ${result.markers.join(", ")}). Public URL left unchanged; ` +
    `set a locale-fitting slug via translate_entry.url_slug or update_fields slug if intended.`
  );
}

export function slugLocaleAckKey(locale: string, slug: string): string {
  return `${locale.trim().toLowerCase()}:${slug.trim().toLowerCase()}`;
}
