import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  IconDeviceFloppy,
  IconLoader2,
  IconPlus,
  IconX,
  IconCheck,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLang } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MarkdownEditorField } from "@/components/editing/MarkdownEditorField";
import { useToast } from "@/hooks/use-toast";
import { useImageRegistry } from "@/components/UniversalImage";
import { queryClient } from "@/lib/queryClient";
import {
  fromDateInputValue,
  fromDatetimeLocalValue,
  toDateInputValue,
  toDatetimeLocalValue,
} from "@shared/parseDateTime";
import {
  coerceJsonFieldInput,
  formatJsonFieldDraft,
  type JsonSchema,
} from "@shared/json-field";
import { coerceRelationFieldInput } from "@shared/relation-field";
import {
  coerceEditorSelectScalar,
  collectEditorFieldTokens,
  expandEditorFieldTokens,
} from "@shared/editor-field-values";
import { parseFillIntent } from "@shared/fillIntent";
import type { ImageEntry } from "@shared/schema";
import { CheckCircle2, Clock, AlertCircle, Unlink, ImageIcon, Images, FileText } from "lucide-react";
import { ImagePickerDialog } from "@/components/editing/ImagePickerDialog";
import { RelationFieldPicker } from "@/components/databases/RelationFieldPicker";

const MARKDOWN_TEXTAREA_KEYS = new Set(["content", "body", "readme", "markdown"]);

function isMarkdownEditorType(type: string, key: string): boolean {
  return type === "markdown" || (type === "textarea" && MARKDOWN_TEXTAREA_KEYS.has(key));
}

type ImageCacheStatus = "cached" | "pending" | "failed" | "untracked";

function findRegistryEntryByUrl(
  images: Record<string, ImageEntry> | undefined,
  url: string,
): ImageEntry | undefined {
  if (!images || !url) return undefined;
  return Object.values(images).find((e) => e.source_url === url || e.src === url);
}

function imageCacheStatus(entry: ImageEntry | undefined): ImageCacheStatus {
  if (!entry) return "untracked";
  if (entry.failed_at) return "failed";
  if (!entry.src && entry.source_url) return "pending";
  if (entry.src) return "cached";
  return "untracked";
}

const IMAGE_CACHE_STATUS_UI: Record<
  ImageCacheStatus,
  { icon: ReactNode; label: string; className: string }
> = {
  cached: {
    icon: <CheckCircle2 className="h-3 w-3" />,
    label: "Cached in registry",
    className: "bg-green-600/90 text-white",
  },
  pending: {
    icon: <Clock className="h-3 w-3" />,
    label: "Pending download",
    className: "bg-amber-500/90 text-white",
  },
  failed: {
    icon: <AlertCircle className="h-3 w-3" />,
    label: "Download failed",
    className: "bg-red-600/90 text-white",
  },
  untracked: {
    icon: <Unlink className="h-3 w-3" />,
    label: "Not in image registry",
    className: "bg-muted text-muted-foreground",
  },
};

