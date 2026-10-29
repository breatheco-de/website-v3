/**
 * One lookup for "which page does this ref name?".
 *
 * Page ID = the entry folder name, verbatim (stable across renames and translations).
 * Slug = a public, per-language address (`{locale}.yml` slug, else `_common.yml` slug, else the ID).
 * Any ref — ID or declared slug, in any spelling that normalizes to the same `slugKey` — resolves here.
 * Callers open files with the returned `entryId`; never join caller input into a content path.
 */
import fs from "fs";
import path from "path";
import { slugKey } from "@shared/slug";
import type { ContentIndex, SlugAlias } from "./content-index";
import { getLookupKey } from "./content-types";
import { applyEntryFilters, findEntryPresence, loadItemsForType } from "./entry-layer";

export type EntryRefMatch = "id" | "id_fallback" | "locale_slug" | "common_slug" | "database";

export type EntryRefWarning = {
  code: "slug_resolved" | "slug_locale_mismatch";
  message: string;
  details: Record<string, unknown>;
};

export type EntryRefResolved = {
  ok: true;
  /** Page ID (YAML folder name) or, for database types, the row slug in the served language. */
  entryId: string;
  /** Served language: the slug's own language unless the caller passed an explicit locale. */
  locale: string | null;
  /** Language the matched slug belongs to (null for the ID or the `_common.yml` slug). */
  slugLocale: string | null;
  matchedBy: EntryRefMatch;
  /** The ref equals a declared value exactly (not just the same `slugKey`). */
  exact: boolean;
  warnings: EntryRefWarning[];
};

export type EntryRefFailure =
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "ambiguous"; candidates: string[] }
  | { ok: false; reason: "index_updating" };

export type EntryRefResult = EntryRefResolved | EntryRefFailure;

export type EntryRefInput = {
  contentType: string;
  ref: string;
  locale?: string | null;
  /** True when the caller chose the locale (not a tool default). An explicit locale wins over the slug's language. */
  localeExplicit?: boolean;
  /** Skip the disk scan for folders not in the index (public 404 path: no readdir per request). */
  indexOnly?: boolean;
};

type ResolverIndex = Pick<
  ContentIndex,
  | "contentRoot"
  | "getDatabase"
  | "normalizeType"
  | "getFolderName"
  | "findBySlug"
  | "resolveBaseSlug"
  | "findSlugAliases"
  | "isDatabaseBacked"
  | "isRefreshPending"
>;

const ALIAS_RANK: Record<SlugAlias["kind"], number> = { id: 0, locale_slug: 1, common_slug: 2 };

export function resolveEntryRef(ci: ResolverIndex, input: EntryRefInput): EntryRefResult {
  const ref = String(input.ref ?? "").trim();
  if (!ref) return { ok: false, reason: "not_found" };
  const contentType = ci.normalizeType(input.contentType);
  const requested = input.locale?.trim() || null;
  const explicit = Boolean(input.localeExplicit && requested);

  if (ci.isDatabaseBacked(contentType)) {
    const db = resolveDatabaseRef(ci, contentType, ref, requested, explicit);
    if (db) return db;
  }

  // 1. Exact page ID (index, then disk for drafts / folders created since the last build).
  const diskNames = () => (input.indexOnly ? [] : folderNames(ci, contentType));
  if (ci.findBySlug(ref, { contentType }).length > 0 || diskNames().includes(ref)) {
    return finish({ ref, entryId: ref, matchedBy: "id", slugLocale: null, requested, explicit, exact: true });
  }

  // 2. Exact declared slug, then 3. any spelling with the same key.
  const aliases = ci.findSlugAliases(contentType, ref);
  const exactId = ci.resolveBaseSlug(ref, contentType);
  const exact = aliases.filter((a) => a.value === ref && (exactId === ref || a.entryId === exactId));
  const picked = pickAlias(exact.length > 0 ? exact : aliases);
  if (picked && "ambiguous" in picked) return { ok: false, reason: "ambiguous", candidates: picked.ambiguous };
  if (picked) {
    const a = picked.alias;
    const matchedBy: EntryRefMatch =
      a.kind === "id" ? (a.value === ref ? "id" : "id_fallback") : a.kind;
    return finish({
      ref,
      entryId: a.entryId,
      matchedBy,
      slugLocale: a.locale ?? null,
      requested,
      explicit,
      exact: a.value === ref,
    });
  }

  // 4. Folders not in the index (draft-only, just created) by key.
  const key = slugKey(ref);
  const onDisk = diskNames().filter((name) => slugKey(name) === key);
  if (onDisk.length === 1) {
    return finish({
      ref,
      entryId: onDisk[0]!,
      matchedBy: "id_fallback",
      slugLocale: null,
      requested,
      explicit,
      exact: false,
    });
  }
  if (onDisk.length > 1) return { ok: false, reason: "ambiguous", candidates: onDisk.sort() };

  return ci.isRefreshPending() ? { ok: false, reason: "index_updating" } : { ok: false, reason: "not_found" };
}

