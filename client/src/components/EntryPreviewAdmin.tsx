import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, Image, ImageOff, Loader2, Pencil, RefreshCw, Wand2, X, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import { useToast } from "@/hooks/use-toast";
import {
  ComponentPickerV2,
  type ComponentPickerV2Selection,
} from "@/components/editing/ComponentPickerV2";
import { SectionRenderer } from "@/components/SectionRenderer";
import {
  applyPreviewPropMappings,
  collectMappablePropsFromSchema,
  materializeOgPreviewReadingTime,
  PREVIEW_BRAND_SOURCE_OPTIONS,
  PREVIEW_META_SOURCE_OPTIONS,
  type PreviewPropDef,
} from "@shared/entry-preview-props";
import type { Section } from "@shared/schema";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const LIVE_PREVIEW_WIDTH = 1200;
const LIVE_PREVIEW_HEIGHT = 630;
const LIVE_PREVIEW_SCALE = 0.38;
/** How many entries to load for live-preview prev/next browsing (includes body for reading time). */
const LIVE_PREVIEW_SAMPLE_LIMIT = 50;
export interface ContentTypePreviewConfig {
  component: string;
  variant?: string;
  version?: string;
  theme?: "dark" | "light";
  widths?: number[];
  maxHeight?: number;
  dirty_on_prop_change?: boolean;
  /** Component data key (supports dotted paths like `left.heading`) → entry field name. */
  props?: Record<string, string>;
}

export interface EntryPreviewFailure {
  slug: string;
  locale: string;
  error: string;
  attempts?: number;
  failedAt?: string;
}

interface EntryPreviewStats {
  fromSource: number;
  generated: number;
  missing: number;
  dirty: number;
  failed: number;
  failures?: EntryPreviewFailure[];
  preview: boolean;
  captureReady?: boolean;
  captureReadyError?: string;
}

interface ComponentSchemaPayload {
  name?: string;
  props?: Record<string, PreviewPropDef>;
  /** Some schemas (e.g. ai_learning) use base_props instead of props. */
  base_props?: Record<string, PreviewPropDef>;
  variant_props?: Record<string, Record<string, PreviewPropDef>>;
}

interface ScreenshotIndexEntry {
  url: string;
  stale: boolean;
}

type ScreenshotIndex = Record<string, ScreenshotIndexEntry>;

interface RegistryOverview {
  components: Array<{ type: string; name: string }>;
}

const UNMAPPED = "__unmapped__";

function collectMappableProps(
  schema: ComponentSchemaPayload | undefined,
  variant: string,
): Array<{ key: string; required: boolean; description?: string }> {
  return collectMappablePropsFromSchema(schema, variant);
}

function coercePreviewScalar(value: unknown): string | undefined {
  if (typeof value === "string") {
    const t = value.trim();
    return t || undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    for (const key of ["title", "name", "label", "slug"]) {
      if (typeof o[key] === "string" && (o[key] as string).trim()) {
        return (o[key] as string).trim();
      }
    }
  }
  return undefined;
}

