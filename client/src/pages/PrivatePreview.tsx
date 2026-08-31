import { useState, useEffect, lazy, Suspense, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useSearch, useLocation } from "wouter";
import { SectionRenderer } from "@/components/SectionRenderer";
import { apiFetch } from "@/lib/queryClient";
import { normalizeContentType, useContentTypesRaw } from "@/hooks/useContentTypes";
import type { CareerProgram, LandingPage, LocationPage, TemplatePage } from "@shared/schema";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useSchemaOrg } from "@/hooks/useSchemaOrg";
import { useContentAutoRefresh } from "@/hooks/useContentAutoRefresh";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import LazyRender from "@/components/LazyRender";
import MenuSlotPlaceholder from "@/components/editing/MenuSlotPlaceholder";
import { MenuVisualContextProvider } from "@/contexts/MenuVisualContext";
import { useMenuConfig } from "@/hooks/useMenuConfig";
import { getMenuChromeHeights } from "@/lib/menuChrome";
import { restoreEditModeScrollPosition } from "@/lib/editModeScroll";
import { useScrollToLocationHashWhenReady } from "@/hooks/useScrollToLocationHashWhenReady";
import { useEditModeOptional } from "@/contexts/EditModeContext";
import { DevicePreviewShell } from "@/components/editing/DevicePreviewShell";
import Staff404Layout from "@/components/editing/Staff404Layout";
import Staff404VariantModal, { type Staff404VariantOption } from "@/components/editing/Staff404VariantModal";
import { isPreviewListingSharedTemplate, isSharedLayoutType } from "@/lib/sharedLayoutEntry";
import { staff404PreviewHref } from "@/lib/staff404";

const RawFileEditorPanel = lazy(() => import("@/components/editing/RawFileEditorPanel"));

type ContentData = CareerProgram | LandingPage | LocationPage | TemplatePage;

type PreviewVariantOption = {
  variantSlug: string;
  locale: string;
  displayName: string;
  isPromoted: boolean;
  version: number | null;
};

type VariantsApiResponse = {
  variants: PreviewVariantOption[];
};

type VersioningLocaleData = {
  variants?: Array<{ slug: string; allocation: number }>;
};

type VersioningApiResponse = {
  isDraft?: boolean;
  hasLiveDefault?: boolean;
  versioningSlug?: string;
  liveByLocale?: Record<string, boolean>;
  versioning?: Record<string, VersioningLocaleData> | null;
  isSharedLayout?: boolean;
  detached?: boolean;
};

type PreviewVariantRow = PreviewVariantOption & {
  allocation: number | null;
};

// Only special-case types whose API path differs from their registry directory name.
// For all other known content types, the directory from the registry is used as the API path.
const STATIC_API_PATHS: Record<string, string> = {
  program: "career-programs",
};

