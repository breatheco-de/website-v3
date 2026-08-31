import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { IS_SERVER } from "@/lib/initialData";
import { useTranslation } from "react-i18next";
import { useLocation, useSearch } from "wouter";
import { apiFetch } from "@/lib/queryClient";
import { SectionRenderer } from "@/components/SectionRenderer";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useSchemaOrg } from "@/hooks/useSchemaOrg";
import { useContentAutoRefresh } from "@/hooks/useContentAutoRefresh";
import { useAlternateUrls } from "@/hooks/useAlternateUrls";
import { useScrollToLocationHashWhenReady } from "@/hooks/useScrollToLocationHashWhenReady";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import LazyRender from "@/components/LazyRender";
import MenuSlotPlaceholder from "@/components/editing/MenuSlotPlaceholder";
import { MenuVisualContextProvider } from "@/contexts/MenuVisualContext";
import { getApiPath } from "@shared/api-paths";
import { useMenuConfig } from "@/hooks/useMenuConfig";
import { getMenuChromeHeights } from "@/lib/menuChrome";

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface ContentTypeDetailProps {
  type: string;
  slug: string;
  locale: string;
  urlPattern?: Record<string, string>;
}

export default function ContentTypeDetail({ type, slug, locale, urlPattern }: ContentTypeDetailProps) {
  const { i18n } = useTranslation();
  const [currentLocation, setLocation] = useLocation();
  const searchString = useSearch();
  const forceVariant =
    new URLSearchParams(searchString).get("force_variant") ??
    new URLSearchParams(searchString).get("variant") ??
    undefined;
  const isNonLocalized = locale === "default";
  const requestLocale = isNonLocalized ? undefined : ((locale || (i18n.language as string) || "en"));
  const apiPath = getApiPath(type);

  const { data, isLoading, error, refetch } = useQuery<Record<string, unknown>>({
    queryKey: forceVariant
      ? [apiPath, slug, requestLocale ?? "auto", forceVariant]
      : [apiPath, slug, requestLocale ?? "auto"],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (requestLocale) qs.set("locale", requestLocale);
      if (forceVariant) qs.set("force_variant", forceVariant);
      const query = qs.toString();
      const response = await apiFetch(`${apiPath}/${slug}${query ? `?${query}` : ""}`);
      if (!response.ok) {
        throw new Error(`${type} not found`);
      }
      return response.json();
    },
    enabled: !!slug,
  });

  const effectiveLocale = (isNonLocalized && data?.locale)
    ? String(data.locale)
    : (requestLocale || (i18n.language as string) || "en");

  useEffect(() => {
    // For i18n, always use the base language (e.g. "es" for "es-mx") since translation
    // bundles only exist for base languages; regional variants share the same translations.
    const i18nLocale = effectiveLocale.split("-")[0];
    if (i18nLocale && i18n.language !== i18nLocale) {
      i18n.changeLanguage(i18nLocale);
    }
  }, [effectiveLocale, i18n]);

  useEffect(() => {
    if (data?.slug && data.slug !== slug && urlPattern) {
      const pattern = urlPattern[effectiveLocale] || urlPattern["default"] || urlPattern["en"];
      if (pattern) {
        let correctUrl = pattern.replace(":slug", String(data.slug));
        if (searchString) {
          correctUrl += correctUrl.includes("?") ? `&${searchString}` : `?${searchString}`;
        }
        setLocation(correctUrl, { replace: true });
      }
    }
  }, [data?.slug, slug, effectiveLocale, urlPattern, searchString, setLocation]);

  const alternates = useAlternateUrls(currentLocation);
  const metaWithAlternates = data?.meta ? { ...(data.meta as object), alternates } : undefined;
  usePageMeta(metaWithAlternates, effectiveLocale);
  useSchemaOrg(data?.schema);

  const handleRefetch = () => {
    refetch();
  };

  useContentAutoRefresh(type, slug, effectiveLocale, handleRefetch);

  useScrollToLocationHashWhenReady(!!data && !isLoading);

  const {
    topMenuId,
    bottomMenuId,
    topMenuConfig,
    isTopMenuLoading,
    sectionBackgroundOverlapsMenu,
  } = useMenuConfig({ layout: data?.layout as { menu?: { top?: string | null; bottom?: string | null } } | undefined, locale: effectiveLocale });
  const topChromeHeights = getMenuChromeHeights(topMenuConfig);

  if (isLoading && !IS_SERVER) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        data-testid={`loading-${type}`}
      >
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // force_variant URLs skip SSR initial data; avoid hydration mismatch (see initial-data-middleware).
  if (IS_SERVER && !data && !error) {
    return null;
  }

  if (error || !data) {
    const label = capitalize(type);
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        data-testid={`error-${type}`}
      >
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">
            {effectiveLocale === "es" ? `${label} no encontrado` : `${label} not found`}
          </h1>
          <p className="text-muted-foreground">
            {effectiveLocale === "es"
              ? `El ${type} que buscas no existe.`
              : `The ${type} you're looking for doesn't exist.`}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div data-testid={`page-${type}`}>
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
            contentType={type}
            slug={slug}
            locale={effectiveLocale}
            onMenuChange={() => refetch()}
          />
        </div>
        <SectionRenderer
          sections={(data.sections as any[]) || []}
          settings={data.settings}
          contentType={type}
          slug={slug}
          locale={effectiveLocale}
          variant={forceVariant}
          programSlug={type === "program" ? slug : undefined}
          singleEntry={data.singleEntry as Record<string, unknown> | undefined}
          meta={data.meta as Record<string, unknown> | undefined}
          param={data.param as Record<string, unknown> | undefined}
        />
      </MenuVisualContextProvider>
      <div className="group relative">
        {bottomMenuId && (
          <LazyRender>
            <div className="pb-12">
              <Footer menuId={bottomMenuId} />
            </div>
          </LazyRender>
        )}
        <MenuSlotPlaceholder
          position="bottom"
          currentMenuId={bottomMenuId ?? null}
          contentType={type}
          slug={slug}
          locale={effectiveLocale}
          onMenuChange={() => refetch()}
        />
      </div>
    </div>
  );
}
