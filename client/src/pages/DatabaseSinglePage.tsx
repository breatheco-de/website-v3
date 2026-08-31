import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { IS_SERVER } from "@/lib/initialData";
import { useLocation } from "wouter";
import { SectionRenderer } from "@/components/SectionRenderer";
import { apiFetch } from "@/lib/queryClient";
import type { TemplatePage } from "@shared/schema";
import { getApiPath } from "@shared/api-paths";
import { useContentTypesRaw } from "@/hooks/useContentTypes";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useSchemaOrg } from "@/hooks/useSchemaOrg";
import { useContentAutoRefresh } from "@/hooks/useContentAutoRefresh";
import { useAlternateUrls } from "@/hooks/useAlternateUrls";
import { useScrollToLocationHashWhenReady } from "@/hooks/useScrollToLocationHashWhenReady";
import { useVariableDefinitions, useVariableContext } from "@/hooks/useVariables";
import { resolveDeep } from "@/lib/variable-manager";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import LazyRender from "@/components/LazyRender";
import MenuSlotPlaceholder from "@/components/editing/MenuSlotPlaceholder";
import { MenuVisualContextProvider } from "@/contexts/MenuVisualContext";
import { useMenuConfig } from "@/hooks/useMenuConfig";
import { getMenuChromeHeights } from "@/lib/menuChrome";
import LocaleUnavailable, {
  type LocaleUnavailableInfo,
} from "@/components/LocaleUnavailable";
import Staff404Recovery, { Staff404SwitchToEditHint } from "@/components/editing/Staff404Recovery";
import { useEditModeOptional } from "@/contexts/EditModeContext";

interface DatabaseSinglePageProps {
  contentType: string;
}

