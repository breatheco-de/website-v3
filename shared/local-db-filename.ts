/**
 * Live-sanitize helpers for private-database local filenames.
 * Basename uses hyphen slug rules; known extensions are preserved (including while typing).
 */
import { slugifyInput } from "./slug";

const KNOWN_EXTENSIONS = [".json", ".csv", ".yml", ".yaml"] as const;
/** Extensions staff may type without the suffix being turned into `-json` etc. */
const TYPABLE_EXTENSIONS = [".json", ".yml", ".yaml", ".csv"] as const;
const EMPTY_CREATEABLE = new Set([".json", ".yml", ".yaml"]);

export type KnownLocalDbExtension = (typeof KNOWN_EXTENSIONS)[number];

type Split = {
  /** Basename before the extension (or whole name if none). */
  base: string;
  /** Complete known ext (`.json`), incomplete while typing (`.j`), trailing `.`, or `""`. */
  ext: string;
  /** True when `ext` is a complete known extension. */
  complete: boolean;
};

function splitFilename(raw: string): Split {
  // Trim start only so a trailing space can become `-` while typing.
  const input = String(raw ?? "").replace(/^\s+/, "");
  const lower = input.toLowerCase();

  for (const ext of KNOWN_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return {
        base: input.slice(0, input.length - ext.length),
        ext,
        complete: true,
      };
    }
  }

  const lastDot = input.lastIndexOf(".");
  if (lastDot >= 0) {
    const after = input.slice(lastDot + 1);
    const afterLower = after.toLowerCase();
    // Trailing "." or letters that are a prefix of a known extension (e.g. ".j", ".yam")
    if (after === "" || /^[a-zA-Z]+$/.test(after)) {
      const isPrefix = TYPABLE_EXTENSIONS.some((ext) => ext.slice(1).startsWith(afterLower));
      if (after === "" || isPrefix) {
        return {
          base: input.slice(0, lastDot),
          ext: after === "" ? "." : `.${afterLower}`,
          complete: false,
        };
      }
    }
  }

  return { base: input, ext: "", complete: false };
}

/**
 * Keystroke-safe filename: slugify the basename (space → `-`), keep a trailing `-`
 * while typing, preserve known extensions (and their prefixes while typing).
 */
export function sanitizeLocalFilenameInput(raw: string): string {
  const { base, ext, complete } = splitFilename(raw);
  let slug = slugifyInput(base);
  // Complete extension: drop a trailing `-` left by junk at the end of the basename.
  if (complete) slug = slug.replace(/-+$/g, "");
  if (ext === ".") return slug ? `${slug}.` : "";
  if (ext) return slug ? `${slug}${ext}` : "";
  return slug;
}

/** Append `.json` when the name has no complete known extension. */
export function ensureLocalFilenameExtension(name: string): string {
  const sanitized = sanitizeLocalFilenameInput(name);
  if (!sanitized) return "";
  const { ext, complete } = splitFilename(sanitized);
  if (complete) return sanitized;
  // Incomplete typing suffix (`.j`, `.yam`, trailing `.`) → strip it, then append .json
  const cleaned = sanitized.endsWith(ext) && ext
    ? sanitized.slice(0, sanitized.length - ext.length).replace(/-+$/g, "")
    : sanitized.replace(/\.+$/g, "");
  return cleaned ? `${cleaned}.json` : "";
}

/** Empty auto-create is only safe for JSON/YAML (not CSV). */
export function isEmptyCreateableFilename(name: string): boolean {
  const ensured = ensureLocalFilenameExtension(name);
  if (!ensured) return false;
  const { ext, complete } = splitFilename(ensured);
  return complete && EMPTY_CREATEABLE.has(ext);
}
