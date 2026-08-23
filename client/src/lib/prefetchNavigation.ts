import {
  hasSectionType,
  loadSectionComponent,
  preloadSections,
  type SectionRef,
} from "@/components/sectionRegistry";
import { queryClient } from "@/lib/queryClient";
import { isNonNavigableHref } from "@shared/safe-href";

/** Hydrated from SSR initial data (see server/initial-data-middleware.ts). */
export const NAVIGATION_EAGER_MANIFEST_QUERY_KEY = [
  "navigation-eager-manifest",
] as const;

type ManifestEntry = {
  eager: string[][];
  leadForm?: boolean;
};

type NavigationEagerManifest = {
  paths: Record<string, ManifestEntry>;
};

const completedPaths = new Set<string>();
const inflight = new Map<string, Promise<void>>();

function getNavigationEagerManifest(): NavigationEagerManifest | null {
  const data = queryClient.getQueryData<NavigationEagerManifest>(
    [...NAVIGATION_EAGER_MANIFEST_QUERY_KEY],
  );
  return data?.paths ? data : null;
}

export function isInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

export function isExternalHref(href: string): boolean {
  const s = href.trim();
  return (
    s.startsWith("http://") ||
    s.startsWith("https://") ||
    s.startsWith("//") ||
    s.startsWith("mailto:") ||
    s.startsWith("tel:")
  );
}

function normalizePath(href: string): string {
  const raw = href.split("?")[0].split("#")[0].trim();
  if (!raw || raw === "/") return "/";
  if (raw !== "/" && raw.endsWith("/")) return raw.slice(0, -1);
  return raw;
}

export function extractPath(href: string): string {
  try {
    if (href.startsWith("/")) return normalizePath(href);
    const parsed = new URL(href);
    return normalizePath(parsed.pathname);
  } catch {
    return normalizePath(href);
  }
}

export function isPrefetchableHref(href: string, currentPath?: string): boolean {
  if (!href || href.startsWith("#") || isNonNavigableHref(href) || !isInternalHref(href) || isExternalHref(href)) {
    return false;
  }
  const path = extractPath(href);
  if (!path) return false;
  const current =
    currentPath ??
    (typeof window !== "undefined" ? window.location.pathname : "");
  const norm = (p: string) => (p.length > 1 ? p.replace(/\/$/, "") : p);
  return norm(path) !== norm(current);
}

function scheduleIdle(fn: () => void): void {
  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(fn);
  } else {
    setTimeout(fn, 0);
  }
}

function getManifestEntry(path: string): ManifestEntry | undefined {
  const manifest = getNavigationEagerManifest();
  if (!manifest) return undefined;
  const normalized =
    path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  return manifest.paths[normalized] ?? manifest.paths[path];
}

function tuplesToSectionRefs(tuples: string[][]): SectionRef[] {
  return tuples.map(([type, variant]) => ({ type, variant }));
}

async function preloadPathFromManifest(path: string): Promise<void> {
  if (completedPaths.has(path)) return;
  const existing = inflight.get(path);
  if (existing) return existing;

  const work = (async () => {
    try {
      const entry = getManifestEntry(path);
      if (!entry?.eager?.length) return;

      const refs = tuplesToSectionRefs(entry.eager);
      const loads: Promise<unknown>[] = [preloadSections(refs)];
      if (
        "leadForm" in entry &&
        entry.leadForm === true &&
        hasSectionType("lead_form")
      ) {
        loads.push(loadSectionComponent("lead_form", "default"));
      }
      await Promise.all(loads);
      completedPaths.add(path);
    } catch {
      // fail-open
    } finally {
      inflight.delete(path);
    }
  })();

  inflight.set(path, work);
  return work;
}

/** Hover prefetch: manifest lookup + section chunk imports only (no network). */
export function prefetchNavigationHref(href: string): void {
  if (!isPrefetchableHref(href)) return;
  const path = extractPath(href);
  scheduleIdle(() => {
    void preloadPathFromManifest(path);
  });
}
