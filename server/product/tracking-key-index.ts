/**
 * Per-site tracking key index: every `_product.yml` under a content root (soft-removed
 * included, so their keys stay reserved). Works for any site, unlike the default-site
 * product index. Cached per root; product writes and the product watcher invalidate it.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { parseAudienceFromProductDoc } from "@shared/productAudience";
import {
  normalizeShortKey,
  parseRetiredShortKeys,
  type TrackingKeyIndex,
  type TrackingKeyProduct,
} from "@shared/tracking-keys";
import { getDefaultContentRoot } from "../site-config";
import { resolveProductSidecarPath } from "./product-sidecar";

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; index: TrackingKeyIndex }>();

export function contentRootAbsolute(contentRoot?: string): string {
  const raw = contentRoot ?? getDefaultContentRoot();
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

/** Site id used by the pipeline database and the HTML cache (content folder name). */
export function siteIdForContentRoot(contentRoot?: string): string {
  return path.basename(contentRootAbsolute(contentRoot));
}

function loadYaml(file: string): Record<string, unknown> | null {
  try {
    const parsed = yaml.load(fs.readFileSync(file, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function loadSidecar(dir: string): Record<string, unknown> | null {
  const resolved = resolveProductSidecarPath(dir);
  return resolved.exists ? loadYaml(resolved.absolutePath) : null;
}

/** directory name → canonical content type key, from content-types.yml. */
function typeDirectories(root: string): Map<string, string> {
  const map = new Map<string, string>();
  const parsed = loadYaml(path.join(root, "content-types.yml"));
  if (!parsed) return map;
  for (const [key, def] of Object.entries(parsed)) {
    if (!def || typeof def !== "object" || Array.isArray(def)) continue;
    const dir = (def as { directory?: unknown }).directory;
    map.set(typeof dir === "string" && dir ? dir : key, key);
  }
  return map;
}

/** Product entry from a sidecar doc (merged over the type-level sidecar, like the product index). */
export function trackingKeyProductFromDoc(
  contentType: string,
  slug: string,
  entryDoc: Record<string, unknown>,
  typeDoc: Record<string, unknown> = {},
): TrackingKeyProduct {
  const merged = { ...typeDoc, ...entryDoc };
  const audience = parseAudienceFromProductDoc(entryDoc);
  const key = normalizeShortKey(entryDoc.short_key);
  return {
    slug,
    content_type: contentType,
    product_id:
      typeof merged.product_id === "string" && merged.product_id.trim()
        ? merged.product_id.trim()
        : `${contentType}-${slug}`,
    name: typeof merged.name === "string" && merged.name.trim() ? merged.name.trim() : slug,
    ...(key ? { key } : {}),
    active: merged.purchasable === true,
    personas: (audience?.personas ?? []).map((p) => ({
      id: p.id,
      name: p.label || p.role || p.id,
      ...(p.short_key ? { key: p.short_key } : {}),
    })),
    retired: parseRetiredShortKeys(entryDoc.retired_short_keys),
  };
}

function scan(root: string): TrackingKeyIndex {
  const products: TrackingKeyProduct[] = [];
  if (!fs.existsSync(root)) return { products };
  for (const [dirName, contentType] of typeDirectories(root)) {
    const typeDir = path.join(root, dirName);
    if (!fs.existsSync(typeDir)) continue;
    const typeDoc = loadSidecar(typeDir) ?? {};
    for (const ent of fs.readdirSync(typeDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const doc = loadSidecar(path.join(typeDir, ent.name));
      if (!doc) continue;
      products.push(trackingKeyProductFromDoc(contentType, ent.name, doc, typeDoc));
    }
  }
  products.sort((a, b) => a.slug.localeCompare(b.slug));
  return { products };
}

export function loadTrackingKeyIndex(contentRoot?: string, opts?: { fresh?: boolean }): TrackingKeyIndex {
  const root = contentRootAbsolute(contentRoot);
  const hit = cache.get(root);
  if (!opts?.fresh && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.index;
  const index = scan(root);
  cache.set(root, { at: Date.now(), index });
  return index;
}

export function invalidateTrackingKeyIndex(contentRoot?: string): void {
  if (contentRoot === undefined) {
    cache.clear();
    return;
  }
  cache.delete(contentRootAbsolute(contentRoot));
}
