import { Switch, Route, useLocation } from "wouter";
import { queryClient as defaultQueryClient } from "./lib/queryClient";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { lazy, Suspense, useState, useEffect, type ReactNode } from "react";
import NotFound from "@/pages/not-found";
import { SessionProvider } from "@/contexts/SessionContext";
import { EditModeWrapper } from "@/components/editing/EditModeWrapper";
import { DebugAuthProvider, useDebugAuth } from "@/hooks/useDebugAuth";
import { ImagePickerProvider } from "@/contexts/ImagePickerContext";
import { usePageTracking } from "@/hooks/usePageTracking";
import { ThemeBackgroundVars } from "@/components/ThemeBackgroundVars";
import Header from "@/components/Header";
import type { ContentTypeApiItem } from "@/hooks/useContentTypes";
import {
  buildContentTypeRoutes,
  REGIONAL_LOCALE_RE,
} from "@/lib/content-type-routes";
import { ensureEcommerceProductLookup } from "@/lib/ecommerceProductMap";
import {
  loadContentTypeDetailChunk,
  loadDatabaseSinglePageChunk,
  loadPreviewFrameChunk,
  loadPrivateRouterChunk,
} from "@/lib/publicPageChunks";
import "./i18n";

/**
 * Client-only chrome: retry wrapper is fine (not on the hydrate critical path).
 * Do NOT use this for public page routes — .catch() creates a new thenable and
 * defeats preload (magenta Suspense flash).
 */
function lazyWithRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  retries = 3,
  delay = 600,
): React.LazyExoticComponent<T> {
  return lazy(() => {
    const attempt = (n: number): Promise<{ default: T }> =>
      factory().catch(async (err) => {
        if (n <= 0) throw err;
        const backoff = delay * (4 - n);
        await new Promise<void>((resolve) => setTimeout(resolve, backoff));
        return attempt(n - 1);
      });
    return attempt(retries);
  });
}

// Shared thenables with main.tsx preload (publicPageChunks) — do not wrap in
// .catch or Suspense will blank #root. ContentTypeDetail stays lazy so lucide-
// heavy page code stays out of the entry; PublicShellHeader owns the navbar.
const ContentTypeDetail = lazy(() => loadContentTypeDetailChunk());
const DatabaseSinglePage = lazy(() => loadDatabaseSinglePageChunk());
const PreviewFrame = lazy(() => loadPreviewFrameChunk());
const PrivateRouter = lazy(() => loadPrivateRouterChunk());

const PAGE_URL_PATTERN = { en: "/en/:slug", es: "/es/:slug", default: "/en/:slug" };

/**
 * Experiment shell (Next `_app`-style): always main-navbar, outside the page tree
 * so hydrate can attach listeners without waiting on page body / layout.menu.top.
 * Skip private/preview; Header itself honors ?navbar=false.
 */
function PublicShellHeader() {
  const [location] = useLocation();
  const path = location.split("?")[0];
  if (path.startsWith("/private") || path.startsWith("/preview-frame")) {
    return null;
  }
  return <Header menuId="main-navbar" />;
}

/** Trailing segment of a listing-prefix path ("/en/how-to" → "how-to"). */
function listingPageSlug(routePath: string): string {
  const parts = routePath.split("/").filter(Boolean);
  const last = parts[parts.length - 1] || "";
  return last.startsWith(":") ? "" : last;
}

/** Locale root aliases (/ /en/ /es/) — same shell as landings. */
function HomePageRoute({ locale }: { locale: string }) {
  const { data: homePageSettings } = useQuery<{ type: string; slug: string }>({
    queryKey: ["/api/settings/home-page"],
    staleTime: 60000,
  });
  return (
    <ContentTypeDetail
      type="page"
      slug={homePageSettings?.slug ?? "home"}
      locale={locale}
      urlPattern={PAGE_URL_PATTERN}
    />
  );
}

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
const ConsentBanner = lazyWithRetry(() =>
  import("@/components/ConsentBanner").then((m) => ({ default: m.ConsentBanner })),
);
const BootstrapModal = lazyWithRetry(() =>
  import("@/components/BootstrapModal").then((m) => ({ default: m.BootstrapModal })),
);
const ProductionStaffTokenModalHost = lazyWithRetry(() =>
  import("@/components/ProductionStaffTokenModalHost").then((m) => ({
    default: m.ProductionStaffTokenModalHost,
  })),
);

// DebugBubbleGate: lazy-load only when debug mode is on (URL, dismiss flag,
// DEV, or non-expired staff token via useDebugAuth). Regular visitors never
// download the DebugBubble chunk.
function DebugBubbleGate() {
  const { isDebugMode } = useDebugAuth();
  if (!isDebugMode) return null;
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
    <>
      <PublicShellHeader />
      <Suspense fallback={null}>
        <Switch>
          <Route path="/">{() => <HomePageRoute locale="en" />}</Route>
          <Route path="/en/">{() => <HomePageRoute locale="en" />}</Route>
          <Route path="/es/">{() => <HomePageRoute locale="es" />}</Route>
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
                  if (r.kind === "database-single") {
                    return <DatabaseSinglePage contentType={r.type} />;
                  }
                  // Listing prefixes are page YAML entries (e.g. /en/how-to) — same shell as landings.
                  if (r.kind === "template" || r.isListingPrefix) {
                    return (
                      <ContentTypeDetail
                        type="page"
                        slug={params.slug || listingPageSlug(r.path)}
                        locale={r.regional ? params.locale || "" : r.locale}
                        urlPattern={PAGE_URL_PATTERN}
                      />
                    );
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
    </>
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
              <ThemeBackgroundVars />
              <Toaster />
              {import.meta.env.DEV ? (
                <Suspense fallback={null}>
                  <ProductionStaffTokenModalHost />
                </Suspense>
              ) : null}
              <IdleMounted>
                <Suspense fallback={null}><ChatWidget /></Suspense>
                <DebugBubbleGate />
                <VariableModalHostGate />
                <Suspense fallback={null}><OverlayRuntime /></Suspense>
                <Suspense fallback={null}><BootstrapModal /></Suspense>
                <Suspense fallback={null}><ConsentBanner /></Suspense>
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
