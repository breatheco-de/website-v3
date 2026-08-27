import React, { useState, useRef, useEffect, lazy, Suspense, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import type { ImageRef, ImageEntry, ImagePreset } from "@shared/schema";
import SolidCard from "./SolidCard";
import { BrokenImage, type BrokenImageReason } from "./BrokenImage";
import { useSectionContext } from "@/contexts/SectionContext";
import { useEditModeOptional } from "@/contexts/EditModeContext";
import { useContentTypes } from "@/hooks/useContentTypes";
import { detectContentInfo } from "@/components/DebugBubble/utils/debugHelpers";
import { Pencil, CheckCircle2, Clock, AlertCircle, Unlink, ExternalLink, ShieldCheck, Shield, ChevronDown } from "lucide-react";
import { editContent } from "@/lib/contentApi";
import { emitContentUpdated } from "@/lib/contentEvents";
import { resolveTemplateFallback } from "@/lib/variable-manager";
import { useToast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { queryClient } from "@/lib/queryClient";

const ImagePickerDialog = lazy(() =>
  import("@/components/editing/ImagePickerDialog").then((m) => ({
    default: m.ImagePickerDialog,
  })),
);

const DEFAULT_SRCSET_SIZES =
  "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw";

function firstPresetSizesFromImageEntry(
  imageEntry: { preset?: string[] } | null | undefined,
  presets: Record<string, { sizes?: string }> | undefined,
): string | undefined {
  if (!imageEntry?.preset?.length || !presets) return undefined;
  for (const name of imageEntry.preset) {
    const s = presets[name]?.sizes;
    if (typeof s === "string" && s.trim()) return s;
  }
  return undefined;
}

interface ImageRegistryData {
  presets: Record<string, ImagePreset>;
  images: Record<string, ImageEntry>;
}

export function useImageRegistry() {
  const { data, isLoading } = useQuery<ImageRegistryData>({
    queryKey: ["/api/image-registry"],
    staleTime: Infinity,
  });

  const registry = data ?? null;

  const reverseMap: Map<string, ImageEntry> = (() => {
    if (!registry?.images) return new Map();
    const map = new Map<string, ImageEntry>();
    for (const entry of Object.values(registry.images)) {
      if (entry.src) map.set(entry.src, entry);
    }
    return map;
  })();

  return { registry, loading: isLoading, reverseMap };
}

/** Visitor-facing (SSR) image subset for the current public page — edit-mode blank detection. */
export function useVisitorImageRegistry(opts: {
  contentType?: string;
  slug?: string;
  locale?: string;
  enabled?: boolean;
}) {
  const { contentType, slug, locale = "en", enabled = false } = opts;
  const { data, isLoading, isFetched } = useQuery<ImageRegistryData>({
    queryKey: ["/api/image-registry", "visitor-subset", contentType, slug, locale],
    queryFn: async () => {
      const params = new URLSearchParams({
        contentType: contentType!,
        slug: slug!,
        locale,
      });
      const res = await fetch(`/api/image-registry/visitor-subset?${params.toString()}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<ImageRegistryData>;
    },
    enabled: enabled && !!contentType && !!slug,
    staleTime: Infinity,
  });

  return {
    visitorSubset: data ?? null,
    visitorSubsetLoading: enabled && !!contentType && !!slug && isLoading,
    visitorSubsetReady: !enabled || !contentType || !slug || isFetched,
  };
}

interface FieldContext {
  fieldPath?: string;
  arrayPath?: string;
  index?: number;
  srcField?: string;
  templateKey?: string;
}

interface UniversalImageProps extends ImageRef {
  loading?: "lazy" | "eager";
  onLoad?: () => void;
  onError?: () => void;
  onImgRef?: (el: HTMLImageElement | null) => void;
  useSolidCard?: boolean;
  bordered?: boolean;
  style?: React.CSSProperties;
  fieldContext?: FieldContext;
  sizes?: string;
}

const ASPECT_RATIOS: Record<string, number> = {
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "4:3": 4 / 3,
  "3:4": 3 / 4,
  "1:1": 1,
  "21:9": 21 / 9,
};

function buildSrcsetString(srcset: Array<{ w: number; url: string }>): string {
  return srcset.map((s) => `${s.url} ${s.w}w`).join(", ");
}

export function UniversalImage({
  id,
  preset = "full",
  alt: altOverride,
  className = "",
  loading: loadingProp,
  onLoad,
  onError,
  onImgRef,
  useSolidCard = false,
  bordered = false,
  style,
  fieldContext,
  sizes: sizesProp,
}: UniversalImageProps) {
  const { registry, loading: registryLoading, reverseMap } = useImageRegistry();
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const imgRefCallback = (el: HTMLImageElement | null) => {
    (imgRef as React.MutableRefObject<HTMLImageElement | null>).current = el;
    onImgRef?.(el);
  };
  const {
    isPriority: isPrioritySection,
    sectionIndex,
    contentType: sectionContentType,
    slug: sectionSlug,
    locale: sectionLocale,
    imageSizes: sectionImageSizes,
    variableFields, variableKeys
  } = useSectionContext();
  const editModeCtx = useEditModeOptional();
  const isEditMode = editModeCtx?.isEditMode ?? false;
  // Capture iframes are /private/* and inherit edit-mode localStorage — hide chrome
  // so cache/override badges are not baked into OG / entry-preview WebPs.
  const isCaptureMode =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("capture") === "1";
  const showEditChrome = isEditMode && !isCaptureMode;
  const { toast } = useToast();

  // Non-blocking AI impression beacon (public pages only).
  useEffect(() => {
    if (showEditChrome || isCaptureMode) return;
    const registryId = id?.trim();
    if (!registryId || registryId.startsWith("/") || registryId.startsWith("http") || registryId.startsWith("data:")) {
      return;
    }
    const entry = registry?.images?.[registryId];
    if (!entry || (entry.origin !== "ai" && !entry.ai?.generated)) return;

    const el = imgRef.current;
    if (!el) return;

    let sent = false;
    const send = () => {
      if (sent) return;
      sent = true;
      const body = JSON.stringify({ id: registryId });
      try {
        if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
          const blob = new Blob([body], { type: "application/json" });
          navigator.sendBeacon("/api/media/impression", blob);
        } else {
          void fetch("/api/media/impression", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            keepalive: true,
          });
        }
      } catch {
        /* ignore */
      }
    };

    if (typeof IntersectionObserver === "undefined") {
      send();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          send();
          observer.disconnect();
        }
      },
      { threshold: 0.01 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [id, registry, showEditChrome, isCaptureMode, isLoaded]);

  const [pathname] = useLocation();
  const contentTypesMap = useContentTypes();
  const detectedContent = useMemo(
    () => detectContentInfo(pathname, contentTypesMap),
    [pathname, contentTypesMap],
  );
  const visitorContentType = sectionContentType || detectedContent.type || "";
  const visitorSlug = sectionSlug || detectedContent.slug || "";
  const visitorLocale =
    (sectionLocale && sectionLocale.trim()) ||
    (typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("locale") || undefined
      : undefined) ||
    "en";

  const { visitorSubset, visitorSubsetLoading, visitorSubsetReady } = useVisitorImageRegistry({
    contentType: visitorContentType,
    slug: visitorSlug,
    locale: visitorLocale,
    enabled: showEditChrome,
  });

  // Derive the template key from fieldContext + the section's _variableKeys map from context.
  // _variableKeys maps dotPath → templateKey (e.g. "image.src" → "image").
  // Explicit fieldContext.templateKey takes priority; otherwise auto-derive from the field path.
  const templateKey: string | undefined = (() => {
    if (fieldContext?.templateKey) return fieldContext.templateKey;
    if (!variableKeys) return undefined;
    let lookupPath: string | undefined;
    if (fieldContext?.fieldPath) {
      lookupPath = fieldContext.fieldPath;
    } else if (fieldContext?.arrayPath !== undefined && fieldContext?.index !== undefined && fieldContext?.srcField) {
      lookupPath = `${fieldContext.arrayPath}.${fieldContext.index}.${fieldContext.srcField}`;
    }
    if (!lookupPath) return undefined;
    return variableKeys[lookupPath];
  })();


  const { data: dbOverridesData } = useQuery<{ overrides: Record<string, unknown>; originals?: Record<string, unknown> }>({
    queryKey: ["/api/content-types", sectionContentType, "db-overrides", sectionSlug],
    queryFn: async () => {
      const res = await fetch(`/api/content-types/${sectionContentType}/db-overrides/${sectionSlug}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<{ overrides: Record<string, unknown>; originals?: Record<string, unknown> }>;
    },
    enabled: isEditMode && !!templateKey && !!sectionContentType && !!sectionSlug,
    staleTime: 0,
    refetchOnMount: false,
  });
  const dbOverrides = dbOverridesData?.overrides ?? {};
  const dbOriginals = dbOverridesData?.originals ?? {};
  const isOverridden = !!templateKey && templateKey in dbOverrides;

  const resolvedLoadingEarly: "lazy" | "eager" =
    loadingProp !== undefined
      ? loadingProp
      : isPrioritySection
        ? "eager"
        : "lazy";

  const isEager = resolvedLoadingEarly === "eager";

  useEffect(() => {
    setHasError(false);
    if (isEager) {
      return;
    }
    const img = imgRef.current;
    const alreadyCached = img && img.complete && img.naturalWidth > 0;
    if (alreadyCached) {
      setIsLoaded(true);
    } else {
      setIsLoaded(false);
    }
  }, [id, isEager]);

  const handleLoad = () => {
    setIsLoaded(true);
    onLoad?.();
  };

  const handleError = () => {
    setHasError(true);
    onError?.();
  };

  // In edit mode, patchVariableFieldHighlights rewrites template fields as
  // "{{ single.field | resolvedUrl }}" strings. If such a string reaches UniversalImage
  // as the `id` prop it is not a direct URL and not in the registry, so the component
  // returns null (silently hiding both the image and the override badge).
  // resolveTemplateFallback strips the {{ … }} wrapper and returns only the embedded URL.
  const resolvedId = resolveTemplateFallback(id ?? "");

  if (!resolvedId || !resolvedId.trim()) {
    return null;
  }

  const isDirectUrl =
    resolvedId.startsWith("/") ||
    resolvedId.startsWith("http://") ||
    resolvedId.startsWith("https://") ||
    resolvedId.startsWith("data:");

  if (!isDirectUrl && !isEager && (registryLoading || !registry || !registry.images)) {
    return (
      <div
        className={`bg-muted animate-pulse ${className}`}
        data-testid={`img-skeleton-${id}`}
      />
    );
  }

  if (showEditChrome && !isDirectUrl && visitorSubsetLoading) {
    return (
      <div
        className={`bg-muted animate-pulse ${className}`}
        data-testid={`img-skeleton-${id}`}
      />
    );
  }

  const imageEntry = registry?.images?.[resolvedId] ?? (isDirectUrl ? reverseMap.get(resolvedId) : undefined) ?? undefined;
  const isDirectPath = !imageEntry && isDirectUrl;

  const inVisitorSubset = (() => {
    if (isDirectUrl) return true;
    if (!visitorSubsetReady || !visitorSubset?.images) return true; // don't false-positive while unknown
    return !!visitorSubset.images[resolvedId];
  })();

  const renderBroken = (reason: BrokenImageReason) => (
    <BrokenImage id={resolvedId} reason={reason} className={className} style={style} />
  );

  if (!imageEntry && !isDirectPath) {
    if (showEditChrome) return renderBroken("unknown");
    return null;
  }

  // Id exists in the full gallery but would be blank on the public page
  if (showEditChrome && !isDirectUrl && visitorSubsetReady && visitorSubset && !inVisitorSubset) {
    return renderBroken("visitor-blank");
  }

  const presetConfig = registry?.presets?.[preset];
  const aspectRatio = presetConfig?.aspect_ratio
    ? ASPECT_RATIOS[presetConfig.aspect_ratio]
    : undefined;

  const finalAlt = altOverride || (imageEntry ? imageEntry.alt : resolvedId);
  const src = imageEntry ? imageEntry.src : resolvedId;

  const resolvedLoading = resolvedLoadingEarly;
  const fetchPriority: "high" | "auto" = (isPrioritySection || isEager) ? "high" : "auto";
  const decoding: "sync" | "async" = (isPrioritySection || isEager) ? "sync" : "async";

  const srcsetString =
    imageEntry?.srcset && imageEntry.srcset.length > 0
      ? buildSrcsetString(imageEntry.srcset)
      : undefined;


  const fromSchema =
    (fieldContext?.fieldPath && sectionImageSizes[fieldContext.fieldPath]) ||
    (fieldContext?.arrayPath && sectionImageSizes[fieldContext.arrayPath]) ||
    undefined;
  const fromRegistryImagePresets = firstPresetSizesFromImageEntry(
    imageEntry,
    registry?.presets,
  );
  const sizesString =
    sizesProp ??
    fromSchema ??
    fromRegistryImagePresets ??
    presetConfig?.sizes ??
    (srcsetString ? DEFAULT_SRCSET_SIZES : undefined);

  const intrinsicWidth = imageEntry?.width;
  const intrinsicHeight = imageEntry?.height;

  const containerStyle: React.CSSProperties = aspectRatio
    ? { aspectRatio: aspectRatio.toString() }
    : {};

  if (hasError) {
    if (showEditChrome) return renderBroken("load-failed");
    return null;
  }

  const borderClasses = bordered
    ? "border-2 border-muted-foreground/40 rounded-lg"
    : "";

  const hasFieldContext = !!(
    fieldContext?.fieldPath ||
    (fieldContext?.arrayPath !== undefined && fieldContext?.index !== undefined && fieldContext?.srcField)
  );
  const canReplace = showEditChrome && hasFieldContext && sectionIndex >= 0;

  type CacheStatus = "cached" | "pending" | "failed" | "untracked";
  const cacheStatus: CacheStatus = isDirectPath
    ? "untracked"
    : imageEntry?.failed_at
      ? "failed"
      : !imageEntry?.src && imageEntry?.source_url
        ? "pending"
        : imageEntry?.src
          ? "cached"
          : "untracked";

  const cacheStatusConfig: Record<CacheStatus, { icon: React.ReactNode; label: string; classes: string }> = {
    cached: {
      icon: <CheckCircle2 className="h-3 w-3" />,
      label: "Cached in registry",
      classes: "bg-green-600/90 text-white",
    },
    pending: {
      icon: <Clock className="h-3 w-3" />,
      label: "Pending download",
      classes: "bg-amber-500/90 text-white",
    },
    failed: {
      icon: <AlertCircle className="h-3 w-3" />,
      label: "Download failed",
      classes: "bg-red-600/90 text-white",
    },
    untracked: {
      icon: <Unlink className="h-3 w-3" />,
      label: "Not in image registry",
      classes: "bg-gray-500/90 text-white",
    },
  };

  const statusBadge = showEditChrome ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={`absolute bottom-1 right-1 z-10 flex items-center justify-center rounded-full p-1 shadow-sm ${cacheStatusConfig[cacheStatus].classes}`}
          data-testid={`badge-cache-status-${id}`}
          aria-label={cacheStatusConfig[cacheStatus].label}
        >
          {cacheStatusConfig[cacheStatus].icon}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {cacheStatusConfig[cacheStatus].label}
      </TooltipContent>
    </Tooltip>
  ) : null;

  const overrideBadge = showEditChrome && !!templateKey ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={`absolute top-1 left-1 z-10 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium shadow-sm ${
            isOverridden
              ? "bg-green-600/90 text-white"
              : "bg-muted/90 text-muted-foreground"
          }`}
          data-testid={`badge-override-status-${id}`}
          aria-label={isOverridden ? "Image overridden by editor" : "Image using template default"}
        >
          {isOverridden ? (
            <ShieldCheck className="h-3 w-3 shrink-0" />
          ) : (
            <Shield className="h-3 w-3 shrink-0" />
          )}
          {isOverridden ? "Overridden" : "Default"}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {isOverridden
          ? `Custom image set by an editor (key: ${templateKey})`
          : `Still using the template default (key: ${templateKey})`}
      </TooltipContent>
    </Tooltip>
  ) : null;

  const handleEditClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPickerOpen(true);
  };

  const handlePickerSave = async (pickedSrc: string, _alt: string, registryId: string | undefined) => {
    if (sectionIndex < 0 || !sectionContentType || !sectionSlug || !sectionLocale) {
      toast({ title: "Cannot save", description: "Missing section context", variant: "destructive" });
      throw new Error("Missing section context");
    }

    let path: string | null = null;
    if (fieldContext?.fieldPath) {
      path = `sections.${sectionIndex}.${fieldContext.fieldPath}`;
    } else if (fieldContext?.arrayPath !== undefined && fieldContext?.index !== undefined && fieldContext?.srcField) {
      path = `sections.${sectionIndex}.${fieldContext.arrayPath}.${fieldContext.index}.${fieldContext.srcField}`;
    }

    if (!path) {
      toast({ title: "Cannot save", description: "No field path configured for this image", variant: "destructive" });
      throw new Error("No field path configured");
    }

    const isIdField = fieldContext?.srcField?.endsWith("_id") ?? false;
    const valueToSave = isIdField && registryId ? registryId : pickedSrc;

    const result = await editContent({
      contentType: sectionContentType,
      slug: sectionSlug,
      locale: sectionLocale,
      operations: [{ action: "update_field", path, value: valueToSave }],
    });

    if (result.success) {
      emitContentUpdated({ contentType: sectionContentType, slug: sectionSlug, locale: sectionLocale });
      toast({ title: "Image updated" });

      // Auto-enqueue external URLs for WebP optimization if not already in the registry
      if (!registryId && /^https?:\/\//.test(valueToSave)) {
        fetch("/api/image-registry/enqueue-external", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: valueToSave, tag: "manual" }),
        }).catch(() => {});
      }
    } else {
      throw new Error(result.error ?? "Save failed");
    }
  };

  const handleResetOverride = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!sectionContentType || !sectionSlug || !templateKey) return;
    try {
      const res = await fetch(
        `/api/content-types/${sectionContentType}/db-overrides/${sectionSlug}?field=${encodeURIComponent(templateKey)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error(await res.text());
      await queryClient.invalidateQueries({
        queryKey: ["/api/content-types", sectionContentType, "db-overrides", sectionSlug],
      });
      emitContentUpdated({ contentType: sectionContentType, slug: sectionSlug, locale: sectionLocale ?? "" });
      toast({ title: "Image reset to original" });
    } catch (err) {
      toast({
        title: "Reset failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const editOverlay = canReplace ? (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center invisible group-hover/editimg:visible"
      data-edit-overlay="true"
    >
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative z-10 flex items-center gap-2">
        {/* Replace dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1.5 bg-white/90 text-gray-900 rounded-md px-2.5 py-1.5 text-xs font-medium shadow-md cursor-pointer"
              data-testid={`button-edit-image-${id}`}
              aria-label="Replace image"
              onClick={(e) => e.stopPropagation()}
            >
              <Pencil className="h-3 w-3" />
              Replace
              <ChevronDown className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem
              data-testid={`menu-item-choose-image-${id}`}
              onSelect={(e) => {
                (e as unknown as React.MouseEvent).stopPropagation?.();
                setPickerOpen(true);
              }}
            >
              Choose new image
            </DropdownMenuItem>
            {isOverridden && (
              <DropdownMenuItem
                data-testid={`menu-item-reset-image-${id}`}
                onSelect={(e) => {
                  handleResetOverride(e as unknown as React.MouseEvent);
                }}
              >
                Reset to original
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Open dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1.5 bg-white/90 text-gray-900 rounded-md px-2.5 py-1.5 text-xs font-medium shadow-md cursor-pointer"
              data-testid={`button-open-image-${id}`}
              aria-label="Open image"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="h-3 w-3" />
              Open
              <ChevronDown className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem
              data-testid={`menu-item-open-original-${id}`}
              onSelect={() => {
                const originalUrl = isOverridden && templateKey && dbOriginals[templateKey]
                  ? String(dbOriginals[templateKey])
                  : src;
                window.open(originalUrl, "_blank", "noopener,noreferrer");
              }}
            >
              Open original image
            </DropdownMenuItem>
            {isOverridden && (
              <DropdownMenuItem
                data-testid={`menu-item-open-override-${id}`}
                onSelect={() =>
                  window.open(String(dbOverrides[templateKey!]), "_blank", "noopener,noreferrer")
                }
              >
                Open override version
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  ) : null;

  const imageContent = (
    <div
      className={`relative overflow-hidden ${borderClasses} ${useSolidCard ? "" : className} ${canReplace ? "group/editimg" : ""}`}
      style={containerStyle}
      data-testid={`img-container-${id}`}
    >
      {!isEager && !isLoaded && (
        <div
          className="absolute inset-0 bg-muted animate-pulse"
          data-testid={`img-loading-${id}`}
        />
      )}
      <img
        ref={imgRefCallback}
        src={src}
        alt={finalAlt}
        loading={resolvedLoading}
        decoding={decoding}
        {...{ fetchpriority: fetchPriority }}
        {...(srcsetString ? { srcSet: srcsetString } : {})}
        {...(sizesString ? { sizes: sizesString } : {})}
        {...(intrinsicWidth ? { width: intrinsicWidth } : {})}
        {...(intrinsicHeight ? { height: intrinsicHeight } : {})}
        onLoad={handleLoad}
        onError={handleError}
        className={`w-full h-full ${
          isEager
            ? "opacity-100"
            : `transition-opacity duration-300 ${isLoaded ? "opacity-100" : "opacity-0"}`
        }`}
        style={{
          objectFit: style?.objectFit || "cover",
          objectPosition: style?.objectPosition || "center center",
          ...style,
        }}
        data-testid={`img-${id}`}
      />
      {overrideBadge}
      {statusBadge}
      {editOverlay}
    </div>
  );

  const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1;
  const renderedSize = imgRef.current
    ? { width: Math.round(imgRef.current.getBoundingClientRect().width * dpr), height: Math.round(imgRef.current.getBoundingClientRect().height * dpr) }
    : undefined;

  const pickerDialog = canReplace ? (
    <Suspense fallback={null}>
      <ImagePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="Replace Image"
        initialSrc={src}
        initialAlt={finalAlt}
        onSave={handlePickerSave}
        renderPreset={preset !== "full" ? preset : undefined}
        renderedSize={renderedSize}
      />
    </Suspense>
  ) : null;

  if (useSolidCard) {
    return (
      <>
        <SolidCard className={`!p-0 !min-h-0 overflow-hidden ${className}`}>
          {imageContent}
        </SolidCard>
        {pickerDialog}
      </>
    );
  }

  return (
    <>
      {imageContent}
      {pickerDialog}
    </>
  );
}

export default UniversalImage;
