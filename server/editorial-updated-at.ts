/**
 * Editorial `updated_at` — last content change on the locale/variant YAML layer.
 * Opposite of `published_at` (once-only on `_common.yml`): this key lives on the
 * file being saved and moves when a whitelist save lands.
 *
 * Stamp from incoming ops / mapped updates, never dumped-file SHA or sync-state.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { normalizeFlexibleDate } from "@shared/normalizeFlexibleDate";
import {
  getFolder,
  RESERVED_UPDATED_AT_FIELD,
  UPDATED_AT_ALIAS_FIELD,
} from "./content-types";
import { isPublishedAtEmpty, readPublishedAt } from "./published-at";
import { getDefaultContentRoot } from "./site-config";
import { markFileAsModified } from "./sync-state";
import { SHARED_LAYOUT_KEYS } from "./shared-layout-sync";

export type EditorialUpdatedAtStamp = "now" | "seed" | "keep";

export type EditorialOp = {
  action?: string;
  path?: string;
  value?: unknown;
  index?: number;
  section?: Record<string, unknown>;
  sections?: Array<Record<string, unknown>>;
  item?: Record<string, unknown>;
  from?: number;
  to?: number;
};

const EDITORIAL_META_KEYS = new Set(["page_title", "description"]);

const STRUCTURAL_SECTION_KEYS = new Set<string>([
  "type",
  "component",
  "variant",
  "version",
  "theme",
  "id",
  "section_id",
  "_label",
  "_remove",
  "_insertAfterSectionId",
  "spacing",
  ...SHARED_LAYOUT_KEYS,
]);

const LAYOUT_KEY_RE = /^(padding|margin|showOn)/i;

const NON_EDITORIAL_ROOT_PATHS = new Set([
  "updated_at",
  "_updated_at",
  "published_at",
  "layout",
  "seo",
  "status",
  "slug",
  "_slug",
  "locale",
  "_locale",
]);

export function isEditorialUpdatedAtEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  return false;
}

export function setYamlUpdatedAt(data: Record<string, unknown>, iso: string): void {
  data[UPDATED_AT_ALIAS_FIELD] = iso;
  delete data[RESERVED_UPDATED_AT_FIELD];
}

function isLayoutOrIdentityKey(key: string): boolean {
  if (STRUCTURAL_SECTION_KEYS.has(key)) return true;
  return LAYOUT_KEY_RE.test(key);
}

function isEmptyEditorial(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length === 0;
  return false;
}

/** Strip layout / identity so remaining leaves are copy + images. */
export function stripNonEditorial(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripNonEditorial).filter((v) => !isEmptyEditorial(v));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isLayoutOrIdentityKey(k)) continue;
      const stripped = stripNonEditorial(v);
      if (!isEmptyEditorial(stripped)) out[k] = stripped;
    }
    return out;
  }
  return value;
}