export default function DatabaseSinglePage({ contentType }: DatabaseSinglePageProps) {
  const [location] = useLocation();
  const locale = location.startsWith("/es") ? "es" : "en";
  const { menuConfig: defaultHeaderMenuConfig, isLoading: isDefaultHeaderLoading } = useMenuConfig("main-navbar", locale);

  const segments = location.split("?")[0].split("/").filter(Boolean);
  const slug = segments[segments.length - 1] || "";
  const _searchParams = new URLSearchParams(location.split("?")[1] ?? "");
  const variantFromUrl = _searchParams.get("force_variant") ?? _searchParams.get("variant") ?? undefined;

  const { data: contentTypesData } = useContentTypesRaw();
  const contentTypeInfo = contentTypesData?.find((ct) => ct.name === contentType);
  const typeLabel = contentTypeInfo?.label || contentType.charAt(0).toUpperCase() + contentType.slice(1);
  const editMode = useEditModeOptional();
  const isStaff = !!editMode?.isEditMode;
  // Default to database-backed until content types load (matches historical behavior);
  // once loaded, static types are fetched from the content-pages endpoint instead.
  const isDbBacked = contentTypeInfo ? contentTypeInfo.has_database : true;
  const isSharedLayout = contentTypeInfo
    ? !!(contentTypeInfo.has_database || contentTypeInfo.single_template)
    : true;
  const staticApiPath = getApiPath(contentType);

  const {
    data: page,
    isLoading,
    error,
    refetch,
    failureReason,
  } = useQuery<TemplatePage>({
    queryKey: isDbBacked
      ? ["/api/database-single", contentType, slug, locale]
      : [staticApiPath, slug, locale],
    queryFn: async () => {
      const url = isDbBacked
        ? `/api/database-single/${contentType}/${slug}?locale=${locale}`
        : `${staticApiPath}/${slug}?locale=${locale}`;
      const response = await apiFetch(url);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        if (body?.error === "locale_unavailable" || body?.code === "EMPTY_LOCALE") {
          const err = new Error("locale_unavailable") as Error & {
            localeUnavailable?: LocaleUnavailableInfo;
          };
          err.localeUnavailable = body;
          throw err;
        }
        throw new Error("Page not found");
      }
      return response.json();
    },
    enabled: !!slug && contentTypesData !== undefined,
  });

  const localeUnavailable =
    (failureReason as (Error & { localeUnavailable?: LocaleUnavailableInfo }) | null)
      ?.localeUnavailable ||
    ((page as { locale_unavailable?: boolean } | undefined)?.locale_unavailable
      ? (page as unknown as LocaleUnavailableInfo)
      : null);

  const pageDetached = !!(page as { detached?: boolean } | undefined)?.detached;
  const isSharedTemplate = isSharedLayout && !pageDetached;
  const allowEntryStructuralOverrides = !isSharedLayout || pageDetached;

  const { data: varDefinitions } = useVariableDefinitions();
  const varContext = useVariableContext();

  const resolvedMeta = (() => {
    if (!page?.meta) return undefined;
    const singleEntry = page.singleEntry;
    if (!singleEntry && (!varDefinitions || Object.keys(varDefinitions).length === 0)) return page.meta;
    const { data } = resolveDeep(page.meta, varDefinitions || {}, varContext, { singleEntry });
    return data as typeof page.meta;
  })();

  const resolvedSchema = (() => {
    if (!page?.schema) return undefined;
    const singleEntry = page.singleEntry;
    if (!singleEntry && (!varDefinitions || Object.keys(varDefinitions).length === 0)) return page.schema;
    const { data } = resolveDeep(page.schema, varDefinitions || {}, varContext, { singleEntry });
    return data as typeof page.schema;
  })();

  const alternates = useAlternateUrls(location);
  const metaWithAlternates = resolvedMeta ? { ...resolvedMeta, alternates } : undefined;
  usePageMeta(metaWithAlternates, locale);
  useSchemaOrg(resolvedSchema);

  const handleRefetch = () => {
    refetch();
  };

  useContentAutoRefresh(contentType, slug, locale, handleRefetch);

  useScrollToLocationHashWhenReady(!!page && !isLoading);

  const {
    topMenuId,
    bottomMenuId,
    topMenuConfig,
    isTopMenuLoading,
    sectionBackgroundOverlapsMenu,
  } = useMenuConfig({ layout: (page as any)?.layout, locale });
  const topChromeHeights = getMenuChromeHeights(topMenuConfig);

  if (isLoading && !IS_SERVER) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        data-testid="loading-database-single"
      >
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (localeUnavailable) {
    return <LocaleUnavailable info={localeUnavailable} pageLocale={locale} />;
  }

  if (error || !page) {
    return (
      <div data-testid="error-database-single">
        <Header menuConfig={defaultHeaderMenuConfig} isLoading={isDefaultHeaderLoading} />
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center w-full max-w-lg px-4">
            <h1 className="text-2xl font-bold text-foreground mb-2">
              {locale === "es" ? "Página no encontrada" : "Page not found"}
            </h1>
            {!isStaff && (
              <div data-testid="text-404-description">
                <p className="text-muted-foreground">
                  {locale === "es"
                    ? "La página que buscas no existe."
                    : "The page you're looking for doesn't exist."}
                </p>
                <Staff404SwitchToEditHint locale={locale} contentType={contentType} slug={slug} />
              </div>
            )}
            <Staff404Recovery
              surface="databaseSingle"
              typeLabel={typeLabel}
              slug={slug}
              contentType={contentType}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid={`page-${contentType}-${slug}`}>
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
            contentType={contentType}
            slug={slug}
            locale={locale}
            onMenuChange={() => refetch()}
            isSharedTemplate={isSharedTemplate}
            isDetached={isSharedLayout && pageDetached}
          />
        </div>
        <SectionRenderer
          sections={page.sections}
          settings={page.settings}
          contentType={contentType}
          slug={slug}
          locale={locale}
          variant={variantFromUrl}
          isSharedTemplate={isSharedTemplate}
          singleEntry={page.singleEntry}
          meta={page.meta as Record<string, unknown> | undefined}
          param={(page as { param?: Record<string, unknown> }).param}
          allowEntryStructuralOverrides={allowEntryStructuralOverrides}
          perEntryRemovedSections={page.perEntryRemovedSections}
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
          contentType={contentType}
          slug={slug}
          locale={locale}
          onMenuChange={() => refetch()}
          isSharedTemplate={isSharedTemplate}
          isDetached={isSharedLayout && pageDetached}
        />
      </div>
    </div>
  );
}
