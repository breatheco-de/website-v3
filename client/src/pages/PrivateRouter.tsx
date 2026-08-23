import { Switch, Route, useLocation } from "wouter";
import { lazy, Suspense, type ReactNode } from "react";
import NotFound from "@/pages/not-found";
import { getDebugToken, isDebugModeActive, useDebugAuth } from "@/hooks/useDebugAuth";
import { resolvePrivatePageAccess } from "@/lib/private-page-access";

const ComponentShowcase = lazy(() => import("@/pages/ComponentShowcase"));
const ComponentGallery = lazy(() => import("@/pages/ComponentGallery"));
const ComponentPreview = lazy(() => import("@/pages/ComponentPreview"));
const EntryPreviewFrame = lazy(() => import("@/pages/EntryPreviewFrame"));
const MediaGallery = lazy(() => import("@/pages/MediaGallery"));
const MenuEditor = lazy(() => import("@/pages/MenuEditor"));
const MoleculesShowcase = lazy(() => import("@/pages/MoleculesShowcase"));
const PrivatePreview = lazy(() => import("@/pages/PrivatePreview"));
const DiagnosticsPage = lazy(() => import("@/pages/DiagnosticsPage"));
const PrivateRedirects = lazy(() => import("@/pages/PrivateRedirects"));
const ContentTypeManagePage = lazy(() => import("@/pages/ContentTypeManagePage"));
const SyncLogPage = lazy(() => import("@/pages/SyncLogPage"));
const CloudSyncPage = lazy(() => import("@/pages/CloudSyncPage"));
const PrivateDatabases = lazy(() => import("@/pages/PrivateDatabases"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const SeoGeoSettingsPage = lazy(() => import("@/pages/SeoGeoSettingsPage"));
const AIKnowledge = lazy(() => import("@/pages/AIKnowledge"));
const AIConversations = lazy(() => import("@/pages/AIConversations"));
const AIKnowledgeBlocks = lazy(() => import("@/pages/AIKnowledgeBlocks"));
const AISettingsPage = lazy(() => import("@/pages/AISettingsPage"));
const ThemeEditor = lazy(() => import("@/pages/ThemeEditor"));
const TrackingPage = lazy(() => import("@/pages/TrackingPage"));
const SecurityPage = lazy(() => import("@/pages/SecurityPage"));
const ComponentInsightsPage = lazy(() => import("@/pages/ComponentInsightsPage"));
const StoreProductsPage = lazy(() => import("@/pages/StoreProductsPage"));
const StoreEcommercePage = lazy(() => import("@/pages/StoreEcommercePage"));
const StoreProductDetailPage = lazy(() => import("@/pages/StoreProductDetailPage"));
const ConversionsPage = lazy(() => import("@/pages/ConversionsPage"));
const McpServerPage = lazy(() => import("@/pages/McpServerPage"));
const ErrorLogPage = lazy(() => import("@/pages/ErrorLogPage"));
const BackgroundPipelinePage = lazy(() => import("@/pages/BackgroundPipelinePage"));
const PrivateOverlays = lazy(() => import("@/pages/PrivateOverlays"));

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

function SyncLogRedirect() {
  const search = typeof window !== "undefined" ? window.location.search : "";
  if (typeof window !== "undefined") {
    window.location.replace(`/private/repository-sync${search}`);
  }
  return null;
}

function BlogManageRedirect() {
  const search = typeof window !== "undefined" ? window.location.search : "";
  if (typeof window !== "undefined") {
    window.location.replace(`/private/type/blog${search}`);
  }
  return null;
}

function SeoGeoRedirect() {
  if (typeof window !== "undefined") {
    window.location.replace("/private/diagnostics/seo");
  }
  return null;
}

function PrivateStaffGate({ children }: { children: ReactNode }) {
  const [pathname] = useLocation();
  const { isLoading, isValidated, hasToken } = useDebugAuth();
  const access = resolvePrivatePageAccess({
    pathname,
    isDebugMode: isDebugModeActive(),
    isLoading,
    isValidated,
    hasToken,
    hasCachedStaffSession: !!getDebugToken(),
  });
  if (access === "deny") return <NotFound />;
  if (access === "pending") return <LoadingFallback />;
  return <>{children}</>;
}

export default function PrivateRouter() {
  return (
    <PrivateStaffGate>
      <Suspense fallback={<LoadingFallback />}>
        <Switch>
          <Route path="/private/component" component={ComponentGallery} />
          <Route path="/private/component-showcase" component={ComponentShowcase} />
          <Route path="/private/component-showcase/:componentType" component={ComponentShowcase} />
          <Route path="/private/component-showcase/:componentType/preview" component={ComponentPreview} />
          <Route path="/private/entry-preview-frame/:contentType/:slug" component={EntryPreviewFrame} />
          <Route path="/private/blog" component={BlogManageRedirect} />
          <Route path="/private/type/:contentType" component={ContentTypeManagePage} />
          <Route path="/private/databases" component={PrivateDatabases} />
          <Route path="/private/databases/:name" component={PrivateDatabases} />
          <Route path="/private/diagnostics/seo-geo" component={SeoGeoRedirect} />
          <Route path="/private/diagnostics/:tab" component={DiagnosticsPage} />
          <Route path="/private/diagnostics" component={DiagnosticsPage} />
          <Route path="/private/redirects" component={PrivateRedirects} />
          <Route path="/private/media-gallery" component={MediaGallery} />
          <Route path="/private/menu-editor/:menuName" component={MenuEditor} />
          <Route path="/private/molecules-showcase" component={MoleculesShowcase} />
          <Route path="/private/preview/:contentType/:slug" component={PrivatePreview} />
          <Route path="/private/ai-knowledge" component={AIKnowledge} />
          <Route path="/private/ai-knowledge-blocks" component={AIKnowledgeBlocks} />
          <Route path="/private/ai-conversations" component={AIConversations} />
          <Route path="/private/settings/ai/llms" component={AISettingsPage} />
          <Route path="/private/settings/ai/qdrant" component={AISettingsPage} />
          <Route path="/private/settings/ai" component={AISettingsPage} />
          <Route path="/private/settings/seo/og" component={SeoGeoSettingsPage} />
          <Route path="/private/settings/seo/schema" component={SeoGeoSettingsPage} />
          <Route path="/private/settings/seo/search-console" component={SeoGeoSettingsPage} />
          <Route path="/private/settings/seo" component={SeoGeoSettingsPage} />
          <Route path="/private/settings" component={SettingsPage} />
          <Route path="/private/sync-log" component={SyncLogRedirect} />
          <Route path="/private/repository-sync" component={SyncLogPage} />
          <Route path="/private/cloud-sync" component={CloudSyncPage} />
          <Route path="/private/theme-editor" component={ThemeEditor} />
          <Route path="/private/component-insights" component={ComponentInsightsPage} />
          <Route path="/private/store/products" component={StoreProductsPage} />
          <Route path="/private/store/ecommerce" component={StoreEcommercePage} />
          <Route path="/private/store/product/:slug" component={StoreProductDetailPage} />
          <Route path="/private/store/conversions" component={ConversionsPage} />
          <Route path="/private/tracking/sgtm" component={TrackingPage} />
          <Route path="/private/tracking/ipn" component={TrackingPage} />
          <Route path="/private/tracking" component={TrackingPage} />
          <Route path="/private/security/roles" component={SecurityPage} />
          <Route path="/private/security/users" component={SecurityPage} />
          <Route path="/private/security/auth" component={SecurityPage} />
          <Route path="/private/security/captcha" component={SecurityPage} />
          <Route path="/private/security" component={SecurityPage} />
          <Route path="/private/mcp-server" component={McpServerPage} />
          <Route path="/private/error-log" component={ErrorLogPage} />
          <Route path="/private/background-pipeline" component={BackgroundPipelinePage} />
          <Route path="/private/overlays" component={PrivateOverlays} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </PrivateStaffGate>
  );
}
