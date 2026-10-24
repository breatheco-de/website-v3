import { hydrateRoot, createRoot } from "react-dom/client";
import App from "./App";
import {
  hydrateInitialData,
  clearSSRHydration,
  readInitialDataPayload,
} from "./lib/initialData";
import { setThemePaint } from "@shared/theme-palette";
import {
  preloadSectionsFromInitialData,
  prefetchRemainingSectionsFromInitialData,
} from "@/components/sectionRegistry";
import { injectDevSite, resumePendingDomainNavigation } from "./lib/devSite";
import {
  cancelledEditResponse,
  confirmGuardedEdit,
  findGuardedDraftForRequest,
} from "./lib/proposal-edit-guard";
import {
  resolvePublicPageChunkLoads,
} from "./lib/preloadPublicPageChunk";

// ─── Global fetch interceptor ────────────────────────────────────────────────
// Injects ?__site=<domain> into every relative /api/ fetch call so that direct
// fetch() calls anywhere in the codebase (DebugBubble, edit-mode hooks, future
// code) automatically target the active dev-site without each call site needing
// an explicit injectDevSite() wrapper.
//
// Guards:
//   • Only active in dev builds (injectDevSite() is a no-op in production).
//   • Only applied to relative /api/ URLs to avoid touching external requests.
//   • Skips URLs that already carry __site= (no double-injection).
//   • Saves to a draft in an open proposal wait for the co-author confirmation
//     (lib/proposal-edit-guard); a cancel answers 409 without hitting the server.
if (typeof window !== "undefined") {
  const _nativeFetch = window.fetch.bind(window);
  window.fetch = function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    if (typeof input === "string" && input.startsWith("/api/")) {
      input = injectDevSite(input);
    } else if (input instanceof URL && input.pathname.startsWith("/api/")) {
      const injected = injectDevSite(input.toString());
      if (injected !== input.toString()) input = new URL(injected);
    }
    const guarded = findGuardedDraftForRequest(input, init);
    if (guarded) {
      const target = input;
      return confirmGuardedEdit(guarded).then((ok) =>
        ok ? _nativeFetch(target, init) : cancelledEditResponse(),
      );
    }
    return _nativeFetch(input, init);
  };
}

const initialDataPayload = readInitialDataPayload();
setThemePaint(initialDataPayload?.themePaint ?? null);
hydrateInitialData();

if (typeof window !== "undefined") {
  void resumePendingDomainNavigation();
}

const rootEl = document.getElementById("root")!;

(async () => {
  if (rootEl.hasChildNodes()) {
    // Preload the lazy route chunk needed for the current URL before calling
    // hydrateRoot(). Without this, React's <Suspense fallback={null}> fires while
    // chunks load, blanking the entire page (the white-flash bug).
    //
    // Prefer a single page chunk (not all three public pages) so cold loads do
    // not fan out unused JS and trip edge rate limits. SSR __INITIAL_DATA__
    // query keys identify the route type; path heuristics cover the rest.
    // Heavy private chunks (PreviewFrame, PrivateRouter) remain lazy-only.
    // Normalize pathname: strip trailing slash (except root "/") for consistent matching.
    const rawPath = window.location.pathname;
    const path = rawPath.length > 1 ? rawPath.replace(/\/$/, "") : rawPath;

    // MAINTENANCE NOTE: When adding a new lazy() route in App.tsx, extend
    // resolvePublicPageChunkLoads in preloadPublicPageChunk.ts so Suspense
    // does not blank the page. DebugBubble / ChatWidget / VariableModalHost
    // stay client-only (ClientOnly) and are intentionally not preloaded.
    const chunkLoads = resolvePublicPageChunkLoads(path, initialDataPayload);

    // Await only eager/above-fold section chunks so hydrateRoot can start sooner.
    // Below-fold sections stay in the SSR HTML (DeferredSection keeps them visible
    // during data-ssr-hydrating) and their JS chunks idle-prefetch after hydrate.
    const sectionPreload = preloadSectionsFromInitialData(initialDataPayload, {
      eagerOnly: true,
    });

    // Gracefully handle preload failure — hydration still proceeds but may briefly
    // flash for that route. Better than blocking hydration globally.
    try {
      await Promise.all([...chunkLoads, sectionPreload]);
    } catch {
      // Chunk failed to load; proceed with hydrateRoot anyway.
    }

    hydrateRoot(rootEl, <App />);
    prefetchRemainingSectionsFromInitialData(initialDataPayload);

    requestAnimationFrame(() => {
      if (typeof requestIdleCallback !== "undefined") {
        requestIdleCallback(() => clearSSRHydration());
      } else {
        setTimeout(() => clearSSRHydration(), 200);
      }
    });
  } else {
    clearSSRHydration();
    // Empty #root (SSR miss / CSR): warm route + eager sections before first paint
    // so pages do not mount Header+Footer with LazySection null.
    const rawPath = window.location.pathname;
    const path = rawPath.length > 1 ? rawPath.replace(/\/$/, "") : rawPath;
    try {
      await Promise.all([
        ...resolvePublicPageChunkLoads(path, initialDataPayload),
        preloadSectionsFromInitialData(initialDataPayload, { eagerOnly: true }),
      ]);
    } catch {
      // fail-open
    }
    createRoot(rootEl).render(<App />);
    prefetchRemainingSectionsFromInitialData(initialDataPayload);
  }
})();
