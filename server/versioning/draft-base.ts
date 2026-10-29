/**
 * Draft bases: what a draft was created from, and how it differs.
 *
 * - `_draft.based_on` (in the draft file) holds hashes of the live locale file and
 *   `_common.yml` when the draft was created. It travels with the content repo, so
 *   any environment can tell the draft is behind live.
 * - The full base copy (parsed live + common) lives in SQLite `draft_bases` on the
 *   machine that created the draft. Without it the draft can still be detected as
 *   stale, but not rebuilt and its diff is approximate.
 */

import fs from "fs";
import path from "path";
import { isTemplateVersioningSlug, liveTemplateBasename } from "@shared/sharedLayoutPaths";
import { fieldScope, splitByFieldScope, type FieldScope, type FieldScopeOptions } from "@shared/field-scope";
import { cloneJson, deleteAtPath, isPlainObject, setAtPath } from "@shared/object-path";
import { FUNNEL_YAML_KEY, normalizeFunnelBlock } from "@shared/funnel";
import { deepMerge } from "../utils/deepMerge";
import { getFolder } from "../content-types";
import { diffRedirectItems, mergeRedirectLists, type RedirectChanges } from "../redirect-items";
import { getSiteSqlite } from "../db";
import { urlParamsForContentType } from "../field-scope-config";
import {
  hashVariantFileContents,
  readDraftMeta,
  readVariantData,
  resolveRoot,
  safeDumpYaml,
  safeLoadYaml,
  stripDraftMetaFromRaw,
  variantFilePathFor,
  writeDraftMeta,
  writeVariantData,
  type DraftBasedOn,
  type DraftTranslatedFrom,
} from "./draft-meta";

export type DraftRef = {
  contentType: string;
  slug: string;
  locale: string;
  variant: string;
  /** Absolute or cwd-relative content root (`site_4geeks-com`). */
  contentRoot?: string;
};

export type BaseSnapshot = {
  live: Record<string, unknown> | null;
  common: Record<string, unknown> | null;
};

export type DraftBaseRow = {
  locale_hash: string | null;
  common_hash: string | null;
  snapshot: BaseSnapshot | null;
  source_snapshot: Record<string, unknown> | null;
  created_at: number;
};

/** Where base copies are kept. Production: site SQLite; tests: in memory. */
export interface DraftBaseStore {
  get(site: string, ref: DraftRef): DraftBaseRow | null;
  put(site: string, ref: DraftRef, row: DraftBaseRow): void;
  delete(site: string, ref: DraftRef): void;
}

export function createMemoryDraftBaseStore(): DraftBaseStore {
  const rows = new Map<string, DraftBaseRow>();
  const key = (site: string, r: DraftRef) => `${site}|${r.contentType}|${r.slug}|${r.locale}|${r.variant}`;
  return {
    get: (site, ref) => cloneJson(rows.get(key(site, ref)) ?? null),
    put: (site, ref, row) => void rows.set(key(site, ref), cloneJson(row)),
    delete: (site, ref) => void rows.delete(key(site, ref)),
  };
}

