import fs from "fs";
import path from "path";
import {
  entryLocales,
  getDefaultContentPath,
  getDirectory,
  loadContentTypes,
  safeLoad,
} from "./content.js";
import { fail, type McpTextResult, type NextAction } from "./respond.js";

/** `_common.yml` `locale`: the language an address without /en/ or /es/ is served in. */
export function entryPrimaryLocale(
  contentType: string,
  slug: string,
  contentPath?: string,
): string | null {
  const config = loadContentTypes(contentPath)[contentType];
  if (!config) return null;
  const basePath = contentPath || getDefaultContentPath();
  const commonPath = path.join(basePath, getDirectory(contentType, config), slug, "_common.yml");
  if (!fs.existsSync(commonPath)) return null;
  const value = safeLoad(fs.readFileSync(commonPath, "utf-8"))?.locale;
  return typeof value === "string" && value ? value : null;
}

export function missingLocaleDetails(
  contentType: string,
  slug: string,
  locale: string,
  contentPath?: string,
): { available_locales: string[]; primary_locale: string | null; suggested_locale: string | null } {
  const available = entryLocales(contentType, slug, contentPath).filter((l) => l !== locale);
  const primary = entryPrimaryLocale(contentType, slug, contentPath);
  const suggested = primary && available.includes(primary) ? primary : available[0] ?? null;
  return { available_locales: available, primary_locale: primary, suggested_locale: suggested };
}

/**
 * Failure for a live `{locale}.yml` that does not exist on an existing page.
 * Read tools retry themselves in the suggested language; write tools point to a read
 * first, because editing another language is a different change.
 */
export function missingLocaleFail(opts: {
  tool: string;
  mode: "read" | "write";
  contentType: string;
  slug: string;
  locale: string;
  contentPath?: string;
  argsHint?: Record<string, unknown>;
  note?: string;
}): McpTextResult {
  const { tool, mode, contentType, slug, locale, contentPath } = opts;
  const details = missingLocaleDetails(contentType, slug, locale, contentPath);
  const live = details.available_locales.length
    ? `Live languages: ${details.available_locales.join(", ")}.`
    : "No live language files.";
  const addLanguage = mode === "write" ? " To add this language, use translate_entry." : "";
  const next_actions: NextAction[] = [];
  if (details.suggested_locale) {
    next_actions.push(
      mode === "read"
        ? {
            tool,
            reason: `Page has no live ${locale}.yml; read it in ${details.suggested_locale}.`,
            args_hint: { ...opts.argsHint, slug, contentType, locale: details.suggested_locale },
            priority: "recommended",
          }
        : {
            tool: "get_entry_content",
            reason: `Page has no live ${locale}.yml. Confirm which language you meant to edit before retrying ${tool}.`,
            args_hint: { slug, contentType, locale: details.suggested_locale },
            priority: "recommended",
          },
    );
  }
  return fail(
    `Locale '${locale}' not found for page '${slug}' (contentType: ${contentType}). ${live}${addLanguage}${opts.note ?? ""}`,
    { code: "locale_not_available", contentType, slug, locale, ...details, next_actions },
  );
}
