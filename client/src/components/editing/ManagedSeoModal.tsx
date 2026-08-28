import { useState, useEffect, useCallback, useRef } from "react";
import { SeoModal, type SeoModalTab } from "@/components/DebugBubble/components/SeoModal";
import type { ContentInfo, SeoMeta, SeoLocation, SlugCheckStatus } from "@/components/DebugBubble/types";
import { useToast } from "@/hooks/use-toast";
import { getDebugToken, useDebugAuth } from "@/hooks/useDebugAuth";
import { useSeoModalSaves } from "@/hooks/useSeoModalSaves";
import { useContentTypes } from "@/hooks/useContentTypes";
import { normalizeLocale, buildContentUrlFromPattern } from "@/lib/locale";
import { computeDirtyMetaKeys, liveSnippetClearBlocked } from "@/lib/buildMetaSaveOperations";

export interface ManagedSeoModalTarget {
  contentType: string;
  slug: string;
  locale: string;
  /** When set, SEO reads/writes this variant file (draft or A/B). */
  variant?: string;
  initialTab?: SeoModalTab;
}

interface ManagedSeoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ManagedSeoModalTarget | null;
  onSaved?: () => void;
}

const EMPTY_SEO_META: SeoMeta = {
  page_title: "",
  description: "",
  og_image: "",
  canonical_url: "",
  robots: "",
  priority: "",
  change_frequency: "",
  redirects: [],
};