function createSqliteDraftBaseStore(): DraftBaseStore {
  const db = (site: string) => getSiteSqlite(site);
  return {
    get(site, ref) {
      try {
        const row = db(site)
          .prepare(
            `SELECT locale_hash, common_hash, snapshot_json, source_snapshot_json, created_at
             FROM draft_bases WHERE content_type = ? AND slug = ? AND locale = ? AND variant = ?`,
          )
          .get(ref.contentType, ref.slug, ref.locale, ref.variant) as
          | {
              locale_hash: string | null;
              common_hash: string | null;
              snapshot_json: string | null;
              source_snapshot_json: string | null;
              created_at: number;
            }
          | undefined;
        if (!row) return null;
        return {
          locale_hash: row.locale_hash,
          common_hash: row.common_hash,
          snapshot: row.snapshot_json ? (JSON.parse(row.snapshot_json) as BaseSnapshot) : null,
          source_snapshot: row.source_snapshot_json
            ? (JSON.parse(row.source_snapshot_json) as Record<string, unknown>)
            : null,
          created_at: row.created_at,
        };
      } catch {
        return null;
      }
    },
    put(site, ref, row) {
      try {
        db(site)
          .prepare(
            `INSERT INTO draft_bases
               (content_type, slug, locale, variant, locale_hash, common_hash, snapshot_json, source_snapshot_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(content_type, slug, locale, variant) DO UPDATE SET
               locale_hash = excluded.locale_hash,
               common_hash = excluded.common_hash,
               snapshot_json = excluded.snapshot_json,
               source_snapshot_json = excluded.source_snapshot_json,
               created_at = excluded.created_at`,
          )
          .run(
            ref.contentType,
            ref.slug,
            ref.locale,
            ref.variant,
            row.locale_hash,
            row.common_hash,
            row.snapshot ? JSON.stringify(row.snapshot) : null,
            row.source_snapshot ? JSON.stringify(row.source_snapshot) : null,
            row.created_at,
          );
      } catch {
        /* base copy is best-effort: hashes in _draft still detect staleness */
      }
    },
    delete(site, ref) {
      try {
        db(site)
          .prepare(
            `DELETE FROM draft_bases WHERE content_type = ? AND slug = ? AND locale = ? AND variant = ?`,
          )
          .run(ref.contentType, ref.slug, ref.locale, ref.variant);
      } catch {
        /* non-fatal */
      }
    },
  };
}

let activeStore: DraftBaseStore = process.env.VITEST
  ? createMemoryDraftBaseStore()
  : createSqliteDraftBaseStore();

export function getDraftBaseStore(): DraftBaseStore {
  return activeStore;
}

/** Swap the store (tests). Returns the previous one. */
export function setDraftBaseStore(store: DraftBaseStore): DraftBaseStore {
  const prev = activeStore;
  activeStore = store;
  return prev;
}

// ── Paths ────────────────────────────────────────────────────────────────────

function siteOf(ref: DraftRef): string {
  return path.basename(resolveRoot(ref.contentRoot));
}

function typeDir(ref: DraftRef): string {
  const root = resolveRoot(ref.contentRoot);
  return path.join(root, getFolder(ref.contentType, root));
}

export function draftPathOf(ref: DraftRef): string {
  return variantFilePathFor(ref);
}

export function livePathOf(ref: Pick<DraftRef, "contentType" | "slug" | "locale" | "contentRoot">): string {
  if (isTemplateVersioningSlug(ref.slug)) {
    return path.join(typeDir(ref as DraftRef), liveTemplateBasename(ref.locale));
  }
  return path.join(typeDir(ref as DraftRef), ref.slug, `${ref.locale}.yml`);
}

export function commonPathOf(ref: Pick<DraftRef, "contentType" | "slug" | "contentRoot">): string {
  if (isTemplateVersioningSlug(ref.slug)) return path.join(typeDir(ref as DraftRef), "_common.yml");
  return path.join(typeDir(ref as DraftRef), ref.slug, "_common.yml");
}

function hashFile(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return hashVariantFileContents(fs.readFileSync(filePath, "utf-8"));
}

function loadFile(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  return safeLoadYaml(fs.readFileSync(filePath, "utf-8"));
}

export function currentSnapshot(ref: DraftRef): BaseSnapshot {
  return { live: loadFile(livePathOf(ref)), common: loadFile(commonPathOf(ref)) };
}

/** Field scope options for this entry (its URL params are always locale). */
export function scopeOptionsOf(ref: Pick<DraftRef, "contentType" | "contentRoot">): FieldScopeOptions {
  try {
    return { urlParams: urlParamsForContentType(ref.contentType, ref.contentRoot) };
  } catch {
    return {};
  }
}

/**
 * Locale file content a draft may start from: page-level keys are dropped, since they
 * are published from `_common.yml` (copying a legacy locale copy would stage it as an edit).
 * Returns the raw text untouched when there is nothing to drop.
 */
