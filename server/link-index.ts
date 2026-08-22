/**
 * Derived outbound internal-link index per entry id.
 * Not an authored source of truth — rebuilt/patched from content crawls.
 */

import * as fs from "fs";
import * as path from "path";
import { getDefaultContentRoot } from "./site-config";

export const LINK_INDEX_FILENAME = "link-index.json";

export type LinkIndex = {
  version: 1;
  updated_at: string;
  /** entryId → outbound public paths */
  outbound: Record<string, string[]>;
};

function absRoot(contentRoot?: string): string {
  return contentRoot
    ? path.isAbsolute(contentRoot)
      ? contentRoot
      : path.join(process.cwd(), contentRoot)
    : getDefaultContentRoot();
}

function indexPath(contentRoot?: string): string {
  return path.join(absRoot(contentRoot), LINK_INDEX_FILENAME);
}

let cache: { root: string; data: LinkIndex } | null = null;

function emptyIndex(): LinkIndex {
  return { version: 1, updated_at: new Date().toISOString(), outbound: {} };
}

export function loadLinkIndex(contentRoot?: string): LinkIndex {
  const root = absRoot(contentRoot);
  if (cache && cache.root === root) return cache.data;
  const fp = indexPath(contentRoot);
  if (!fs.existsSync(fp)) {
    const data = emptyIndex();
    cache = { root, data };
    return data;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(fp, "utf-8")) as LinkIndex;
    if (!parsed || parsed.version !== 1 || typeof parsed.outbound !== "object") {
      const data = emptyIndex();
      cache = { root, data };
      return data;
    }
    cache = { root, data: parsed };
    return parsed;
  } catch {
    const data = emptyIndex();
    cache = { root, data };
    return data;
  }
}

export function saveLinkIndex(data: LinkIndex, contentRoot?: string): void {
  const root = absRoot(contentRoot);
  data.updated_at = new Date().toISOString();
  fs.writeFileSync(indexPath(contentRoot), JSON.stringify(data, null, 2) + "\n", "utf-8");
  cache = { root, data };
}

export function invalidateLinkIndexCache(): void {
  cache = null;
}

export function getLinkIndexOutbound(entryId: string, contentRoot?: string): string[] | null {
  const row = loadLinkIndex(contentRoot).outbound[entryId];
  return Array.isArray(row) ? row : null;
}

export function patchLinkIndexOutbound(
  entryId: string,
  outbound: string[],
  contentRoot?: string,
): void {
  const data = loadLinkIndex(contentRoot);
  data.outbound[entryId] = [...new Set(outbound)].sort();
  saveLinkIndex(data, contentRoot);
}

/** Rebuild outbound map from a full crawl result. */
export function rebuildLinkIndex(
  outboundByEntry: Record<string, string[]>,
  contentRoot?: string,
): LinkIndex {
  const data: LinkIndex = {
    version: 1,
    updated_at: new Date().toISOString(),
    outbound: {},
  };
  for (const [id, paths] of Object.entries(outboundByEntry)) {
    data.outbound[id] = [...new Set(paths)].sort();
  }
  saveLinkIndex(data, contentRoot);
  return data;
}