export function ManagedSeoModal({ open, onOpenChange, target, onSaved }: ManagedSeoModalProps) {
  const { toast } = useToast();
  const { hasCapability } = useDebugAuth();
  const contentTypesMap = useContentTypes();
  const canEditSeo = Boolean(
    target?.contentType && hasCapability("seo_edit", target.contentType),
  );

  const denySeoEdit = useCallback(async () => {
    toast({
      title: "Permission denied",
      description: `You need the seo_edit capability for content type "${target?.contentType ?? ""}".`,
      variant: "destructive",
    });
  }, [target?.contentType, toast]);

  const [seoLoading, setSeoLoading] = useState(false);
  const [seoData, setSeoData] = useState<{
    meta: Record<string, unknown>;
    liveMeta?: Record<string, unknown>;
    metaOverrides?: string[];
    context?: "live" | "variant";
    variant?: string;
    faqSchema: Record<string, unknown> | null;
    schemaOrg: Record<string, unknown>[];
    schemaOrgDocuments?: Array<{ schema: Record<string, unknown>; source: string }>;
    title: string;
    slug?: string;
  } | null>(null);
  const [seoMeta, setSeoMeta] = useState<SeoMeta>(EMPTY_SEO_META);
  const [seoLocations, setSeoLocations] = useState<string[]>([]);
  const [locationsBaseline, setLocationsBaseline] = useState<string[]>([]);
  const [seoAvailableLocations, setSeoAvailableLocations] = useState<SeoLocation[]>([]);
  const [seoLocationSearch, setSeoLocationSearch] = useState("");

  const [metaOverrides, setMetaOverrides] = useState<string[]>([]);
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
  const baselineMetaRef = useRef<SeoMeta>(EMPTY_SEO_META);
  const baselineLocationsRef = useRef<string[]>([]);

  const [newSlugValue, setNewSlugValue] = useState("");
  const [slugCheckStatus, setSlugCheckStatus] = useState<SlugCheckStatus>("idle");
  const [slugCheckReason, setSlugCheckReason] = useState<string | null>(null);
  const [slugRenaming, setSlugRenaming] = useState(false);
  const [slugRedirectPrompt, setSlugRedirectPrompt] = useState(false);
  const [slugOldUrl, setSlugOldUrl] = useState("");
  const [slugNewUrl, setSlugNewUrl] = useState("");

  const contentInfo: ContentInfo = {
    type: target?.contentType ?? null,
    slug: target?.slug ?? null,
    label: target?.slug ?? "SEO",
  };

  const locale = normalizeLocale(target?.locale || "en");
  const currentLocaleSlug = (seoData?.slug as string) || target?.slug || "";
  const seoContext = seoData?.context ?? (target?.variant ? "variant" : "live");
  const seoVariant = seoData?.variant ?? target?.variant;

  const applySeoMetaFromForm = useCallback((next: SeoMeta) => {
    setSeoMeta(next);
    setDirtyKeys(computeDirtyMetaKeys(next, baselineMetaRef.current));
  }, []);

  const fetchSeoPreview = useCallback(async () => {
    if (!target?.contentType || !target?.slug) return;
    setSeoLoading(true);
    setSeoData(null);
    try {
      const params = new URLSearchParams({ locale });
      if (target.variant) params.set("variant", target.variant);
      const res = await fetch(
        `/api/seo-preview/${encodeURIComponent(target.contentType)}/${encodeURIComponent(target.slug)}?${params}`,
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(
          (errData as { error?: string }).error || "Failed to fetch SEO data",
        );
      }
      const data = await res.json();
      setSeoData(data);
      const nextMeta: SeoMeta = {
        page_title: (data.meta?.page_title as string) || "",
        description: (data.meta?.description as string) || "",
        og_image: (data.meta?.og_image as string) || "",
        canonical_url: (data.meta?.canonical_url as string) || "",
        robots: (data.meta?.robots as string) || "",
        priority: data.meta?.priority != null ? String(data.meta.priority) : "",
        change_frequency: (data.meta?.change_frequency as string) || "",
        redirects: ((data.meta?.redirects as Array<string | { path: string; status?: number }>) || [])
          .map((r) => (typeof r === "string" ? r : r?.path))
          .filter((r): r is string => Boolean(r)),
      };
      baselineMetaRef.current = nextMeta;
      setSeoMeta(nextMeta);
      setMetaOverrides(Array.isArray(data.metaOverrides) ? data.metaOverrides : []);
      setDirtyKeys(new Set());
      const loadedLocations = (data.locations as string[]) || [];
      baselineLocationsRef.current = [...loadedLocations];
      setLocationsBaseline([...loadedLocations]);
      setSeoLocations(loadedLocations);
      setSeoAvailableLocations(
        (data.availableLocations as SeoLocation[]) || [],
      );
      setSeoLocationSearch("");
      setNewSlugValue(typeof data.slug === "string" && data.slug ? data.slug : target.slug);
      setSlugCheckStatus("idle");
      setSlugCheckReason(null);
      setSlugRedirectPrompt(false);
    } catch (error) {
      console.error("Error fetching SEO preview:", error);
      toast({
        title: "Failed to load SEO data",
        description:
          error instanceof Error ? error.message : "Could not fetch page SEO information.",
        variant: "destructive",
      });
    } finally {
      setSeoLoading(false);
    }
  }, [target?.contentType, target?.slug, target?.variant, locale, toast]);

  useEffect(() => {
    if (open && target) {
      fetchSeoPreview();
    }
  }, [open, target, fetchSeoPreview]);

  const saves = useSeoModalSaves({
    contentType: target?.contentType ?? null,
    slug: target?.slug ?? null,
    locale,
    seoContext,
    seoVariant,
    seoMeta,
    setSeoMeta,
    dirtyKeys,
    setDirtyKeys,
    baselineMetaRef,
    baselineLocationsRef,
    seoData,
    metaOverrides,
    onSaved,
    refetch: fetchSeoPreview,
  });

  useEffect(() => {
    if (!newSlugValue || !target?.contentType || newSlugValue === currentLocaleSlug) {
      setSlugCheckStatus("idle");
      setSlugCheckReason(null);
      return;
    }
    const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    if (!slugRegex.test(newSlugValue)) {
      setSlugCheckStatus("taken");
      setSlugCheckReason("Use only lowercase letters, numbers, and hyphens");
      return;
    }
    setSlugCheckStatus("available");
    setSlugCheckReason(null);
  }, [newSlugValue, target?.contentType, currentLocaleSlug]);

  const handleSlugRename = async (createRedirect: boolean) => {
    if (!target?.contentType || !target?.slug || !newSlugValue || slugCheckStatus !== "available") return;
    setSlugRenaming(true);
    setSlugRedirectPrompt(false);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const token = getDebugToken();
      if (token) headers["X-Debug-Token"] = token;
      const res = await fetch("/api/content/rename-slug", {
        method: "POST",
        headers,
        body: JSON.stringify({
          contentType: target.contentType,
          folderSlug: target.slug,
          locale,
          newSlug: newSlugValue,
          createRedirect,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to rename");
      }
      const result = await res.json();
      toast({
        title: "Slug renamed",
        description: `${result.oldSlug} → ${result.newSlug}${createRedirect ? " (redirect created)" : ""}`,
      });
      onOpenChange(false);
      onSaved?.();
    } catch (error) {
      toast({
        title: "Failed to rename slug",
        description: error instanceof Error ? error.message : "Could not rename content slug.",
        variant: "destructive",
      });
    } finally {
      setSlugRenaming(false);
    }
  };

  const handleSlugRenameClick = () => {
    if (!target?.contentType || !target?.slug || slugCheckStatus !== "available") return;
    const pattern = contentTypesMap?.[target.contentType]?.url_pattern;
    setSlugOldUrl(buildContentUrlFromPattern(pattern, currentLocaleSlug, locale));
    setSlugNewUrl(buildContentUrlFromPattern(pattern, newSlugValue, locale));
    setSlugRedirectPrompt(true);
  };

  return (
    <SeoModal
      open={open}
      onOpenChange={onOpenChange}
      contentInfo={contentInfo}
      seoLoading={seoLoading}
      seoData={seoData}
      seoMeta={seoMeta}
      setSeoMeta={applySeoMetaFromForm}
      seoLocations={seoLocations}
      setSeoLocations={setSeoLocations}
      seoAvailableLocations={seoAvailableLocations}
      seoLocationSearch={seoLocationSearch}
      setSeoLocationSearch={setSeoLocationSearch}
      baselineLocations={locationsBaseline}
      saving={saves.saving}
      onSaveLocations={async (locs) => {
        if (!canEditSeo) return denySeoEdit();
        await saves.saveLocations(locs);
        setLocationsBaseline([...locs]);
      }}
      onSaveVisibility={async () => {
        if (!canEditSeo) return denySeoEdit();
        return saves.saveVisibility();
      }}
      onRevertVisibility={() => {
        applySeoMetaFromForm({
          ...seoMeta,
          robots: baselineMetaRef.current.robots,
          priority: baselineMetaRef.current.priority,
          change_frequency: baselineMetaRef.current.change_frequency,
        });
      }}
      onSaveSnippet={async () => {
        if (!canEditSeo) return denySeoEdit();
        return saves.saveSnippet();
      }}
      onRevertSnippet={() => {
        applySeoMetaFromForm({
          ...seoMeta,
          page_title: baselineMetaRef.current.page_title,
          description: baselineMetaRef.current.description,
        });
      }}
      onSaveCanonical={async () => {
        if (!canEditSeo) return denySeoEdit();
        return saves.saveCanonical();
      }}
      onSaveOgImage={async (url: string) => {
        if (!canEditSeo) return denySeoEdit();
        return saves.saveOgImage(url);
      }}
      visibilityDirty={["robots", "priority", "change_frequency"].some((k) => dirtyKeys.has(k))}
      snippetDirty={["page_title", "description"].some((k) => dirtyKeys.has(k))}
      snippetSaveBlocked={
        saves.isLiveLocale &&
        liveSnippetClearBlocked(seoMeta, dirtyKeys)
      }
      canonicalDirty={dirtyKeys.has("canonical_url")}
      newSlugValue={newSlugValue}
      setNewSlugValue={setNewSlugValue}
      slugCheckStatus={slugCheckStatus}
      slugRenaming={slugRenaming}
      slugRedirectPrompt={slugRedirectPrompt}
      slugOldUrl={slugOldUrl}
      slugNewUrl={slugNewUrl}
      handleSlugRenameClick={handleSlugRenameClick}
      handleSlugRename={handleSlugRename}
      currentLocaleSlug={currentLocaleSlug}
      slugCheckReason={slugCheckReason}
      setSlugRedirectPrompt={setSlugRedirectPrompt}
      locale={locale}
      contentTypeLabel={
        target?.contentType
          ? target.contentType.charAt(0).toUpperCase() + target.contentType.slice(1)
          : undefined
      }
      initialTab={target?.initialTab}
      seoContext={seoContext}
      seoVariant={seoVariant}
      metaOverrides={metaOverrides}
    />
  );
}