export function draftSeedFromLiveRaw(liveRaw: string, opts?: FieldScopeOptions): string {
  return draftSeedFromLive(liveRaw, opts).content;
}

export const FUNNEL_CARRIED_WARNING = "funnel_carried_from_language_file";

/**
 * {@link draftSeedFromLiveRaw}, except a legacy `funnel:` in the live locale file that differs
 * from `_common.yml` is kept in the draft (as visitors see it: locale merged over common), so
 * publishing moves it to `_common.yml` instead of silently dropping it. `carried` lists kept keys.
 */
export function draftSeedFromLive(
  liveRaw: string,
  opts?: FieldScopeOptions & { commonRaw?: string | null },
): { content: string; carried: string[] } {
  const raw = stripDraftMetaFromRaw(liveRaw);
  const data = safeLoadYaml(raw);
  if (!data) return { content: raw, carried: [] };
  const { common, locale } = splitByFieldScope(data, opts);
  if (Object.keys(common).length === 0) return { content: raw, carried: [] };
  const carried: string[] = [];
  if (isPlainObject(common[FUNNEL_YAML_KEY]) && opts?.commonRaw !== undefined) {
    const commonFunnel = (opts.commonRaw ? safeLoadYaml(opts.commonRaw) : null)?.[FUNNEL_YAML_KEY];
    const own = common[FUNNEL_YAML_KEY] as Record<string, unknown>;
    const visible = isPlainObject(commonFunnel) ? deepMerge(commonFunnel, own) : own;
    if (JSON.stringify(normalizeFunnelBlock(visible)) !== JSON.stringify(normalizeFunnelBlock(commonFunnel))) {
      locale[FUNNEL_YAML_KEY] = visible;
      carried.push(FUNNEL_YAML_KEY);
    }
  }
  return { content: Object.keys(locale).length ? safeDumpYaml(locale) : "{}\n", carried };
}

/** Warning for callers that seed a draft with {@link draftSeedFromLive}. */
export function funnelCarriedWarning(locale: string): { code: string; message: string } {
  return {
    code: FUNNEL_CARRIED_WARNING,
    message:
      `This page's ${locale} language file had its own funnel, different from the page's shared settings (_common.yml). ` +
      "The draft keeps it so it isn't lost; publishing moves it to _common.yml for every language. " +
      "Change or remove funnel in the draft if it shouldn't become the page funnel.",
  };
}

// ── Field-level diff ─────────────────────────────────────────────────────────

/** Split one level deeper for these keys (`meta.page_title`, `seo.main_keyword`). */
const NESTED_FIELD_KEYS = new Set(["meta", "seo"]);

/** Merged per address on rebuild instead of as one value. */
const REDIRECTS_PATH = "meta.redirects";

/** Flatten to review-sized fields: top-level keys; `meta.*` / `seo.*` one level deeper. */
export function flattenFields(data: Record<string, unknown> | null | undefined): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (!data) return out;
  for (const [key, value] of Object.entries(data)) {
    if (key === "_draft") continue;
    if (NESTED_FIELD_KEYS.has(key) && isPlainObject(value)) {
      for (const [sub, v] of Object.entries(value)) out.set(`${key}.${sub}`, v);
      continue;
    }
    out.set(key, value);
  }
  return out;
}

export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export type FieldChange = {
  field_path: string;
  before: unknown;
  after: unknown;
  scope: FieldScope;
  removed?: boolean;
  /** Published value in the translation source locale (translations only). */
  source?: unknown;
};

export type AuthorDiff = {
  /** true when no base copy exists: diff is draft vs today's live (may include live changes). */
  approximate: boolean;
  changes: FieldChange[];
};

/** Publish deletes top-level and `meta.*` nulls from the locale file; other nested nulls stay. */
function publishKeepsLocaleNull(fieldPath: string): boolean {
  return fieldPath.includes(".") && !fieldPath.startsWith("meta.");
}

