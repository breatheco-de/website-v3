/**
 * Content-type `editor.type: live_request` — fetch on entry get/SSR (not DB cache).
 * Public GET only; SSRF via isPrivateDestination; on_error empty.
 * URL/query templates use canonical `{{ entry.* }}` via resolveSingleVars.
 */

import { getContentTypeConfig, getFieldMapping, getFullFieldMapping } from "./content-types";
import { getValueByPath, resolveFieldValue } from "./transform";
import { resolveSingleVars } from "./single-resolver";
import { isPrivateDestination } from "@shared/ssrf";
import { child } from "./logger";

const log = child({ module: "live-request" });

const LIVE_FETCH_TIMEOUT_MS = 8_000;
const LIVE_FETCH_MAX_BYTES = 2_000_000;

export type LiveRequestEditorHint = {
  type?: string;
  request?: {
    url?: string;
    method?: string;
    query?: Record<string, string>;
  };
  response?: {
    items_path?: string;
  };
  on_error?: string;
};

/** Interpolate `{{ entry.* }}` / legacy `{{ single.* }}` (and pipe fallbacks) into a string. */
function resolveEntryTemplateString(
  template: string,
  entry: Record<string, unknown>,
): string {
  const resolved = resolveSingleVars(template, entry);
  if (resolved == null) return "";
  if (typeof resolved === "object") return JSON.stringify(resolved);
  return String(resolved);
}

function resolveItemsPath(data: unknown, itemsPath?: string): unknown {
  const path = (itemsPath || "$").trim();
  if (path === "$" || path === "") return data;
  const bare = path.startsWith("$.") ? path.slice(2) : path.startsWith("$") ? path.slice(1) : path;
  if (!bare) return data;
  return getValueByPath(data, bare);
}

async function fetchLiveJson(url: string): Promise<unknown> {
  if (isPrivateDestination(url)) {
    throw new Error(`Blocked private/internal destination: ${url}`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
      redirect: "follow",
    });
    if (!res.ok) {
      throw new Error(`Upstream ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > LIVE_FETCH_MAX_BYTES) {
      throw new Error(`Response too large (${buf.byteLength} bytes)`);
    }
    return JSON.parse(buf.toString("utf-8"));
  } finally {
    clearTimeout(timer);
  }
}

function buildUrlWithQuery(
  urlTemplate: string,
  query: Record<string, string> | undefined,
  entry: Record<string, unknown>,
): string {
  const base = resolveEntryTemplateString(urlTemplate, entry).trim();
  const url = new URL(base);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (!k.trim()) continue;
      url.searchParams.set(k, resolveEntryTemplateString(String(v ?? ""), entry));
    }
  }
  return url.toString();
}

type SourceItemsDb = {
  getLastGoodItems(name: string): { items: Record<string, unknown>[] } | null;
};

/**
 * Row from the database cache before content-type `function:` mappings overwrote
 * those keys. The delivery re-run reads `value` from here and `item` from the
 * entry, which already includes live_request fields.
 */
function findPreMappingItem(
  db: SourceItemsDb | undefined,
  contentType: string,
  contentRoot: string | undefined,
  entry: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const dbName = getContentTypeConfig(contentType, contentRoot)?.database?.slug;
  if (!db || !dbName) return undefined;
  const items = db.getLastGoodItems(dbName)?.items;
  if (!items?.length) return undefined;

  const slug = String(entry.slug ?? entry._slug ?? "");
  if (!slug) return undefined;
  const candidates = items.filter((item) => String(item.slug ?? "") === slug);
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  const locale = String(entry.locale ?? entry._locale ?? "");
  const localePath = getFullFieldMapping(contentType, contentRoot)?.locale;
  if (locale && typeof localePath === "string" && !localePath.startsWith("function:")) {
    const exact = candidates.find(
      (item) => String(getValueByPath(item, localePath) ?? "") === locale,
    );
    if (exact) return exact;
  }
  return candidates[0];
}

/**
 * Re-run CT field_mapping `function:` keys after a live_request.
 * `sourceItem` is the pre-mapping row: each function receives that field as
 * `value` and the current entry (with live fields) as `item`.
 */
export function reapplyContentTypeFunctions(
  contentType: string,
  entry: Record<string, unknown>,
  contentRoot?: string,
  sourceItem?: Record<string, unknown> | null,
): Record<string, unknown> {
  const full = getFullFieldMapping(contentType, contentRoot);
  const mapping = full || getFieldMapping(contentType, contentRoot) || {};
  const slug = String(entry.slug ?? entry._slug ?? "");
  const out = { ...entry };

  for (const [key, raw] of Object.entries(mapping)) {
    const source = typeof raw === "object" && raw && "source" in raw
      ? String((raw as { source: string }).source)
      : String(raw);
    if (!source.startsWith("function:")) continue;
    try {
      const value = resolveFieldValue(
        source,
        out,
        key,
        { contentType, slug, fieldPath: key },
        sourceItem ? { value: sourceItem[key] } : undefined,
      );
      if (value !== undefined) out[key] = value;
    } catch (err) {
      log.warn(
        { err, contentType, field: key },
        "[live-request] function reapply failed",
      );
    }
  }
  return out;
}

/**
 * For each editor.type live_request field: GET url, set entry[field] from items_path.
 * Functions re-run only after a live_request actually ran, using the pre-mapping
 * field value as input. A shallow copy is returned.
 */
export async function resolveLiveRequestsOnEntry(
  contentType: string,
  entry: Record<string, unknown> | null | undefined,
  opts?: { contentRoot?: string; db?: SourceItemsDb },
): Promise<Record<string, unknown> | null | undefined> {
  if (!entry || typeof entry !== "object") return entry;

  const ct = getContentTypeConfig(contentType, opts?.contentRoot);
  const editor = ct?.editor;
  if (!editor) return entry;

  let out: Record<string, unknown> = { ...entry };
  let ranLive = false;

  for (const [field, hint] of Object.entries(editor)) {
    const h = hint as LiveRequestEditorHint;
    if (h?.type !== "live_request") continue;
    ranLive = true;
    const urlTemplate = h.request?.url;
    if (!urlTemplate || typeof urlTemplate !== "string" || !urlTemplate.trim()) {
      out[field] = undefined;
      continue;
    }
    try {
      const url = buildUrlWithQuery(urlTemplate, h.request?.query, out);
      const data = await fetchLiveJson(url);
      const items = resolveItemsPath(data, h.response?.items_path);
      out[field] = items;
    } catch (err) {
      log.warn(
        { err, contentType, field },
        "[live-request] fetch failed; leaving field empty",
      );
      out[field] = undefined;
    }
  }

  if (!ranLive) return out;

  const sourceItem = findPreMappingItem(opts?.db, contentType, opts?.contentRoot, out);
  return reapplyContentTypeFunctions(contentType, out, opts?.contentRoot, sourceItem);
}
