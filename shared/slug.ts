/**
 * Page slugs and page IDs: one normalization rule for generating, validating and comparing.
 *
 * Rule: lowercase, strip accents (NFD), every run of non `[a-z0-9]` becomes `-`,
 * trim `-` from both ends. Other identifier kinds (heading anchors, role IDs,
 * consent keys, database names, webhook IDs) keep their own helpers.
 */

export type SlugifyOptions = { maxLength?: number };

function normalize(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-");
}

/** Generate a page slug from any text (titles, labels, raw input). */
export function slugify(text: string, opts?: SlugifyOptions): string {
  const out = normalize(text).replace(/^-+|-+$/g, "");
  // Plain slice (no re-trim): database-derived slugs were generated this way and are stored identities.
  return opts?.maxLength && opts.maxLength > 0 ? out.slice(0, opts.maxLength) : out;
}

/**
 * Keystroke-safe variant for slug inputs: same rule, but keeps one trailing `-`
 * so staff can type `foo-bar`. Validate the final value with `isSlug`.
 */
export function slugifyInput(text: string): string {
  return normalize(text).replace(/^-+/g, "");
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