/** Draft (locale part + staged page-level fields) vs a base. */
export function diffDraftAgainst(
  draft: Record<string, unknown>,
  base: BaseSnapshot,
  opts?: FieldScopeOptions,
): FieldChange[] {
  const { common: draftCommon, locale: draftLocale } = splitByFieldScope(draft, opts);
  const changes: FieldChange[] = [];

  const baseLive = flattenFields(base.live);
  const draftLive = flattenFields(draftLocale);
  const localePaths = new Set([...baseLive.keys(), ...draftLive.keys()]);
  for (const p of localePaths) {
    if (fieldScope(p, opts) === "common") continue;
    const before = baseLive.get(p);
    const inDraft = draftLive.has(p);
    const after = draftLive.get(p);
    if (!inDraft || after === null) {
      if (before === undefined) continue;
      if (inDraft && before === null && publishKeepsLocaleNull(p)) continue;
      changes.push({ field_path: p, before, after: undefined, scope: "locale", removed: true });
      continue;
    }
    if (!sameValue(before, after)) changes.push({ field_path: p, before, after, scope: "locale" });
  }

  const baseCommon = flattenFields(base.common);
  for (const [p, after] of flattenFields(draftCommon)) {
    const before = baseCommon.get(p);
    if (after === null) {
      changes.push({ field_path: p, before, after: undefined, scope: "common", removed: true });
      continue;
    }
    if (!sameValue(before, after)) changes.push({ field_path: p, before, after, scope: "common" });
  }
  return changes.sort((a, b) => a.field_path.localeCompare(b.field_path));
}

/** Changes between two snapshots (live changes since base, or what a publish changed). */
export function diffSnapshots(before: BaseSnapshot, after: BaseSnapshot, opts?: FieldScopeOptions): FieldChange[] {
  const changes: FieldChange[] = [];
  const pairs: Array<[FieldScope, Map<string, unknown>, Map<string, unknown>]> = [
    ["locale", flattenFields(before.live), flattenFields(after.live)],
    ["common", flattenFields(before.common), flattenFields(after.common)],
  ];
  for (const [scope, a, b] of pairs) {
    for (const p of new Set([...a.keys(), ...b.keys()])) {
      if (fieldScope(p, opts) !== scope) continue;
      const va = a.get(p);
      const vb = b.get(p);
      if (sameValue(va, vb)) continue;
      changes.push({
        field_path: p,
        before: va,
        after: vb,
        scope,
        ...(vb === undefined ? { removed: true } : {}),
      });
    }
  }
  return changes.sort((x, y) => x.field_path.localeCompare(y.field_path));
}

// ── Base record / check ──────────────────────────────────────────────────────

/**
 * Stamp `_draft.based_on` with today's live hashes and keep a base copy.
 * Call when a draft is created and after every rebuild — never on plain draft edits.
 */
export function recordDraftBase(
  ref: DraftRef,
  opts: { author?: string; at?: Date; store?: DraftBaseStore; skipMark?: boolean } = {},
): DraftBasedOn | null {
  const draftPath = draftPathOf(ref);
  if (!fs.existsSync(draftPath)) return null;
  const basedOn: DraftBasedOn = {
    locale: hashFile(livePathOf(ref)),
    common: hashFile(commonPathOf(ref)),
    at: (opts.at ?? new Date()).toISOString(),
  };
  writeDraftMeta(
    draftPath,
    { based_on: basedOn },
    { author: opts.author, contentRoot: ref.contentRoot, skipMark: opts.skipMark },
  );
  const store = opts.store ?? activeStore;
  const prev = store.get(siteOf(ref), ref);
  store.put(siteOf(ref), ref, {
    locale_hash: basedOn.locale,
    common_hash: basedOn.common,
    snapshot: currentSnapshot(ref),
    source_snapshot: prev?.source_snapshot ?? null,
    created_at: Date.parse(basedOn.at),
  });
  return basedOn;
}