/** Locale on listing rows (matches preview-frame fallback when no localeKey). */
function sampleEntryLocale(entry: Record<string, unknown>): string {
  for (const key of ["lang", "locale", "language"] as const) {
    const v = entry[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "en";
}

interface PreviewResolveContextPayload {
  meta?: Record<string, unknown>;
  brand?: Record<string, unknown>;
}

export type EntryPreviewFieldMapping = Record<
  string,
  string | { source: string; default: string }
> | null | undefined;

export function EntryPreviewConfigDialog({
  open,
  onOpenChange,
  contentType,
  preview,
  fieldMapping,
  onFinished,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentType: string;
  preview: ContentTypePreviewConfig | null | undefined;
  fieldMapping?: EntryPreviewFieldMapping;
  /** Fired when the user finishes (save / cancel / clear), not when swapping to the component picker. */
  onFinished?: () => void;
}) {
  const { toast } = useToast();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [component, setComponent] = useState(preview?.component || "");
  const [variant, setVariant] = useState(preview?.variant || "");
  const [version, setVersion] = useState(preview?.version || "");
  const [theme, setTheme] = useState<"dark" | "light">(preview?.theme || "dark");
  const [dirtyOnPropChange, setDirtyOnPropChange] = useState(!!preview?.dirty_on_prop_change);
  const [propsMap, setPropsMap] = useState<Record<string, string>>(preview?.props || {});
  const [mappingDirty, setMappingDirty] = useState(false);
  const [baselineKey, setBaselineKey] = useState(
    `${preview?.component || ""}::${preview?.variant || ""}`,
  );
  const [sampleIndex, setSampleIndex] = useState(0);
  /** Skip draft reset when reopening config after picker (select or cancel). */
  const skipPreviewSyncRef = useRef(false);

  const { data: registry } = useQuery<RegistryOverview>({
    queryKey: ["/api/component-registry"],
  });

  const { data: screenshotIndex } = useQuery<ScreenshotIndex>({
    queryKey: ["/api/private/component-screenshots"],
  });

  const schemaVersion = version || "1.0";
  const { data: schema } = useQuery<ComponentSchemaPayload>({
    queryKey: ["/api/component-registry", component, schemaVersion, "schema"],
    enabled: !!component && open,
    queryFn: async () => {
      const res = await fetch(
        `/api/component-registry/${encodeURIComponent(component)}/${encodeURIComponent(schemaVersion)}/schema`,
      );
      if (!res.ok) throw new Error("Schema not found");
      return res.json();
    },
  });

  useEffect(() => {
    if (!open) return;
    if (skipPreviewSyncRef.current) {
      skipPreviewSyncRef.current = false;
      return;
    }
    setComponent(preview?.component || "");
    setVariant(preview?.variant || "");
    setVersion(preview?.version || "");
    setTheme(preview?.theme || "dark");
    setDirtyOnPropChange(!!preview?.dirty_on_prop_change);
    setPropsMap(preview?.props || {});
    setBaselineKey(`${preview?.component || ""}::${preview?.variant || ""}`);
    setMappingDirty(false);
    setSampleIndex(0);
  }, [open, preview]);

  // Reset sample when switching content types while the dialog stays mounted.
  useEffect(() => {
    setSampleIndex(0);
  }, [contentType]);

  const mappableProps = useMemo(
    () => collectMappableProps(schema, variant || "default"),
    [schema, variant],
  );

  const fieldOptions = useMemo(() => {
    const keys: string[] = [];
    if (fieldMapping) {
      for (const k of Object.keys(fieldMapping)) {
        if (k.startsWith("_") || k === "image" || k === "og_image") continue;
        keys.push(k);
      }
    }
    keys.sort();
    return keys;
  }, [fieldMapping]);

  const extraMappedSource = useMemo(() => {
    const known = new Set<string>([
      ...fieldOptions,
      ...PREVIEW_META_SOURCE_OPTIONS,
      ...PREVIEW_BRAND_SOURCE_OPTIONS,
    ]);
    const extras = new Set<string>();
    for (const v of Object.values(propsMap)) {
      if (typeof v === "string" && v.trim() && !known.has(v.trim())) {
        extras.add(v.trim());
      }
    }
    return Array.from(extras).sort();
  }, [fieldOptions, propsMap]);

  const { data: sampleItemsData } = useQuery<{ results?: Record<string, unknown>[] }>({
    queryKey: [
      "/api/content-types",
      contentType,
      "items",
      "preview-live-samples",
      "reading_minutes",
      LIVE_PREVIEW_SAMPLE_LIMIT,
    ],
    queryFn: () =>
      // List API strips article bodies; reading_minutes is still attached for OG live preview.
      // include_content=1 keeps the body when available (capture / debugging).
      fetch(
        `/api/content-types/${encodeURIComponent(contentType)}/items?limit=${LIVE_PREVIEW_SAMPLE_LIMIT}&include_content=1`,
      ).then((r) => r.json()),
    enabled: open && !!component,
    staleTime: 60_000,
  });

  const { data: brandData } = useQuery<{
    title?: string;
    logo_src?: string;
    logo_dark_src?: string;
  }>({
    queryKey: ["/api/admin/brand-settings"],
    enabled: open && !!component,
    staleTime: 60_000,
  });

  const sampleEntries = useMemo(() => {
    const results = sampleItemsData?.results;
    if (!Array.isArray(results)) return [] as Record<string, unknown>[];
    return results.filter((item) => item && typeof item === "object");
  }, [sampleItemsData]);

  const sampleCount = sampleEntries.length;

  useEffect(() => {
    if (sampleCount === 0) {
      setSampleIndex(0);
      return;
    }
    setSampleIndex((i) => (i >= sampleCount ? 0 : i));
  }, [sampleCount]);

  const sampleEntry = useMemo(() => {
    if (sampleCount === 0) return {};
    return sampleEntries[Math.min(sampleIndex, sampleCount - 1)] || {};
  }, [sampleEntries, sampleIndex, sampleCount]);

  const sampleSlug = String(sampleEntry.slug || "").trim();
  const sampleLocale = sampleEntryLocale(sampleEntry);

  /** Real SEO meta + theme-aware brand (same as OG capture). Listings omit `meta`. */
  const { data: resolveCtx } = useQuery<PreviewResolveContextPayload>({
    queryKey: [
      "/api/content-types",
      contentType,
      "entries",
      sampleSlug,
      "preview-resolve-context",
      sampleLocale,
      theme,
    ],
    queryFn: async () => {
      const qs = new URLSearchParams({ locale: sampleLocale, theme });
      const res = await fetch(
        `/api/content-types/${encodeURIComponent(contentType)}/entries/${encodeURIComponent(sampleSlug)}/preview-resolve-context?${qs}`,
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Failed to load preview context (${res.status})`);
      }
      return res.json();
    },
    enabled: open && !!component && !!sampleSlug,
    staleTime: 60_000,
  });

  const sampleLabel = useMemo(() => {
    const title =
      coercePreviewScalar(sampleEntry.title) ||
      coercePreviewScalar(sampleEntry.name) ||
      String(sampleEntry.slug || "").trim();
    return title || "Sample entry";
  }, [sampleEntry]);

  const goPrevSample = () => {
    if (sampleCount <= 1) return;
    setSampleIndex((i) => (i - 1 + sampleCount) % sampleCount);
  };

  const goNextSample = () => {
    if (sampleCount <= 1) return;
    setSampleIndex((i) => (i + 1) % sampleCount);
  };

  const fallbackBrand = useMemo(
    () => ({
      "brand.title": brandData?.title || "Brand",
      // brand.logo is theme-aware with light fallback; brand.logo_dark is dark-only
      // (never substitute the light wordmark — dark OG canvases map logo_dark explicitly).
      "brand.logo":
        theme === "dark"
          ? brandData?.logo_dark_src || brandData?.logo_src || ""
          : brandData?.logo_src || "",
      "brand.logo_dark": brandData?.logo_dark_src || "",
    }),
    [brandData, theme],
  );

  const liveSection = useMemo((): Section | null => {
    if (!component.trim()) return null;
    const data: Record<string, unknown> = {};
    applyPreviewPropMappings(data, propsMap, {
      entry: sampleEntry,
      // Prefer resolved SEO meta from the entry YAML — never invent page_title from entry.title.
      meta: resolveCtx?.meta && typeof resolveCtx.meta === "object" ? resolveCtx.meta : {},
      brand:
        resolveCtx?.brand && typeof resolveCtx.brand === "object" && Object.keys(resolveCtx.brand).length > 0
          ? resolveCtx.brand
          : fallbackBrand,
    });
    for (const key of ["title", "category", "author", "logo"] as const) {
      if (!(key in data)) continue;
      // Keep string[] for category (e.g. tags → badges); only coerce scalars/objects.
      if (key === "category" && Array.isArray(data[key])) continue;
      const coerced = coercePreviewScalar(data[key]);
      if (coerced !== undefined) data[key] = coerced;
    }
    // List API strips article bodies; materialize label (uses reading_minutes fallback).
    materializeOgPreviewReadingTime(data, propsMap, sampleEntry);
    return {
      type: component,
      variant: variant || "default",
      version: version || "1.0",
      ...data,
      section_id: "entry-preview-config-live",
    } as Section;
  }, [component, variant, version, propsMap, sampleEntry, resolveCtx, fallbackBrand]);

  const requiredUnmapped = useMemo(() => {
    return mappableProps.filter((p) => p.required && !propsMap[p.key]?.trim());
  }, [mappableProps, propsMap]);

  const mappedCount = useMemo(
    () => Object.values(propsMap).filter((v) => typeof v === "string" && v.trim()).length,
    [propsMap],
  );

  /** Ready to save / capture: has mappable fields, all required mapped, ≥1 mapping. */
  const mappingsReady =
    !!component.trim() &&
    !!schema &&
    mappableProps.length > 0 &&
    requiredUnmapped.length === 0 &&
    mappedCount > 0;

  const incompatibleComponent = !!component.trim() && !!schema && mappableProps.length === 0;

  // Allow cancel when component has no mappable fields (user must pick another); otherwise
  // block dismiss after a component change until required mappings are done.
  const canDismiss =
    !mappingDirty ||
    mappingsReady ||
    incompatibleComponent ||
    !component.trim();
  const canSave = mappingsReady;

  const componentDisplayName =
    registry?.components.find((c) => c.type === component)?.name || component;
  const thumbUrl =
    component && screenshotIndex?.[component]?.url && !screenshotIndex[component].stale
      ? screenshotIndex[component].url
      : "";

  const openPicker = () => {
    skipPreviewSyncRef.current = true;
    onOpenChange(false);
    // Allow dialog exit animation before opening picker (no nested dialogs)
    window.setTimeout(() => setPickerOpen(true), 150);
  };

  const handlePickerOpenChange = (nextOpen: boolean) => {
    setPickerOpen(nextOpen);
    if (!nextOpen) {
      // Preserve draft (picker cancel) or selection (onSelect already applied)
      skipPreviewSyncRef.current = true;
      window.setTimeout(() => onOpenChange(true), 150);
    }
  };

  const handlePickerSelect = (sel: ComponentPickerV2Selection) => {
    const nextKey = `${sel.type}::${sel.variant}`;
    const changed = nextKey !== baselineKey;
    setComponent(sel.type);
    setVariant(sel.variant);
    setVersion(sel.version);
    if (changed) {
      setPropsMap({});
      setMappingDirty(true);
      setBaselineKey(nextKey);
    }
    // pickExample also calls onOpenChange(false); that path reopens config
    // with skipPreviewSyncRef so this selection is not wiped by the preview sync.
    skipPreviewSyncRef.current = true;
    setPickerOpen(false);
  };

  const setPropMapping = (compKey: string, entryField: string) => {
    setPropsMap((prev) => {
      const next = { ...prev };
      if (!entryField || entryField === UNMAPPED) delete next[compKey];
      else next[compKey] = entryField;
      return next;
    });
    setMappingDirty(true);
  };

  const requestCloseConfig = (nextOpen: boolean) => {
    if (!nextOpen && !canDismiss) {
      toast({
        title: "Finish property mappings",
        description:
          "Map every required property (and at least one field) before closing, or clear the component.",
        variant: "destructive",
      });
      return;
    }
    onOpenChange(nextOpen);
    if (!nextOpen) onFinished?.();
  };

  const save = async (clear = false) => {
    if (!clear && !canSave) {
      toast({
        title: incompatibleComponent
          ? "Component not compatible"
          : "Finish property mappings",
        description: incompatibleComponent
          ? "This component has no simple fields to map. Pick a different component."
          : requiredUnmapped.length > 0
            ? `Map required properties: ${requiredUnmapped.map((p) => p.key).join(", ")}`
            : "Map at least one component property to a content-type field before saving.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const body = clear
        ? { preview: null }
        : {
            preview: {
              component: component.trim(),
              variant: variant.trim() || undefined,
              version: version.trim() || undefined,
              theme,
              widths: [1200],
              maxHeight: 630,
              dirty_on_prop_change: dirtyOnPropChange,
              props: propsMap,
            },
          };
      const res = await apiRequest(
        "PUT",
        `/api/content-types/${encodeURIComponent(contentType)}/config`,
        body,
      );
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error || "Failed to save preview config", variant: "destructive" });
        return;
      }
      if (data.warning) {
        toast({ title: "Saved with warning", description: data.warning });
      } else {
        toast({ title: clear ? "Preview config cleared" : "Preview config saved" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/content-types", contentType, "config"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/content-types", contentType, "entry-previews"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/content-types", contentType, "entry-previews", "stats"],
      });
      setMappingDirty(false);
      onOpenChange(false);
      onFinished?.();
    } catch {
      toast({ title: "Failed to save preview config", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={requestCloseConfig}>
        <DialogContent
          className="sm:max-w-lg lg:max-w-5xl max-h-[90vh] overflow-y-auto"
          onPointerDownOutside={(e) => {
            if (!canDismiss) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (!canDismiss) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>Entry preview component</DialogTitle>
            <DialogDescription>
              Map component fields to content-type fields (<code className="font-mono text-[10px]">single</code>),{" "}
              <code className="font-mono text-[10px]">meta.*</code>, or{" "}
              <code className="font-mono text-[10px]">brand.*</code> — same namespaces as templates.
              Capture loads SEO meta and expands <code className="font-mono text-[10px]">{"{{ entry.* }}"}</code> inside it.
              Brand is live at capture time and does not auto-recapture. Required top-level props and at least one
              mapping are needed before saving.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,460px)] lg:items-start">
          <div className="space-y-4 min-w-0">
            {/* Summary card */}
            {component ? (
              <div
                className="flex items-stretch gap-3 rounded-lg border border-border overflow-hidden"
                data-testid="card-preview-component-summary"
              >
                <div className="w-28 shrink-0 bg-muted flex items-center justify-center">
                  {thumbUrl ? (
                    <img src={thumbUrl} alt="" className="w-full h-full object-cover max-h-24" />
                  ) : (
                    <ImageOff className="h-6 w-6 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0 py-2 pr-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{componentDisplayName}</p>
                    <p className="text-[11px] text-muted-foreground font-mono truncate">
                      {component}
                      {variant ? ` / ${variant}` : ""}
                      {version ? ` @ ${version}` : ""}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0"
                    onClick={openPicker}
                    data-testid="button-edit-preview-component"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={openPicker}
                className="w-full rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground hover:bg-muted/40 transition-colors"
                data-testid="button-choose-preview-component"
              >
                Choose a component for OG / list thumbnails
              </button>
            )}

            <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
              <div>
                <Label className="text-xs">Theme</Label>
                <p className="text-[11px] text-muted-foreground">Capture theme for screenshots</p>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={theme === "dark"}
                  onCheckedChange={(on) => setTheme(on ? "dark" : "light")}
                  data-testid="switch-preview-theme"
                />
                <span className="text-xs text-muted-foreground">{theme}</span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
              <div>
                <Label className="text-xs">Dirty on prop change</Label>
                <p className="text-[11px] text-muted-foreground">
                  Re-capture when mapped prop values drift from the last capture.
                </p>
              </div>
              <Switch
                checked={dirtyOnPropChange}
                onCheckedChange={setDirtyOnPropChange}
                data-testid="switch-dirty-on-prop-change"
              />
            </div>

            {component && (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <Label className="text-xs">Property mappings</Label>
                  <p className="text-[10px] text-muted-foreground shrink-0">
                    <span className="text-destructive font-medium">Required</span> must be mapped · others optional
                  </p>
                </div>
                {mappingDirty && requiredUnmapped.length > 0 && (
                  <p className="text-[11px] text-destructive" data-testid="text-mapping-required">
                    Required unmapped: {requiredUnmapped.map((p) => p.key).join(", ")}
                  </p>
                )}
                {!mappingsReady &&
                  !!schema &&
                  mappableProps.length > 0 &&
                  requiredUnmapped.length === 0 &&
                  mappedCount === 0 && (
                    <p className="text-[11px] text-destructive" data-testid="text-mapping-at-least-one">
                      Map at least one property before saving.
                    </p>
                  )}
                {mappableProps.length === 0 ? (
                  <p className="text-[11px] text-destructive" data-testid="text-mapping-incompatible">
                    {schema
                      ? "No simple fields to map for this variant (including nested paths like left.heading). Arrays are still skipped — pick another component."
                      : "Loading schema…"}
                  </p>
                ) : (
                  <div className="space-y-2" data-testid="list-preview-prop-mappings">
                    {mappableProps.map((prop) => {
                      const mapped = !!propsMap[prop.key]?.trim();
                      return (
                        <div key={prop.key} className="flex items-center gap-2">
                          <div className="w-[40%] min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <p className="text-xs font-mono truncate" title={prop.key}>
                                {prop.key}
                              </p>
                              {prop.required ? (
                                <Badge
                                  variant="outline"
                                  className="h-4 shrink-0 px-1 text-[9px] font-medium text-destructive border-destructive/40"
                                  data-testid={`badge-preview-prop-required-${prop.key}`}
                                >
                                  Required
                                </Badge>
                              ) : null}
                            </div>
                            {prop.description ? (
                              <p className="text-[10px] text-muted-foreground line-clamp-1">
                                {prop.description}
                              </p>
                            ) : null}
                          </div>
                          <Select
                            value={propsMap[prop.key] || UNMAPPED}
                            onValueChange={(v) => setPropMapping(prop.key, v)}
                          >
                            <SelectTrigger
                              className="flex-1 h-9 text-xs font-mono"
                              data-testid={`select-preview-prop-${prop.key}`}
                            >
                              <SelectValue placeholder="Content field" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={UNMAPPED} className="text-xs text-muted-foreground">
                                — not mapped —
                              </SelectItem>
                              {extraMappedSource.length > 0 && (
                                <SelectGroup>
                                  <SelectLabel className="text-[10px]">Current</SelectLabel>
                                  {extraMappedSource.map((f) => (
                                    <SelectItem key={f} value={f} className="text-xs font-mono">
                                      {f}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              )}
                              {fieldOptions.length > 0 && (
                                <SelectGroup>
                                  <SelectLabel className="text-[10px]">Mapped fields</SelectLabel>
                                  {fieldOptions.map((f) => (
                                    <SelectItem key={f} value={f} className="text-xs font-mono">
                                      {f}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              )}
                              <SelectGroup>
                                <SelectLabel className="text-[10px]">Meta</SelectLabel>
                                {PREVIEW_META_SOURCE_OPTIONS.map((f) => (
                                  <SelectItem key={f} value={f} className="text-xs font-mono">
                                    {f}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                              <SelectGroup>
                                <SelectLabel className="text-[10px]">Brand</SelectLabel>
                                {PREVIEW_BRAND_SOURCE_OPTIONS.map((f) => (
                                  <SelectItem key={f} value={f} className="text-xs font-mono">
                                    {f}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                          {!prop.required ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                              disabled={!mapped}
                              title={mapped ? "Clear mapping" : "Not mapped"}
                              onClick={() => setPropMapping(prop.key, UNMAPPED)}
                              data-testid={`button-clear-preview-prop-${prop.key}`}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          ) : (
                            <span className="w-8 shrink-0" aria-hidden />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                  <CollapsibleTrigger asChild>
                    <button type="button" className="text-[11px] text-primary hover:underline">
                      {advancedOpen ? "Hide advanced" : "Read more (advanced)"}
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="text-[11px] text-muted-foreground space-y-1 pt-1">
                    <p>
                      Resolver:{" "}
                      <code className="font-mono">shared/entry-preview-props.ts</code>
                      {" · "}
                      Live SEO meta via{" "}
                      <code className="font-mono">preview-resolve-context</code> (same as capture;{" "}
                      <code className="font-mono">meta.page_title</code> is not invented from{" "}
                      <code className="font-mono">title</code>)
                      {" · "}
                      brand from <code className="font-mono">variables.yml</code>.
                    </p>
                    <p>
                      Schema:{" "}
                      <code className="font-mono">
                        component-registry/{component || "{type}"}/{schemaVersion}/schema
                      </code>
                    </p>
                    <p>
                      Blocked (circular): <code className="font-mono">_image</code>,{" "}
                      <code className="font-mono">image</code>,{" "}
                      <code className="font-mono">og_image</code>,{" "}
                      <code className="font-mono">meta.og_image</code>.
                    </p>
                    <p>
                      Brand logos: <code className="font-mono">brand.logo</code> is theme-aware
                      (light URL, or dark URL in dark theme with light fallback).{" "}
                      <code className="font-mono">brand.logo_dark</code> is the dark-mode wordmark
                      only — use it for dark OG canvases; it never falls back to the light logo.
                      Registry IDs in <code className="font-mono">variables.yml</code> become URLs
                      for the screenshot. Set the dark logo under Settings → Brand if empty.
                    </p>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            )}
          </div>

          {component ? (
            <div
              className="hidden lg:block space-y-2 lg:sticky lg:top-0"
              data-testid="panel-entry-preview-live"
            >
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">Live preview</Label>
                <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground min-w-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    disabled={sampleCount <= 1}
                    onClick={goPrevSample}
                    aria-label="Previous sample entry"
                    data-testid="button-preview-sample-prev"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <p
                    className="truncate max-w-[140px] text-center"
                    title={
                      sampleCount > 0
                        ? `${sampleLabel} (${sampleIndex + 1}/${sampleCount}) · ${theme} theme`
                        : `Sample entry · ${theme} theme`
                    }
                  >
                    {sampleCount > 0 ? (
                      <>
                        <span className="tabular-nums">
                          {sampleIndex + 1}/{sampleCount}
                        </span>
                        {" · "}
                        {theme}
                      </>
                    ) : (
                      <>Sample · {theme}</>
                    )}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    disabled={sampleCount <= 1}
                    onClick={goNextSample}
                    aria-label="Next sample entry"
                    data-testid="button-preview-sample-next"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div
                className={cn(
                  "rounded-md border border-border overflow-hidden bg-background",
                  theme === "dark" && "dark",
                )}
                style={{
                  width: LIVE_PREVIEW_WIDTH * LIVE_PREVIEW_SCALE,
                  height: LIVE_PREVIEW_HEIGHT * LIVE_PREVIEW_SCALE,
                }}
              >
                <div
                  className="origin-top-left pointer-events-none"
                  style={{
                    width: LIVE_PREVIEW_WIDTH,
                    height: LIVE_PREVIEW_HEIGHT,
                    transform: `scale(${LIVE_PREVIEW_SCALE})`,
                  }}
                >
                  {liveSection ? (
                    <Suspense
                      fallback={
                        <div className="flex h-full w-full items-center justify-center bg-muted text-sm text-muted-foreground">
                          Loading component…
                        </div>
                      }
                    >
                      <SectionRenderer sections={[liveSection]} />
                    </Suspense>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-muted text-sm text-muted-foreground">
                      Choose a component
                    </div>
                  )}
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground leading-snug">
                Updates as you map properties. Browse samples with the arrows. Mapping{" "}
                <code className="font-mono">content</code> derives reading time from the article body
                (list responses include <code className="font-mono">reading_minutes</code> when the
                body is stripped). Brand URLs follow the theme toggle.
              </p>
            </div>
          ) : null}
          </div>

          <DialogFooter className="flex-wrap gap-2">
            {preview?.component && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={saving || !canDismiss}
                onClick={() => save(true)}
                data-testid="button-clear-preview-config"
              >
                Clear
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={!canDismiss}
              onClick={() => requestCloseConfig(false)}
              data-testid="button-cancel-preview-config"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={saving || !canSave}
              onClick={() => save(false)}
              data-testid="button-save-preview-config"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ComponentPickerV2
        open={pickerOpen}
        onOpenChange={handlePickerOpenChange}
        onSelect={handlePickerSelect}
        initialType={component || undefined}
        title="Choose preview component"
      />
    </>
  );
}

export function EntryPreviewCard({
  contentType,
  preview,
  fieldMapping,
  onRetryQueued,
  onGenerateAll,
  generateAllCounts,
  queueBusyCount = 0,
  queuePaused = false,
  configError = null,
}: {
  contentType: string;
  preview: ContentTypePreviewConfig | null | undefined;
  fieldMapping?: EntryPreviewFieldMapping;
  /** Called after failed metas are cleared so the parent can force-enqueue captures. */
  onRetryQueued?: (failures: EntryPreviewFailure[]) => void;
  onGenerateAll?: (mode: "missing" | "all") => void;
  generateAllCounts?: { missing: number; all: number };
  /** Queued + capturing jobs — poll stats while > 0 so the KPI line moves live. */
  queueBusyCount?: number;
  queuePaused?: boolean;
  /** Server capture misconfiguration (missing CF credentials / public SITE_URL). */
  configError?: string | null;
}) {
  const { toast } = useToast();
  const [confirmRetryOpen, setConfirmRetryOpen] = useState(false);
  const [generateAllOpen, setGenerateAllOpen] = useState(false);
  const [generateMode, setGenerateMode] = useState<"missing" | "all">("missing");
  const [configOpen, setConfigOpen] = useState(false);

  const missingCount = generateAllCounts?.missing ?? 0;
  const allCount = generateAllCounts?.all ?? 0;
  const canGenerateAll = !!onGenerateAll && missingCount + allCount > 0;
  const selectedGenerateCount = generateMode === "missing" ? missingCount : allCount;

  const openGenerateAllDialog = () => {
    setGenerateMode(missingCount > 0 ? "missing" : "all");
    setGenerateAllOpen(true);
  };

  const { data, isLoading } = useQuery<EntryPreviewStats>({
    queryKey: ["/api/content-types", contentType, "entry-previews", "stats"],
    queryFn: async () => {
      const r = await fetch(
        `/api/content-types/${encodeURIComponent(contentType)}/entry-previews/stats`,
        {
          credentials: "include",
          cache: "no-store",
          headers: getSessionHeaders(),
        },
      );
      if (!r.ok) throw new Error(`Failed to load preview stats (${r.status})`);
      return r.json();
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: queueBusyCount > 0 ? 1_500 : false,
  });

  const retryMutation = useMutation({
    mutationFn: async () => {
      const failures = data?.failures ? [...data.failures] : [];
      if (failures.length === 0) return { retried: 0, failures };
      await onRetryQueued?.(failures);
      return { retried: failures.length, failures };
    },
    onSuccess: (result: { retried: number }) => {
      const retried = result.retried ?? 0;
      toast({
        title: "Retry queued",
        description:
          retried > 0
            ? `${retried} preview(s) queued on the server`
            : "No failed previews to retry",
      });
      setConfirmRetryOpen(false);
      void queryClient.invalidateQueries({
        queryKey: ["/api/content-types", contentType, "entry-previews"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["/api/content-types", contentType, "entry-previews", "stats"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["/api/content-types", contentType, "entry-previews", "queue"],
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Retry failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const hasPreview = !!preview?.component;

  return (
    <>
      <Card data-testid="card-entry-preview">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">OG Preview</CardTitle>
          <div className="flex items-center gap-1">
            {hasPreview && canGenerateAll && (
              <Button
                size="icon"
                variant="ghost"
                onClick={openGenerateAllDialog}
                disabled={queueBusyCount > 0}
                title={
                  queueBusyCount > 0
                    ? `Generating ${queueBusyCount}…`
                    : "Generate OG previews"
                }
                data-testid="button-generate-all-entry-previews-header"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${queueBusyCount > 0 ? "animate-spin" : ""}`}
                />
              </Button>
            )}
            {configError ? (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex shrink-0"
                    data-testid="badge-entry-preview-config-error"
                  >
                    <Badge variant="destructive" className="gap-1 text-[10px] cursor-pointer">
                      <AlertCircle className="h-3 w-3" />
                      Action Required
                    </Badge>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-72 text-xs"
                  side="bottom"
                  align="end"
                  data-testid="popover-entry-preview-config-error"
                >
                  <p className="text-destructive leading-relaxed" data-testid="text-entry-preview-config-error">
                    {configError}
                  </p>
                </PopoverContent>
              </Popover>
            ) : (
              <Image className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {hasPreview
              ? "Use Cloudflare to generate the images that show when your pages are published on social media."
              : "Configure a component to generate OG / list thumbnails when image is empty."}
          </p>
          {hasPreview ? (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer text-primary hover:underline">Read more (advanced)</summary>
              <div className="mt-1 space-y-2 leading-relaxed">
                <p>
                  {preview.component}
                  {preview.variant ? ` / ${preview.variant}` : ""} — server captures via Cloudflare Browser
                  Run for admin thumbs and og:image. On success, locale YAML meta.og_image is set (unless a
                  gallery/editorial image is already set). You can close this tab after Generate.
                </p>
                <p>
                  Queue: server/entry-preview-capture-queue.ts · CF client: server/cloudflare-browser.ts ·
                  Storage: server/entry-preview-manager.ts · Frame: client/src/pages/EntryPreviewFrame.tsx.
                  Component gallery thumbs still use client modern-screenshot. Auto-commit batches YAML when
                  GitHub sync flags are on; WebPs under images/entry-previews/ are not in content git.
                </p>
              </div>
            </details>
          ) : null}

          {hasPreview && (
            <div className="space-y-1">
              {isLoading ? (
                <div
                  className="flex items-center gap-1.5 text-sm text-muted-foreground"
                  data-testid="text-entry-preview-stats-loading"
                >
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Loading…</span>
                </div>
              ) : data?.captureReady === false ? (
                <p
                  className="text-xs text-destructive leading-relaxed"
                  data-testid="text-entry-preview-not-ready"
                >
                  {data.captureReadyError ||
                    "Preview mappings incomplete — captures are paused until you fix the config."}
                </p>
              ) : (
                <>
                  <p className="text-sm font-medium" data-testid="text-entry-preview-stats">
                    {data?.generated ?? 0} gen · {data?.fromSource ?? 0} source ·{" "}
                    {(data?.dirty ?? 0) > 0 ? `${data!.dirty} dirty · ` : ""}
                    {data?.missing ?? 0} missing
                    {queueBusyCount > 0 ? ` · generating ${queueBusyCount}` : ""}
                  </p>
                  {(data?.failed ?? 0) > 0 && (
                    <button
                      type="button"
                      className="text-xs text-destructive hover:underline"
                      onClick={() => setConfirmRetryOpen(true)}
                      data-testid="button-retry-failed-entry-previews"
                    >
                      {data!.failed} failed — Retry
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => setConfigOpen(true)}
            data-testid="button-edit-entry-preview-config"
          >
            {hasPreview ? "Edit preview config" : "Configure preview"}
          </button>
        </CardContent>
      </Card>

      <Dialog open={confirmRetryOpen} onOpenChange={setConfirmRetryOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Retry failed previews?</DialogTitle>
            <DialogDescription>
              Clears the failed flag and marks those entries dirty so they can be captured again.
            </DialogDescription>
          </DialogHeader>
          {(data?.failures?.length ?? 0) > 0 && (
            <ul
              className="max-h-48 overflow-y-auto space-y-2 rounded-md border border-border bg-muted/40 p-3 text-xs"
              data-testid="list-entry-preview-failures-dialog"
            >
              {data!.failures!.map((f) => (
                <li key={`${f.slug}:${f.locale}`} className="leading-snug">
                  <div className="font-medium text-foreground">
                    {f.slug}
                    {f.locale ? ` · ${f.locale}` : ""}
                  </div>
                  <div className="text-destructive">{f.error}</div>
                  {typeof f.attempts === "number" && f.attempts > 1 ? (
                    <div className="text-muted-foreground">{f.attempts} attempts</div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConfirmRetryOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={retryMutation.isPending}
              onClick={() => retryMutation.mutate()}
              data-testid="button-confirm-retry-failed-previews"
            >
              {retryMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Retry failed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={generateAllOpen} onOpenChange={setGenerateAllOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Generate OG previews?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  This queues screenshot captures for this content type. Each entry is rendered with
                  the configured preview component, then saved as the admin thumbnail and{" "}
                  <code className="text-xs">og:image</code> when the reserved image field is empty.
                </p>
                <ul className="list-disc pl-4 space-y-1 text-xs">
                  <li>Runs one at a time in this browser tab (short pause between each).</li>
                  <li>Keep this tab open — the queue pauses when the tab is hidden.</li>
                  <li>Does not overwrite entries that already use a source/DB image.</li>
                  <li>Regenerate all will re-capture even when a preview already exists.</li>
                </ul>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Generate scope">
            <Button
              type="button"
              variant="outline"
              className={cn(
                "justify-start h-auto py-3 px-4",
                generateMode === "missing" && "border-primary ring-1 ring-primary",
              )}
              disabled={missingCount === 0}
              onClick={() => setGenerateMode("missing")}
              aria-checked={generateMode === "missing"}
              role="radio"
              data-testid="button-generate-missing-previews"
            >
              <div className="text-left">
                <div className="font-medium">Missing only</div>
                <div className="text-xs text-muted-foreground font-normal">
                  {missingCount} without a preview yet (or marked dirty)
                </div>
              </div>
            </Button>
            <Button
              type="button"
              variant="outline"
              className={cn(
                "justify-start h-auto py-3 px-4",
                generateMode === "all" && "border-primary ring-1 ring-primary",
              )}
              disabled={allCount === 0}
              onClick={() => setGenerateMode("all")}
              aria-checked={generateMode === "all"}
              role="radio"
              data-testid="button-regenerate-all-previews"
            >
              <div className="text-left">
                <div className="font-medium">Regenerate all</div>
                <div className="text-xs text-muted-foreground font-normal">
                  {allCount} entries — re-capture even if a preview exists
                </div>
              </div>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground" data-testid="text-generate-confirm-summary">
            {selectedGenerateCount > 0
              ? `About to queue ${selectedGenerateCount} capture${selectedGenerateCount === 1 ? "" : "s"} (${generateMode === "missing" ? "missing/dirty only" : "all eligible entries"}).`
              : "No entries match this option."}
          </p>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setGenerateAllOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={selectedGenerateCount === 0}
              onClick={() => {
                onGenerateAll?.(generateMode);
                setGenerateAllOpen(false);
              }}
              data-testid="button-confirm-generate-entry-previews"
            >
              <Wand2 className="h-3.5 w-3.5 mr-1" />
              Generate {selectedGenerateCount > 0 ? selectedGenerateCount : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EntryPreviewConfigDialog
        open={configOpen}
        onOpenChange={setConfigOpen}
        contentType={contentType}
        preview={preview}
        fieldMapping={fieldMapping}
      />
    </>
  );
}
