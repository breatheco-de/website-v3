/**
 * Page slugs and page IDs: one normalization rule for generating, validating and comparing.
 *
 * Rule: lowercase, strip accents (NFD), every run of non `[a-z0-9]` becomes the separator
 * (default `-`), trim separator from both ends. Use `separator: "_"` for snake_case
 * identifiers (database names, field keys). Other kinds (heading anchors, role IDs,
 * consent keys, webhook IDs) may still keep specialized helpers when they need extra rules.
 */

export type SlugifyOptions = {
  maxLength?: number;
  /** Word join character. Default `-` (page slugs). Use `_` for snake_case identifiers. */
  separator?: "-" | "_";
};

function normalize(text: string, separator: "-" | "_"): string {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, separator);
}

function trimEnds(value: string, separator: "-" | "_"): string {
  return separator === "_"
    ? value.replace(/^_+|_+$/g, "")
    : value.replace(/^-+|-+$/g, "");
}

function trimStart(value: string, separator: "-" | "_"): string {
  return separator === "_" ? value.replace(/^_+/g, "") : value.replace(/^-+/g, "");
}

/** Generate a page slug (or snake_case id) from any text (titles, labels, raw input). */
export function slugify(text: string, opts?: SlugifyOptions): string {
  const separator = opts?.separator ?? "-";
  const out = trimEnds(normalize(text, separator), separator);
  // Plain slice (no re-trim): database-derived slugs were generated this way and are stored identities.
  return opts?.maxLength && opts.maxLength > 0 ? out.slice(0, opts.maxLength) : out;
}

/**
 * Keystroke-safe variant for slug inputs: same rule, but keeps one trailing separator
 * so staff can type `foo-bar` / `foo_bar`. Validate the final value with `isSlug`
 * (hyphen form) or a caller-specific check for snake_case.
 */
export function slugifyInput(text: string, opts?: Pick<SlugifyOptions, "separator">): string {
  const separator = opts?.separator ?? "-";
  return trimStart(normalize(text, separator), separator);
}

/** Comparison key for page slugs and page IDs. Two refs name the same page iff their keys match. */
export function slugKey(value: string): string {
  return slugify(value);
}

/** True when the value is already a canonical slug (lowercase letters, digits, single hyphens). */
export function isSlug(value: string): boolean {
  return typeof value === "string" && value.length > 0 && slugify(value) === value;
}

export const SLUG_FORMAT_HINT = "Use lowercase letters, numbers, and hyphens only.";