/** Base copy (live + common when the draft was made) while it still matches `_draft.based_on`. */
export function baseSnapshotOf(ref: DraftRef, store: DraftBaseStore = activeStore): BaseSnapshot | null {
  const row = store.get(siteOf(ref), ref);
  if (!row?.snapshot) return null;
  const meta = readDraftMeta(draftPathOf(ref));
  if (meta?.based_on && row.locale_hash !== meta.based_on.locale) return null;
  return row.snapshot;
}

export function forgetDraftBase(ref: DraftRef, store: DraftBaseStore = activeStore): void {
  store.delete(siteOf(ref), ref);
}

export type DraftBaseCheck =
  | { status: "ok" }
  | { status: "stale"; changed: Array<"locale" | "common">; based_on: DraftBasedOn }
  | { status: "unknown" };

function draftCarriesCommonFields(draft: Record<string, unknown> | null, opts?: FieldScopeOptions): boolean {
  if (!draft) return false;
  return Object.keys(splitByFieldScope(draft, opts).common).length > 0;
}

/** Compare today's live hashes with `_draft.based_on`. `common` counts only if the draft stages page-level fields. */
export function checkDraftBase(ref: DraftRef): DraftBaseCheck {
  const meta = readDraftMeta(draftPathOf(ref));
  const liveHash = hashFile(livePathOf(ref));
  if (!meta?.based_on) {
    return liveHash === null ? { status: "ok" } : { status: "unknown" };
  }
  const changed: Array<"locale" | "common"> = [];
  if ((meta.based_on.locale ?? null) !== liveHash) changed.push("locale");
  if (draftCarriesCommonFields(readVariantData(draftPathOf(ref)), scopeOptionsOf(ref))) {
    if ((meta.based_on.common ?? null) !== hashFile(commonPathOf(ref))) changed.push("common");
  }
  return changed.length ? { status: "stale", changed, based_on: meta.based_on } : { status: "ok" };
}

/** Author changes: base copy vs draft; without a base copy, draft vs today's live (approximate). */
export function authorDiff(ref: DraftRef, opts: { store?: DraftBaseStore } = {}): AuthorDiff | null {
  const draft = readVariantData(draftPathOf(ref));
  if (!draft) return null;
  const row = (opts.store ?? activeStore).get(siteOf(ref), ref);
  const meta = readDraftMeta(draftPathOf(ref));
  const hasCopy = !!row?.snapshot && (!meta?.based_on || row.locale_hash === meta.based_on.locale);
  const base: BaseSnapshot = hasCopy
    ? row!.snapshot!
    : meta?.based_on && meta.based_on.locale === null
      ? { live: null, common: currentSnapshot(ref).common }
      : currentSnapshot(ref);
  const approximate = !hasCopy && !(meta?.based_on && meta.based_on.locale === null && !fs.existsSync(livePathOf(ref)));
  const changes = diffDraftAgainst(draft, base, scopeOptionsOf(ref));
  if (meta?.translated_from) {
    const source = loadFile(
      livePathOf({ ...ref, locale: meta.translated_from.locale }),
    );
    const sourceFields = flattenFields(source);
    for (const c of changes) {
      if (sourceFields.has(c.field_path)) c.source = sourceFields.get(c.field_path);
    }
  }
  return { approximate, changes };
}

// ── Rebuild ──────────────────────────────────────────────────────────────────

export type RebuildResult =
  | {
      ok: true;
      author_changes: FieldChange[];
      live_changes_since_base: FieldChange[];
      /** Old addresses added on live since the base, kept in the rebuilt draft. */
      redirects_kept_from_live: string[];
      /** Draft content after the rebuild (without `_draft`). */
      result: Record<string, unknown>;
      wrote: boolean;
    }
  | {
      ok: false;
      reason: "conflict" | "has_sections" | "no_base_copy" | "draft_missing";
      conflicting_fields?: Array<{ field_path: string; author: unknown; live: unknown }>;
      author_changes?: FieldChange[];
      live_changes_since_base?: FieldChange[];
    };

/**
 * Re-apply the author's changes on top of today's live when live moved since the
 * base. Field-by-field: a field changed on both sides is a conflict, except
 * `meta.redirects`, which merges per address. Drafts whose author changed
 * `sections` are never rebuilt automatically.
 */