/** JSON shape shared by the loopback endpoint and MCP. */
export type EntryRefWire =
  | {
      ok: true;
      contentType: string;
      entry_id: string;
      locale: string | null;
      slug_locale: string | null;
      matched_by: EntryRefMatch;
      warnings: EntryRefWarning[];
    }
  | { ok: false; reason: EntryRefFailure["reason"]; candidates?: string[]; message: string };

/**
 * Resolve within one type, or across every type when `contentType` is null.
 * Across types: exact page-ID hits win; otherwise exactly one type must match.
 */
export function resolveEntryRefAcrossTypes(
  ci: ResolverIndex & Pick<ContentIndex, "getContentTypes">,
  input: Omit<EntryRefInput, "contentType"> & { contentType: string | null },
): EntryRefWire {
  const types = input.contentType ? [input.contentType] : ci.getContentTypes();
  const hits: Array<{ contentType: string; r: EntryRefResolved }> = [];
  let ambiguous: string[] | null = null;
  let updating = false;
  for (const contentType of types) {
    const r = resolveEntryRef(ci, { ...input, contentType });
    if (r.ok) hits.push({ contentType: ci.normalizeType(contentType), r });
    else if (r.reason === "ambiguous") ambiguous = [...(ambiguous ?? []), ...r.candidates.map((c) => `${contentType}/${c}`)];
    else if (r.reason === "index_updating") updating = true;
  }
  const exact = hits.filter((h) => h.r.matchedBy === "id");
  const pool = exact.length > 0 ? exact : hits;
  const label = input.contentType ?? "any type";
  if (pool.length === 1) {
    const { contentType, r } = pool[0]!;
    return {
      ok: true,
      contentType,
      entry_id: r.entryId,
      locale: r.locale,
      slug_locale: r.slugLocale,
      matched_by: r.matchedBy,
      warnings: r.warnings,
    };
  }
  if (pool.length > 1 || ambiguous) {
    const candidates = [...pool.map((h) => `${h.contentType}/${h.r.entryId}`), ...(ambiguous ?? [])].sort();
    const failure: EntryRefFailure = { ok: false, reason: "ambiguous", candidates };
    return { ok: false, reason: "ambiguous", candidates, message: entryRefFailureMessage(label, input.ref, failure) };
  }
  const failure: EntryRefFailure = updating ? { ok: false, reason: "index_updating" } : { ok: false, reason: "not_found" };
  return { ok: false, reason: failure.reason, message: entryRefFailureMessage(label, input.ref, failure) };
}

/** Human message for a failed lookup (agents and API errors). */
export function entryRefFailureMessage(contentType: string, ref: string, failure: EntryRefFailure): string {
  if (failure.reason === "ambiguous") {
    return `"${ref}" matches more than one ${contentType} page (${failure.candidates.join(", ")}). Pass the exact page ID.`;
  }
  if (failure.reason === "index_updating") {
    return `No ${contentType} page matches "${ref}" yet. The site index is updating (the page may have just been created or renamed); retry shortly.`;
  }
  return `No ${contentType} page matches "${ref}".`;
}

