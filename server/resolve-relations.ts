/**
 * Hydrate editor.type: relation fields on page/SSR entry bags.
 * Listing projections stay as pointer strings/arrays.
 */
import { getContentTypeConfig, resolveContentTypeUrl, type ContentTypeEditorHint } from "./content-types";
import { queryEntries } from "./query-entries";
import { resolveSourceName } from "./query-options";
import { databaseManager, type DatabaseManager } from "./database";
import type { ContentIndex } from "./content-index";
import { getSupportedLocales, getDefaultLocale } from "./settings";
import { normalizeRelationPointers } from "@shared/relation-field";
import { getBaseUrl } from "./hreflang";
import { child } from "./logger";

const log = child({ module: "resolve-relations" });

export type ResolveRelationsOptions = {
  contentRoot?: string;
  locale?: string;
  db?: DatabaseManager;
  contentIndex?: ContentIndex;
  /** When set, used to build Person url / @id for authors-like types. */
  baseUrl?: string;
};

function localeFallbackOrder(preferred?: string, contentRoot?: string): string[] {
  const supported = getSupportedLocales(contentRoot);
  const def = getDefaultLocale(contentRoot);
  const ordered: string[] = [];
  const push = (l?: string) => {
    if (l && supported.includes(l) && !ordered.includes(l)) ordered.push(l);
  };
  push(preferred);
  push(def);
  for (const l of supported) push(l);
  return ordered;
}

async function loadRelatedItem(
  source: string,
  pointer: string,
  valuePath: string,
  locales: string[],
  opts: ResolveRelationsOptions,
): Promise<Record<string, unknown> | null> {
  const db = opts.db ?? databaseManager;
  const resolved = resolveSourceName(source, opts.contentRoot, db);
  if (resolved.kind !== "contentType" && resolved.kind !== "database") {
    return null;
  }

  for (const locale of locales) {
    const { items } = await queryEntries(
      {
        from:
          resolved.kind === "contentType"
            ? { contentType: resolved.name }
            : { database: resolved.name },
        locale,
        filters: [{ field: valuePath, value: pointer }],
        limit: 5,
      },
      {
        db,
        contentIndex: opts.contentIndex,
        contentRoot: opts.contentRoot,
      },
    );
    const match = items.find((it) => {
      const v = it[valuePath] ?? it.slug ?? it.bc_slug ?? it.id;
      return String(v) === String(pointer);
    });
    if (match) return match as Record<string, unknown>;
  }
  return null;
}

function attachAuthorUrls(
  item: Record<string, unknown>,
  source: string,
  opts: ResolveRelationsOptions,
  locale?: string,
): Record<string, unknown> {
  if (source !== "authors") return item;
  const base = opts.baseUrl ?? getBaseUrl();
  try {
    const path = resolveContentTypeUrl(
      "authors",
      item,
      locale || "en",
      opts.contentRoot,
    );
    if (path) {
      const url = `${base.replace(/\/$/, "")}${path}`;
      return { ...item, url, "@id": url };
    }
  } catch {
    /* ignore */
  }
  return item;
}

function isResolvedItem(v: unknown): boolean {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    typeof (v as Record<string, unknown>).slug === "string"
  );
}

/** Field already hydrated by an earlier pass (object, or non-empty array of objects with `slug`). */
function isAlreadyResolved(raw: unknown): boolean {
  if (Array.isArray(raw)) return raw.length > 0 && raw.every(isResolvedItem);
  return isResolvedItem(raw);
}

/**
 * Mutates a copy of `entry`: each relation field becomes hydrated object / object[]
 * (or left as pointer string(s) on broken refs).
 */
export async function resolveRelationsOnEntry(
  contentType: string,
  entry: Record<string, unknown>,
  opts: ResolveRelationsOptions = {},
): Promise<Record<string, unknown>> {
  const config = getContentTypeConfig(contentType, opts.contentRoot);
  const editor = config?.editor;
  if (!editor) return { ...entry };

  const out: Record<string, unknown> = { ...entry };
  const locales = localeFallbackOrder(opts.locale, opts.contentRoot);
  const errors: string[] = [];

  for (const [field, hint] of Object.entries(editor as Record<string, ContentTypeEditorHint>)) {
    if (hint?.type !== "relation" || !hint.source) continue;
    const raw = entry[field];
    if (isAlreadyResolved(raw)) continue;
    const normalized = normalizeRelationPointers(raw);
    if (!normalized.ok) {
      errors.push(`${field}: ${normalized.error}`);
      continue;
    }
    if (normalized.value === null) {
      out[field] = hint.multiple ? [] : null;
      continue;
    }
    const pointers = Array.isArray(normalized.value)
      ? normalized.value
      : [normalized.value];
    const valuePath = hint.value || "slug";
    const hydrated: Record<string, unknown>[] = [];
    for (const pointer of pointers) {
      const item = await loadRelatedItem(hint.source, pointer, valuePath, locales, opts);
      if (!item) {
        errors.push(`${field}: broken relation "${pointer}" → ${hint.source}`);
        // Keep raw pointer so filters/UI still see something
        hydrated.push({ slug: pointer, name: pointer, _relation_broken: true });
        continue;
      }
      hydrated.push(attachAuthorUrls(item, hint.source, opts, opts.locale));
    }
    out[field] = hint.multiple ? hydrated : hydrated[0] ?? null;
  }

  if (errors.length) {
    out._relation_errors = errors;
    log.warn({ contentType, errors }, "[resolve-relations] broken or invalid relations");
  }
  return out;
}
