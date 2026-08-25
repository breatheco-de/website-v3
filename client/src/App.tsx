import { Switch, Route } from "wouter";
import { queryClient as defaultQueryClient } from "./lib/queryClient";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { lazy, Suspense, useState, useEffect, type ReactNode } from "react";
import NotFound from "@/pages/not-found";
import { SessionProvider } from "@/contexts/SessionContext";
import { EditModeWrapper } from "@/components/editing/EditModeWrapper";
import { DebugAuthProvider, isDebugModeActive, useDebugAuth } from "@/hooks/useDebugAuth";
import { ImagePickerProvider } from "@/contexts/ImagePickerContext";
import { usePageTracking } from "@/hooks/usePageTracking";
import type { ContentTypeApiItem } from "@/hooks/useContentTypes";
import {
  buildContentTypeRoutes,
  REGIONAL_LOCALE_RE,
} from "@/lib/content-type-routes";
import { ensureEcommerceProductLookup } from "@/lib/ecommerceProductMap";
import "./i18n";

// Track whether the Vite HMR WebSocket is currently connected.
// When disconnected, lazy-import retries are paused until the connection
// is restored (or a full-reload is imminent) rather than failing immediately.
let _hmrConnected = true;

function _waitForHmrReconnect(timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve) => {
    if (_hmrConnected) { resolve(); return; }
    let timer: ReturnType<typeof setTimeout>;
    const onConnect = () => {
      clearTimeout(timer);
      window.removeEventListener("vite:ws:connect" as keyof WindowEventMap, onConnect);
      resolve();
    };
    window.addEventListener("vite:ws:connect" as keyof WindowEventMap, onConnect);
    // Timeout safety valve — resolve anyway so retries can proceed/fail naturally
    timer = setTimeout(() => {
      window.removeEventListener("vite:ws:connect" as keyof WindowEventMap, onConnect);
      resolve();
    }, timeoutMs);
  });
}

if (typeof window !== "undefined") {
  // Vite 5+ dispatches these events on the window when the HMR socket changes state
  window.addEventListener("vite:ws:connect" as keyof WindowEventMap, () => {
    _hmrConnected = true;
  });
  window.addEventListener("vite:ws:disconnect" as keyof WindowEventMap, () => {
    _hmrConnected = false;
  });
  // A full-reload means the page is about to reload — no point retrying imports
  window.addEventListener("vite:beforeFullReload" as keyof WindowEventMap, () => {
    _hmrConnected = false;
  });
}

function lazyWithRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  retries = 3,
  delay = 600,
): React.LazyExoticComponent<T> {
  return lazy(() => {
    const attempt = (n: number): Promise<{ default: T }> =>
      factory().catch(async (err) => {
        if (n <= 0) throw err;
        // If the HMR socket is disconnected, pause until it reconnects
        // (avoids burning all retries while the server is restarting)
        if (!_hmrConnected) {
          await _waitForHmrReconnect();
        }
        // Back off on transient failures (edge 429 / aborted dynamic imports).
        const backoff = delay * (4 - n);
        await new Promise<void>((resolve) => setTimeout(resolve, backoff));
        return attempt(n - 1);
      });
    return attempt(retries);
  });
}

const ContentTypeDetail = lazyWithRetry(() => import("@/pages/ContentTypeDetail"));
const TemplatePage = lazyWithRetry(() => import("@/pages/page"));
const DatabaseSinglePage = lazyWithRetry(() => import("@/pages/DatabaseSinglePage"));

const PreviewFrame = lazyWithRetry(() => import("@/pages/PreviewFrame"));
const PrivateRouter = lazyWithRetry(() => import("@/pages/PrivateRouter"));
// Admin/editor-only UI — deferred into separate chunks so regular visitors
// never download them as part of the initial bundle. They are already
// client-only (inside <ClientOnly>) so no SSR preload is needed.
const DebugBubble = lazyWithRetry(() =>
  import("@/components/DebugBubble").then((m) => ({ default: m.DebugBubble })),
);
const ChatWidget = lazyWithRetry(() =>
  import("@/components/ChatWidget").then((m) => ({ default: m.ChatWidget })),
);
const VariableModalHost = lazyWithRetry(() =>
  import("@/components/editing/VariableHighlight").then((m) => ({ default: m.VariableModalHost })),
);
const OverlayRuntime = lazyWithRetry(() =>
  import("@/components/overlays/OverlayRuntime").then((m) => ({ default: m.OverlayRuntime })),
);
const BootstrapModal = lazyWithRetry(() =>
  import("@/components/BootstrapModal").then((m) => ({ default: m.BootstrapModal })),
);

// DebugBubbleGate: gate the lazy import behind a synchronous debug-mode check.
// isDebugModeActive() reads URL params + sessionStorage + import.meta.env.DEV —
// all synchronous, no hooks. Regular visitors never trigger the network request
// for the DebugBubble chunk.
function DebugBubbleGate() {
  if (!isDebugModeActive()) return null;
  return <Suspense fallback={null}><DebugBubble /></Suspense>;
}

// Editor-only hosts (variable modals). Regular visitors must not download these
// chunks on cold load — they contributed to /assets 429 fan-out on production.
function VariableModalHostGate() {
  const { canEdit, hasToken, isValidated, isDebugMode } = useDebugAuth();
  if (!canEdit && !isDebugMode && !(hasToken && isValidated)) return null;
  return <Suspense fallback={null}><VariableModalHost /></Suspense>;
}