export default function PrivatePreview() {
  const params = useParams<{ contentType: string; slug: string }>();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const [, navigate] = useLocation();
  
  const contentType = params.contentType!;
  const slug = params.slug;
  const variant = searchParams.get("variant");
  const version = searchParams.get("version");
  const locale = searchParams.get("locale") || "en";
  
  const { data: allContentTypes, isLoading: typesLoading } = useContentTypesRaw();

  const normalizedType = normalizeContentType(
    contentType,
    allContentTypes
      ? Object.fromEntries(allContentTypes.map(t => [t.name, { directory: t.directory, url_pattern: t.url_pattern }]))
      : undefined
  );

  const typeInfo = allContentTypes?.find(t => t.name === normalizedType);
  // For types with /api/{directory}/{slug} standalone endpoints, derive the path from the
  // registry directory instead of hardcoding it. Types without standalone endpoints (e.g. blog,
  // downloadable) are routed through the generic /api/content-pages endpoint below.
  const STANDALONE_ENDPOINT_TYPES = new Set(["landing", "location", "page"]);
  const staticApiPath =
    STATIC_API_PATHS[normalizedType] ??
    (STANDALONE_ENDPOINT_TYPES.has(normalizedType) ? typeInfo?.directory : undefined);
  const isValidContentType = !!typeInfo || !!staticApiPath;
  const typeLabel = typeInfo?.label || normalizedType.charAt(0).toUpperCase() + normalizedType.slice(1);

  const [showRawEditor, setShowRawEditor] = useState(false);
  const [variantModal, setVariantModal] = useState<"templates" | "entry" | null>(null);

  const editMode = useEditModeOptional();
  const isDeviceShell = !!editMode?.isEditMode && editMode.previewBreakpoint === "mobile";

  const { data: content, isLoading, error, refetch } = useQuery<ContentData>({
    queryKey: ["/api/preview", normalizedType, slug, variant, version, locale],
    queryFn: async ({ signal }) => {
      let url: string;
      if (staticApiPath) {
        url = `/api/${staticApiPath}/${slug}?locale=${locale}`;
      } else {
        url = `/api/content-pages/${normalizedType}/${slug}?locale=${locale}`;
      }
      if (variant) url += `&force_variant=${variant}`;
      if (version) url += `&force_version=${version}`;

      // Bound the wait so a hung fetch cannot leave the page on "Loading…" forever.
      const timeoutMs = 20_000;
      const timeoutCtrl = new AbortController();
      const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs);
      const onAbort = () => timeoutCtrl.abort();
      signal?.addEventListener("abort", onAbort);
      try {
        const response = await apiFetch(url, { signal: timeoutCtrl.signal });
        if (!response.ok) {
          throw new Error("Content not found");
        }
        return response.json();
      } catch (err) {
        if (timeoutCtrl.signal.aborted && !signal?.aborted) {
          throw new Error(`Timed out loading ${normalizedType} preview`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    },
    enabled: !!slug && isValidContentType && !typesLoading && !isDeviceShell,
  });

  const contentMissing = !!error || !content;
  const recoveryEnabled = !!slug && isValidContentType && !typesLoading && !isLoading && contentMissing && !isDeviceShell;

  const { data: rawFileCheck } = useQuery<{ exists: boolean }>({
    queryKey: ["/api/content/raw-file", normalizedType, slug, locale],
    queryFn: async () => {
      const res = await fetch(`/api/content/raw-file?contentType=${normalizedType}&slug=${slug}&locale=${locale}`);
      if (!res.ok) return { exists: false };
      const data = await res.json();
      return { exists: !!data.exists };
    },
    enabled: recoveryEnabled,
  });

  const { data: versioningInfo } = useQuery<VersioningApiResponse | null>({
    queryKey: ["/api/versioning", normalizedType, slug],
    queryFn: async () => {
      const res = await fetch(`/api/versioning/${encodeURIComponent(normalizedType)}/${encodeURIComponent(slug!)}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: recoveryEnabled,
  });

  const versioningSlug = versioningInfo?.versioningSlug || slug;

  const { data: variantsInfo, isLoading: variantsLoading } = useQuery<VariantsApiResponse | null>({
    queryKey: ["/api/variants", normalizedType, versioningSlug],
    queryFn: async () => {
      const res = await fetch(`/api/variants/${encodeURIComponent(normalizedType)}/${encodeURIComponent(versioningSlug!)}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: recoveryEnabled && !!versioningSlug,
  });

  const availableVariants = useMemo((): PreviewVariantRow[] => {
    const list = variantsInfo?.variants ?? [];
    const versioning = versioningInfo?.versioning ?? null;

    const allocationFor = (option: PreviewVariantOption): number | null => {
      const localeData = versioning?.[option.locale];
      if (!localeData) {
        // No versioning file: live is 100%, named files are unpublished (0%).
        if (option.isPromoted) return 100;
        return 0;
      }
      const variants = localeData.variants ?? [];
      if (option.isPromoted) {
        const sum = variants.reduce((s, v) => s + (v.allocation ?? 0), 0);
        return Math.max(0, 100 - sum);
      }
      const match = variants.find((v) => v.slug === option.variantSlug);
      return match?.allocation ?? 0;
    };

    return list
      .map((option) => ({
        ...option,
        allocation: allocationFor(option),
      }))
      .sort((a, b) => {
        if (a.isPromoted !== b.isPromoted) return a.isPromoted ? -1 : 1;
        if (a.locale !== b.locale) return a.locale.localeCompare(b.locale);
        const allocA = a.allocation ?? -1;
        const allocB = b.allocation ?? -1;
        if (allocA !== allocB) return allocB - allocA;
        return a.variantSlug.localeCompare(b.variantSlug);
      });
  }, [variantsInfo, versioningInfo]);

  const isDraftOnly =
    !!versioningInfo?.isDraft ||
    versioningInfo?.hasLiveDefault === false ||
    (availableVariants.length > 0 && !availableVariants.some((v) => v.isPromoted));
  const listingSharedTemplate =
    isPreviewListingSharedTemplate(versioningInfo) ||
    (recoveryEnabled && versioningInfo === undefined && isSharedLayoutType(typeInfo));

  const openVariantPreview = (option: Staff404VariantOption) => {
    navigate(
      staff404PreviewHref({
        contentType: normalizedType,
        slug: slug!,
        listingSharedTemplate,
        option: {
          locale: option.locale || locale,
          isPromoted: option.isPromoted,
          variantSlug: option.variantSlug,
          version: option.version,
        },
      }),
    );
  };

  usePageMeta(content?.meta, locale);
  useSchemaOrg(content?.schema);

  const handleRefetch = () => {
    refetch();
  };

  useEffect(() => {
    if (!content || isLoading) return;
    restoreEditModeScrollPosition();
  }, [content, isLoading]);

  useScrollToLocationHashWhenReady(!!content && !isLoading);

  useEffect(() => {
    if (!content || isLoading) return;
    const contentLocale = (content as Record<string, unknown>).locale;
    if (typeof contentLocale === "string" && contentLocale && contentLocale !== locale) {
      const url = new URL(window.location.href);
      url.searchParams.set("locale", contentLocale);
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }, [content, isLoading, locale]);

  useContentAutoRefresh(
    normalizedType,
    slug,
    locale,
    handleRefetch
  );

  const {
    topMenuId,
    bottomMenuId,
    topMenuConfig,
    isTopMenuLoading,
    sectionBackgroundOverlapsMenu,
  } = useMenuConfig({ layout: (content as any)?.layout as { menu?: { top?: string | null; bottom?: string | null } } | undefined, locale });
  const topChromeHeights = getMenuChromeHeights(topMenuConfig);

  if (isDeviceShell) {
    return <DevicePreviewShell />;
  }

  if (typesLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" data-testid="loading-preview">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Loading preview...</p>
        </div>
      </div>
    );
  }

  if (!isValidContentType) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4" data-testid="error-invalid-type">
        <div className="w-full max-w-lg">
          <Staff404Layout
            surface="privatePreview"
            typeLabel={typeLabel}
            contentType={contentType}
            isValidType={false}
            staffOrEditMode
          />
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" data-testid="loading-preview">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">
            Loading {typeLabel.toLowerCase()} preview...
          </p>
        </div>
      </div>
    );
  }

  if (error || !content) {
    const requestedVariantMissing =
      !!variant &&
      availableVariants.length > 0 &&
      !availableVariants.some(
        (v) => !v.isPromoted && v.variantSlug === variant && v.locale === locale,
      );
    const variantsPending = variantsLoading || (recoveryEnabled && versioningInfo === undefined);

    return (
      <>
        <div className="min-h-screen flex items-center justify-center bg-background px-4" data-testid="error-preview">
          <div className="w-full max-w-lg">
            <Staff404Layout
              surface="privatePreview"
              typeLabel={typeLabel}
              slug={slug}
              contentType={normalizedType}
              isValidType
              listingSharedTemplate={listingSharedTemplate}
              isDraftOnly={isDraftOnly}
              hasEntryVariants={!listingSharedTemplate && availableVariants.length > 0}
              variantsLoading={variantsPending}
              hasTemplateVariants={listingSharedTemplate && availableVariants.length > 0}
              requestedVariantMissing={requestedVariantMissing}
              requestedVariant={variant}
              locale={locale}
              yamlExists={!!rawFileCheck?.exists}
              staffOrEditMode
              onEditYaml={() => setShowRawEditor(true)}
              onEditTemplates={() => setVariantModal("templates")}
              onOpenDraft={() => setVariantModal("entry")}
            />
          </div>
        </div>
        <Staff404VariantModal
          open={variantModal !== null}
          onOpenChange={(open) => {
            if (!open) setVariantModal(null);
          }}
          mode={variantModal === "templates" ? "templates" : "entry"}
          typeLabel={typeLabel}
          typeDirectory={typeInfo?.directory || normalizedType}
          variants={availableVariants}
          onSelect={(option) => {
            setVariantModal(null);
            openVariantPreview(option);
          }}
        />
        {showRawEditor && (
          <Suspense fallback={null}>
            <RawFileEditorPanel
              contentType={normalizedType}
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

  const pageDetached = !!(content as { detached?: boolean }).detached;
  const isSharedLayout = !!(typeInfo?.has_database || typeInfo?.single_template);
  const isSharedTemplate = isSharedLayout && !pageDetached;
  const isDetached = isSharedLayout && pageDetached;

  return (
    <div data-testid={`preview-${contentType}-${slug}`}>
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
            currentMenuId={topMenuId}
            contentType={normalizedType}
            slug={slug!}
            locale={locale}
            onMenuChange={() => refetch()}
            isSharedTemplate={isSharedTemplate}
            isDetached={isDetached}
          />
        </div>
        <SectionRenderer 
          sections={content.sections} 
          contentType={normalizedType}
          slug={slug}
          locale={locale}
          variant={variant ?? undefined}
          version={version ? Number(version) : undefined}
          isSharedTemplate={isSharedTemplate}
          singleEntry={(content as any).singleEntry}
          meta={(content as any).meta}
          param={(content as any).param}
          allowEntryStructuralOverrides={!isSharedLayout || pageDetached}
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
          currentMenuId={bottomMenuId}
          contentType={normalizedType}
          slug={slug!}
          locale={locale}
          onMenuChange={() => refetch()}
          isSharedTemplate={isSharedTemplate}
          isDetached={isDetached}
        />
      </div>
    </div>
  );
}