function pickAlias(
  aliases: SlugAlias[],
): { alias: SlugAlias } | { ambiguous: string[] } | null {
  if (aliases.length === 0) return null;
  const ids = [...new Set(aliases.map((a) => a.entryId))];
  let pool = aliases;
  if (ids.length > 1) {
    // A page ID wins over another page's slug with the same key.
    const idAliases = aliases.filter((a) => a.kind === "id");
    const idOwners = [...new Set(idAliases.map((a) => a.entryId))];
    if (idOwners.length !== 1) return { ambiguous: ids.sort() };
    pool = idAliases;
  }
  const best = [...pool].sort((a, b) => ALIAS_RANK[a.kind] - ALIAS_RANK[b.kind])[0]!;
  return { alias: best };
}

function finish(opts: {
  ref: string;
  entryId: string;
  matchedBy: EntryRefMatch;
  slugLocale: string | null;
  requested: string | null;
  explicit: boolean;
  exact: boolean;
}): EntryRefResolved {
  const { ref, entryId, matchedBy, slugLocale, requested, explicit, exact } = opts;
  const warnings: EntryRefWarning[] = [];
  let locale = requested;
  if (slugLocale) {
    if (explicit && requested && requested !== slugLocale) {
      warnings.push({
        code: "slug_locale_mismatch",
        message: `"${ref}" is the ${slugLocale} address of page "${entryId}"; serving the requested ${requested} version.`,
        details: { slug: ref, slug_locale: slugLocale, served_locale: requested, entry_id: entryId },
      });
    } else {
      locale = slugLocale;
    }
  }
  if (entryId !== ref || (slugLocale && locale === slugLocale && requested !== slugLocale)) {
    warnings.push({
      code: "slug_resolved",
      message:
        `"${ref}" resolved to page "${entryId}"` +
        (slugLocale ? ` (${slugLocale} address)` : "") +
        `. Use "${entryId}" as the page ID in later calls.`,
      details: { slug: ref, entry_id: entryId, matched_by: matchedBy, locale },
    });
  }
  return { ok: true, entryId, locale, slugLocale, matchedBy, exact, warnings };
}

function folderNames(ci: ResolverIndex, contentType: string): string[] {
  const dir = path.join(ci.contentRoot, ci.getFolderName(contentType));
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function resolveDatabaseRef(
  ci: ResolverIndex,
  contentType: string,
  ref: string,
  requested: string | null,
  explicit: boolean,
): EntryRefResolved | EntryRefFailure | null {
  const typeItems = loadItemsForType(ci, contentType);
  if (!typeItems) return null;
  let matchedSlug = ref;
  let presence = findEntryPresence(ci as ContentIndex, contentType, ref);
  if (!presence) {
    const lookupKey = getLookupKey(contentType, ci.contentRoot) || "slug";
    const key = slugKey(ref);
    const rows = applyEntryFilters(typeItems.items, contentType, ci.contentRoot);
    const hits = [
      ...new Set(
        rows
          .map((item) => String(item[lookupKey] ?? item.slug ?? ""))
          .filter((s) => s && slugKey(s) === key),
      ),
    ];
    if (hits.length > 1) return { ok: false, reason: "ambiguous", candidates: hits.sort() };
    if (hits.length === 0) return null;
    matchedSlug = hits[0]!;
    presence = findEntryPresence(ci as ContentIndex, contentType, matchedSlug);
    if (!presence) return null;
  }
  const slugLocale =
    Object.entries(presence.localeSlugs).find(([, s]) => s === matchedSlug)?.[0] ?? null;
  const resolved = finish({
    ref,
    entryId: matchedSlug,
    matchedBy: "database",
    slugLocale,
    requested,
    explicit,
    exact: matchedSlug === ref,
  });
  if (resolved.locale && presence.localeSlugs[resolved.locale]) {
    resolved.entryId = presence.localeSlugs[resolved.locale]!;
  }
  return resolved;
}