// DeferredTooltipProvider: avoids loading @radix-ui/react-tooltip in the initial
// bundle. Children render immediately without the provider; the Radix chunk is
// fetched after mount so tooltips are available long before any user can open one.
function DeferredTooltipProvider({ children }: { children: ReactNode }) {
  const [Provider, setProvider] = useState<React.ComponentType<{ children: ReactNode }> | null>(null);

  useEffect(() => {
    import("@/components/ui/tooltip").then(({ TooltipProvider }) => {
      setProvider(() => TooltipProvider);
    });
  }, []);

  if (!Provider) return <>{children}</>;
  return <Provider>{children}</Provider>;
}

function LoadingFallback() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <div
          className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]"
          role="status"
        >
          <span className="!absolute !-m-px !h-px !w-px !overflow-hidden !whitespace-nowrap !border-0 !p-0 ![clip:rect(0,0,0,0)]">
            Loading...
          </span>
        </div>
      </div>
    </div>
  );
}

function useContentTypeRoutes() {
  const { data: contentTypes, isLoading } = useQuery<ContentTypeApiItem[]>({
    queryKey: ["/api/content-types"],
    staleTime: Infinity,
  });

  return { routes: buildContentTypeRoutes(contentTypes), isLoading };
}

function Router() {
  const { routes, isLoading } = useContentTypeRoutes();

  return (
    <Suspense fallback={null}>
      <Switch>
        <Route path="/" component={TemplatePage} />
        <Route path="/en/" component={TemplatePage} />
        <Route path="/es/" component={TemplatePage} />
        <Route path="/preview-frame" component={PreviewFrame} />
        <Route path="/private/*" component={PrivateRouter} />
        {routes.map((r) => {
          const key = `${r.path}-${r.type}-${r.locale}-${r.isListingPrefix ? "listing" : r.kind}`;
          return (
            <Route key={key} path={r.path}>
              {(params: { locale?: string; slug?: string }) => {
                if (r.regional && !REGIONAL_LOCALE_RE.test(params.locale || "")) {
                  return <NotFound />;
                }
                if (r.kind === "template") {
                  return <TemplatePage />;
                }
                if (r.kind === "database-single") {
                  return <DatabaseSinglePage contentType={r.type} />;
                }
                return (
                  <ContentTypeDetail
                    type={r.type}
                    slug={params.slug || ""}
                    locale={r.regional ? params.locale || "" : r.locale}
                    urlPattern={r.urlPattern}
                  />
                );
              }}
            </Route>
          );
        })}
        {isLoading ? (
          <Route>{() => <LoadingFallback />}</Route>
        ) : (
          <Route component={NotFound} />
        )}
      </Switch>
    </Suspense>
  );
}

function PageTracker() {
  usePageTracking();
  return null;
}

function EcommerceBootstrap() {
  useEffect(() => {
    void ensureEcommerceProductLookup();
  }, []);
  return null;
}

function ClientOnly({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <>{children}</>;
}

/** Mount children after hydration idle so their chunks don't compete with INP/TBT. */
function IdleMounted({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const enable = () => {
      if (!cancelled) setReady(true);
    };
    if (typeof requestIdleCallback !== "undefined") {
      const id = requestIdleCallback(enable, { timeout: 1500 });
      return () => {
        cancelled = true;
        cancelIdleCallback(id);
      };
    }
    const t = setTimeout(enable, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);
  if (!ready) return null;
  return <>{children}</>;
}

interface AppProps {
  ssrQueryClient?: QueryClient;
}

function App({ ssrQueryClient }: AppProps = {}) {
  const client = ssrQueryClient || defaultQueryClient;

  // Safety-net: Radix UI sometimes leaves pointer-events:none on document.body
  // after a dialog closes (race between close animation and react-remove-scroll
  // cleanup). The primary fix is in dialog.tsx's onCloseAutoFocus, but this
  // MutationObserver catches any remaining edge-cases (e.g. programmatic closes
  // where onCloseAutoFocus never fires).
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (document.body.style.pointerEvents === "none") {
        const hasOpenDialog = document.querySelector(
          '[role="dialog"][data-state="open"]'
        );
        if (!hasOpenDialog) {
          document.body.style.removeProperty("pointer-events");
        }
      }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ["style"] });
    return () => observer.disconnect();
  }, []);

  return (
    <QueryClientProvider client={client}>
      <SessionProvider>
        <DebugAuthProvider>
        <DeferredTooltipProvider>
          <EditModeWrapper>
            <ImagePickerProvider>
            <PageTracker />
            <EcommerceBootstrap />
            <Router />
            <ClientOnly>
              <Toaster />
              <IdleMounted>
                <Suspense fallback={null}><ChatWidget /></Suspense>
                <DebugBubbleGate />
                <VariableModalHostGate />
                <Suspense fallback={null}><OverlayRuntime /></Suspense>
                <Suspense fallback={null}><BootstrapModal /></Suspense>
              </IdleMounted>
            </ClientOnly>
            </ImagePickerProvider>
          </EditModeWrapper>
        </DeferredTooltipProvider>
        </DebugAuthProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}

export default App;