function ImageUrlFieldEditor({
  fieldKey,
  value,
  cacheImages,
  onChange,
  fallbackPreviewSrc,
  /** When true, gallery opens filtered to og-image and ensures that tag on accept. */
  isReservedOgImageField = false,
}: {
  fieldKey: string;
  value: unknown;
  cacheImages: boolean;
  onChange: (v: string) => void;
  /** Display-only when the field is empty (e.g. Entry Preview OG WebP). Never written into the input. */
  fallbackPreviewSrc?: string | null;
  isReservedOgImageField?: boolean;
}) {
  const { toast } = useToast();
  const { registry } = useImageRegistry();
  const url = typeof value === "string" ? value : "";
  const [broken, setBroken] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fallback = typeof fallbackPreviewSrc === "string" ? fallbackPreviewSrc.trim() : "";
  const usingAutoOg = !url.trim() && !!fallback;
  const hasValue = !!url.trim();

  useEffect(() => {
    setBroken(false);
  }, [url, fallback]);

  const entry = findRegistryEntryByUrl(registry?.images, url);
  const status = imageCacheStatus(entry);
  const statusUi = usingAutoOg
    ? {
        icon: <ImageIcon className="h-3 w-3" />,
        label: "Auto-generated OG preview",
        className: "bg-primary/15 text-primary",
      }
    : IMAGE_CACHE_STATUS_UI[status];
  const fieldPreviewSrc =
    entry?.src ||
    (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("/")
      ? url
      : "");
  const previewSrc = fieldPreviewSrc || (usingAutoOg ? fallback : "");

  const ensureOgTag = async (registryId: string) => {
    try {
      const resp = await fetch(`/api/image-registry/${encodeURIComponent(registryId)}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ add: ["og-image"] }),
      });
      if (!resp.ok) {
        const err = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || "Failed to tag image");
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/image-registry"] });
    } catch (err) {
      toast({
        title: "Image selected, tag not updated",
        description: err instanceof Error ? err.message : "Could not ensure og-image tag",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-2" data-testid={`image-field-${fieldKey}`}>
      <div className="flex items-start gap-3">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border bg-muted flex items-center justify-center">
          {previewSrc && !broken ? (
            <a
              href={previewSrc}
              target="_blank"
              rel="noopener noreferrer"
              className="block h-full w-full cursor-zoom-in"
              title="Open image in new tab"
              data-testid={`link-preview-${fieldKey}`}
            >
              <img
                src={previewSrc}
                alt=""
                className="h-full w-full object-cover"
                onError={() => setBroken(true)}
                data-testid={`img-preview-${fieldKey}`}
              />
            </a>
          ) : (
            <ImageIcon className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-1.5">
          <span
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${statusUi.className}`}
            data-testid={`badge-cache-status-${fieldKey}`}
          >
            {statusUi.icon}
            {statusUi.label}
          </span>
          <div className="flex items-center gap-2">
            <Input
              type="url"
              value={url}
              onChange={(e) => onChange(e.target.value)}
              placeholder="https://…"
              className="text-sm min-w-0 flex-1"
              data-testid={`input-edit-${fieldKey}`}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 shrink-0 text-xs"
              onClick={() => setPickerOpen(true)}
              data-testid={`button-gallery-${fieldKey}`}
            >
              <Images className="h-3.5 w-3.5 mr-1.5" />
              Choose from gallery
            </Button>
            {hasValue && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-9 shrink-0 text-xs text-muted-foreground px-2"
                onClick={() => onChange("")}
                data-testid={`button-clear-image-${fieldKey}`}
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      </div>

      {usingAutoOg ? (
        <p className="text-[11px] text-muted-foreground" data-testid={`text-auto-og-hint-${fieldKey}`}>
          Auto Entry Preview OG is used for og:image and list thumbs while this field is empty.
          Choose from gallery or paste a URL to override.
        </p>
      ) : !hasValue && isReservedOgImageField ? (
        <p className="text-[11px] text-muted-foreground" data-testid={`text-auto-og-hint-${fieldKey}`}>
          While empty, auto Entry Preview generates og:image / list thumbs. Choose from gallery or
          paste a URL to override.
        </p>
      ) : hasValue && isReservedOgImageField ? (
        <p className="text-[11px] text-muted-foreground" data-testid={`text-override-og-hint-${fieldKey}`}>
          This URL overrides auto OG. Clear the field to restore auto-generated Entry Preview.
        </p>
      ) : null}

      {cacheImages && (
        <p className="text-[11px] text-muted-foreground">
          Image will be cached on the next database refresh. Original URL is stored in the field.
        </p>
      )}

      <ImagePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title={isReservedOgImageField ? "Choose OG / social image" : "Choose image"}
        initialSrc={url}
        defaultTagFilter={isReservedOgImageField ? "og-image" : undefined}
        ensureTagsOnSave={isReservedOgImageField ? ["og-image"] : undefined}
        onSave={async (src, _alt, registryId) => {
          onChange(src);
          // Dialog already ensures og-image via ensureTagsOnSave; keep as idempotent fallback.
          if (isReservedOgImageField && registryId) {
            await ensureOgTag(registryId);
          }
        }}
      />
    </div>
  );
}

function PdfUrlFieldEditor({
  fieldKey,
  value,
  onChange,
}: {
  fieldKey: string;
  value: unknown;
  onChange: (v: string) => void;
}) {
  const url = typeof value === "string" ? value : "";
  const [pickerOpen, setPickerOpen] = useState(false);
  const hasValue = !!url.trim();
  const filename = url
    ? url.split("/").pop()?.split("?")[0] || "document.pdf"
    : "";

  return (
    <div className="space-y-2" data-testid={`pdf-field-${fieldKey}`}>
      <div className="flex items-start gap-3">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border bg-muted flex items-center justify-center">
          <FileText className="h-6 w-6 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0 space-y-1.5">
          {hasValue && (
            <p
              className="text-[11px] text-muted-foreground truncate"
              data-testid={`text-pdf-filename-${fieldKey}`}
              title={filename}
            >
              {filename}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Input
              type="url"
              value={url}
              onChange={(e) => onChange(e.target.value)}
              placeholder="https://…/document.pdf"
              className="text-sm min-w-0 flex-1"
              data-testid={`input-edit-${fieldKey}`}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 shrink-0 text-xs"
              onClick={() => setPickerOpen(true)}
              data-testid={`button-gallery-pdf-${fieldKey}`}
            >
              <Images className="h-3.5 w-3.5 mr-1.5" />
              Choose from gallery
            </Button>
            {hasValue && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-9 shrink-0 text-xs text-muted-foreground px-2"
                onClick={() => onChange("")}
                data-testid={`button-clear-pdf-${fieldKey}`}
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      </div>

      {!hasValue && (
        <p className="text-[11px] text-muted-foreground" data-testid={`text-pdf-empty-hint-${fieldKey}`}>
          Choose from gallery or paste a PDF URL.
        </p>
      )}

      <ImagePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        doctype="pdf"
        title="Choose PDF"
        initialSrc={url}
        onSave={(src) => {
          onChange(src);
        }}
      />
    </div>
  );
}

export type EditorOption = string | { value: string; label: string };

export interface EditorConfig {
  type?: string;
  options?: EditorOption[];
  populate_options?: boolean;
  allow_custom_values?: boolean;
  split_comma_values?: boolean;
  cache_images?: boolean;
  /** Legacy UI hint; prefer fill_intent.purpose. */
  description?: string;
  fill_intent?: { goal: string; purpose: string; constraints?: string[] };
  /** Required when type is `json`. */
  schema?: Record<string, unknown>;
  source?: string;
  value?: string;
  label?: string;
  multiple?: boolean;
  required?: boolean | "attached";
}

interface DBConfig {
  field_mapping?: Record<string, string>;
  editor?: Record<string, EditorConfig>;
}

interface DatabaseDetail {
  name: string;
  config: DBConfig;
}

export function normalizeOption(opt: EditorOption): { value: string; label: string } {
  return typeof opt === "string" ? { value: opt, label: opt } : opt;
}

/** cache_images implies the image editor even when type is missing from config. */
export function resolveEditorType(editorConfig?: EditorConfig): string {
  if (editorConfig?.cache_images) return "image";
  return editorConfig?.type || "text";
}

/** Exported for unit tests — coerces form state (json drafts as strings) to save payload. */
export function buildItemFromForm(
  fields: string[],
  formData: Record<string, unknown>,
  editor: Record<string, EditorConfig> | undefined,
  omitEmpty: boolean,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of fields) {
    const value = formData[key];
    const editorType = editor?.[key]?.type;
    if (editorType === "boolean") {
      out[key] = Boolean(value);
    } else if (editorType === "json") {
      const schema = editor?.[key]?.schema as JsonSchema | undefined;
      const draft =
        typeof value === "string" ? value : formatJsonFieldDraft(value);
      const coerced = coerceJsonFieldInput(draft, schema ?? null);
      if (!coerced.ok) {
        throw new Error(`${key}: ${coerced.error}`);
      }
      if (coerced.value === null) {
        if (!omitEmpty) out[key] = null;
      } else {
        out[key] = coerced.value;
      }
    } else if (editorType === "relation") {
      const coerced = coerceRelationFieldInput(value, editor?.[key]);
      if (!coerced.ok) {
        throw new Error(`${key}: ${coerced.error}`);
      }
      if (coerced.value === null) {
        if (!omitEmpty) out[key] = editor?.[key]?.multiple ? [] : null;
      } else {
        out[key] = coerced.value;
      }
    } else if (editorType === "tags") {
      const arr = Array.isArray(value) ? value : [];
      if (arr.length > 0) {
        out[key] = arr;
      } else if (!omitEmpty) {
        out[key] = [];
      }
    } else if (editorType === "number") {
      if (value !== "" && value !== null && value !== undefined) {
        const n = Number(value);
        out[key] = isNaN(n) ? value : n;
      } else if (!omitEmpty) {
        out[key] = null;
      }
    } else if (editorType === "select") {
      const opts = (editor?.[key]?.options ?? []).map((o) =>
        typeof o === "string" ? o : o.value,
      );
      const allNumeric =
        opts.length > 0 && opts.every((o) => /^-?\d+(\.\d+)?$/.test(String(o)));
      if (allNumeric && value !== "" && value !== null && value !== undefined) {
        const n = Number(value);
        out[key] = isNaN(n) ? value : n;
      } else if (value !== "" && value !== null && value !== undefined) {
        out[key] = value;
      } else if (!omitEmpty) {
        out[key] = "";
      }
    } else {
      if (value !== "" && value !== null && value !== undefined) {
        out[key] = value;
      } else if (!omitEmpty) {
        out[key] = "";
      }
    }
  }
  return out;
}

function jsonFieldStatus(
  draft: string,
  schema: JsonSchema | undefined,
): { valid: boolean; message?: string } {
  if (!schema) {
    return { valid: false, message: "json fields require a compilable editor.schema" };
  }
  const coerced = coerceJsonFieldInput(draft, schema);
  if (!coerced.ok) {
    return { valid: false, message: coerced.error };
  }
  return { valid: true };
}

export interface ItemEditModalProps {
  /** Database name — required unless `editorOverrides` + `onlyFields` fully define the form. */
  dbName?: string;
  item: Record<string, unknown> | null;
  onSave: (item: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
  title?: string;
  modalDescription?: string;
  hiddenFields?: string[];
  onlyFields?: string[];
  allItems?: Record<string, unknown>[];
  /**
   * Content-type key for peer option harvesting when there is no database
   * (e.g. blog category select with populate_options). Uses
   * `/api/content-types/:type/items`.
   */
  contentType?: string;
  /** When set, shows a banner indicating which override layer is being edited. */
  overrideLevel?: "database" | "content_type";
  /** Prefer these editor hints over (or instead of) database config.editor. */
  editorOverrides?: Record<string, EditorConfig>;
  /**
   * Display-only thumbnail for the reserved image field when empty
   * (Entry Preview / auto OG). Never merged into form state or save payload.
   */
  imageFallbackPreviewSrc?: string | null;
  /**
   * Form field keys that represent the reserved OG/image source
   * (e.g. `image`, or DB column `preview_image_url` when mapped).
   * Defaults to `["image"]`.
   */
  imageFallbackFieldKeys?: string[];
  /**
   * When true (shared-layout detached entry), fields with `required: "attached"`
   * are labeled optional while detached but stay editable.
   */
  entryDetached?: boolean;
}

export function ItemEditModal({
  dbName,
  item,
  onSave,
  onClose,
  title,
  modalDescription,
  hiddenFields = [],
  onlyFields,
  allItems: externalAllItems,
  contentType,
  overrideLevel,
  editorOverrides,
  imageFallbackPreviewSrc,
  imageFallbackFieldKeys,
  entryDetached = false,
}: ItemEditModalProps) {
  const imageFallbackKeys = new Set(
    (imageFallbackFieldKeys?.length ? imageFallbackFieldKeys : ["image"]).filter(Boolean),
  );

  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [tagInput, setTagInput] = useState<Record<string, string>>({});
  /** Select fields in “add custom value” mode (plus button). */
  const [selectCustomOpen, setSelectCustomOpen] = useState<Record<string, boolean>>({});
  const [selectCustomDraft, setSelectCustomDraft] = useState<Record<string, string>>({});

  const isNew = item === null;
  const skipDbConfig = !!editorOverrides && !!onlyFields?.length && !dbName;

  // SSR seeds a per-page image-registry subset (often just the logo). This modal
  // needs the full catalog so image fields can resolve source_url → cache status.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ["/api/image-registry"] });
  }, []);

  const { data: detail, isLoading: configLoading } = useQuery<DatabaseDetail>({
    queryKey: ["/api/databases", dbName],
    staleTime: 5 * 60 * 1000,
    enabled: !!dbName && !skipDbConfig,
  });

  const { data: allItemsData } = useQuery<{ items: Record<string, unknown>[] }>({
    queryKey: [`/api/databases/${dbName}/items`],
    enabled: !externalAllItems && !!detail && !!dbName,
    staleTime: 5 * 60 * 1000,
  });

  const config = detail?.config;
  const editor = editorOverrides ?? config?.editor;

  const needsPeerPopulate = useMemo(() => {
    if (!editor) return false;
    const keys =
      onlyFields && onlyFields.length > 0
        ? onlyFields
        : Object.keys(editor);
    return keys.some((k) => {
      const hint = editor[k];
      return !!(hint?.populate_options || hint?.allow_custom_values);
    });
  }, [editor, onlyFields]);

  const { data: ctPeerItemsData } = useQuery<{
    results?: Record<string, unknown>[];
  }>({
    queryKey: ["/api/content-types", contentType, "items", "peer-options"],
    queryFn: () =>
      fetch(
        `/api/content-types/${encodeURIComponent(contentType!)}/items?limit=500`,
      ).then((r) => r.json()),
    enabled:
      !externalAllItems &&
      !dbName &&
      !!contentType &&
      needsPeerPopulate,
    staleTime: 60_000,
  });

  const allItems =
    externalAllItems ??
    allItemsData?.items ??
    ctPeerItemsData?.results ??
    [];

  const normalizeFormData = (src: Record<string, unknown>): Record<string, unknown> => {
    const next = { ...src };
    if (!editor) return next;
    for (const [key, hint] of Object.entries(editor)) {
      if (!(key in next)) continue;
      if (hint?.type === "json") {
        const v = next[key];
        if (typeof v === "string") continue;
        next[key] = formatJsonFieldDraft(v);
        continue;
      }
      if (hint?.type === "select" || hint?.type === "tags") {
        const v = next[key];
        if (hint.type === "select") {
          const scalar = coerceEditorSelectScalar(v);
          if (scalar && scalar !== v) next[key] = scalar;
        } else if (v !== null && typeof v === "object" && !Array.isArray(v)) {
          const scalar = coerceEditorSelectScalar(v);
          if (scalar) next[key] = [scalar];
        }
      }
    }
    return next;
  };

  const [formData, setFormData] = useState<Record<string, unknown>>(() =>
    item ? normalizeFormData({ ...item }) : {},
  );
  const [initialized, setInitialized] = useState(!isNew);
  const lastItemRef = useRef(item);

  useEffect(() => {
    if (!item || isNew) return;
    if (lastItemRef.current === item) {
      // Editor hints may arrive after open — reformat json drafts once without wiping edits mid-type
      setFormData((prev) => {
        if (!editor) return prev;
        let changed = false;
        const next = { ...prev };
        for (const [key, hint] of Object.entries(editor)) {
          if (hint?.type !== "json") continue;
          if (!(key in next)) continue;
          if (typeof next[key] === "string") continue;
          next[key] = formatJsonFieldDraft(next[key]);
          changed = true;
        }
        return changed ? next : prev;
      });
      return;
    }
    lastItemRef.current = item;
    setFormData(normalizeFormData({ ...item }));
  }, [item, editor, isNew]);

  useEffect(() => {
    if (!isNew || initialized) return;
    const keys =
      onlyFields && onlyFields.length > 0
        ? onlyFields
        : config?.field_mapping
          ? Object.keys(config.field_mapping)
          : [];
    if (keys.length === 0 && !editorOverrides) return;
    const defaults: Record<string, unknown> = {};
    for (const key of keys) {
      if (hiddenFields.includes(key)) continue;
      const editorType = editor?.[key]?.type;
      defaults[key] =
        editorType === "tags" || (editorType === "relation" && editor?.[key]?.multiple)
          ? []
          : editorType === "boolean"
            ? false
            : "";
    }
    setFormData(defaults);
    setInitialized(true);
  }, [isNew, initialized, config, hiddenFields, onlyFields, editor, editorOverrides]);

  const fields = (() => {
    if (onlyFields && onlyFields.length > 0) {
      return onlyFields.filter((f) => !hiddenFields.includes(f));
    }
    if (config?.field_mapping) {
      return Object.keys(config.field_mapping).filter((f) => !hiddenFields.includes(f));
    }
    return [];
  })();

  const jsonFieldsInvalid = useMemo(() => {
    if (!editor) return false;
    for (const key of fields) {
      if (editor[key]?.type !== "json") continue;
      const draft =
        typeof formData[key] === "string"
          ? (formData[key] as string)
          : formatJsonFieldDraft(formData[key]);
      const status = jsonFieldStatus(draft, editor[key]?.schema as JsonSchema | undefined);
      if (!status.valid) return true;
    }
    return false;
  }, [editor, fields, formData]);

  const relationFieldsInvalid = useMemo(() => {
    if (!editor) return false;
    for (const key of fields) {
      if (editor[key]?.type !== "relation") continue;
      const coerced = coerceRelationFieldInput(formData[key], editor[key]);
      if (!coerced.ok) return true;
    }
    return false;
  }, [editor, fields, formData]);

  const setValue = (key: string, v: unknown) =>
    setFormData((prev) => ({ ...prev, [key]: v }));

  const handleSave = async () => {
    if (jsonFieldsInvalid) {
      toast({
        title: "Save failed",
        description: "Fix invalid JSON fields before saving.",
        variant: "destructive",
      });
      return;
    }
    if (relationFieldsInvalid) {
      toast({
        title: "Save failed",
        description: "Fix invalid relation fields (required pointers only; empty array not allowed).",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const payload = buildItemFromForm(fields, formData, editor, isNew);
      await onSave(payload);
      toast({
        title: isNew ? "Item added" : "Item saved",
        description: isNew ? "The new entry was created successfully." : "Your changes were saved.",
      });
      onClose();
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const renderField = (key: string) => {
    const editorConfig = editor?.[key];
    const type = resolveEditorType(editorConfig);
    const rawManualOptions: EditorOption[] = editorConfig?.options || [];
    const manualOptions = rawManualOptions.map(normalizeOption);
    const canAddCustom =
      editorConfig?.allow_custom_values ?? editorConfig?.populate_options ?? false;
    const splitComma = editorConfig?.split_comma_values === true;

    const dataOptions: { value: string; label: string }[] = (
      editorConfig?.populate_options || editorConfig?.allow_custom_values
    )
      ? collectEditorFieldTokens(allItems, key, { splitComma }).map((v) => ({
          value: v,
          label: v,
        }))
      : [];

    const manualValues = new Set(manualOptions.map((o) => o.value));
    const mergedOptions = [
      ...manualOptions,
      ...dataOptions.filter((o) => !manualValues.has(o.value)),
    ];

    const value = formData[key];

    switch (type) {
      case "markdown":
        return (
          <MarkdownEditorField
            value={String(value ?? "")}
            onChange={(md) => setValue(key, md)}
            label={key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
            data-testid={`input-edit-${key}`}
          />
        );
      case "textarea":
        if (isMarkdownEditorType(type, key)) {
          return (
            <MarkdownEditorField
              value={String(value ?? "")}
              onChange={(md) => setValue(key, md)}
              label={key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              data-testid={`input-edit-${key}`}
            />
          );
        }
        return (
          <Textarea
            value={String(value ?? "")}
            onChange={(e) => setValue(key, e.target.value)}
            className="text-sm min-h-[6rem] resize-y"
            data-testid={`input-edit-${key}`}
          />
        );
      case "boolean":
        return (
          <div className="flex items-center gap-2">
            <Switch
              checked={Boolean(value)}
              onCheckedChange={(v) => setValue(key, v)}
              data-testid={`switch-edit-${key}`}
            />
            <span className="text-sm text-muted-foreground">
              {Boolean(value) ? "Yes" : "No"}
            </span>
          </div>
        );
      case "number":
        return (
          <Input
            type="number"
            value={String(value ?? "")}
            onChange={(e) => setValue(key, e.target.value)}
            className="text-sm"
            data-testid={`input-edit-${key}`}
          />
        );
      case "date": {
        const raw = typeof value === "string" ? value : "";
        return (
          <Input
            type="date"
            value={toDateInputValue(raw)}
            onChange={(e) => setValue(key, fromDateInputValue(e.target.value))}
            className="text-sm"
            data-testid={`input-edit-${key}`}
          />
        );
      }
      case "datetime": {
        const raw = typeof value === "string" ? value : "";
        return (
          <div className="space-y-1">
            <Input
              type="datetime-local"
              value={toDatetimeLocalValue(raw)}
              onChange={(e) =>
                setValue(key, e.target.value ? fromDatetimeLocalValue(e.target.value) : "")
              }
              className="text-sm"
              data-testid={`input-edit-${key}`}
            />
            <p className="text-[11px] text-muted-foreground">
              Accepts timezone-aware or naive values · edits saved as UTC ISO-8601
              {raw ? ` (${raw})` : ""}
            </p>
          </div>
        );
      }
      case "image":
        return (
          <ImageUrlFieldEditor
            fieldKey={key}
            value={value}
            cacheImages={editorConfig?.cache_images === true}
            onChange={(v) => setValue(key, v)}
            fallbackPreviewSrc={
              imageFallbackKeys.has(key) ? imageFallbackPreviewSrc : undefined
            }
            isReservedOgImageField={imageFallbackKeys.has(key)}
          />
        );
      case "pdf":
        return (
          <PdfUrlFieldEditor
            fieldKey={key}
            value={value}
            onChange={(v) => setValue(key, v)}
          />
        );
      case "select": {
        const selectValue = coerceEditorSelectScalar(value);
        const optionValues = new Set(mergedOptions.map((o) => o.value));
        const selectOptions =
          selectValue && !optionValues.has(selectValue)
            ? [{ value: selectValue, label: selectValue }, ...mergedOptions]
            : mergedOptions;
        const customOpen = !!selectCustomOpen[key];
        const customDraft = selectCustomDraft[key] ?? "";
        const commitCustom = () => {
          const next = customDraft
            .trim()
            .toLowerCase()
            .replace(/\s+/g, "-")
            .replace(/[^a-z0-9-]/g, "")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "");
          if (!next) return;
          setValue(key, next);
          setSelectCustomOpen((prev) => ({ ...prev, [key]: false }));
          setSelectCustomDraft((prev) => ({ ...prev, [key]: "" }));
        };
        const cancelCustom = () => {
          setSelectCustomOpen((prev) => ({ ...prev, [key]: false }));
          setSelectCustomDraft((prev) => ({ ...prev, [key]: "" }));
        };

        if (canAddCustom && customOpen) {
          return (
            <div className="flex items-center gap-2" data-testid={`select-custom-${key}`}>
              <Input
                value={customDraft}
                onChange={(e) =>
                  setSelectCustomDraft((prev) => ({ ...prev, [key]: e.target.value }))
                }
                placeholder="New category slug…"
                className="h-9 text-sm font-mono flex-1"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitCustom();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    cancelCustom();
                  }
                }}
                data-testid={`input-edit-custom-${key}`}
              />
              <Button
                type="button"
                size="sm"
                disabled={!customDraft.trim()}
                onClick={commitCustom}
                data-testid={`button-save-custom-${key}`}
              >
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={cancelCustom}
                data-testid={`button-cancel-custom-${key}`}
              >
                <IconX className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        }

        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <Select
                  value={selectValue || undefined}
                  onValueChange={(v) => setValue(key, v)}
                >
                  <SelectTrigger className="text-sm w-full" data-testid={`select-edit-${key}`}>
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    {selectOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {canAddCustom && (
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-9 w-9 shrink-0"
                  title="Add new value"
                  onClick={() => {
                    setSelectCustomDraft((prev) => ({ ...prev, [key]: "" }));
                    setSelectCustomOpen((prev) => ({ ...prev, [key]: true }));
                  }}
                  data-testid={`button-add-custom-${key}`}
                >
                  <IconPlus className="h-4 w-4" />
                </Button>
              )}
            </div>
            {selectOptions.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                No options yet. Enable “include values from existing data” or add manual options.
              </p>
            )}
          </div>
        );
      }
      case "tags": {
        const tags = Array.isArray(value)
          ? (value as string[]).filter((t) => typeof t === "string" && t.trim() !== "")
          : expandEditorFieldTokens(value, { splitComma });
        const inputVal = tagInput[key] || "";
        const addTag = () => {
          const trimmed = inputVal.trim();
          if (!trimmed) return;
          if (!tags.includes(trimmed)) setValue(key, [...tags, trimmed]);
          setTagInput((prev) => ({ ...prev, [key]: "" }));
        };

        if (mergedOptions.length > 0) {
          const optionValues = new Set(mergedOptions.map((o) => o.value));
          const customTags = tags.filter((t) => !optionValues.has(t));
          const toggle = (opt: { value: string; label: string }) => {
            if (tags.includes(opt.value)) {
              setValue(key, tags.filter((t) => t !== opt.value));
            } else {
              setValue(key, [...tags, opt.value]);
            }
          };

          // ≤ 10 options: badge grid — click to select/deselect
          if (mergedOptions.length <= 10) {
            return (
              <div className="space-y-2" data-testid={`tags-${key}`}>
                <div className="flex flex-wrap gap-1.5">
                  {mergedOptions.map((opt) => {
                    const selected = tags.includes(opt.value);
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => toggle(opt)}
                        data-testid={`button-tag-${key}-${opt.value}`}
                        className="inline-flex"
                      >
                        <Badge
                          variant={selected ? "default" : "outline"}
                          className={selected ? "" : "text-muted-foreground"}
                        >
                          {selected && <IconCheck className="h-3 w-3 mr-1" />}
                          {opt.label}
                        </Badge>
                      </button>
                    );
                  })}
                </div>
                {customTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {customTags.map((tag, ti) => (
                      <Badge key={ti} variant="secondary" className="gap-1">
                        {tag}
                        <button
                          type="button"
                          onClick={() => setValue(key, tags.filter((t) => t !== tag))}
                          data-testid={`button-remove-custom-tag-${key}-${ti}`}
                        >
                          <IconX className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
                {canAddCustom && (
                  <div className="flex gap-2">
                    <Input
                      value={inputVal}
                      onChange={(e) =>
                        setTagInput((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      placeholder="Add new value..."
                      className="h-8 text-sm flex-1"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addTag();
                        }
                      }}
                      data-testid={`input-tag-${key}`}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!inputVal.trim()}
                      onClick={addTag}
                      data-testid={`button-add-tag-${key}`}
                    >
                      <IconPlus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            );
          }

          // > 10 options: searchable combobox
          const filteredOptions = inputVal
            ? mergedOptions.filter(
                (o) =>
                  o.label.toLowerCase().includes(inputVal.toLowerCase()) ||
                  o.value.toLowerCase().includes(inputVal.toLowerCase()),
              )
            : mergedOptions;
          return (
            <div className="space-y-2" data-testid={`tags-${key}`}>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => {
                    const opt = mergedOptions.find((o) => o.value === tag);
                    return (
                      <Badge key={tag} variant="secondary" className="gap-1">
                        {opt?.label ?? tag}
                        <button
                          type="button"
                          onClick={() => setValue(key, tags.filter((t) => t !== tag))}
                          data-testid={`button-remove-tag-${key}-${tag}`}
                        >
                          <IconX className="h-3 w-3" />
                        </button>
                      </Badge>
                    );
                  })}
                </div>
              )}
              <Input
                value={inputVal}
                onChange={(e) =>
                  setTagInput((prev) => ({ ...prev, [key]: e.target.value }))
                }
                placeholder="Search options..."
                className="h-8 text-sm"
                data-testid={`input-tag-search-${key}`}
              />
              <div className="border rounded-md max-h-44 overflow-y-auto divide-y">
                {filteredOptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">
                    No options match
                  </p>
                ) : (
                  filteredOptions.map((opt) => {
                    const selected = tags.includes(opt.value);
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => toggle(opt)}
                        className={`flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover-elevate ${
                          selected ? "text-foreground" : "text-muted-foreground"
                        }`}
                        data-testid={`button-tag-${key}-${opt.value}`}
                      >
                        <span className="flex-1">{opt.label}</span>
                        {selected && (
                          <IconCheck className="h-3.5 w-3.5 flex-shrink-0" />
                        )}
                      </button>
                    );
                  })
                )}
                {canAddCustom && inputVal.trim() && !mergedOptions.some((o) => o.value === inputVal.trim()) && (
                  <button
                    type="button"
                    onClick={addTag}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-muted-foreground hover-elevate"
                    data-testid={`button-add-custom-tag-${key}`}
                  >
                    <IconPlus className="h-3.5 w-3.5" />
                    Add "{inputVal.trim()}"
                  </button>
                )}
              </div>
            </div>
          );
        }

        // No options configured: free-form tag input
        return (
          <div className="space-y-2">
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag, ti) => (
                  <Badge key={ti} variant="secondary" className="gap-1">
                    {tag}
                    <button
                      type="button"
                      onClick={() => setValue(key, tags.filter((_, i) => i !== ti))}
                      data-testid={`button-remove-tag-${key}-${ti}`}
                    >
                      <IconX className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                value={inputVal}
                onChange={(e) =>
                  setTagInput((prev) => ({ ...prev, [key]: e.target.value }))
                }
                placeholder="Add tag..."
                className="h-8 text-sm flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                data-testid={`input-tag-${key}`}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!inputVal.trim()}
                onClick={addTag}
                data-testid={`button-add-tag-${key}`}
              >
                <IconPlus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        );
      }
      case "json": {
        const draft =
          typeof value === "string" ? value : formatJsonFieldDraft(value);
        const schema = editorConfig?.schema as JsonSchema | undefined;
        const status = jsonFieldStatus(draft, schema);
        return (
          <div className="space-y-2" data-testid={`json-editor-${key}`}>
            <p className="text-[11px] text-muted-foreground">
              Saved as structured data, not a string. Exact{" "}
              <code className="text-foreground">{"{{ single." + key + " }}"}</code> binds
              return the value as-is.
            </p>
            <div className="rounded-md border overflow-hidden min-h-[10rem]">
              <CodeMirror
                value={draft}
                height="160px"
                extensions={[jsonLang()]}
                theme={oneDark}
                onChange={(v) => setValue(key, v)}
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: true,
                  highlightActiveLine: true,
                }}
                className="text-xs [&_.cm-editor]:text-xs"
                data-testid={`input-edit-${key}`}
              />
            </div>
            {!status.valid && (
              <p
                className="text-[11px] text-destructive"
                data-testid={`text-json-error-${key}`}
              >
                {status.message}
              </p>
            )}
          </div>
        );
      }
      case "relation": {
        return (
          <RelationFieldPicker
            fieldKey={key}
            source={editorConfig?.source || ""}
            valuePath={editorConfig?.value || "slug"}
            labelPath={editorConfig?.label || "name"}
            multiple={!!editorConfig?.multiple}
            required={
              editorConfig?.required === true ||
              (editorConfig?.required === "attached" && !entryDetached)
            }
            value={value}
            onChange={(next) => setValue(key, next)}
          />
        );
      }
      default:
        return (
          <Input
            value={String(value ?? "")}
            onChange={(e) => setValue(key, e.target.value)}
            className="text-sm"
            data-testid={`input-edit-${key}`}
          />
        );
    }
  };

  const showLoading = !!dbName && !skipDbConfig && configLoading;

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title ?? (isNew ? "Add Item" : "Edit Item")}</DialogTitle>
          <DialogDescription>
            {modalDescription ??
              (isNew ? "Fill in the fields to create a new entry." : "Edit the fields below.")}
          </DialogDescription>
        </DialogHeader>
        {overrideLevel && (
          <div
            className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
            data-testid="banner-override-level"
          >
            {overrideLevel === "database" ? (
              <>
                Editing at <span className="font-medium text-foreground">database override</span> level —
                changes apply to listings, dropdowns, and other database-powered UI.
              </>
            ) : (
              <>
                Editing at <span className="font-medium text-foreground">content type override</span> level —
                page/YAML only; does not change the database or listing data.
              </>
            )}
          </div>
        )}
        <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1 min-h-0">
          {showLoading && (
            <div className="flex items-center justify-center py-8">
              <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!showLoading && fields.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
              <p className="text-sm font-medium">No fields configured</p>
              <p className="text-xs text-muted-foreground max-w-xs">
                Go to content type Field Mappings or database settings to add fields before editing.
              </p>
            </div>
          )}
          {!showLoading &&
            fields.map((key) => {
              const editorConfig = editor?.[key];
              const editorType = resolveEditorType(editorConfig);
              const useMarkdown = isMarkdownEditorType(editorType, key);
              const req = editorConfig?.required;
              const showAlwaysRequired = req === true;
              const showAttachedRequired = req === "attached" && !entryDetached;
              const showOptionalWhileDetached = req === "attached" && entryDetached;
              const staffHint =
                parseFillIntent(editorConfig?.fill_intent)?.purpose?.trim() ||
                editorConfig?.description?.trim();
              return (
                <div key={key} className="space-y-1.5">
                  {!useMarkdown && (
                    <Label className="text-xs font-medium capitalize">
                      {key.replace(/_/g, " ")}
                      {showAlwaysRequired || showAttachedRequired ? (
                        <span className="text-primary ml-0.5" title={
                          showAttachedRequired
                            ? "Required when attached to the shared layout"
                            : "Required for publish"
                        }>*</span>
                      ) : null}
                      {showOptionalWhileDetached ? (
                        <span
                          className="ml-1.5 text-[10px] font-normal normal-case text-muted-foreground"
                          data-testid={`label-optional-while-detached-${key}`}
                        >
                          Optional while detached
                        </span>
                      ) : null}
                    </Label>
                  )}
                  {staffHint ? (
                    <p
                      className="text-xs text-muted-foreground"
                      data-testid={`text-field-fill-purpose-${key}`}
                    >
                      {staffHint}
                    </p>
                  ) : null}
                  {renderField(key)}
                </div>
              );
            })}
        </div>
        <DialogFooter className="flex items-center justify-end gap-2 pt-2 border-t mt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={saving}
            data-testid="button-cancel-edit-item"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={
              saving ||
              showLoading ||
              fields.length === 0 ||
              jsonFieldsInvalid ||
              relationFieldsInvalid
            }
            data-testid="button-save-edit-item"
          >
            {saving ? (
              <IconLoader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <IconDeviceFloppy className="h-3.5 w-3.5 mr-1" />
            )}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
