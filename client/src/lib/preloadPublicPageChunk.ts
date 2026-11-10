/**
 * Shared public-route chunk preload for SSR (entry-server) and client hydrate (main.tsx).
 * Keeps React.lazy() page modules in cache so <Suspense fallback={null}> does not blank #root.
 */
import {
  inferPublicPageChunk,
  type ContentRouteKind,
  type ContentTypeRouteInput,
} from "@/lib/content-type-routes";

export type InitialDataLike =
  | {
      queries: Array<{ queryKey: unknown[]; data?: unknown }>;
      queryKey?: never;
      data?: never;
    }
  | { queryKey: unknown[]; data: unknown; queries?: never }
  | null
  | undefined;

function contentTypesFromInitialData(
  payload: InitialDataLike,
): ContentTypeRouteInput[] | undefined {
  if (!payload?.queries?.length) return undefined;
  for (const { queryKey, data } of payload.queries) {
    if (
      Array.isArray(queryKey) &&
      queryKey[0] === "/api/content-types" &&
      Array.isArray(data)
    ) {
      return data as ContentTypeRouteInput[];
    }
  }
  return undefined;
}

/** Infer which public page component matches SSR initial data query keys. */
export function pageChunkImportFromInitialData(
  payload: InitialDataLike,
): Promise<unknown> | null {
  const queries = payload?.queries;
  if (!queries?.length) return null;
  for (const { queryKey } of queries) {
    if (!Array.isArray(queryKey) || queryKey.length === 0) continue;
    const key0 = queryKey[0];
    if (key0 === "/api/database-single") {
      return import("@/pages/DatabaseSinglePage");
    }
    if (typeof key0 === "string" && key0.startsWith("/api/content-pages/")) {
      const type = key0.slice("/api/content-pages/".length);
      const ct = contentTypesFromInitialData(payload)?.find((t) => t.name === type);
      if (ct && (ct.has_database || ct.single_template)) {
        return import("@/pages/DatabaseSinglePage");
      }
    }
    if (key0 === "/api/pages" || key0 === "/api/blog/config") {
      return import("@/pages/page");
    }
    if (
      typeof key0 === "string" &&
      key0.startsWith("/api/") &&
      key0 !== "/api/menus" &&
      key0 !== "/api/variables" &&
      key0 !== "/api/content-types" &&
      key0 !== "/api/image-registry" &&
      key0 !== "/api/settings/home-page" &&
      key0 !== "/api/blog/posts"
    ) {
      return import("@/pages/ContentTypeDetail");
    }
  }
  return null;
}

export function importPublicPageChunk(
  kind: ContentRouteKind,
): Promise<unknown> {
  if (kind === "database-single") return import("@/pages/DatabaseSinglePage");
  if (kind === "content-type-detail") return import("@/pages/ContentTypeDetail");
  return import("@/pages/page");
}

/**
 * Resolve the dynamic import(s) for the public (or private) page matching `pathname`.
 * Callers should await these before renderToPipeableStream / hydrateRoot.
 */
export function resolvePublicPageChunkLoads(
  pathname: string,
  payload?: InitialDataLike,
): Promise<unknown>[] {
  const rawPath = pathname.split("?")[0].split("#")[0];
  const path = rawPath.length > 1 ? rawPath.replace(/\/$/, "") : rawPath;

  if (path === "/private" || path.startsWith("/private/")) {
    return [import("@/pages/PrivateRouter")];
  }
  if (path === "/preview-frame") {
    return [import("@/pages/PreviewFrame")];
  }
  if (path === "/terms-conditions" || path === "/terminos-condiciones") {
    return [import("@/pages/TermsPage")];
  }
  if (path === "/privacy-policy" || path === "/politica-privacidad") {
    return [import("@/pages/PrivacyPage")];
  }

  const fromData = pageChunkImportFromInitialData(payload);
  if (fromData) return [fromData];

  return [
    importPublicPageChunk(
      inferPublicPageChunk(path, contentTypesFromInitialData(payload)),
    ),
  ];
}

/** Await public page chunk(s) for pathname (+ optional initial data). Fail-open. */
export async function preloadPublicPageChunks(
  pathname: string,
  payload?: InitialDataLike,
): Promise<void> {
  try {
    await Promise.all(resolvePublicPageChunkLoads(pathname, payload));
  } catch {
    // fail-open — caller may still render / hydrate
  }
}
