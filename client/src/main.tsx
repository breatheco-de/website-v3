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
  const rawPath = window.location.pathname;
  const path = rawPath.length > 1 ? rawPath.replace(/\/$/, "") : rawPath;

  // Same Promise as App React.lazy (publicPageChunks). In production, entry
  // modulepreloads should already be fetching these in parallel with HTML.
  const chunkLoads = resolvePublicPageChunkLoads(path, initialDataPayload);
  const sectionPreload = preloadSectionsFromInitialData(initialDataPayload, {
    eagerOnly: true,
  }).catch(() => {});

  if (rootEl.hasChildNodes()) {
    try {
      await Promise.all(chunkLoads);
    } catch {
      // fail-open — may Suspense-flash
    }

    hydrateRoot(rootEl, <App />);
    prefetchRemainingSectionsFromInitialData(initialDataPayload);

    void sectionPreload.finally(() => {
      requestAnimationFrame(() => {
        if (typeof requestIdleCallback !== "undefined") {
          requestIdleCallback(() => clearSSRHydration());
        } else {
          setTimeout(() => clearSSRHydration(), 200);
        }
      });
    });
  } else {
    clearSSRHydration();
    try {
      await Promise.all([...chunkLoads, sectionPreload]);
    } catch {
      // fail-open
    }
    createRoot(rootEl).render(<App />);
    prefetchRemainingSectionsFromInitialData(initialDataPayload);
  }
})();
