import { lazy, Suspense, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { IS_SERVER } from "@/lib/initialData";
import { useParams, useLocation, useSearch } from "wouter";
import { useTranslation } from "react-i18next";
import { SectionRenderer } from "@/components/SectionRenderer";
import { apiFetch } from "@/lib/queryClient";
import type { TemplatePage } from "@shared/schema";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useSchemaOrg } from "@/hooks/useSchemaOrg";
import { useContentAutoRefresh } from "@/hooks/useContentAutoRefresh";
import { useAlternateUrls } from "@/hooks/useAlternateUrls";
import { useScrollToLocationHashWhenReady } from "@/hooks/useScrollToLocationHashWhenReady";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import LazyRender from "@/components/LazyRender";
import MenuSlotPlaceholder from "@/components/editing/MenuSlotPlaceholder";
import Staff404Recovery, { Staff404SwitchToEditHint } from "@/components/editing/Staff404Recovery";
import { MenuVisualContextProvider } from "@/contexts/MenuVisualContext";
import { useMenuConfig } from "@/hooks/useMenuConfig";
import { getMenuChromeHeights } from "@/lib/menuChrome";
import { normalizeFunnelBlock } from "@shared/funnel";
import { useEditModeOptional } from "@/contexts/EditModeContext";

const RawFileEditorPanel = lazy(() => import("@/components/editing/RawFileEditorPanel"));

