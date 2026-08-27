import { useState, useRef, useEffect } from "react";
import { Check, CloudUpload, Crop as CropIcon, FileText, Film, Loader2, Search, Tags, Upload, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ReactCrop from "react-image-crop";
import type { Crop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { ImageRegistry, ImageEntry } from "@shared/schema";
import {
  type MediaDoctype,
  acceptAttrForDoctype,
  extensionsForDoctype,
  inferDoctypeFromSrc,
} from "@shared/media-doctype";

interface FamilyUsageEntry {
  filePath: string;
  slug: string;
  contentType: string;
  locale: string;
  sectionIndex: number;
  sectionType: string;
  currentSrc: string;
  currentId: string;
  title?: string;
  hasBinding?: boolean;
  isNoindex?: boolean;
}

const CONTENT_TYPE_LABELS: Record<string, string> = {
  landings: "Landing",
  pages: "Página",
  bootcamps: "Programa",
  locations: "Ubicación",
  articles: "Artículo",
  events: "Evento",
};

export interface ImagePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  initialSrc?: string;
  initialAlt?: string;
  /** Locked tag filter (e.g. logo pickers) — cannot be cleared by the user. */
  tagFilter?: string;
  /**
   * Initial tag filter when the dialog opens; user can clear via chip to browse all tags.
   * Ignored when `tagFilter` is set.
   */
  defaultTagFilter?: string;
  /**
   * Tags ensured on the registry image when Save is clicked (idempotent POST).
   * Shown as a footer hint when a gallery image is selected.
   * Standard project tags: `og-image`, `logo`, `brand`.
   */
  ensureTagsOnSave?: string[];
  onSave: (src: string, alt: string, registryId: string | undefined) => Promise<void> | void;
  onRemove?: () => void;
  renderPreset?: string;
  renderedSize?: { width: number; height: number };
  /**
   * Restrict browse/upload to this media type. Defaults to `"image"` (current behavior).
   */
  doctype?: MediaDoctype;
  /** Tab shown when the dialog opens. Defaults to `"browse"`. */
  initialMode?: "browse" | "upload";
  /**
   * When true, close the dialog after a successful upload (gallery “add media” flow).
   * Field pickers leave this unset so upload selects the file and waits for Save.
   */
  closeOnSuccessfulUpload?: boolean;
  /**
   * Gallery “add media” mode: only show the upload dropzone (no Browse tab / Save).
   */
  uploadOnly?: boolean;
}

const DOCTYPE_TITLES: Record<MediaDoctype, string> = {
  image: "Choose image",
  video: "Choose video",
  pdf: "Choose PDF",
};

const DOCTYPE_UPLOAD_HINTS: Record<MediaDoctype, string> = {
  image: "PNG, JPG, WebP, SVG, AVIF, GIF (max 10 MB)",
  video: "MP4, WebM, MOV, OGG, M4V (max 100 MB)",
  pdf: "PDF documents (max 100 MB)",
};

const ASPECT_RATIO_MAP: Record<string, number> = {
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "4:3": 4 / 3,
  "3:4": 3 / 4,
  "1:1": 1,
  "21:9": 21 / 9,
};

export function ImagePickerDialog({
  open,
  onOpenChange,
  title,
  initialSrc = "",
  initialAlt = "",
  tagFilter,
  defaultTagFilter,
  ensureTagsOnSave,
  onSave,
  onRemove,
  renderPreset,
  renderedSize,
  doctype = "image",
  initialMode = "browse",
  closeOnSuccessfulUpload = false,
  uploadOnly = false,
}: ImagePickerDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const resolvedTitle = title ?? DOCTYPE_TITLES[doctype];
  const allowCrop = doctype === "image";
  const effectiveInitialMode = uploadOnly ? "upload" : initialMode;

  const { data: imageRegistry } = useQuery<ImageRegistry>({
    queryKey: ["/api/image-registry"],
    // SSR may have seeded a page-local subset; always refetch the full catalog when the picker opens.
    staleTime: 0,
    refetchOnMount: "always",
    enabled: open,
  });

  const { data: mediaStatus } = useQuery<{
    defaultProvider: string;
    providers: string[];
    gcs?: { bucket: string; basePath: string; projectId?: string };
  }>({
    queryKey: ["/api/media/status"],
    enabled: open,
    staleTime: 60000,
  });

  const hasCloudProvider = (mediaStatus?.providers ?? []).some((p) => p !== "local");

  const lockedTagFilter = typeof tagFilter === "string" && tagFilter.trim() ? tagFilter.trim() : "";
  const initialDefaultFilter =
    typeof defaultTagFilter === "string" && defaultTagFilter.trim() ? defaultTagFilter.trim() : "";
  const tagFilterSelectable = !lockedTagFilter;

  const [pickerMode, setPickerMode] = useState<"browse" | "upload">(effectiveInitialMode);
  const [search, setSearch] = useState("");
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [activeTagFilters, setActiveTagFilters] = useState<string[]>(() => {
    const initial = lockedTagFilter || initialDefaultFilter;
    return initial ? [initial] : [];
  });
  const [visibleCount, setVisibleCount] = useState(48);
  const [selectedSrc, setSelectedSrc] = useState(initialSrc);
  const [selectedAlt, setSelectedAlt] = useState(initialAlt);
  const [selectedRegistryId, setSelectedRegistryId] = useState<string | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const popoverContainerRef = useRef<HTMLDivElement>(null);

  const [cropPanelOpen, setCropPanelOpen] = useState(false);
  const [cropState, setCropState] = useState<Crop>({ unit: "%", x: 0, y: 0, width: 100, height: 100 });
  const [cropTargetWidth, setCropTargetWidth] = useState(800);
  const [cropTargetHeight, setCropTargetHeight] = useState(600);
  const [cropAspectLock, setCropAspectLock] = useState(false);
  const [cropQuality, setCropQuality] = useState(85);
  const [cropProcessing, setCropProcessing] = useState(false);
  const [openPanelId, setOpenPanelId] = useState<string | null>(null);
  const [bulkModal, setBulkModal] = useState<{
    open: boolean;
    usages: FamilyUsageEntry[];
    checking: boolean;
    applying: boolean;
    selectedIndices: Set<number>;
  }>({ open: false, usages: [], checking: false, applying: false, selectedIndices: new Set() });

  const cropSizeSuggestions = (() => {
    const suggestions: Array<{ value: string; label: string; width: number; height: number }> = [];
    const seen = new Set<string>();

    const addPresetSuggestion = (presetName: string) => {
      if (!imageRegistry?.presets) return;
      const presetConfig = (imageRegistry.presets as Record<string, { widths: number[]; aspect_ratio: string | null; description?: string }>)[presetName];
      if (!presetConfig) return;
      const maxWidth = Math.max(...presetConfig.widths);
      const ar = presetConfig.aspect_ratio ? ASPECT_RATIO_MAP[presetConfig.aspect_ratio] : null;
      const height = ar ? Math.round(maxWidth / ar) : 0;
      const key = `${maxWidth}x${height}`;
      if (seen.has(key)) return;
      seen.add(key);
      const label = height > 0
        ? `${presetName} — ${maxWidth} × ${height} px`
        : `${presetName} — ${maxWidth} px wide`;
      suggestions.push({ value: key, label, width: maxWidth, height: height > 0 ? height : cropTargetHeight });
    };

    if (renderPreset) addPresetSuggestion(renderPreset);

    if (selectedRegistryId && imageRegistry?.images?.[selectedRegistryId]?.preset) {
      for (const p of imageRegistry.images[selectedRegistryId].preset!) {
        if (p !== renderPreset) addPresetSuggestion(p);
      }
    }

    if (renderedSize && renderedSize.width > 0 && renderedSize.height > 0) {
      const imgEntry = selectedRegistryId ? imageRegistry?.images?.[selectedRegistryId] : undefined;
      const targetWidth = renderedSize.width;
      // Use the image's natural aspect ratio so resizing never distorts it.
      // Fall back to the rendered container height only when dimensions are unknown.
      const targetHeight = (imgEntry?.width && imgEntry?.height)
        ? Math.round(targetWidth * (imgEntry.height / imgEntry.width))
        : renderedSize.height;
      const key = `${targetWidth}x${targetHeight}`;
      if (!seen.has(key)) {
        seen.add(key);
        suggestions.push({
          value: key,
          label: `Match displayed size on retina screens — ${targetWidth} × ${targetHeight} px`,
          width: targetWidth,
          height: targetHeight,
        });
      }
    }

    return suggestions;
  })();

  useEffect(() => {
    if (open) {
      setSelectedSrc(initialSrc);
      setSelectedAlt(initialAlt);
      setOpenPanelId(null);
      let resolvedId: string | undefined;
      if (initialSrc && imageRegistry?.images) {
        resolvedId = Object.entries(imageRegistry.images).find(
          ([, entry]) => entry.src === initialSrc
        )?.[0];
      }
      setSelectedRegistryId(resolvedId);
      setSearch("");
      setSearchExpanded(false);
      setTagsExpanded(false);
      setPickerMode(effectiveInitialMode);
      const initial = lockedTagFilter || initialDefaultFilter;
      setActiveTagFilters(initial ? [initial] : []);
    } else {
      setOpenPanelId(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialSrc, initialAlt, lockedTagFilter, initialDefaultFilter, effectiveInitialMode]);

  useEffect(() => {
    setVisibleCount(48);
  }, [search, open, activeTagFilters]);

  useEffect(() => {
    if (searchExpanded) {
      searchInputRef.current?.focus();
    }
  }, [searchExpanded]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleScroll = () => setOpenPanelId(null);
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  const childrenByParent = (() => {
    const map: Record<string, Array<[string, ImageEntry]>> = {};
    if (!imageRegistry?.images) return map;
    for (const [id, img] of Object.entries(imageRegistry.images)) {
      if (img.parentId) {
        if (!map[img.parentId]) map[img.parentId] = [];
        map[img.parentId].push([id, img]);
      }
    }
    return map;
  })();

  const effectiveTagFilters = lockedTagFilter
    ? [lockedTagFilter]
    : activeTagFilters;
  const activeTagFilterCount = effectiveTagFilters.length;

  const availableTags = (() => {
    const defs = imageRegistry?.tagDefinitions;
    if (defs && Object.keys(defs).length > 0) {
      return Object.entries(defs).map(([key, def]) => ({
        key,
        label: def.label || key,
      }));
    }
    // Fallback: unique tags present on images
    const seen = new Set<string>();
    for (const img of Object.values(imageRegistry?.images ?? {})) {
      for (const t of img.tags ?? []) {
        if (t) seen.add(t);
      }
    }
    return Array.from(seen)
      .sort()
      .map((key) => ({ key, label: key }));
  })();

  const toggleTagFilter = (key: string) => {
    setActiveTagFilters((prev) =>
      prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key],
    );
  };

  const filteredImages = (() => {
    if (!imageRegistry?.images) return [];
    const searchLower = search.toLowerCase();
    const tagSet = new Set(effectiveTagFilters.map((t) => t.toLowerCase()));
    return Object.entries(imageRegistry.images)
      .filter(([id, img]) => {
        if (img.parentId) return false;
        if (inferDoctypeFromSrc(img.src) !== doctype) return false;
        if (tagSet.size > 0) {
          const hasMatch = img.tags?.some((t) => tagSet.has(t.toLowerCase()));
          if (!hasMatch) return false;
        }
        if (!searchLower) return true;
        return (
          id.toLowerCase().includes(searchLower) ||
          img.alt?.toLowerCase().includes(searchLower) ||
          img.tags?.some((t) => t.toLowerCase().includes(searchLower))
        );
      })
      .sort((a, b) => (b[1].usage_count ?? 0) - (a[1].usage_count ?? 0));
  })();

  const selectedDisplaySrc = !selectedSrc ? "" : (imageRegistry?.images?.[selectedSrc]?.src || selectedSrc);

  const handleUpload = async (files: FileList | File[]) => {
      if (!files.length) return;
      const file = files[0];
      const allowed = extensionsForDoctype(doctype);
      const ext = `.${file.name.split(".").pop()?.toLowerCase()}`;
      if (!allowed.includes(ext)) {
        toast({
          title: "Unsupported file type",
          description: `${ext} is not allowed for ${doctype} (expected ${allowed.join(", ")})`,
          variant: "destructive",
        });
        return;
      }
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        if (effectiveTagFilters.length > 0) {
          formData.append("tags", JSON.stringify(effectiveTagFilters));
        }
        const resp = await fetch("/api/image-registry/upload", {
          method: "POST",
          body: formData,
        });
        if (!resp.ok) {
          const errData = (await resp.json()) as { error?: string };
          throw new Error(errData.error ?? "Upload failed");
        }
        const result = (await resp.json()) as {
          id: string;
          src: string;
          alt: string;
          duplicate?: boolean;
          existingId?: string;
        };
        await queryClient.invalidateQueries({ queryKey: ["/api/image-registry"] });
        const noun = doctype === "pdf" ? "PDF" : doctype === "video" ? "Video" : "Image";
        toast({
          title: result.duplicate ? `${noun} already exists` : `${noun} uploaded`,
          description: result.duplicate
            ? `Already registered as "${result.existingId}". Using the existing one.`
            : `Registered as "${result.id}"`,
        });
        if (closeOnSuccessfulUpload) {
          onOpenChange(false);
          return;
        }
        setSelectedSrc(result.src);
        setSelectedAlt(result.alt);
        setSelectedRegistryId(result.id);
        setPickerMode("browse");
      } catch (err: unknown) {
        toast({
          title: "Upload failed",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      } finally {
        setUploading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (
        ensureTagsOnSave &&
        ensureTagsOnSave.length > 0 &&
        selectedRegistryId
      ) {
        const resp = await fetch(
          `/api/image-registry/${encodeURIComponent(selectedRegistryId)}/tags`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ add: ensureTagsOnSave }),
          },
        );
        if (!resp.ok) {
          const err = (await resp.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error || "Failed to apply standard image tags");
        }
        await queryClient.invalidateQueries({ queryKey: ["/api/image-registry"] });
      }
      await onSave(selectedSrc, selectedAlt, selectedRegistryId);
      onOpenChange(false);
    } catch (err: unknown) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const checkFamilyAndSave = async () => {
    if (!imageRegistry?.images || !selectedRegistryId) {
      await handleSave();
      return;
    }

    const selectedEntry = imageRegistry.images[selectedRegistryId];
    if (!selectedEntry) {
      await handleSave();
      return;
    }

    const effectiveParentId = selectedEntry.parentId ?? selectedRegistryId;
    const children = childrenByParent[effectiveParentId] ?? [];
    const isFamily = !!selectedEntry.parentId || children.length > 0;
    if (!isFamily) {
      await handleSave();
      return;
    }

    // Collect all family member IDs
    const familyIds = [effectiveParentId, ...children.map(([id]) => id)];

    setBulkModal({ open: true, usages: [], checking: true, applying: false, selectedIndices: new Set() });
    try {
      await fetch("/api/image-registry/clear-ref-cache", { method: "POST" });
      const params = new URLSearchParams();
      familyIds.forEach(id => params.append("ids[]", id));
      const resp = await fetch(`/api/image-registry/family-usage?${params.toString()}`);
      if (!resp.ok) {
        const errData = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error ?? `Server error ${resp.status}`);
      }
      const usages: FamilyUsageEntry[] = await resp.json();

      // Only show usages from OTHER family members (not the one we're currently saving)
      // and exclude noindex/sample pages
      const otherUsages = usages.filter(u => u.currentId !== selectedRegistryId && !u.isNoindex);

      if (!otherUsages.length) {
        setBulkModal({ open: false, usages: [], checking: false, applying: false, selectedIndices: new Set() });
        await handleSave();
        return;
      }

      // Pre-select all non-binding rows
      const initialSelected = new Set(
        otherUsages.map((u, i) => i).filter(i => !otherUsages[i].hasBinding)
      );
      setBulkModal({ open: true, usages: otherUsages, checking: false, applying: false, selectedIndices: initialSelected });
    } catch (err) {
      setBulkModal({ open: false, usages: [], checking: false, applying: false, selectedIndices: new Set() });
      toast({
        title: "No se pudo verificar el uso de la imagen",
        description: err instanceof Error ? err.message : "Error desconocido",
        variant: "destructive",
      });
      await handleSave();
    }
  };

  const handleBulkReplaceAndSave = async () => {
    if (!selectedRegistryId || !selectedSrc) return;

    // Build per-file replacements only for selected, non-binding usages
    const fileReplacements = bulkModal.usages
      .filter((u, i) => bulkModal.selectedIndices.has(i) && !u.hasBinding)
      .map(u => ({
        filePath: u.filePath,
        fromId: u.currentId,
        fromSrc: u.currentSrc,
        toId: selectedRegistryId,
        toSrc: selectedSrc,
      }));

    setBulkModal(prev => ({ ...prev, applying: true }));
    try {
      const resp = await fetch("/api/image-registry/bulk-replace-usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileReplacements }),
      });
      if (!resp.ok) {
        const errData = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error ?? `Server error ${resp.status}`);
      }
      const result = (await resp.json()) as { filesUpdated: number };
      setBulkModal({ open: false, usages: [], checking: false, applying: false, selectedIndices: new Set() });
      await handleSave();
      if (result.filesUpdated > 0) {
        toast({
          title: `${result.filesUpdated} ${result.filesUpdated === 1 ? "page updated" : "pages updated"}`,
          description: "Changes applied to all selected pages.",
        });
      }
    } catch (err) {
      setBulkModal(prev => ({ ...prev, applying: false }));
      toast({
        title: "Error al reemplazar",
        description: err instanceof Error ? err.message : "Error desconocido",
        variant: "destructive",
      });
    }
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  const handleRemove = () => {
    onRemove?.();
    onOpenChange(false);
  };

  const handleOpenCrop = () => {
    setCropState({ unit: "%", x: 0, y: 0, width: 100, height: 100 });
    if (selectedRegistryId && imageRegistry?.images?.[selectedRegistryId]) {
      const entry = imageRegistry.images[selectedRegistryId];
      setCropTargetWidth(entry.width ?? 800);
      setCropTargetHeight(entry.height ?? 600);
      const presetQuality = entry.preset?.[0]
        ? (imageRegistry.presets as Record<string, { quality?: number }>)?.[entry.preset[0]]?.quality
        : undefined;
      setCropQuality(entry.quality_override ?? presetQuality ?? 85);
    } else {
      setCropTargetWidth(800);
      setCropTargetHeight(600);
      setCropQuality(85);
    }
    setCropPanelOpen(true);
  };

  const handleCropApply = async () => {
    if (!selectedRegistryId) return;
    setCropProcessing(true);
    try {
      const resp = await fetch("/api/media/crop-resize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageId: selectedRegistryId,
          crop: {
            x: (cropState.x ?? 0) / 100,
            y: (cropState.y ?? 0) / 100,
            width: (cropState.width ?? 100) / 100,
            height: (cropState.height ?? 100) / 100,
          },
          targetWidth: cropTargetWidth,
          targetHeight: cropTargetHeight,
          quality: cropQuality,
        }),
      });
      const contentType = resp.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        throw new Error(`Unexpected response (${resp.status})`);
      }
      if (!resp.ok) {
        const data = (await resp.json()) as { error?: string };
        throw new Error(data.error ?? "Processing failed");
      }
      const result = (await resp.json()) as {
        id: string;
        src: string;
        width: number;
        height: number;
      };
      await queryClient.invalidateQueries({ queryKey: ["/api/image-registry"] });
      setSelectedSrc(result.src);
      setSelectedRegistryId(result.id);
      setCropPanelOpen(false);
      toast({
        title: "Image processed",
        description: `Saved as ${result.width}×${result.height} WebP`,
      });
    } catch (err: unknown) {
      toast({
        title: "Processing failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setCropProcessing(false);
    }
  };

  const cropSrc = selectedRegistryId
    ? (imageRegistry?.images?.[selectedRegistryId]?.src ?? selectedDisplaySrc)
    : selectedDisplaySrc;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) handleClose();
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
          <div ref={popoverContainerRef} />
          <DialogHeader>
            <DialogTitle>{resolvedTitle}</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-hidden flex flex-col gap-4 py-2">
            {!uploadOnly && (
              <div className="flex rounded-md border overflow-visible">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={`flex-1 rounded-none toggle-elevate ${pickerMode === "browse" ? "toggle-elevated bg-muted" : ""}`}
                  onClick={() => setPickerMode("browse")}
                  data-testid="button-picker-browse"
                >
                  <Search className="h-4 w-4 mr-1.5" />
                  Browse
                </Button>
                <div className="w-px bg-border" />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={`flex-1 rounded-none toggle-elevate ${pickerMode === "upload" ? "toggle-elevated bg-muted" : ""}`}
                  onClick={() => setPickerMode("upload")}
                  data-testid="button-picker-upload"
                >
                  <Upload className="h-4 w-4 mr-1.5" />
                  Upload
                </Button>
              </div>
            )}

            {pickerMode === "browse" && !uploadOnly ? (
              <>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    {searchExpanded ? (
                      <div className="relative flex-1 min-w-0">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          ref={searchInputRef}
                          placeholder={
                            doctype === "pdf"
                              ? "Search PDFs..."
                              : doctype === "video"
                                ? "Search videos..."
                                : "Search images..."
                          }
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              setSearchExpanded(false);
                            }
                          }}
                          className="pl-10 pr-9"
                          data-testid="input-image-gallery-search"
                        />
                        <button
                          type="button"
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            setSearch("");
                            setSearchExpanded(false);
                          }}
                          aria-label="Close search"
                          data-testid="button-close-search"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant={search ? "secondary" : "outline"}
                        className="h-9 w-9 shrink-0 p-0 relative"
                        onClick={() => {
                          setSearchExpanded(true);
                          setTagsExpanded(false);
                        }}
                        aria-label="Search images"
                        data-testid="button-expand-search"
                      >
                        <Search className="h-4 w-4" />
                        {!!search && (
                          <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-primary" />
                        )}
                      </Button>
                    )}

                    {lockedTagFilter ? (
                      <Badge
                        variant="secondary"
                        className="font-normal shrink-0"
                        data-testid="badge-active-tag-filter"
                      >
                        Tag: {lockedTagFilter}
                      </Badge>
                    ) : availableTags.length > 0 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant={tagsExpanded || activeTagFilterCount > 0 ? "secondary" : "outline"}
                        className="h-9 shrink-0 gap-1.5"
                        onClick={() => {
                          setTagsExpanded((v) => !v);
                          setSearchExpanded(false);
                        }}
                        data-testid="button-expand-tag-filter"
                      >
                        <Tags className="h-4 w-4" />
                        <span className="text-xs">Tags</span>
                        {activeTagFilterCount > 0 && (
                          <Badge
                            variant="default"
                            className="h-5 min-w-5 px-1.5 text-[10px] leading-none"
                            data-testid="badge-active-tag-count"
                          >
                            {activeTagFilterCount}
                          </Badge>
                        )}
                      </Button>
                    ) : null}
                  </div>

                  {tagsExpanded && tagFilterSelectable && availableTags.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5" data-testid="tag-filter-row">
                      <Badge
                        variant={activeTagFilters.length === 0 ? "default" : "outline"}
                        className="cursor-pointer text-xs"
                        onClick={() => setActiveTagFilters([])}
                        data-testid="badge-tag-all"
                      >
                        All
                      </Badge>
                      {availableTags.map(({ key, label }) => {
                        const selected = activeTagFilters.includes(key);
                        return (
                          <Badge
                            key={key}
                            variant={selected ? "default" : "outline"}
                            className="cursor-pointer text-xs"
                            onClick={() => toggleTagFilter(key)}
                            data-testid={`badge-tag-${key}`}
                          >
                            {label}
                          </Badge>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto min-h-0" ref={scrollContainerRef}>
                  <div className="columns-4 sm:columns-5 md:columns-6 gap-2">
                    {filteredImages.slice(0, visibleCount).map(([id, img]) => {
                      const variants = childrenByParent[id] || [];
                      const hasVariants = variants.length > 0;
                      const isPanelOpen = openPanelId === id;
                      const isSelected = selectedRegistryId === id
                        || variants.some(([childId, c]) => selectedRegistryId === childId || selectedSrc === c.src);
                      const borderClass = isSelected
                        ? "border-primary"
                        : "border-transparent hover:border-muted-foreground/50";

                      return (
                        <Popover
                          key={id}
                          open={isPanelOpen}
                          onOpenChange={(isOpen) => setOpenPanelId(isOpen ? id : null)}
                        >
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedSrc(img.src);
                                setSelectedAlt(img.alt || "");
                                setSelectedRegistryId(id);
                              }}
                              className={`mb-2 break-inside-avoid rounded-md overflow-hidden bg-muted border-2 transition-colors block w-full ${borderClass}`}
                              title={img.alt}
                              data-testid={`gallery-image-${id}`}
                            >
                              <div className="relative">
                                {doctype === "pdf" ? (
                                  <div className="aspect-square flex flex-col items-center justify-center gap-1 p-2 bg-muted">
                                    <FileText className="h-6 w-6 text-muted-foreground" />
                                    <span className="text-[9px] text-muted-foreground truncate w-full text-center">
                                      {img.src.split("/").pop()?.split("?")[0] || id}
                                    </span>
                                  </div>
                                ) : doctype === "video" ? (
                                  <div className="aspect-square flex flex-col items-center justify-center gap-1 p-2 bg-muted">
                                    <Film className="h-6 w-6 text-muted-foreground" />
                                    <span className="text-[9px] text-muted-foreground truncate w-full text-center">
                                      {img.src.split("/").pop()?.split("?")[0] || id}
                                    </span>
                                  </div>
                                ) : (
                                  <img src={img.src} alt={img.alt} className="w-full h-auto" loading="lazy" />
                                )}
                                {hasVariants && (
                                  <div className="absolute bottom-1 right-1 bg-black/80 text-white rounded text-[11px] font-bold px-1.5 py-0.5 leading-none">
                                    {variants.length}v
                                  </div>
                                )}
                              </div>
                            </button>
                          </PopoverTrigger>
                          {hasVariants && (
                            <PopoverContent
                              side="right"
                              sideOffset={8}
                              className="z-[10001] w-60 p-2 space-y-1"
                              container={popoverContainerRef.current ?? undefined}
                              data-testid="floating-variant-panel"
                            >
                              <p className="text-xs font-semibold text-muted-foreground px-1 pb-0.5">Variantes</p>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedSrc(img.src);
                                  setSelectedAlt(img.alt || "");
                                  setSelectedRegistryId(id);
                                  setOpenPanelId(null);
                                }}
                                className={`w-full flex items-center gap-2 rounded-md p-1.5 text-left hover-elevate ${selectedRegistryId === id ? "bg-muted" : ""}`}
                                data-testid={`variant-original-${id}`}
                              >
                                <img src={img.src} alt={img.alt} className="w-12 h-9 object-cover rounded flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-semibold leading-tight">Original</p>
                                  {img.width && img.height && (
                                    <p className="text-[11px] text-muted-foreground leading-tight">{img.width} × {img.height}</p>
                                  )}
                                </div>
                              </button>
                              {variants.map(([childId, childImg]) => {
                                const childSelected = selectedRegistryId === childId || selectedSrc === childImg.src;
                                return (
                                  <button
                                    key={childId}
                                    type="button"
                                    onClick={() => {
                                      setSelectedSrc(childImg.src);
                                      setSelectedAlt(childImg.alt || img.alt || "");
                                      setSelectedRegistryId(childId);
                                      setOpenPanelId(null);
                                    }}
                                    className={`w-full flex items-center gap-2 rounded-md p-1.5 text-left hover-elevate ${childSelected ? "bg-muted" : ""}`}
                                    data-testid={`variant-child-${childId}`}
                                  >
                                    <img src={childImg.src} alt={childImg.alt} className="w-12 h-9 object-cover rounded flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-medium leading-tight">{childImg.width} × {childImg.height}</p>
                                      {childImg.quality_override !== undefined && (
                                        <p className="text-[11px] text-muted-foreground leading-tight">Quality: {childImg.quality_override}</p>
                                      )}
                                    </div>
                                  </button>
                                );
                              })}
                            </PopoverContent>
                          )}
                        </Popover>
                      );
                    })}
                  </div>
                  {visibleCount < filteredImages.length && (
                    <div className="py-3 flex justify-center">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setVisibleCount((prev) => Math.min(prev + 24, filteredImages.length))
                        }
                        data-testid="button-load-more-images"
                      >
                        Load more ({filteredImages.length - visibleCount} remaining)
                      </Button>
                    </div>
                  )}
                  {filteredImages.length === 0 && (
                    <div className="text-center py-8 px-4 space-y-2" data-testid="empty-gallery-results">
                      <p className="text-muted-foreground">
                        {doctype === "pdf"
                          ? "No PDFs found"
                          : doctype === "video"
                            ? "No videos found"
                            : "No images found"}
                      </p>
                      {(search.trim() || activeTagFilterCount > 0) && (
                        <p className="text-xs text-muted-foreground">
                          {(() => {
                            const parts: string[] = [];
                            if (search.trim()) {
                              parts.push(`search “${search.trim()}”`);
                            }
                            if (activeTagFilterCount > 0) {
                              const labels = effectiveTagFilters.map(
                                (key) =>
                                  availableTags.find((t) => t.key === key)?.label || key,
                              );
                              parts.push(
                                labels.length === 1
                                  ? `tag “${labels[0]}”`
                                  : `tags ${labels.map((l) => `“${l}”`).join(", ")}`,
                              );
                            }
                            return `Filtered by ${parts.join(" and ")}.`;
                          })()}
                        </p>
                      )}
                      {(!!search.trim() || (!lockedTagFilter && activeTagFilterCount > 0)) && (
                        <button
                          type="button"
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                          onClick={() => {
                            setSearch("");
                            setSearchExpanded(false);
                            if (!lockedTagFilter) {
                              setActiveTagFilters([]);
                            }
                            setTagsExpanded(false);
                          }}
                          data-testid="button-clear-gallery-filters"
                        >
                          Clear filters
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center min-h-[200px]">
                {hasCloudProvider || mediaStatus?.defaultProvider === "local" ? (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={acceptAttrForDoctype(doctype)}
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files?.length) handleUpload(e.target.files);
                        e.target.value = "";
                      }}
                      data-testid="input-file-upload"
                    />
                    <div
                      className={`w-full rounded-md border-2 border-dashed p-8 text-center transition-colors cursor-pointer ${
                        dragOver
                          ? "border-primary bg-primary/5"
                          : "border-muted-foreground/30 hover:border-muted-foreground/50"
                      }`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOver(true);
                      }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOver(false);
                        if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files);
                      }}
                      onClick={() => fileInputRef.current?.click()}
                      data-testid="dropzone-upload"
                    >
                      {uploading ? (
                        <div className="flex flex-col items-center gap-2">
                          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                          <p className="text-sm text-muted-foreground">Uploading...</p>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2">
                          <CloudUpload className="h-8 w-8 text-muted-foreground" />
                          <p className="text-sm font-medium">
                            {doctype === "pdf"
                              ? "Drop a PDF here or click to browse"
                              : doctype === "video"
                                ? "Drop a video here or click to browse"
                                : "Drop an image here or click to browse"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {DOCTYPE_UPLOAD_HINTS[doctype]}
                          </p>
                          {hasCloudProvider && mediaStatus?.gcs && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Uploading to {mediaStatus.gcs.bucket}/{mediaStatus.gcs.basePath}
                            </p>
                          )}
                          {!hasCloudProvider && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Saving to 4geeks-com/images/
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="text-center space-y-3 p-4">
                    <Upload className="h-8 w-8 text-muted-foreground mx-auto" />
                    <p className="text-sm font-medium">No storage provider configured</p>
                    <p className="text-sm text-muted-foreground">
                      Drop images directly into the{" "}
                      <code className="bg-muted px-1 rounded text-xs">
                        4geeks-com/images/
                      </code>{" "}
                      folder, then scan the registry to include them.
                    </p>
                  </div>
                )}
              </div>
            )}

            {!uploadOnly && (selectedSrc || selectedDisplaySrc) && (
              <div className="border-t pt-4">
                <div className="flex gap-3">
                  <div className="w-16 h-16 rounded-md overflow-hidden bg-muted border flex-shrink-0">
                    {selectedDisplaySrc ? (
                      doctype === "pdf" ? (
                        <div className="w-full h-full flex items-center justify-center">
                          <FileText className="h-6 w-6 text-muted-foreground" />
                        </div>
                      ) : doctype === "video" ? (
                        <div className="w-full h-full flex items-center justify-center">
                          <Film className="h-6 w-6 text-muted-foreground" />
                        </div>
                      ) : (
                        <img
                          src={selectedDisplaySrc}
                          alt={selectedAlt || "Preview"}
                          className="w-full h-full object-cover"
                        />
                      )
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                        None
                      </div>
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="flex gap-2">
                      <Input
                        value={selectedSrc}
                        onChange={(e) => {
                          setSelectedSrc(e.target.value);
                          setSelectedRegistryId(undefined);
                        }}
                        placeholder={
                          doctype === "pdf"
                            ? "PDF URL or registry ID"
                            : doctype === "video"
                              ? "Video URL or registry ID"
                              : "Image URL or registry ID"
                        }
                        className="text-sm flex-1"
                        data-testid="input-image-url"
                      />
                      {allowCrop && selectedRegistryId && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleOpenCrop}
                          data-testid="button-crop-resize"
                        >
                          <CropIcon className="h-4 w-4 mr-1.5" />
                          Crop & Resize
                        </Button>
                      )}
                    </div>
                    <div className="flex">
                      <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 bg-muted text-muted-foreground text-xs select-none">
                        Alt
                      </span>
                      <Input
                        value={selectedAlt}
                        onChange={(e) => setSelectedAlt(e.target.value)}
                        placeholder="Alt text"
                        className="text-sm rounded-l-none"
                        data-testid="input-image-alt"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex-row gap-2 sm:justify-between">
            <div className="flex min-w-0 flex-1 items-center gap-2 pr-2">
              {!uploadOnly && onRemove ? (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleRemove}
                  data-testid="button-image-remove"
                >
                  <X className="h-4 w-4 mr-2" />
                  Remove
                </Button>
              ) : null}
              {!uploadOnly &&
                ensureTagsOnSave &&
                ensureTagsOnSave.length > 0 &&
                selectedSrc &&
                selectedRegistryId && (
                  <p
                    className="text-[11px] text-muted-foreground leading-snug"
                    data-testid="text-auto-tag-hint"
                  >
                    Saving will tag this image as{" "}
                    {ensureTagsOnSave
                      .map(
                        (key) =>
                          availableTags.find((t) => t.key === key)?.label || key,
                      )
                      .join(", ")}
                    .
                  </p>
                )}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                data-testid="button-image-cancel"
              >
                Cancel
              </Button>
              {!uploadOnly && (
                <Button
                  type="button"
                  onClick={checkFamilyAndSave}
                  disabled={!selectedSrc || saving || bulkModal.checking}
                  data-testid="button-image-save"
                >
                  {saving || bulkModal.checking ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4 mr-2" />
                  )}
                  Save
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={allowCrop && cropPanelOpen} onOpenChange={setCropPanelOpen}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Crop & Resize</DialogTitle>
            <DialogDescription>
              Select a crop area and set target dimensions to create a new optimized image.
            </DialogDescription>
          </DialogHeader>

          {cropSrc && (
            <div className="flex-1 overflow-y-auto space-y-4 py-2">
              <div className="flex justify-center">
                <ReactCrop
                  crop={cropState}
                  onChange={(_, percentCrop) => setCropState(percentCrop)}
                  aspect={
                    cropAspectLock && cropTargetWidth > 0 && cropTargetHeight > 0
                      ? cropTargetWidth / cropTargetHeight
                      : undefined
                  }
                >
                  <img
                    src={cropSrc}
                    alt="Crop source"
                    className="max-w-full max-h-80"
                    data-testid="crop-source-image"
                  />
                </ReactCrop>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Target Width (px)
                  </label>
                  <Input
                    type="number"
                    min={1}
                    value={cropTargetWidth}
                    onChange={(e) => setCropTargetWidth(parseInt(e.target.value, 10) || 1)}
                    className="text-sm"
                    data-testid="input-crop-width"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Target Height (px)
                  </label>
                  <Input
                    type="number"
                    min={1}
                    value={cropTargetHeight}
                    onChange={(e) => setCropTargetHeight(parseInt(e.target.value, 10) || 1)}
                    className="text-sm"
                    data-testid="input-crop-height"
                  />
                </div>
              </div>

              {cropSizeSuggestions.length > 0 && (
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">
                    Suggested size presets
                  </label>
                  <Select
                    onValueChange={(val) => {
                      const s = cropSizeSuggestions.find((s) => s.value === val);
                      if (s) {
                        setCropTargetWidth(s.width);
                        setCropTargetHeight(s.height);
                      }
                    }}
                    data-testid="select-crop-size-preset"
                  >
                    <SelectTrigger data-testid="trigger-crop-size-preset">
                      <SelectValue placeholder="Choose a preset size…" />
                    </SelectTrigger>
                    <SelectContent>
                      {cropSizeSuggestions.map((s) => (
                        <SelectItem key={s.value} value={s.value} data-testid={`option-crop-size-${s.value}`}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex items-center gap-3">
                <Switch
                  checked={cropAspectLock}
                  onCheckedChange={setCropAspectLock}
                  id="crop-aspect-lock-picker"
                  data-testid="toggle-crop-aspect-lock"
                />
                <label htmlFor="crop-aspect-lock-picker" className="text-sm cursor-pointer">
                  Lock aspect ratio
                </label>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">Quality</label>
                  <span className="text-xs text-muted-foreground" data-testid="text-crop-quality">
                    {cropQuality}%
                  </span>
                </div>
                <input
                  type="range"
                  min={50}
                  max={100}
                  value={cropQuality}
                  onChange={(e) => setCropQuality(parseInt(e.target.value, 10))}
                  className="w-full accent-primary"
                  data-testid="slider-crop-quality"
                />
                <p className="text-[11px] text-muted-foreground">
                  Non-default quality generates a separate file (e.g. <code>-q68</code>). Same dimensions + same quality reuses the existing file.
                </p>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCropPanelOpen(false)}
              data-testid="button-crop-cancel"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={cropProcessing}
              onClick={handleCropApply}
              data-testid="button-crop-apply"
            >
              {cropProcessing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CropIcon className="h-4 w-4 mr-2" />
              )}
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bulkModal.open}
        onOpenChange={(isOpen) => {
          if (!isOpen && !bulkModal.applying) {
            setBulkModal({ open: false, usages: [], checking: false, applying: false, selectedIndices: new Set() });
          }
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Apply to other pages</DialogTitle>
            <DialogDescription>
              {bulkModal.checking
                ? "Searching for references in content…"
                : (() => {
                    const total = bulkModal.usages.length;
                    const selectedCount = bulkModal.selectedIndices.size;
                    return `${total} other ${total === 1 ? "page is" : "pages are"} using a different version of this image. Do you want to replace it with this version on those pages too?${selectedCount === 0 ? " (none selected)" : ""}`;
                  })()}
            </DialogDescription>
          </DialogHeader>

          {bulkModal.checking ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {bulkModal.usages.some(u => !u.hasBinding) && (
                <div className="flex items-center gap-2 px-2 py-1 border-b">
                  <Checkbox
                    id="bulk-select-all"
                    data-testid="checkbox-bulk-select-all"
                    checked={
                      bulkModal.usages.every((u, i) => u.hasBinding || bulkModal.selectedIndices.has(i))
                    }
                    onCheckedChange={(checked) => {
                      setBulkModal(prev => {
                        const next = new Set(prev.selectedIndices);
                        prev.usages.forEach((u, i) => {
                          if (!u.hasBinding) {
                            if (checked) next.add(i);
                            else next.delete(i);
                          }
                        });
                        return { ...prev, selectedIndices: next };
                      });
                    }}
                    disabled={bulkModal.applying}
                  />
                  <label htmlFor="bulk-select-all" className="text-sm text-muted-foreground cursor-pointer select-none">
                    Select all
                  </label>
                </div>
              )}
              <div className="flex-1 overflow-y-auto min-h-0 space-y-1 py-1">
                {bulkModal.usages.map((usage, i) => {
                  const entry = imageRegistry?.images?.[usage.currentId];
                  const isVariant = !!entry?.parentId;
                  const typeLabel = CONTENT_TYPE_LABELS[usage.contentType] ?? usage.contentType;
                  const displayTitle = usage.title || usage.slug;
                  const isDisabled = !!usage.hasBinding || bulkModal.applying;
                  const isSelected = bulkModal.selectedIndices.has(i);
                  return (
                    <div
                      key={i}
                      className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-sm ${usage.hasBinding ? "opacity-50" : ""}`}
                      data-testid={`bulk-usage-row-${i}`}
                    >
                      <Checkbox
                        data-testid={`checkbox-bulk-row-${i}`}
                        checked={isSelected && !usage.hasBinding}
                        disabled={isDisabled}
                        onCheckedChange={(checked) => {
                          setBulkModal(prev => {
                            const next = new Set(prev.selectedIndices);
                            if (checked) next.add(i);
                            else next.delete(i);
                            return { ...prev, selectedIndices: next };
                          });
                        }}
                        className="mt-0.5 shrink-0"
                      />
                      <Badge variant="outline" className="shrink-0 text-[10px] mt-0.5">
                        {typeLabel}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium leading-tight truncate">
                          {displayTitle}
                          {usage.locale && <span className="text-muted-foreground ml-1 text-xs">({usage.locale})</span>}
                        </p>
                        {usage.title && usage.title !== usage.slug && (
                          <p className="text-xs text-muted-foreground truncate leading-tight">{usage.slug}</p>
                        )}
                        {(usage.sectionType !== "unknown" || usage.sectionIndex >= 0) && (
                          <p className="text-xs text-muted-foreground leading-tight">
                            {usage.sectionType !== "unknown" ? usage.sectionType : ""}
                            {usage.sectionIndex >= 0 && ` · section ${usage.sectionIndex + 1}`}
                          </p>
                        )}
                        {usage.hasBinding && (
                          <p className="text-xs text-muted-foreground leading-tight italic">
                            Has a binding — update via the binding panel
                          </p>
                        )}
                      </div>
                      <Badge variant="secondary" className="shrink-0 text-[10px] leading-tight">
                        {isVariant
                          ? `${entry?.width ?? "?"} × ${entry?.height ?? "?"}${entry?.quality_override !== undefined ? ` · Quality: ${entry.quality_override}` : ""}`
                          : "Original"}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <DialogFooter className="flex-row gap-2 sm:justify-between mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setBulkModal({ open: false, usages: [], checking: false, applying: false, selectedIndices: new Set() });
                void handleSave();
              }}
              disabled={bulkModal.applying || bulkModal.checking}
              data-testid="button-bulk-skip"
            >
              Save this section only
            </Button>
            <Button
              type="button"
              onClick={handleBulkReplaceAndSave}
              disabled={bulkModal.applying || bulkModal.checking || bulkModal.selectedIndices.size === 0}
              data-testid="button-bulk-confirm"
            >
              {bulkModal.applying ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              {bulkModal.selectedIndices.size === 0
                ? "None selected"
                : `Update ${bulkModal.selectedIndices.size} ${bulkModal.selectedIndices.size === 1 ? "page" : "pages"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