export function rebuildDraftFromBase(
  ref: DraftRef,
  opts: { preview?: boolean; author?: string; store?: DraftBaseStore } = {},
): RebuildResult {
  const store = opts.store ?? activeStore;
  const draftPath = draftPathOf(ref);
  const draft = readVariantData(draftPath);
  if (!draft) return { ok: false, reason: "draft_missing" };
  const row = store.get(siteOf(ref), ref);
  const meta = readDraftMeta(draftPath);
  if (!row?.snapshot || (meta?.based_on && row.locale_hash !== meta.based_on.locale)) {
    return { ok: false, reason: "no_base_copy" };
  }
  const base = row.snapshot;
  const now = currentSnapshot(ref);
  const scopeOpts = scopeOptionsOf(ref);
  const authorChanges = diffDraftAgainst(draft, base, scopeOpts);
  const liveChanges = diffSnapshots(base, now, scopeOpts);
  if (authorChanges.some((c) => c.field_path === "sections")) {
    return {
      ok: false,
      reason: "has_sections",
      author_changes: authorChanges,
      live_changes_since_base: liveChanges,
    };
  }
  const liveByPath = new Map(liveChanges.map((c) => [c.field_path, c]));

  // Old addresses merge per address: both sides may add/remove different ones.
  const authorRedirects = authorChanges.find((c) => c.field_path === REDIRECTS_PATH);
  const liveRedirects = liveByPath.get(REDIRECTS_PATH);
  let mergedRedirects: unknown[] | null = null;
  const redirectConflicts: Array<{ field_path: string; author: unknown; live: unknown }> = [];
  if (authorRedirects && liveRedirects) {
    const merged = mergeRedirectLists(
      authorRedirects.before,
      authorRedirects.removed ? [] : authorRedirects.after,
      liveRedirects.removed ? [] : liveRedirects.after,
    );
    if (merged.ok) mergedRedirects = merged.list;
    else {
      for (const c of merged.conflicts) {
        redirectConflicts.push({ field_path: `${REDIRECTS_PATH}[${c.path}]`, author: c.author, live: c.live });
      }
    }
    liveByPath.delete(REDIRECTS_PATH);
  }

  const conflicts = [
    ...authorChanges
      .filter((c) => liveByPath.has(c.field_path))
      .map((c) => ({ field_path: c.field_path, author: c.after ?? null, live: liveByPath.get(c.field_path)!.after ?? null })),
    ...redirectConflicts,
  ];
  if (conflicts.length > 0) {
    return {
      ok: false,
      reason: "conflict",
      conflicting_fields: conflicts,
      author_changes: authorChanges,
      live_changes_since_base: liveChanges,
    };
  }

  const result: Record<string, unknown> = cloneJson(splitByFieldScope(now.live ?? {}, scopeOpts).locale);
  for (const c of authorChanges) {
    if (c.field_path === REDIRECTS_PATH && mergedRedirects) {
      if (mergedRedirects.length > 0) setAtPath(result, REDIRECTS_PATH, cloneJson(mergedRedirects));
      else deleteAtPath(result, REDIRECTS_PATH);
    } else if (c.scope === "common") {
      setAtPath(result, c.field_path, c.removed ? null : cloneJson(c.after));
    } else if (c.removed) {
      deleteAtPath(result, c.field_path);
    } else {
      setAtPath(result, c.field_path, cloneJson(c.after));
    }
  }
  if (!opts.preview) {
    writeVariantData(draftPath, result, { author: opts.author, contentRoot: ref.contentRoot });
    recordDraftBase(ref, { author: opts.author, store });
  }
  return {
    ok: true,
    author_changes: authorChanges,
    live_changes_since_base: liveChanges,
    redirects_kept_from_live: liveRedirects
      ? diffRedirectItems(liveRedirects.before, liveRedirects.after).added.map((i) => i.path)
      : [],
    result,
    wrote: !opts.preview,
  };
}