export default function Page() {
  const [location, setLocation] = useLocation();
  const searchString = useSearch();
  const { i18n } = useTranslation();
  const localeMatch = location.split("?")[0].match(/^\/([a-z]{2}(?:-[a-z]{2})?)\//i);
  const locale = localeMatch ? localeMatch[1].toLowerCase() : "en";
  const i18nLocale = locale.split("-")[0];
  const params = useParams<{ slug: string }>();
  const slugFromPath = location.split("?")[0].replace(/^\/[a-z]{2}(?:-[a-z]{2})?\//i, "").split("/")[0] || "";
  const forceVariant = new URLSearchParams(searchString).get("force_variant") ?? undefined;

  const { data: homePageSettings } = useQuery<{ type: string; slug: string }>({
    queryKey: ["/api/settings/home-page"],
    staleTime: 60000,
  });
  const homeSlug = homePageSettings?.slug ?? "home";
  const slug = params.slug || slugFromPath || homeSlug;

  const [showRawEditor, setShowRawEditor] = useState(false);
  const editMode = useEditModeOptional();
  const isStaff = !!editMode?.isEditMode;

  useEffect(() => {
    if (i18n.language !== i18nLocale) {
      i18n.changeLanguage(i18nLocale);
    }
  }, [i18nLocale, i18n]);

  const { data: page, isPending, isLoading, error, refetch } = useQuery<TemplatePage>({
    queryKey: forceVariant
      ? ["/api/pages", slug, locale, forceVariant]
      : ["/api/pages", slug, locale],
    queryFn: async () => {
      const qs = new URLSearchParams({ locale });
      if (forceVariant) qs.set("force_variant", forceVariant);
      const response = await apiFetch(`/api/pages/${slug}?${qs}`);
      if (!response.ok) {
        throw new Error("Page not found");
      }
      return response.json();
    },
    enabled: !!slug,
  });

  const { data: rawFileCheck } = useQuery<{ exists: boolean }>({
    queryKey: ["/api/content/raw-file", "page", slug, locale],
    queryFn: async () => {
      const res = await fetch(`/api/content/raw-file?contentType=page&slug=${slug}&locale=${locale}`);
      if (!res.ok) return { exists: false };
      const data = await res.json();
      return { exists: !!data.exists };
    },
    enabled: !!slug && !!error,
  });

  useEffect(() => {
    if (page?.slug && page.slug !== slug) {
      const correctUrl = `/${locale}/${page.slug}`;
      setLocation(correctUrl, { replace: true });
    }
  }, [page?.slug, slug, locale, setLocation]);

  const alternates = useAlternateUrls(location);
  const metaWithAlternates = page?.meta ? { ...page.meta, alternates } : undefined;
  usePageMeta(metaWithAlternates, locale);
  useSchemaOrg(page?.schema);

  const handleRefetch = () => {
    refetch();
  };

  useContentAutoRefresh("page", slug, locale, handleRefetch);

  useScrollToLocationHashWhenReady(!!page && !isPending && !isLoading);

  const {
    topMenuId,
    bottomMenuId,
    topMenuConfig,
    isTopMenuLoading,
    sectionBackgroundOverlapsMenu,
  } = useMenuConfig({ layout: (page as any)?.layout, locale });
  const topChromeHeights = getMenuChromeHeights(topMenuConfig);

  if ((isPending || isLoading) && !IS_SERVER) {
    return (
      <div 
        className="min-h-screen flex items-center justify-center"
        data-testid="loading-page"
      >
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // During SSR, page data is not yet available for variant URLs or uncached pages.
  // Return null so the SSR HTML stays empty — the client will render correctly after hydration.
  if (IS_SERVER && !page && !error) {
    return null;
  }

  if (error || !page) {
    return (
      <>
        <div 
          className="min-h-screen flex items-center justify-center"
          data-testid="error-page"
        >
          <div className="text-center w-full max-w-lg px-4">
            <h1 className="text-2xl font-bold text-foreground mb-2">
              {locale === "es" ? "Página no encontrada" : "Page not found"}
            </h1>
            {!isStaff && (
              <div className="mb-4" data-testid="text-404-description">
                <p className="text-muted-foreground">
                  {locale === "es" 
                    ? "La página que buscas no existe." 
                    : "The page you're looking for doesn't exist."}
                </p>
                <Staff404SwitchToEditHint locale={locale} contentType="page" slug={slug} />
              </div>
            )}
            <Staff404Recovery
              yamlExists={!!rawFileCheck?.exists}
              onEditYaml={() => setShowRawEditor(true)}
            />
          </div>
        </div>
        {showRawEditor && (
          <Suspense fallback={null}>
            <RawFileEditorPanel
              contentType="page"
              slug={slug}
              locale={locale}
              onClose={() => setShowRawEditor(false)}
              onSaved={() => window.location.reload()}
            />
          </Suspense>
        )}
      </>
    );
  }

  return (
    <div data-testid={`page-${slug}`}>
      <MenuVisualContextProvider
        value={{
          sectionBackgroundOverlapsMenu,
          topChromeHeightDesktop: topChromeHeights.totalHeightDesktop,
          topChromeHeightMobile: topChromeHeights.totalHeightMobile,
        }}
      >
        <div className="group relative">
          {topMenuId && <Header menuConfig={topMenuConfig} isLoading={isTopMenuLoading} />}
          <MenuSlotPlaceholder
            position="top"
            currentMenuId={topMenuId ?? null}
            contentType="page"
            slug={slug}
            locale={locale}
            onMenuChange={() => refetch()}
          />
        </div>
        <SectionRenderer 
          sections={page.sections} 
          settings={page.settings}
          contentType="page"
          slug={slug}
          locale={locale}
          variant={forceVariant}
          singleEntry={page.singleEntry}
          meta={page.meta as Record<string, unknown> | undefined}
          param={(page as { param?: Record<string, unknown> }).param}
          funnel={normalizeFunnelBlock((page as Record<string, unknown>).funnel)}
        />
      </MenuVisualContextProvider>
      <div className="group relative">
        {bottomMenuId && (
          <LazyRender>
            <Footer menuId={bottomMenuId} />
          </LazyRender>
        )}
        <MenuSlotPlaceholder
          position="bottom"
          currentMenuId={bottomMenuId ?? null}
          contentType="page"
          slug={slug}
          locale={locale}
          onMenuChange={() => refetch()}
        />
      </div>
    </div>
  );
}