export function hasEditorialPayload(section: unknown): boolean {
  return !isEmptyEditorial(stripNonEditorial(section));
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function editorialSectionFingerprints(sections: unknown): string[] {
  if (!Array.isArray(sections)) return [];
  return sections.map((s) => stableJson(stripNonEditorial(s))).sort();
}

function getAtPath(obj: unknown, dotPath: string): unknown {
  const parts = dotPath.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function metaEditorialChanged(previous: unknown, next: unknown): boolean {
  const prevMeta =
    previous && typeof previous === "object" ? (previous as Record<string, unknown>) : {};
  const nextMeta = next && typeof next === "object" ? (next as Record<string, unknown>) : {};
  for (const key of EDITORIAL_META_KEYS) {
    if (stableJson(prevMeta[key] ?? null) !== stableJson(nextMeta[key] ?? null)) return true;
  }
  return false;
}

function fieldPathTouchesEditorial(
  path: string,
  previous: Record<string, unknown>,
  nextValue: unknown,
): boolean {
  if (path === "title") return true;
  if (path === "updated_at" || path === "_updated_at" || path === "published_at") return false;
  if (path === "seo" || path.startsWith("seo.")) return false;
  if (path === "layout" || path.startsWith("layout.")) return false;
  if (NON_EDITORIAL_ROOT_PATHS.has(path)) return false;

  if (path === "meta") {
    return metaEditorialChanged(previous.meta, nextValue);
  }
  if (path.startsWith("meta.")) {
    const key = path.slice("meta.".length).split(".")[0];
    return EDITORIAL_META_KEYS.has(key);
  }

  if (path === "sections") {
    return (
      stableJson(editorialSectionFingerprints(previous.sections)) !==
      stableJson(editorialSectionFingerprints(nextValue))
    );
  }
  if (path.startsWith("sections.")) {
    const parts = path.split(".");
    if (parts.length >= 3 && isLayoutOrIdentityKey(parts[2])) return false;
    if (parts.length === 2) {
      const idx = Number(parts[1]);
      const prevSections = Array.isArray(previous.sections) ? previous.sections : [];
      const prev = Number.isFinite(idx) ? prevSections[idx] : undefined;
      return (
        stableJson(stripNonEditorial(prev)) !== stableJson(stripNonEditorial(nextValue)) &&
        (hasEditorialPayload(nextValue) || hasEditorialPayload(prev))
      );
    }
    return true;
  }

  return false;
}

export function operationsTouchEditorialContent(
  operations: EditorialOp[],
  previous: Record<string, unknown> = {},
): boolean {
  for (const op of operations) {
    const action = op.action;
    if (!action) continue;
    if (action === "reorder_sections") continue;
    if (action === "update_field" && typeof op.path === "string") {
      if (fieldPathTouchesEditorial(op.path, previous, op.value)) return true;
      continue;
    }
    if (action === "update_section" && typeof op.index === "number") {
      const prevSections = Array.isArray(previous.sections) ? previous.sections : [];
      const prev = prevSections[op.index];
      const next = op.section ?? {};
      if (stableJson(stripNonEditorial(prev)) !== stableJson(stripNonEditorial(next))) {
        if (hasEditorialPayload(next) || hasEditorialPayload(prev)) return true;
      }
      continue;
    }
    if (action === "replace_all_sections") {
      if (
        stableJson(editorialSectionFingerprints(previous.sections)) !==
        stableJson(editorialSectionFingerprints(op.sections ?? []))
      ) {
        return true;
      }
      continue;
    }
    if (
      (action === "add_item" || action === "add_section" || action === "duplicate_section") &&
      (op.path === "sections" || op.path == null)
    ) {
      if (hasEditorialPayload(op.item ?? op.section ?? op.value)) return true;
      continue;
    }
    if (
      (action === "remove_item" || action === "remove_section") &&
      (op.path === "sections" || op.path == null)
    ) {
      const prevSections = Array.isArray(previous.sections) ? previous.sections : [];
      const idx = typeof op.index === "number" ? op.index : -1;
      if (hasEditorialPayload(prevSections[idx])) return true;
      continue;
    }
  }
  return false;
}

/** Mapped Fields / DB patch bag: title bumps; seo.* and updated_at do not. */
export function updatesTouchEditorialContent(
  updates: Record<string, unknown | null>,
): boolean {
  for (const key of Object.keys(updates)) {
    if (key === "title") return true;
    if (key === "seo" || key.startsWith("seo.")) continue;
    if (key === "updated_at" || key === "_updated_at" || key === "published_at") continue;
    if (key === "meta.page_title" || key === "meta.description") return true;
  }
  return false;
}

export function applyEditorialUpdatedAtToData(opts: {
  data: Record<string, unknown>;
  previous?: Record<string, unknown> | null;
  operations?: EditorialOp[];
  updates?: Record<string, unknown | null>;
  contentType: string;
  slug?: string;
  contentRoot?: string;
  now?: string;
}): { kind: EditorialUpdatedAtStamp; iso?: string } {
  const previous = opts.previous ?? {};
  const whitelist = opts.operations
    ? operationsTouchEditorialContent(opts.operations, previous)
    : updatesTouchEditorialContent(opts.updates ?? {});

  if (whitelist) {
    const iso = opts.now ?? new Date().toISOString();
    setYamlUpdatedAt(opts.data, iso);
    return { kind: "now", iso };
  }

  const existing = opts.data[UPDATED_AT_ALIAS_FIELD] ?? opts.data[RESERVED_UPDATED_AT_FIELD];
  if (!isEditorialUpdatedAtEmpty(existing)) {
    const iso = normalizeFlexibleDate(existing);
    if (iso) setYamlUpdatedAt(opts.data, iso);
    else {
      opts.data[UPDATED_AT_ALIAS_FIELD] = existing;
      delete opts.data[RESERVED_UPDATED_AT_FIELD];
    }
    return { kind: "keep" };
  }

  const published = opts.slug
    ? readPublishedAt(opts.contentType, opts.slug, opts.contentRoot)
    : opts.data.published_at;
  if (!isPublishedAtEmpty(published)) {
    const iso = normalizeFlexibleDate(published) ?? String(published);
    setYamlUpdatedAt(opts.data, iso);
    return { kind: "seed", iso };
  }

  return { kind: "keep" };
}

export function applyEditorialStampToPendingUpdates(opts: {
  pendingUpdates: Record<string, unknown | null>;
  entryData: Record<string, unknown>;
  contentType: string;
  slug: string;
  contentRoot?: string;
  now?: string;
}): { kind: EditorialUpdatedAtStamp; iso?: string } {
  if (updatesTouchEditorialContent(opts.pendingUpdates)) {
    const iso = opts.now ?? new Date().toISOString();
    opts.pendingUpdates[UPDATED_AT_ALIAS_FIELD] = iso;
    delete opts.pendingUpdates[RESERVED_UPDATED_AT_FIELD];
    return { kind: "now", iso };
  }

  const nextVal =
    opts.pendingUpdates[UPDATED_AT_ALIAS_FIELD] ??
    opts.pendingUpdates[RESERVED_UPDATED_AT_FIELD] ??
    opts.entryData[UPDATED_AT_ALIAS_FIELD] ??
    opts.entryData[RESERVED_UPDATED_AT_FIELD];

  if (!isEditorialUpdatedAtEmpty(nextVal) && !Object.prototype.hasOwnProperty.call(opts.pendingUpdates, UPDATED_AT_ALIAS_FIELD)) {
    return { kind: "keep" };
  }
  if (!isEditorialUpdatedAtEmpty(opts.pendingUpdates[UPDATED_AT_ALIAS_FIELD]) ||
      !isEditorialUpdatedAtEmpty(opts.pendingUpdates[RESERVED_UPDATED_AT_FIELD])) {
    return { kind: "keep" };
  }

  if (isEditorialUpdatedAtEmpty(nextVal)) {
    const published = readPublishedAt(opts.contentType, opts.slug, opts.contentRoot);
    if (!isPublishedAtEmpty(published)) {
      const iso = normalizeFlexibleDate(published) ?? String(published);
      opts.pendingUpdates[UPDATED_AT_ALIAS_FIELD] = iso;
      return { kind: "seed", iso };
    }
  }
  return { kind: "keep" };
}

export function applyEditorialStampToDbMappedUpdates(
  mappedUpdates: Record<string, unknown>,
  fieldMapping?: Record<string, string> | null,
  now?: string,
): { kind: EditorialUpdatedAtStamp; iso?: string } {
  if (!updatesTouchEditorialContent(mappedUpdates)) {
    return { kind: "keep" };
  }
  const iso = now ?? new Date().toISOString();
  if (fieldMapping && Object.prototype.hasOwnProperty.call(fieldMapping, RESERVED_UPDATED_AT_FIELD)) {
    mappedUpdates[RESERVED_UPDATED_AT_FIELD] = iso;
  } else if (fieldMapping && Object.prototype.hasOwnProperty.call(fieldMapping, UPDATED_AT_ALIAS_FIELD)) {
    mappedUpdates[UPDATED_AT_ALIAS_FIELD] = iso;
  } else {
    mappedUpdates[UPDATED_AT_ALIAS_FIELD] = iso;
  }
  return { kind: "now", iso };
}

export function operationsFromLocalePayload(data: Record<string, unknown>): EditorialOp[] {
  const ops: EditorialOp[] = [];
  if (Object.prototype.hasOwnProperty.call(data, "title")) {
    ops.push({ action: "update_field", path: "title", value: data.title });
  }
  if (data.meta && typeof data.meta === "object") {
    ops.push({ action: "update_field", path: "meta", value: data.meta });
  }
  if (Array.isArray(data.sections) && data.sections.length > 0) {
    ops.push({
      action: "replace_all_sections",
      sections: data.sections as Array<Record<string, unknown>>,
    });
  }
  return ops;
}

export function persistUpdatedAtOnYamlFile(
  filePath: string,
  iso: string,
  author?: string,
  contentRoot?: string,
): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const data = (yaml.load(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>) || {};
    setYamlUpdatedAt(data, iso);
    fs.writeFileSync(
      filePath,
      yaml.dump(data, { lineWidth: -1, noRefs: true, sortKeys: false }),
      "utf-8",
    );
    markFileAsModified(filePath, author, undefined, contentRoot);
    return true;
  } catch {
    return false;
  }
}

