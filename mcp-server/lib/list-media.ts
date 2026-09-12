/**
 * Media Gallery UI-parity filter / sort / paginate for MCP list_media.
 */

import type { ImageEntry, ImageRegistry } from "../../shared/schema.js";
import { isAiOrigin } from "../../shared/ai-image-gc.js";
import { inferDoctypeFromSrc, type MediaDoctype } from "../../shared/media-doctype.js";

export type ListMediaSort = "newest" | "oldest" | "name" | "usage";
export type ListMediaDoctypeFilter = "all" | MediaDoctype;
export type ListMediaOriginFilter = "all" | "ai" | "uploaded";

export type ListMediaItem = {
  media_id: string;
  src: string;
  alt: string;
  tags: string[];
  doctype: MediaDoctype | null;
  origin: "ai" | "uploaded";
  registered_at?: string;
  parent_id?: string;
  usage_count?: number;
};

export type FilterAndSortMediaOpts = {
  q?: string;
  tags?: string[];
  doctype?: ListMediaDoctypeFilter;
  origin?: ListMediaOriginFilter;
  include_derived?: boolean;
  sort?: ListMediaSort;
  page?: number;
  page_size?: number;
};

export type FilterAndSortMediaResult = {
  items: ListMediaItem[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
  available_tags: string[];
  unknown_tags: string[];
};

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export function clampListMediaPage(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 1) return 1;
  return Math.floor(raw);
}

export function clampListMediaPageSize(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.floor(raw));
}

/** Whole-site tag vocabulary (tagDefinitions keys, else unique entry tags). */
export function collectAvailableTags(
  images: Record<string, ImageEntry>,
  tagDefinitions?: ImageRegistry["tagDefinitions"],
): string[] {
  if (tagDefinitions && Object.keys(tagDefinitions).length > 0) {
    return Object.keys(tagDefinitions).sort((a, b) => a.localeCompare(b));
  }
  const seen = new Set<string>();
  for (const entry of Object.values(images)) {
    for (const tag of entry.tags ?? []) {
      if (tag) seen.add(tag);
    }
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

function entryTimestampMs(entry: ImageEntry): number {
  return Date.parse(entry.registered_at || entry.ai?.generated_at || "");
}

function toSlimItem(id: string, entry: ImageEntry): ListMediaItem {
  const ai = isAiOrigin(entry);
  const item: ListMediaItem = {
    media_id: id,
    src: entry.src,
    alt: entry.alt,
    tags: entry.tags ?? [],
    doctype: inferDoctypeFromSrc(entry.src),
    origin: ai ? "ai" : "uploaded",
  };
  if (entry.registered_at) item.registered_at = entry.registered_at;
  if (entry.parentId) item.parent_id = entry.parentId;
  if (typeof entry.usage_count === "number") item.usage_count = entry.usage_count;
  return item;
}

/**
 * Filter, sort, and paginate gallery entries (Media Gallery UI semantics).
 */
export function filterAndSortMedia(
  images: Record<string, ImageEntry>,
  opts: FilterAndSortMediaOpts = {},
  tagDefinitions?: ImageRegistry["tagDefinitions"],
): FilterAndSortMediaResult {
  const includeDerived = opts.include_derived === true;
  const doctypeFilter: ListMediaDoctypeFilter = opts.doctype ?? "all";
  const originFilter: ListMediaOriginFilter = opts.origin ?? "all";
  const sort: ListMediaSort = opts.sort ?? "newest";
  const page = clampListMediaPage(opts.page);
  const pageSize = clampListMediaPageSize(opts.page_size);
  const searchLower = (opts.q ?? "").trim().toLowerCase();
  const requestedTags = (opts.tags ?? []).map((t) => t.trim()).filter(Boolean);
  const tagSet = new Set(requestedTags.map((t) => t.toLowerCase()));

  const availableTags = collectAvailableTags(images, tagDefinitions);
  const availableLower = new Set(availableTags.map((t) => t.toLowerCase()));
  const unknownTags = requestedTags.filter((t) => !availableLower.has(t.toLowerCase()));

  let entries = Object.entries(images).filter(([id, img]) => {
    if (!includeDerived && img.parentId) return false;

    if (doctypeFilter !== "all") {
      const dt = inferDoctypeFromSrc(img.src);
      if (dt !== doctypeFilter) return false;
    }

    const ai = isAiOrigin(img);
    if (originFilter === "ai" && !ai) return false;
    if (originFilter === "uploaded" && ai) return false;

    if (tagSet.size > 0) {
      const hasMatch = img.tags?.some((t) => tagSet.has(t.toLowerCase()));
      if (!hasMatch) return false;
    }

    if (!searchLower) return true;
    const requestedBy = img.ai?.requested_by;
    return (
      id.toLowerCase().includes(searchLower) ||
      img.alt.toLowerCase().includes(searchLower) ||
      (img.tags?.some((tag) => tag.toLowerCase().includes(searchLower)) ?? false) ||
      (requestedBy?.name || "").toLowerCase().includes(searchLower) ||
      (requestedBy?.id || "").toLowerCase().includes(searchLower)
    );
  });

  entries = entries.sort(([idA, a], [idB, b]) => {
    if (sort === "name") return idA.localeCompare(idB);
    if (sort === "usage") {
      const ua = a.usage_count ?? 0;
      const ub = b.usage_count ?? 0;
      if (ub !== ua) return ub - ua;
      return idA.localeCompare(idB);
    }
    const ta = entryTimestampMs(a);
    const tb = entryTimestampMs(b);
    const aValid = Number.isFinite(ta);
    const bValid = Number.isFinite(tb);
    if (aValid !== bValid) {
      if (sort === "newest") return aValid ? -1 : 1;
      return aValid ? 1 : -1;
    }
    if (aValid && bValid && ta !== tb) {
      return sort === "newest" ? tb - ta : ta - tb;
    }
    return idA.localeCompare(idB);
  });

  const total = entries.length;
  const start = (page - 1) * pageSize;
  const pageEntries = start >= total ? [] : entries.slice(start, start + pageSize);
  const items = pageEntries.map(([id, entry]) => toSlimItem(id, entry));

  return {
    items,
    total,
    page,
    page_size: pageSize,
    has_more: start + items.length < total,
    available_tags: availableTags,
    unknown_tags: unknownTags,
  };
}
