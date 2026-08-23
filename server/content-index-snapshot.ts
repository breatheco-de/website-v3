import type { ContentIndex } from "../content-index";
import type { RedirectEntry } from "../redirects";

export type IndexSnapshot = {
  generation: number;
  site: string;
  entries: ReturnType<ContentIndex["exportSnapshotEntries"]>;
  bySlug: Record<string, ReturnType<ContentIndex["exportSnapshotEntries"]>>;
  byPath: Record<string, ReturnType<ContentIndex["exportSnapshotEntries"][number]>>;
  byUrl: Record<string, unknown>;
  localeSlugMap: Record<string, string>;
  imageUsage: Record<string, string[]>;
  variableUsage: Record<string, string[]>;
  menuUsage: Record<string, unknown[]>;
  seoIndex: Record<string, unknown>;
  redirectEntries: RedirectEntry[];
  slowPhaseReady: boolean;
};

export function serializeSetMap<T>(map: Map<string, Set<T>>): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const [k, v] of map) out[k] = [...v];
  return out;
}

export function deserializeSetMap<T>(obj: Record<string, T[]>): Map<string, Set<T>> {
  const map = new Map<string, Set<T>>();
  for (const [k, arr] of Object.entries(obj)) map.set(k, new Set(arr));
  return map;
}