/** Old addresses (`meta.redirects`) where the variant differs from today's live file. */
export function variantRedirectChanges(ref: DraftRef): RedirectChanges {
  return diffRedirectItems(loadFile(livePathOf(ref)), readVariantData(draftPathOf(ref)));
}

// ── Translation source ───────────────────────────────────────────────────────

export function recordTranslationSource(
  ref: DraftRef,
  sourceLocale: string,
  opts: { author?: string; store?: DraftBaseStore; skipMark?: boolean } = {},
): DraftTranslatedFrom | null {
  const draftPath = draftPathOf(ref);
  if (!fs.existsSync(draftPath)) return null;
  const sourcePath = livePathOf({ ...ref, locale: sourceLocale });
  const hash = hashFile(sourcePath);
  if (!hash) return null;
  const translatedFrom: DraftTranslatedFrom = { locale: sourceLocale, hash, at: new Date().toISOString() };
  writeDraftMeta(
    draftPath,
    { translated_from: translatedFrom },
    { author: opts.author, contentRoot: ref.contentRoot, skipMark: opts.skipMark },
  );
  const store = opts.store ?? activeStore;
  const prev = store.get(siteOf(ref), ref);
  store.put(siteOf(ref), ref, {
    locale_hash: prev?.locale_hash ?? null,
    common_hash: prev?.common_hash ?? null,
    snapshot: prev?.snapshot ?? null,
    source_snapshot: loadFile(sourcePath),
    created_at: prev?.created_at ?? Date.now(),
  });
  return translatedFrom;
}

export type TranslationSourceCheck =
  | { status: "none" }
  | { status: "ok"; source_locale: string }
  | { status: "changed"; source_locale: string; source_changed_fields?: string[] };

export function checkTranslationSource(ref: DraftRef, opts: { store?: DraftBaseStore; withFields?: boolean } = {}): TranslationSourceCheck {
  const meta = readDraftMeta(draftPathOf(ref));
  const from = meta?.translated_from;
  if (!from) return { status: "none" };
  const sourcePath = livePathOf({ ...ref, locale: from.locale });
  if (hashFile(sourcePath) === from.hash) return { status: "ok", source_locale: from.locale };
  if (!opts.withFields) return { status: "changed", source_locale: from.locale };
  const row = (opts.store ?? activeStore).get(siteOf(ref), ref);
  if (!row?.source_snapshot) return { status: "changed", source_locale: from.locale };
  const fields = diffSnapshots({ live: row.source_snapshot, common: null }, { live: loadFile(sourcePath), common: null })
    .map((c) => c.field_path);
  return { status: "changed", source_locale: from.locale, source_changed_fields: fields };
}

// ── Drift (visibility) ───────────────────────────────────────────────────────

export type DraftDrift = {
  behind: boolean;
  source_changed: boolean;
  since?: string;
  changed_files?: Array<"locale" | "common">;
  changed_fields?: string[];
  source_changed_fields?: string[];
  base_unknown?: boolean;
};

/** Cheap mode (hashes only) for lists; full mode adds field names from the base copy. */
export function computeDraftDrift(ref: DraftRef, opts: { full?: boolean; store?: DraftBaseStore } = {}): DraftDrift {
  const base = checkDraftBase(ref);
  const source = checkTranslationSource(ref, { store: opts.store, withFields: opts.full });
  const drift: DraftDrift = {
    behind: base.status === "stale",
    source_changed: source.status === "changed",
  };
  if (base.status === "unknown") drift.base_unknown = true;
  if (base.status === "stale") {
    drift.since = base.based_on.at;
    drift.changed_files = base.changed;
    if (opts.full) {
      const row = (opts.store ?? activeStore).get(siteOf(ref), ref);
      if (row?.snapshot) {
        drift.changed_fields = diffSnapshots(row.snapshot, currentSnapshot(ref)).map((c) => c.field_path);
      }
    }
  }
  if (source.status === "changed" && source.source_changed_fields) {
    drift.source_changed_fields = source.source_changed_fields;
  }
  return drift;
}
