import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { AlertTriangle, Check, ChevronDown, CloudUpload, Code, Database, ExternalLink, HelpCircle, Image, Info, Laptop, Link, Unlink, Loader2, MapPin, Monitor, Pencil, Plus, Redo2, RefreshCw, Save, Search, Settings, Smartphone, Trash2, Undo2, Upload, Video, X } from "lucide-react";
import { IconGitBranch, IconTargetArrow, IconFileCode, IconPencil, IconX, IconShieldCheck, IconShoppingCart } from "@tabler/icons-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BindingConfirmDialog } from "./BindingConfirmDialog";
import { getIcon } from "@/lib/icons";
import { isActivelySelling } from "@/lib/ecommerceProductMap";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ColorPicker } from "@/components/ui/color-picker";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { editContent } from "@/lib/contentApi";
import { emitContentUpdated, registerEditorDirtyCheck } from "@/lib/contentEvents";
import {
  listArticlesOnPage,
  resolveTocGroupId,
  buildSiblingShareOpsForActivation,
} from "@/lib/articleTocShare";
import { getDebugToken } from "@/hooks/useDebugAuth";
import { encodeHtmlValues } from "@shared/htmlEncoding";
import {
  parseEditorType,
  type ColorPickerVariant,
  type EditorType,
} from "@/lib/field-editor-registry";
import { IconPickerModal } from "./IconPickerModal";
import { RelatedFeaturesPicker } from "./RelatedFeaturesPicker";
import { TestimonialItemsPreview } from "./TestimonialItemsPreview";
import { TableContentEditor } from "./TableContentEditor";
import { FaqItemsPicker } from "./FaqItemsPicker";
import { FaqSectionEditorField } from "./FaqSectionEditorField";
import { SchemaOrgSectionEditorField } from "./SchemaOrgSectionEditorField";
import { DbFieldValuesPicker } from "./DbFieldValuesPicker";
import { restoreVariableFieldsForEditor, mergeSavedSectionForLivePreview, detectUnboundTemplatePaths, findFieldPathForExpression } from "./restoreVariableFieldsForEditor";
import { ReplaceBindingModal } from "./ReplaceBindingModal";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { RichTextArea } from "./RichTextArea";
import { MarkdownEditorField } from "./MarkdownEditorField";
import { SectionBindingDialog } from "./SectionBindingDialog";
import { LinkPicker } from "./LinkPicker";
import { ImageWithStylePicker } from "./ImageWithStylePicker";
import type { Section, SectionLayout, ImageRegistry } from "@shared/schema";
import { locations as allLocations, getLocationBySlug } from "@/lib/locations";
import type { Location } from "@shared/session";
import { Badge } from "@/components/ui/badge";
import { normalizeFaqEntries, resolveFaqHardcodedEntries, resolveFaqSearchPhrase } from "@/lib/faqConstants";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useConversionNames } from "@/lib/tracking";
import { buildWebhookSamplePayload } from "@/lib/webhookPayload";
import { useSession } from "@/contexts/SessionContext";
import { apiRequest } from "@/lib/queryClient";
import { AutomationsTagsCard } from "./AutomationsTagsCard";
import { FormFieldsCard } from "./FormFieldsCard";
import { ConsentCard } from "./ConsentCard";
import type { ConsentValues } from "./ConsentCard";
import { WebhookCard, type WebhookSource } from "./WebhookCard";
import { SuccessCard } from "./SuccessCard";
import { RequireSignupCard } from "./RequireSignupCard";
import { ScrollArea } from "@/components/ui/scroll-area";
import CodeMirror from "@uiw/react-codemirror";
import type { EditorView } from "@codemirror/view";
import { yaml } from "@codemirror/lang-yaml";
import { oneDark } from "@codemirror/theme-one-dark";
import { createVariableWidgetPlugin, type TemplateSpan } from "@/lib/cm-variable-highlight";
import { useVariableDefinitions, useVariableContext } from "@/hooks/useVariables";
import {
  formatUnbindLiteralForInsert,
  getSuggestedUnbindDefault,
} from "@shared/templateUnbind";
import * as yamlParser from "js-yaml";
import {
  escapeTemplateVars,
  escapeObjectVars,
  unescapeObjectVars,
  unescapeYamlDump,
} from "@shared/templateVars";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import ReactCrop from "react-image-crop";
import type { Crop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { resolveFormDefaults } from "@shared/resolveFormDefaults";
import {
  joinFormSettingsPath,
  normalizeFormSettingsPath,
} from "@shared/joinFormSettingsPath";
import type { TrackingSettingsResponse } from "@/lib/tracking";
import { collectExtraConsentYamlFields, consentCardChannels, consentKeyFromYamlField, parseConsentSettingsResponse } from "@shared/consent-settings";
import { resolveBoundCtaPaths } from "@shared/validateCtaTracking";
import { showEcommerceEditorTab } from "@shared/wipeOnDuplicate";

function safeYamlLoad(yamlStr: string): unknown {
  const { escaped, map } = escapeTemplateVars(yamlStr);
  const parsed = yamlParser.load(escaped);
  return unescapeObjectVars(parsed, map);
}

function safeYamlDump(obj: unknown, opts?: yamlParser.DumpOptions): string {
  const { escaped, map } = escapeObjectVars(obj);
  const dumped = yamlParser.dump(escaped, opts);
  return unescapeYamlDump(dumped, map);
}

const TEMPLATE_VAR_RE = /\{\{[\s\S]*?\}\}/;

function isTemplateVarValue(value: unknown): boolean {
  return typeof value === "string" && TEMPLATE_VAR_RE.test(value);
}

function getValueAtFieldPath(obj: unknown, fieldPath: string): unknown {
  const parts = fieldPath.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Collect dot-paths whose string leaves contain `{{ ... }}` (mirrors server extractVariableFields). */
function collectTemplateExprPaths(
  obj: unknown,
  prefix = "",
): Record<string, string> {
  const result: Record<string, string> = {};
  if (typeof obj !== "object" || obj === null) return result;
  const entries: Array<[string, unknown]> = Array.isArray(obj)
    ? obj.map((v, i) => [String(i), v] as [string, unknown])
    : Object.entries(obj as Record<string, unknown>).filter(([k]) => !k.startsWith("_"));
  for (const [key, value] of entries) {
    const dotPath = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string" && TEMPLATE_VAR_RE.test(value)) {
      result[dotPath] = value.trim();
    } else if (typeof value === "object" && value !== null) {
      Object.assign(result, collectTemplateExprPaths(value, dotPath));
    }
  }
  return result;
}

/**
 * Bound template paths present when the editor loaded but missing from current YAML
 * (absent key only — empty string / literals are not "cleared").
 */
function detectClearedTemplatePaths(
  originalYaml: string,
  currentYaml: string,
  variableFields?: Record<string, string>,
): string[] {
  let originalPaths: Record<string, string> = { ...(variableFields ?? {}) };
  try {
    const original = safeYamlLoad(originalYaml) as Record<string, unknown> | null;
    if (original && typeof original === "object") {
      originalPaths = { ...originalPaths, ...collectTemplateExprPaths(original) };
    }
  } catch {
    /* keep variableFields-only */
  }
  if (Object.keys(originalPaths).length === 0) return [];

  let current: Record<string, unknown>;
  try {
    const parsed = safeYamlLoad(currentYaml);
    if (!parsed || typeof parsed !== "object") return [];
    current = parsed as Record<string, unknown>;
  } catch {
    return [];
  }

  return Object.keys(originalPaths).filter(
    (path) => getValueAtFieldPath(current, path) === undefined,
  );
}

/** Strip runtime keys; restore `{{ }}` binds from `_variableFields` for the Code editor. */
function stripTransientDynamicKeys(
  section: unknown,
  skipPaths?: Iterable<string>,
): unknown {
  return restoreVariableFieldsForEditor(section, skipPaths);
}

function buildOriginalTemplatePaths(
  originalYaml: string,
  variableFields?: Record<string, string>,
): Record<string, string> {
  let originalPaths: Record<string, string> = { ...(variableFields ?? {}) };
  try {
    const original = safeYamlLoad(originalYaml) as Record<string, unknown> | null;
    if (original && typeof original === "object") {
      originalPaths = { ...originalPaths, ...collectTemplateExprPaths(original) };
    }
  } catch {
    /* keep variableFields-only */
  }
  return originalPaths;
}
import { usePageHistoryOptional } from "@/contexts/PageHistoryContext";
import { useImagePickerContext } from "@/contexts/ImagePickerContext";
import type { ImagePickerTarget } from "@/contexts/ImagePickerContext";

const TECHNICAL_SUFFIXES = new Set(["src", "url", "id", "href"]);
const POSITIONAL_LABELS: Record<string, string> = {
  left: "Izquierda",
  right: "Derecha",
};
const ACRONYMS = new Set(["url", "cta", "id", "api", "seo"]);

function getFieldLabel(fieldPath: string): string {
  const segments = fieldPath.split(".");
  const filtered = segments.filter(
    (s) => !TECHNICAL_SUFFIXES.has(s.toLowerCase()),
  );
  const meaningful = filtered.length > 0 ? filtered : segments;

  const positionalIdx = meaningful.findIndex(
    (s) => s.toLowerCase() in POSITIONAL_LABELS,
  );
  let suffix = "";
  if (positionalIdx !== -1) {
    suffix = ` ${POSITIONAL_LABELS[meaningful[positionalIdx].toLowerCase()]}`;
    meaningful.splice(positionalIdx, 1);
  }

  const label = meaningful
    .map((s) => s.replace(/_/g, " "))
    .join(" ")
    .split(" ")
    .map((w) =>
      ACRONYMS.has(w.toLowerCase())
        ? w.toUpperCase()
        : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(" ");

  return (label + suffix).trim() || fieldPath;
}

interface SectionEditorPanelProps {
  section: Section;
  sectionIndex: number;
  contentType?: string;
  slug?: string;
  locale?: string;
  variant?: string;
  version?: number;
  onUpdate: (updatedSection: Section) => void;
  onClose: () => void;
  onPreviewChange?: (previewSection: Section | null) => void;
  allSections?: Section[];
  isSharedTemplate?: boolean;
  singleEntry?: Record<string, unknown>;
  /** When false, hide entry-scoped structural actions on attached shared-layout pages. */
  allowEntryStructuralOverrides?: boolean;
}

interface ShowOnPickerProps {
  value: string;
  onChange: (value: string) => void;
}

function ShowOnPicker({ value, onChange }: ShowOnPickerProps) {
  const options = [
    { id: "all", label: "Both", icon: Laptop },
    { id: "desktop", label: "Desktop", icon: Monitor },
    { id: "mobile", label: "Mobile", icon: Smartphone },
  ];

  const currentValue = value || "all";

  return (
    <div className="flex items-center justify-between gap-3">
      <Label className="text-sm font-medium whitespace-nowrap">Show on</Label>
      <div className="flex rounded-md border border-border overflow-hidden">
        {options.map((option) => {
          const Icon = option.icon;
          const isSelected = currentValue === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.id === "all" ? "" : option.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${
                isSelected
                  ? "bg-primary text-primary-foreground"
                  : "bg-transparent text-muted-foreground hover:bg-muted"
              } ${option.id !== "all" ? "border-l border-border" : ""}`}
              data-testid={`props-showon-${option.id}`}
            >
              <Icon className="h-4 w-4" />
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function countryCodeToFlag(code: string): string {
  return code
    .toUpperCase()
    .split("")
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join("");
}

interface ShowOnLocationsPickerProps {
  value: string[];
  onChange: (value: string[]) => void;
}

function ShowOnLocationsPicker({
  value,
  onChange,
}: ShowOnLocationsPickerProps) {
  const options = allLocations
    .filter((loc) => loc.visibility === "listed")
    .map((loc) => ({
      value: loc.slug,
      label: `${loc.name}, ${loc.country}`,
      group: loc.region,
      prefix: (
        <span className="text-base leading-none">
          {countryCodeToFlag(loc.country_code)}
        </span>
      ),
      badgeLabel: loc.name,
      searchTerms: [loc.slug, loc.country],
    }));

  return (
    <SearchableMultiSelect
      options={options}
      value={value}
      onChange={onChange}
      label={
        <>
          <MapPin className="h-3.5 w-3.5" />
          Show on locations
        </>
      }
      searchPlaceholder="Search locations..."
      groupLabels={{
        "usa-canada": "USA & Canada",
        latam: "Latin America",
        europe: "Europe",
        online: "Online",
      }}
      testIdPrefix="location"
      emptyMessage="No locations found"
    />
  );
}

interface VariantPickerProps {
  value: string;
  onChange: (value: string) => void;
  options: { id: string; label: string; preview?: () => JSX.Element }[];
  label?: string;
}

function VariantPicker({
  value,
  onChange,
  options,
  label = "Variant",
}: VariantPickerProps) {
  const currentValue = value || options[0]?.id || "";
  const hasPreview = options.some((o) => o.preview);

  if (hasPreview) {
    return (
      <div className="space-y-2">
        <Label className="text-sm font-medium">{label}</Label>
        <div className="grid grid-cols-2 gap-2">
          {options.map((option) => {
            const isSelected = currentValue === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onChange(option.id)}
                className={`flex flex-col items-center gap-1.5 p-2 rounded-md border-2 transition-colors ${
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/30"
                }`}
                data-testid={`props-variant-${option.id}`}
              >
                {option.preview && (
                  <div className="w-full pointer-events-none">
                    {option.preview()}
                  </div>
                )}
                <span className={`text-xs font-medium ${isSelected ? "text-primary" : "text-muted-foreground"}`}>
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <Label className="text-sm font-medium whitespace-nowrap">{label}</Label>
      <div className="flex rounded-md border border-border overflow-hidden">
        {options.map((option, index) => {
          const isSelected = currentValue === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${
                isSelected
                  ? "bg-primary text-primary-foreground"
                  : "bg-transparent text-muted-foreground hover:bg-muted"
              } ${index !== 0 ? "border-l border-border" : ""}`}
              data-testid={`props-variant-${option.id}`}
            >
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TableVariantPreview({ variant }: { variant: string }) {
  const rows = [0, 1, 2];
  if (variant === "default") {
    return (
      <div className="rounded border overflow-hidden">
        <div className="flex bg-muted/50 border-b">
          <div className="flex-1 h-2 m-1.5 rounded bg-muted-foreground/20" />
          <div className="flex-1 h-2 m-1.5 rounded bg-muted-foreground/20" />
          <div className="flex-1 h-2 m-1.5 rounded bg-muted-foreground/20" />
        </div>
        {rows.map((i) => (
          <div key={i} className="flex border-b last:border-0">
            <div className="flex-1 h-2 m-1.5 rounded bg-muted-foreground/10" />
            <div className="flex-1 h-2 m-1.5 rounded bg-muted-foreground/10" />
            <div className="flex-1 h-2 m-1.5 rounded bg-muted-foreground/10" />
          </div>
        ))}
      </div>
    );
  }
  if (variant === "striped") {
    return (
      <div className="rounded border overflow-hidden">
        <div className="flex bg-primary">
          <div className="flex-1 h-2 m-1.5 rounded bg-primary-foreground/30" />
          <div className="flex-1 h-2 m-1.5 rounded bg-primary-foreground/30" />
          <div className="flex-1 h-2 m-1.5 rounded bg-primary-foreground/30" />
        </div>
        {rows.map((i) => (
          <div key={i} className={`flex ${i % 2 === 1 ? "bg-muted/30" : ""}`}>
            <div className="flex-1 h-2 m-1.5 rounded bg-muted-foreground/10" />
            <div className="flex-1 h-2 m-1.5 rounded bg-muted-foreground/10" />
            <div className="flex-1 h-2 m-1.5 rounded bg-muted-foreground/10" />
          </div>
        ))}
      </div>
    );
  }
  if (variant === "cards") {
    return (
      <div className="flex flex-col gap-1">
        {rows.map((i) => (
          <div key={i} className="rounded border p-1.5 space-y-1">
            <div className="flex justify-between gap-2">
              <div className="w-8 h-1.5 rounded bg-muted-foreground/20" />
              <div className="w-12 h-1.5 rounded bg-muted-foreground/10" />
            </div>
            <div className="flex justify-between gap-2">
              <div className="w-6 h-1.5 rounded bg-muted-foreground/20" />
              <div className="w-10 h-1.5 rounded bg-muted-foreground/10" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (variant === "comparison") {
    return (
      <div className="rounded-lg overflow-hidden shadow-sm ring-1 ring-black/5">
        <div className="flex bg-primary">
          <div className="flex-1 h-2.5 m-1 rounded bg-primary-foreground/30" />
          <div className="flex-1 h-2.5 m-1 rounded bg-primary-foreground/30" />
          <div className="flex-1 h-2.5 m-1 rounded bg-primary-foreground/30" />
        </div>
        {rows.map((i) => (
          <div key={i} className={`flex ${i % 2 === 0 ? "" : "bg-primary/5"}`}>
            <div className="flex-1 h-2 m-1 rounded bg-muted-foreground/10" />
            <div className="flex-1 h-2 m-1 rounded bg-muted-foreground/15" />
            <div className="flex-1 h-2 m-1 rounded bg-muted-foreground/10" />
          </div>
        ))}
      </div>
    );
  }
  return null;
}

export function SectionEditorPanel({
  section,
  sectionIndex,
  contentType,
  slug,
  locale,
  variant,
  version,
  onUpdate,
  onClose,
  onPreviewChange,
  allSections,
  isSharedTemplate,
  singleEntry,
  allowEntryStructuralOverrides = true,
}: SectionEditorPanelProps) {
  const { toast } = useToast();
  const { session } = useSession();
  const [yamlContent, setYamlContent] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("code");
  const [scopeDialogOpen, setScopeDialogOpen] = useState(false);
  const [templateSaveConfirmOpen, setTemplateSaveConfirmOpen] = useState(false);
  /** Cleared `{{ single.* }}` paths approved via the shared-template confirm. */
  const [pendingClearedTemplatePaths, setPendingClearedTemplatePaths] = useState<string[]>([]);
  /** Unbound paths → static literals for shared-template save confirm. */
  const [pendingUnboundTemplateDetails, setPendingUnboundTemplateDetails] = useState<
    Array<{ path: string; literal: string }>
  >([]);
  const sessionUnboundPathsRef = useRef<Set<string>>(new Set());
  const [replaceBindingOpen, setReplaceBindingOpen] = useState(false);
  const [pendingReplaceBinding, setPendingReplaceBinding] = useState<{
    span: TemplateSpan;
    fieldPath?: string;
    suggestedDefault: string;
    isMixedString: boolean;
  } | null>(null);

  const { data: variableDefinitions } = useVariableDefinitions();
  const variableContext = useVariableContext();
  const variableDefinitionsRef = useRef(variableDefinitions);
  variableDefinitionsRef.current = variableDefinitions;
  const variableContextRef = useRef(variableContext);
  variableContextRef.current = variableContext;

  const hasChangesRef = useRef(hasChanges);
  hasChangesRef.current = hasChanges;
  useEffect(() => {
    registerEditorDirtyCheck(() => hasChangesRef.current);
    return () => registerEditorDirtyCheck(null);
  }, []);

  const hasVariableFields = !!(section as Record<string, unknown>)._variableFields;
  const isPerEntryOverlaySection = !!(section as Record<string, unknown>)._perEntrySource;
  /**
   * Load raw single.*.yml for shared-layout template sections only.
   * Ordinary pages (e.g. locations) keep authored `{{ }}` via
   * restoreVariableFieldsForEditor — do not hit single-template-sections for them.
   */
  const shouldLoadTemplateYaml =
    !!contentType && !!isSharedTemplate && !isPerEntryOverlaySection;

  // Map from section field path → template key (e.g. "image.src" → "thumbnail")
  const variableFieldToTemplateKey = (() => {
    const vf = (section as Record<string, unknown>)._variableFields as Record<string, string> | undefined;
    if (!vf) return {} as Record<string, string>;
    const result: Record<string, string> = {};
    for (const [fieldPath, templateExpr] of Object.entries(vf)) {
      // Parse expressions like {{ single.thumbnail }} or {{ single.thumbnail | default.jpg }}
      const match = /\{\{\s*single\.([^|}\s]+)/.exec(templateExpr);
      if (match) {
        result[fieldPath] = match[1].trim();
      }
    }
    return result;
  })();

  // Set of template keys that are currently overridden in the DB
  const { data: dbOverridesData, refetch: refetchDbOverrides } = useQuery<{ overrides: Record<string, unknown> }>({
    queryKey: ["/api/content-types", contentType, "db-overrides", slug],
    queryFn: async () => {
      const res = await fetch(`/api/content-types/${contentType}/db-overrides/${slug}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<{ overrides: Record<string, unknown> }>;
    },
    enabled: hasVariableFields && !!contentType && !!slug,
    staleTime: 0,
  });

  const dbOverrides = dbOverridesData?.overrides ?? {};
  const hasDbOverrides = Object.keys(dbOverrides).length > 0;

  // Check if a specific field path has a DB override
  const fieldHasOverride = (fieldPath: string): boolean => {
    const templateKey = variableFieldToTemplateKey[fieldPath];
    return !!templateKey && templateKey in dbOverrides;
  };

  // Track which template key is currently being reset (to disable button and show spinner)
  const [resettingField, setResettingField] = useState<string | null>(null);

  const bindingQueryClient = useQueryClient();

  // Shared-template variant YAML: single.{variant}.{locale}.yml (not entry ?variant= drafts).
  const effectiveTemplateVariant = (() => {
    if (!isSharedTemplate) return "";
    if (typeof window === "undefined") return variant ?? "";
    const params = new URLSearchParams(window.location.search);
    return params.get("force_variant") || params.get("variant") || variant || "";
  })();

  const templateSectionsQueryKey = [
    "/api/content-types",
    contentType,
    "single-template-sections",
    locale ?? "en",
    effectiveTemplateVariant,
  ] as const;

  const { data: templateSectionsData, refetch: refetchTemplateSections } = useQuery<{ sections: string[] }>({
    queryKey: [...templateSectionsQueryKey],
    queryFn: async () => {
      const params = new URLSearchParams({ locale: locale ?? "en" });
      if (effectiveTemplateVariant) params.set("variantSlug", effectiveTemplateVariant);
      const res = await fetch(`/api/content-types/${contentType}/single-template-sections?${params}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<{ sections: string[] }>;
    },
    enabled: shouldLoadTemplateYaml,
  });

  /** After saving shared-template sections, reload YAML from disk so the editor matches the template. */
  const refreshTemplateYamlFromServer = async () => {
    if (!shouldLoadTemplateYaml) return;
    await bindingQueryClient.invalidateQueries({ queryKey: [...templateSectionsQueryKey] });
    const result = await refetchTemplateSections();
    const templateYaml = result.data?.sections?.[sectionIndex];
    if (templateYaml) {
      setYamlContent(templateYaml);
      initialYamlRef.current = templateYaml;
      setHasChanges(false);
    }
  };

  useEffect(() => {
    if (!templateSectionsData) return;
    const templateYaml = templateSectionsData.sections?.[sectionIndex];
    if (!templateYaml || hasChangesRef.current) return;
    setYamlContent(templateYaml);
    initialYamlRef.current = templateYaml;
  }, [templateSectionsData, sectionIndex, slug]);

  // Binding state
  const [bindingDialogOpen, setBindingDialogOpen] = useState(false);
  const [bindingConfirmOpen, setBindingConfirmOpen] = useState(false);
  const [exampleDialogOpen, setExampleDialogOpen] = useState(false);
  const [exampleCopied, setExampleCopied] = useState(false);
  const [locationsPickerOpen, setLocationsPickerOpen] = useState(false);
  const [conversionNameEditing, setConversionNameEditing] = useState(false);
  const [tocShareApplying, setTocShareApplying] = useState(false);
  const [consentsEditing, setConsentsEditing] = useState(false);
  const [webhookEditing, setWebhookEditing] = useState(false);
  const [successEditing, setSuccessEditing] = useState(false);

  const sectionComponentType = (section as Record<string, unknown>)?.type as string || "";

  const { data: bindingData, refetch: refetchBinding } = useQuery({
    queryKey: ["/api/bindings/section", contentType, slug, sectionIndex, locale],
    queryFn: async () => {
      if (!contentType || !slug) return { group: null };
      const res = await fetch(`/api/bindings/section?contentType=${contentType}&slug=${slug}&sectionIndex=${sectionIndex}&locale=${locale || ""}`);
      return res.json();
    },
    enabled: !!contentType && !!slug,
  });

  const bindingGroup = bindingData?.group as {
    id: string;
    name?: string;
    component: string;
    locale: string;
    members: Array<{ contentType: string; slug: string; sectionIndex: number }>;
  } | null;

  const boundSiblings = !bindingGroup ? [] : bindingGroup.members.filter(
    m => !(m.contentType === contentType && m.slug === slug && m.sectionIndex === sectionIndex)
  );

  // Icon picker state
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [iconPickerTarget, setIconPickerTarget] = useState<{
    arrayField: string;
    index: number;
    field: string;
    label: string;
    currentIcon: string;
    simpleFieldPath?: string;
  } | null>(null);
  const [nestedUpdateFn, setNestedUpdateFn] = useState<
    ((value: string) => void) | null
  >(null);

  // Image picker modal state
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [imagePickerTarget, setImagePickerTarget] = useState<ImagePickerTarget | null>(null);
  const [imageGallerySearch, setImageGallerySearch] = useState("");
  const [visibleImageCount, setVisibleImageCount] = useState(48);
  const [tableEditorMode, setTableEditorMode] = useState<
    "content" | "filter" | null
  >(null);
  const [imagePickerMode, setImagePickerMode] = useState<"browse" | "upload">(
    "browse",
  );
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Register this panel's image picker into the global ImagePickerContext
  const imagePickerCtx = useImagePickerContext();
  const setImagePickerOpenRef = useRef(setImagePickerOpen);
  const setImagePickerTargetRef = useRef(setImagePickerTarget);
  setImagePickerOpenRef.current = setImagePickerOpen;
  setImagePickerTargetRef.current = setImagePickerTarget;
  useEffect(() => {
    if (!imagePickerCtx) return;
    imagePickerCtx.registerPicker({
      openPicker: (target: ImagePickerTarget) => {
        setImagePickerTargetRef.current(target);
        setImagePickerOpenRef.current(true);
      },
    });
    return () => {
      imagePickerCtx.registerPicker(null);
    };
  }, [imagePickerCtx]);

  // Crop panel state
  const [cropPanelOpen, setCropPanelOpen] = useState(false);
  const [cropState, setCropState] = useState<Crop>({ unit: "%", x: 0, y: 0, width: 100, height: 100 });
  const [cropTargetWidth, setCropTargetWidth] = useState(800);
  const [cropTargetHeight, setCropTargetHeight] = useState(600);
  const [cropAspectLock, setCropAspectLock] = useState(false);
  const [cropQuality, setCropQuality] = useState(85);
  const [cropProcessing, setCropProcessing] = useState(false);

  const [videoPickerOpen, setVideoPickerOpen] = useState(false);
  const [videoPickerTarget, setVideoPickerTarget] = useState<{
    fieldPath?: string;
    label?: string;
    currentUrl: string;
    arrayPath?: string;
    index?: number;
    field?: string;
  } | null>(null);
  const [videoPickerMode, setVideoPickerMode] = useState<"browse" | "upload" | "url">("url");
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoDragOver, setVideoDragOver] = useState(false);
  const videoFileInputRef = useRef<HTMLInputElement>(null);
  const [videoGallerySearch, setVideoGallerySearch] = useState("");
  const [visibleVideoCount, setVisibleVideoCount] = useState(48);
  const editorViewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    return () => {
      editorViewRef.current = null;
    };
  }, [slug, sectionIndex]);

  const handleUndoRedoRestore = (content: string) => {
    setYamlContent(content);
    setHasChanges(true);
    try {
      const parsed = safeYamlLoad(content) as Section;
      setParseError(null);
      if (parsed && typeof parsed === "object" && onPreviewChange) {
        onPreviewChange(parsed);
      }
    } catch (error) {
      if (error instanceof Error) {
        setParseError(error.message);
      }
    }
  };

  const {
    pushState: pushUndoState,
    canUndo,
    canRedo,
    undo,
    redo,
    clear: clearUndoHistory,
  } = useUndoRedo(yamlContent, handleUndoRedoRestore, {
    enableKeyboardShortcuts: true,
  });

  const pageHistory = usePageHistoryOptional();

  // Store initial state when section loads for undo capability
  const initialYamlRef = useRef<string | null>(null);
  // Stable ref so the effect below can read the latest section without it being a dep
  const sectionRef = useRef(section);
  sectionRef.current = section;

  // Clear undo history and store initial state when section identity changes.
  // clearUndoHistory is stable (useCallback in useUndoRedo); sectionRef lets us
  // read the latest section value without adding the unstable section object to
  // deps (which would cause an infinite re-render loop).
  useEffect(() => {
    clearUndoHistory();
    sessionUnboundPathsRef.current = new Set();
    try {
      const sectionForEditor = stripTransientDynamicKeys(
        sectionRef.current,
        sessionUnboundPathsRef.current,
      );
      const yamlStr = safeYamlDump(sectionForEditor, {
        lineWidth: -1,
        noRefs: true,
        quotingType: '"',
      });
      initialYamlRef.current = yamlStr;
    } catch {
      initialYamlRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionIndex, slug]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const {
        sectionIndex: idx,
        originalText,
        templateSyntax,
        selectionFrom,
        selectionTo,
      } = detail;
      if (idx !== sectionIndex) return;

      detail._handled = true;

      const view = editorViewRef.current;
      if (view) {
        const doc = view.state.doc.toString();
        let from: number;
        let to: number;

        if (
          selectionFrom !== undefined &&
          selectionTo !== undefined &&
          selectionFrom >= 0 &&
          selectionTo <= doc.length &&
          doc.slice(selectionFrom, selectionTo) === originalText
        ) {
          from = selectionFrom;
          to = selectionTo;
        } else {
          const pos = doc.indexOf(originalText);
          if (pos === -1) {
            toast({
              title: "Text not found",
              description:
                "The selected text was not found in the YAML content.",
              variant: "destructive",
            });
            return;
          }
          from = pos;
          to = pos + originalText.length;
        }

        view.dispatch({
          changes: { from, to, insert: templateSyntax },
        });
        toast({
          title: "Variable inserted",
          description: "Text replaced with variable template.",
        });
      } else {
        setYamlContent((prev) => {
          if (!prev.includes(originalText)) {
            toast({
              title: "Text not found",
              description:
                "The selected text was not found in the YAML content.",
              variant: "destructive",
            });
            return prev;
          }
          const updated = prev.replace(originalText, templateSyntax);
          setHasChanges(true);
          setParseError(null);
          try {
            const parsed = safeYamlLoad(updated) as Record<string, unknown>;
            if (onPreviewChange) onPreviewChange(parsed as Section);
          } catch {
            /* ignore parse errors during preview */
          }
          toast({
            title: "Variable inserted",
            description: "Text replaced with variable template.",
          });
          return updated;
        });
      }
    };

    window.addEventListener("variable-created-replace", handler);
    return () =>
      window.removeEventListener("variable-created-replace", handler);
  }, [sectionIndex, toast, onPreviewChange]);

  // Fetch image registry for gallery picker
  const { data: imageRegistry, refetch: refetchRegistry } =
    useQuery<ImageRegistry>({
      queryKey: ["/api/image-registry"],
    });

  const { data: mediaStatus } = useQuery<{
    defaultProvider: string;
    providers: string[];
    gcs?: { bucket: string; basePath: string; projectId?: string };
  }>({
    queryKey: ["/api/media/status"],
  });

  const hasCloudProvider = (mediaStatus?.providers ?? []).some(
    (p) => p !== "local",
  );

  const handleImageUpload = async (files: FileList | File[]) => {
      if (!files.length || !imagePickerTarget) return;
      const file = files[0];
      const allowed = [
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".svg",
        ".avif",
        ".gif",
      ];
      const ext = `.${file.name.split(".").pop()?.toLowerCase()}`;
      if (!allowed.includes(ext)) {
        toast({
          title: "Unsupported file type",
          description: `${ext} files are not supported`,
          variant: "destructive",
        });
        return;
      }
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        const resp = await fetch("/api/image-registry/upload", {
          method: "POST",
          body: formData,
        });
        if (!resp.ok) {
          const err = await resp.json();
          throw new Error(err.error || "Upload failed");
        }
        const result = (await resp.json()) as {
          id: string;
          src: string;
          alt: string;
          duplicate?: boolean;
          existingId?: string;
        };
        await refetchRegistry();
        const fieldName =
          imagePickerTarget.srcField || imagePickerTarget.fieldPath || "";
        const isIdField = fieldName.endsWith("_id");
        setImagePickerTarget({
          ...imagePickerTarget,
          currentSrc: isIdField ? result.id : result.src,
          currentAlt: result.alt,
          currentRegistryId: result.id,
        });
        setImagePickerMode("browse");
        if (result.duplicate) {
          toast({
            title: "Image already exists",
            description: `This image is already registered as "${result.existingId}". Using the existing one.`,
          });
        } else {
          toast({
            title: "Image uploaded",
            description: `Registered as "${result.id}"`,
          });
        }
      } catch (err: any) {
        toast({
          title: "Upload failed",
          description: err.message,
          variant: "destructive",
        });
      } finally {
        setUploading(false);
    }
  };

  const handleVideoUpload = async (files: FileList | File[]) => {
      if (!files.length || !videoPickerTarget) return;
      const file = files[0];
      const allowed = [".mp4", ".webm", ".mov", ".ogg", ".m4v"];
      const ext = `.${file.name.split(".").pop()?.toLowerCase()}`;
      if (!allowed.includes(ext)) {
        toast({
          title: "Unsupported file type",
          description: `${ext} files are not supported. Use MP4, WebM, MOV, or OGG.`,
          variant: "destructive",
        });
        return;
      }
      setVideoUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        const resp = await fetch("/api/image-registry/upload", {
          method: "POST",
          body: formData,
        });
        if (!resp.ok) {
          const err = await resp.json();
          throw new Error(err.error || "Upload failed");
        }
        const result = (await resp.json()) as {
          id: string;
          src: string;
          alt: string;
          duplicate?: boolean;
          existingId?: string;
        };
        await refetchRegistry();
        setVideoPickerTarget({
          ...videoPickerTarget,
          currentUrl: result.src,
        });
        setVideoPickerMode("url");
        if (result.duplicate) {
          toast({
            title: "Video already exists",
            description: `This video is already registered as "${result.existingId}". Using the existing one.`,
          });
        } else {
          toast({
            title: "Video uploaded",
            description: `Registered as "${result.id}"`,
          });
        }
      } catch (err: any) {
        toast({
          title: "Upload failed",
          description: err.message,
          variant: "destructive",
        });
      } finally {
        setVideoUploading(false);
      }
  };

  const filteredGalleryVideos = (() => {
    if (!imageRegistry?.images) return [];
    const videoExts = [".mp4", ".webm", ".mov", ".ogg", ".m4v"];
    const searchLower = videoGallerySearch.toLowerCase();
    return Object.entries(imageRegistry.images)
      .filter(([id, img]) => {
        const isVideo = videoExts.some((ext) => img.src.toLowerCase().endsWith(ext));
        if (!isVideo) return false;
        if (!searchLower) return true;
        return (
          id.toLowerCase().includes(searchLower) ||
          img.alt.toLowerCase().includes(searchLower) ||
          img.tags?.some((tag) => tag.toLowerCase().includes(searchLower))
        );
      })
      .sort((a, b) => (b[1].usage_count ?? 0) - (a[1].usage_count ?? 0));
  })();

  useEffect(() => {
    setVisibleVideoCount(48);
  }, [videoGallerySearch, videoPickerOpen]);

  // Filter and sort gallery images by usage count (most used first)
  const filteredGalleryImages = (() => {
    if (!imageRegistry?.images) return [];
    const searchLower = imageGallerySearch.toLowerCase();
    const tagFilter = imagePickerTarget?.tagFilter?.toLowerCase();
    return Object.entries(imageRegistry.images)
      .filter(([id, img]) => {
        // Apply tag filter first (e.g., "logo" to show only logos)
        if (
          tagFilter &&
          !img.tags?.some((tag) => tag.toLowerCase() === tagFilter)
        ) {
          return false;
        }
        if (!searchLower) return true;
        return (
          id.toLowerCase().includes(searchLower) ||
          img.alt.toLowerCase().includes(searchLower) ||
          img.tags?.some((tag) => tag.toLowerCase().includes(searchLower))
        );
      })
      .sort((a, b) => (b[1].usage_count ?? 0) - (a[1].usage_count ?? 0));
  })();

  // Reset visible count when search changes or modal opens
  useEffect(() => {
    setVisibleImageCount(48);
  }, [imageGallerySearch, imagePickerOpen]);

  // Parse current YAML to extract props
  const parsedSection = (() => {
    try {
      return safeYamlLoad(yamlContent) as Record<string, unknown> | null;
    } catch {
      return null;
    }
  })();

  const currentBackground = (parsedSection?.background as string) || "";
  const currentShowOn = (parsedSection?.showOn as string) || "";
  const currentShowOnLocations =
    (parsedSection?.showOnLocations as string[]) || [];
  const currentHiddenUntilRedirection =
    parsedSection?.hidden_until_redirection === true ||
    parsedSection?.hidden_until_redirection === "true";

  // Initialize YAML content from section. Also re-initializes when slug changes so
  // navigating between DB-backed single pages (e.g. blog posts) resets stale state.
  useEffect(() => {
    // When the template data is already cached (same content-type, same locale),
    // both this effect and the template effect above fire in the same React flush.
    // Effects run in definition order, so the template effect runs first and sets
    // the correct {{ }} variable YAML. If we then overwrite it here with the plain
    // serialised section, the variable highlights are lost — which is exactly the
    // bug reported. Skip setYamlContent in that case and let the template effect
    // own the content; we still clear hasChanges so the editor shows no dirty state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    if (shouldLoadTemplateYaml && templateSectionsData) {
      setHasChanges(false);
      return;
    }
    try {
      const sectionForEditor = stripTransientDynamicKeys(
        section,
        sessionUnboundPathsRef.current,
      );
      const yamlStr = safeYamlDump(sectionForEditor, {
        lineWidth: -1,
        noRefs: true,
        quotingType: '"',
      });
      setYamlContent(yamlStr);
      setHasChanges(false);
    } catch (error) {
      console.error("Error converting section to YAML:", error);
    }
  }, [section, slug]); // intentionally excludes templateSectionsData — see comment above

  const handleRequestUnbind = useCallback(
    (span: TemplateSpan) => {
      const vf = (sectionRef.current as Record<string, unknown>)._variableFields as
        | Record<string, string>
        | undefined;
      const fieldPath = vf ? findFieldPathForExpression(vf, span.expr) : undefined;
      const suggested = getSuggestedUnbindDefault(span.expr, {
        definitions: variableDefinitionsRef.current ?? {},
        context: variableContextRef.current ?? {},
      });
      const suggestedDefault = formatUnbindLiteralForInsert(suggested);
      let isMixedString = false;
      if (fieldPath && vf?.[fieldPath]) {
        isMixedString = vf[fieldPath].trim() !== span.expr.trim();
      }
      setPendingReplaceBinding({
        span,
        fieldPath,
        suggestedDefault,
        isMixedString,
      });
      setReplaceBindingOpen(true);
    },
    [],
  );

  const handleRequestUnbindRef = useRef(handleRequestUnbind);
  handleRequestUnbindRef.current = handleRequestUnbind;

  const cmExtensions = useMemo(
    () => [
      yaml(),
      createVariableWidgetPlugin({
        getDefinitions: () => variableDefinitionsRef.current ?? {},
        getContext: () => variableContextRef.current ?? {},
        onRequestUnbind: (span) => handleRequestUnbindRef.current(span),
      }),
    ],
    [],
  );

  const handleConfirmReplaceBinding = (literal: string) => {
    if (!pendingReplaceBinding) return;
    const { span, fieldPath } = pendingReplaceBinding;
    const view = editorViewRef.current;
    if (view) {
      if (!hasChanges && initialYamlRef.current && yamlContent) {
        pushUndoState(initialYamlRef.current);
      }
      view.dispatch({
        changes: { from: span.from, to: span.to, insert: literal },
      });
    }
    if (fieldPath) {
      sessionUnboundPathsRef.current.add(fieldPath);
    }
    setPendingReplaceBinding(null);
  };

  const handleYamlChange = (value: string) => {
    // Save the initial state on first edit so user can undo back to it
    if (!hasChanges && initialYamlRef.current && yamlContent !== value) {
      pushUndoState(initialYamlRef.current);
    }

    setYamlContent(value);
    setHasChanges(true);

    // Validate YAML on change and trigger live preview
    try {
      const parsed = safeYamlLoad(value) as Section;
      setParseError(null);

      // Trigger live preview if valid section
      if (parsed && typeof parsed === "object" && onPreviewChange) {
        onPreviewChange(parsed);
      }
    } catch (error) {
      if (error instanceof Error) {
        setParseError(error.message);
      }
    }
  };

  // Set/delete a string at a (possibly nested) path on a parsed YAML object.
  const setStringAtPath = (
    parsed: Record<string, unknown>,
    key: string,
    value: string,
  ) => {
    const pathParts = key.split(".");
    if (pathParts.length === 1) {
      if (value) {
        parsed[key] = value;
      } else {
        delete parsed[key];
      }
      return;
    }

    let current: Record<string, unknown> = parsed;
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      if (!current[part] || typeof current[part] !== "object") {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }
    const finalKey = pathParts[pathParts.length - 1];
    if (value) {
      current[finalKey] = value;
    } else {
      delete current[finalKey];
    }

    if (!value) {
      for (let i = pathParts.length - 2; i >= 0; i--) {
        const parentPath = pathParts.slice(0, i);
        let parent: Record<string, unknown> = parsed;
        for (const p of parentPath) {
          parent = parent[p] as Record<string, unknown>;
        }
        const child = parent[pathParts[i]];
        if (
          child &&
          typeof child === "object" &&
          Object.keys(child as Record<string, unknown>).length === 0
        ) {
          delete parent[pathParts[i]];
        } else {
          break;
        }
      }
    }
  };

  // Apply multiple string property updates in one YAML parse/dump cycle.
  // Use this when a single user action must write more than one key (e.g. image src + alt),
  // so consecutive setState reads don't clobber each other.
  const updateProperties = (updates: Record<string, string>) => {
    try {
      const parsed = safeYamlLoad(yamlContent) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object") return;

      pushUndoState(yamlContent);

      for (const [key, value] of Object.entries(updates)) {
        setStringAtPath(parsed, key, value);
      }

      const newYaml = safeYamlDump(parsed, {
        lineWidth: -1,
        noRefs: true,
        quotingType: '"',
      });

      setYamlContent(newYaml);
      setHasChanges(true);
      setParseError(null);

      if (onPreviewChange) {
        onPreviewChange(parsed as Section);
      }
    } catch (error) {
      console.error("Error updating properties:", error);
    }
  };

  // Update a specific property in the YAML
  const updateProperty = (key: string, value: string) => {
    updateProperties({ [key]: value });
  };

  // Update a property with a raw value (e.g. boolean) so YAML dumps natively (layout_reversed: true)
  const updatePropertyWithValue = (key: string, value: unknown) => {
    try {
        const parsed = safeYamlLoad(yamlContent) as Record<string, unknown>;
        if (!parsed || typeof parsed !== "object") return;

        pushUndoState(yamlContent);

        const pathParts = key.split(".");
        const leaf = pathParts[pathParts.length - 1] ?? "";
        // Persist YAML null for identity opt-out (missing ≠ off after duplicate wipe)
        const persistNull =
          value === null &&
          (leaf === "conversion_name" ||
            leaf === "ecommerce_products" ||
            key.endsWith(".conversion_name") ||
            key.endsWith(".ecommerce_products"));
        const shouldDelete =
          value === undefined ||
          (value === null && !persistNull) ||
          (value === "" && !persistNull);

        if (pathParts.length === 1) {
          if (!shouldDelete) {
            parsed[key] = value;
          } else {
            delete parsed[key];
          }
        } else {
          let current: Record<string, unknown> = parsed;
          for (let i = 0; i < pathParts.length - 1; i++) {
            const part = pathParts[i];
            if (!current[part] || typeof current[part] !== "object") {
              current[part] = {};
            }
            current = current[part] as Record<string, unknown>;
          }
          const finalKey = pathParts[pathParts.length - 1];
          if (!shouldDelete) {
            current[finalKey] = value;
          } else {
            delete current[finalKey];
            // Clean up empty parent objects after deletion
            if (!persistNull) {
              for (let i = pathParts.length - 2; i >= 0; i--) {
                const parentPath = pathParts.slice(0, i);
                let parent: Record<string, unknown> = parsed;
                for (const p of parentPath) {
                  parent = parent[p] as Record<string, unknown>;
                }
                const child = parent[pathParts[i]];
                if (child && typeof child === "object" && Object.keys(child as Record<string, unknown>).length === 0) {
                  delete parent[pathParts[i]];
                } else {
                  break;
                }
              }
            }
          }
        }

        const newYaml = safeYamlDump(parsed, {
          lineWidth: -1,
          noRefs: true,
          quotingType: '"',
        });

        setYamlContent(newYaml);
        setHasChanges(true);
        setParseError(null);

        if (onPreviewChange) {
          onPreviewChange(parsed as Section);
        }
      } catch (error) {
        console.error("Error updating property:", error);
      }
  };

  // Update an array property in the YAML (e.g., related_features)
  // For related_features, insert after title to maintain YAML structure
  const updateArrayProperty = (key: string, value: string[]) => {
      try {
        const parsed = safeYamlLoad(yamlContent) as Record<string, unknown>;
        if (!parsed || typeof parsed !== "object") return;

        pushUndoState(yamlContent);

        // Build ordered result with related_features after title
        const buildOrderedResult = (
          obj: Record<string, unknown>,
          keyToInsert: string,
          valueToInsert: string[],
        ): Record<string, unknown> => {
          const result: Record<string, unknown> = {};
          let inserted = false;

          for (const [k, v] of Object.entries(obj)) {
            if (k === keyToInsert) continue; // Skip - we'll insert in correct position
            result[k] = v;
            // Insert after title
            if (k === "title" && !inserted) {
              result[keyToInsert] = valueToInsert;
              inserted = true;
            }
          }

          // Fallback: insert after type if no title found
          if (!inserted) {
            const fallback: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(result)) {
              fallback[k] = v;
              if (k === "type" && !inserted) {
                fallback[keyToInsert] = valueToInsert;
                inserted = true;
              }
            }
            return inserted
              ? fallback
              : { ...result, [keyToInsert]: valueToInsert };
          }

          return result;
        };

        let updated: Record<string, unknown>;

        const pathParts = key.split(".");

        if (pathParts.length > 1) {
          // Nested path (e.g. "dynamic_entries.permanent_filters.related_features")
          updated = parsed;

          // Special case: permanent_filters is a [{item_property_slug, value}] array.
          // When the path is "*.permanent_filters.<fieldName>", write into the array item
          // instead of creating a nested object key.
          const pfIndex = pathParts.indexOf("permanent_filters");
          if (pfIndex !== -1 && pfIndex === pathParts.length - 2) {
            // Navigate to the parent of permanent_filters
            let parent: Record<string, unknown> = updated;
            for (let i = 0; i < pfIndex; i++) {
              const part = pathParts[i];
              if (!parent[part] || typeof parent[part] !== "object") {
                parent[part] = {};
              }
              parent = parent[part] as Record<string, unknown>;
            }
            const fieldName = pathParts[pathParts.length - 1];
            const existingPf = parent["permanent_filters"];
            if (Array.isArray(existingPf)) {
              // Array format — find or create the item for this fieldName
              const arr = existingPf as Array<{ item_property_slug: string; value: unknown }>;
              const idx = arr.findIndex(f => f.item_property_slug === fieldName);
              if (value && value.length > 0) {
                if (idx >= 0) {
                  arr[idx] = { ...arr[idx], value };
                } else {
                  arr.push({ item_property_slug: fieldName, value });
                }
              } else {
                if (idx >= 0) arr.splice(idx, 1);
                if (arr.length === 0) delete parent["permanent_filters"];
              }
            } else if (Array.isArray(existingPf)) {
              // Already handled above (this branch is unreachable, kept for safety)
            } else {
              // permanent_filters is absent or object format — always create/update as array
              if (value && value.length > 0) {
                if (Array.isArray(existingPf)) {
                  // Array already exists (handled above), this is a safety fallback
                  const arr = existingPf as Array<{ item_property_slug: string; value: unknown }>;
                  const idx = arr.findIndex(f => f.item_property_slug === fieldName);
                  if (idx >= 0) {
                    arr[idx] = { ...arr[idx], value };
                  } else {
                    arr.push({ item_property_slug: fieldName, value });
                  }
                } else {
                  // Create fresh array format (correct canonical format).
                  // Also initialize dynamic_entries defaults and migrate root items → hardcoded_entries.
                  if (!parent["database"]) parent["database"] = "frequently_asked_questions";
                  if (!parent["limit"]) parent["limit"] = 9;
                  if (Array.isArray(updated.items) && (updated.items as unknown[]).length > 0 && !updated.hardcoded_entries) {
                    updated.hardcoded_entries = updated.items;
                    delete updated.items;
                  }
                  delete updated.related_features;
                  parent["permanent_filters"] = [{ item_property_slug: fieldName, value }];
                }
              } else {
                // Clearing: if object format existed, clean it up too
                if (existingPf && !Array.isArray(existingPf) && typeof existingPf === "object") {
                  delete (parent["permanent_filters"] as Record<string, unknown>)[fieldName];
                  if (Object.keys(parent["permanent_filters"] as Record<string, unknown>).length === 0) {
                    delete parent["permanent_filters"];
                  }
                }
              }
              delete updated.related_features;
            }
          } else {
            // Generic nested object path
            if (value && value.length > 0) {
              let current: Record<string, unknown> = updated;
              for (let i = 0; i < pathParts.length - 1; i++) {
                const part = pathParts[i];
                if (!current[part] || typeof current[part] !== "object") {
                  current[part] = {};
                }
                current = current[part] as Record<string, unknown>;
              }
              current[pathParts[pathParts.length - 1]] = value;
            } else {
              // Delete and clean up empty parent objects
              let current: Record<string, unknown> = updated;
              for (let i = 0; i < pathParts.length - 1; i++) {
                const part = pathParts[i];
                if (!current[part] || typeof current[part] !== "object") return;
                current = current[part] as Record<string, unknown>;
              }
              delete current[pathParts[pathParts.length - 1]];
              // Clean up empty parents bottom-up
              for (let i = pathParts.length - 2; i >= 0; i--) {
                const parentPath = pathParts.slice(0, i);
                let parent: Record<string, unknown> = updated;
                for (const p of parentPath) {
                  parent = parent[p] as Record<string, unknown>;
                }
                const child = parent[pathParts[i]];
                if (child && typeof child === "object" && Object.keys(child as Record<string, unknown>).length === 0) {
                  delete parent[pathParts[i]];
                } else {
                  break;
                }
              }
            }
          }
        } else if (value && value.length > 0) {
          if (key === "related_features") {
            updated = buildOrderedResult(parsed, key, value);
          } else {
            updated = { ...parsed, [key]: value };
          }
        } else {
          // Remove the key
          updated = {};
          for (const [k, v] of Object.entries(parsed)) {
            if (k !== key) {
              updated[k] = v;
            }
          }
        }

        const newYaml = safeYamlDump(updated, {
          lineWidth: -1,
          noRefs: true,
          quotingType: '"',
        });

        setYamlContent(newYaml);
        setHasChanges(true);
        setParseError(null);

        // Trigger live preview with updated object
        if (onPreviewChange) {
          onPreviewChange(updated as Section);
        }
      } catch (error) {
        console.error("Error updating array property:", error);
      }
  };

  // Update a specific field in an array item (supports nested paths like "signup_card.features")
  const updateArrayItemField = (
      arrayPath: string,
      index: number,
      field: string,
      value: string | number | boolean | undefined,
    ) => {
      try {
        const parsed = safeYamlLoad(yamlContent) as Record<string, unknown>;
        if (!parsed || typeof parsed !== "object") return;

        pushUndoState(yamlContent);

        // Support nested paths like "signup_card.features" by splitting on dots
        const pathParts = arrayPath.split(".");
        let current: Record<string, unknown> = parsed;

        // Traverse to the parent object containing the array
        for (let i = 0; i < pathParts.length - 1; i++) {
          const part = pathParts[i];
          if (!current[part] || typeof current[part] !== "object") return;
          current = current[part] as Record<string, unknown>;
        }

        // Get the array from the final path part
        const arrayField = pathParts[pathParts.length - 1];
        const array = current[arrayField] as
          | Record<string, unknown>[]
          | undefined;
        if (!Array.isArray(array) || !array[index]) return;

        const fieldParts = field.split(".");
        if (fieldParts.length > 1) {
          let target: Record<string, unknown> = array[index];
          for (let i = 0; i < fieldParts.length - 1; i++) {
            if (!target[fieldParts[i]] || typeof target[fieldParts[i]] !== "object") {
              target[fieldParts[i]] = {};
            }
            target = target[fieldParts[i]] as Record<string, unknown>;
          }
          if (value === undefined) {
            delete target[fieldParts[fieldParts.length - 1]];
          } else {
            target[fieldParts[fieldParts.length - 1]] = value;
          }
        } else {
          if (value === undefined) {
            delete array[index][field];
          } else {
            array[index][field] = value;
          }
        }

        const newYaml = safeYamlDump(parsed, {
          lineWidth: -1,
          noRefs: true,
          quotingType: '"',
        });

        setYamlContent(newYaml);
        setHasChanges(true);
        setParseError(null);

        if (onPreviewChange) {
          onPreviewChange(parsed as Section);
        }
      } catch (error) {
        console.error("Error updating array item:", error);
      }
  };

  // Update multiple fields of an array item at once (avoids stale state issues)
  const updateArrayItemFields = (arrayPath: string, index: number, updates: Record<string, string>) => {
      try {
        const parsed = safeYamlLoad(yamlContent) as Record<string, unknown>;
        if (!parsed || typeof parsed !== "object") return;

        pushUndoState(yamlContent);

        const pathParts = arrayPath.split(".");
        let current: Record<string, unknown> = parsed;

        for (let i = 0; i < pathParts.length - 1; i++) {
          const part = pathParts[i];
          if (!current[part] || typeof current[part] !== "object") return;
          current = current[part] as Record<string, unknown>;
        }

        const arrayField = pathParts[pathParts.length - 1];
        const array = current[arrayField] as
          | Record<string, unknown>[]
          | undefined;
        if (!Array.isArray(array) || !array[index]) return;

        // Apply all updates at once
        for (const [field, value] of Object.entries(updates)) {
          array[index][field] = value;
        }

        const newYaml = safeYamlDump(parsed, {
          lineWidth: -1,
          noRefs: true,
          quotingType: '"',
        });

        setYamlContent(newYaml);
        setHasChanges(true);
        setParseError(null);

        if (onPreviewChange) {
          onPreviewChange(parsed as Section);
        }
      } catch (error) {
        console.error("Error updating array item fields:", error);
      }
  };

  // Add a new item to an array field
  const addArrayItem = (arrayPath: string, defaultItem: Record<string, unknown>) => {
      try {
        const parsed = safeYamlLoad(yamlContent) as Record<string, unknown>;
        if (!parsed || typeof parsed !== "object") return;

        pushUndoState(yamlContent);

        // Support nested paths like "signup_card.features" by splitting on dots
        const pathParts = arrayPath.split(".");
        let current: Record<string, unknown> = parsed;

        // Traverse to the parent object containing the array
        for (let i = 0; i < pathParts.length - 1; i++) {
          const part = pathParts[i];
          if (!current[part] || typeof current[part] !== "object") {
            current[part] = {};
          }
          current = current[part] as Record<string, unknown>;
        }

        // Get or create the array from the final path part
        const arrayField = pathParts[pathParts.length - 1];
        let array = current[arrayField] as
          | Record<string, unknown>[]
          | undefined;

        if (!Array.isArray(array)) {
          array = [];
          current[arrayField] = array;
        }

        array.push(defaultItem);

        const newYaml = safeYamlDump(parsed, {
          lineWidth: -1,
          noRefs: true,
          quotingType: '"',
        });

        setYamlContent(newYaml);
        setHasChanges(true);
        setParseError(null);

        if (onPreviewChange) {
          onPreviewChange(parsed as Section);
        }
      } catch (error) {
        console.error("Error adding array item:", error);
      }
  };

  // Remove an item from an array field
  const removeArrayItem = (arrayPath: string, indexToRemove: number) => {
      try {
        const parsed = safeYamlLoad(yamlContent) as Record<string, unknown>;
        if (!parsed || typeof parsed !== "object") return;

        pushUndoState(yamlContent);

        const pathParts = arrayPath.split(".");
        let current: Record<string, unknown> = parsed;

        for (let i = 0; i < pathParts.length - 1; i++) {
          const part = pathParts[i];
          if (!current[part] || typeof current[part] !== "object") return;
          current = current[part] as Record<string, unknown>;
        }

        const arrayField = pathParts[pathParts.length - 1];
        const array = current[arrayField] as
          | Record<string, unknown>[]
          | undefined;

        if (
          !Array.isArray(array) ||
          indexToRemove < 0 ||
          indexToRemove >= array.length
        )
          return;

        array.splice(indexToRemove, 1);

        const newYaml = safeYamlDump(parsed, {
          lineWidth: -1,
          noRefs: true,
          quotingType: '"',
        });

        setYamlContent(newYaml);
        setHasChanges(true);
        setParseError(null);

        if (onPreviewChange) {
          onPreviewChange(parsed as Section);
        }
      } catch (error) {
        console.error("Error removing array item:", error);
      }
  };

  // Replace an entire array field
  const updateArrayField = (arrayPath: string, newArray: Record<string, unknown>[]) => {
      try {
        const parsed = safeYamlLoad(yamlContent) as Record<string, unknown>;
        if (!parsed || typeof parsed !== "object") return;

        pushUndoState(yamlContent);

        // Support nested paths like "signup_card.features" by splitting on dots
        const pathParts = arrayPath.split(".");
        let current: Record<string, unknown> = parsed;

        // Traverse to the parent object containing the array
        for (let i = 0; i < pathParts.length - 1; i++) {
          const part = pathParts[i];
          if (!current[part] || typeof current[part] !== "object") {
            current[part] = {};
          }
          current = current[part] as Record<string, unknown>;
        }

        // Set the array from the final path part
        const arrayField = pathParts[pathParts.length - 1];

        if (newArray.length === 0) {
          // Remove the field if array is empty
          delete current[arrayField];
        } else {
          current[arrayField] = newArray;
        }

        const newYaml = safeYamlDump(parsed, {
          lineWidth: -1,
          noRefs: true,
          quotingType: '"',
        });

        setYamlContent(newYaml);
        setHasChanges(true);
        setParseError(null);

        if (onPreviewChange) {
          onPreviewChange(parsed as Section);
        }
      } catch (error) {
        console.error("Error updating array field:", error);
      }
  };

  // Get configured field editors from the component registry API
  const sectionType = (section as { type: string }).type || "";

  const articlesOnPage = listArticlesOnPage(
    ((allSections || []) as unknown) as Array<Record<string, unknown>>,
  );

  const applyLocalTocSettings = (opts: {
    showToc: boolean;
    tocGroup?: string | null;
  }) => {
    try {
      const parsed = safeYamlLoad(yamlContent) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object") return;
      pushUndoState(yamlContent);
      parsed.show_toc = opts.showToc;
      if (opts.showToc && !parsed.toc_position) {
        parsed.toc_position = "side";
      }
      if (opts.tocGroup === null) {
        delete parsed.toc_group;
      } else if (typeof opts.tocGroup === "string") {
        parsed.toc_group = opts.tocGroup;
      }
      const newYaml = safeYamlDump(parsed, {
        lineWidth: -1,
        noRefs: true,
        quotingType: '"',
      });
      setYamlContent(newYaml);
      setHasChanges(true);
      setParseError(null);
      if (onPreviewChange) {
        onPreviewChange(parsed as Section);
      }
    } catch (error) {
      console.error("Error updating TOC settings:", error);
    }
  };

  const unifyArticleTocOnPage = async () => {
    const groupId = resolveTocGroupId(articlesOnPage);
    applyLocalTocSettings({ showToc: true, tocGroup: groupId });

    const siblingOps = buildSiblingShareOpsForActivation(
      articlesOnPage,
      sectionIndex,
      groupId,
    );

    if (siblingOps.length === 0 || !contentType || !slug || !locale) {
      return;
    }

    setTocShareApplying(true);
    try {
      const result = await editContent({
        contentType,
        slug,
        locale,
        variant,
        version,
        operations: siblingOps,
      });
      if (result.success) {
        emitContentUpdated({ contentType, slug, locale });
        toast({
          title: "Table of contents enabled",
          description:
            "Articles on this page share one TOC. Reading time and the mobile TOC appear on the first article only.",
        });
      } else {
        toast({
          title: "Could not update other articles",
          description: result.error || "TOC was enabled on this article only.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error unifying TOC across articles:", error);
      toast({
        title: "Could not update other articles",
        description: "TOC was enabled on this article only.",
        variant: "destructive",
      });
    } finally {
      setTocShareApplying(false);
    }
  };

  const handleArticleTocToggle = (checked: boolean) => {
    if (!checked) {
      applyLocalTocSettings({ showToc: false });
      return;
    }
    // Multi-article pages always continue one piece — stamp group, no choice dialog.
    if (articlesOnPage.length > 1) {
      void unifyArticleTocOnPage();
      return;
    }
    applyLocalTocSettings({ showToc: true });
  };

  // Component example query — lazy, only runs when the example dialog is open
  const schemaVersion = `v${version !== undefined ? version : 1}.0`;
  const { data: examplesData, isLoading: examplesLoading } = useQuery<{
    examples: Array<{ name: string; description?: string; yaml: string }>;
  }>({
    queryKey: ["/api/component-registry", sectionType, schemaVersion, "examples"],
    queryFn: async () => {
      const res = await fetch(`/api/component-registry/${sectionType}/${schemaVersion}/examples`);
      if (!res.ok) return { examples: [] };
      return res.json();
    },
    enabled: exampleDialogOpen && !!sectionType,
    staleTime: 5 * 60 * 1000,
  });
  const componentExamples = examplesData?.examples ?? [];
  const currentVariantForExample = (parsedSection?.variant as string) || "default";
  const bestExampleIdx = componentExamples.findIndex(
    (ex) => ex.yaml.includes(`variant: ${currentVariantForExample}`)
  );

  // Fetch all field editors from component registry
  const { data: allFieldEditors } = useQuery<
    Record<string, Record<string, EditorType>>
  >({
    queryKey: ["/api/component-registry/field-editors"],
  });

  const { data: themeConfig } = useQuery<{
    button_variants?: { id: string; label: string }[];
    fontSizes?: { id: string; label: string; value: string; tailwind: string }[];
  }>({
    queryKey: ["/api/theme"],
  });

  const { names: conversionNames, isLoading: conversionNamesLoading } = useConversionNames();

  const { data: formStateSuggestions } = useQuery<{ automations: string[]; tags: string[] }>({
    queryKey: ["/api/form-state/suggestions"],
  });

  const { data: trackingSettings } = useQuery<TrackingSettingsResponse>({
    queryKey: ["/api/settings/tracking"],
  });

  const { data: consentSettingsRaw } = useQuery({
    queryKey: ["/api/settings/consent"],
  });
  const { fallback: consentFallback, messages: consentSettings } = parseConsentSettingsResponse(consentSettingsRaw);

  const { data: formOptions, isLoading: formOptionsLoading } = useQuery<{
    locations: Array<{ slug: string; name: string; city: string; country: string; region: string }>;
    regions: Array<{ slug: string; label: string }>;
  }>({
    queryKey: ["/api/form-options"],
  });

  const formSettingsPath: string | null = (() => {
    const rawFields = allFieldEditors?.[sectionType] || {};
    const currentVariant = (parsedSection as Record<string, unknown>)?.variant as string | undefined;
    let globalPath: string | null = null;
    for (const [fieldPath, editorType] of Object.entries(rawFields)) {
      if (editorType === "form-settings") {
        const colonIndex = fieldPath.indexOf(":");
        // Variant-prefixed keys (e.g. "course:signup_card.form") — only match active variant.
        // Do not fall back to another variant's path as "global".
        if (colonIndex > 0 && !fieldPath.startsWith("color-picker:")) {
          const variantPrefix = fieldPath.substring(0, colonIndex);
          const actualPath = normalizeFormSettingsPath(fieldPath.substring(colonIndex + 1));
          if (currentVariant && variantPrefix === currentVariant) {
            return actualPath;
          }
        } else if (globalPath === null) {
          globalPath = normalizeFormSettingsPath(fieldPath);
        }
      }
    }
    return globalPath;
  })();

  const sectionFieldEditors = allFieldEditors?.[sectionType] || {};
  const currentEditorVariant = (parsedSection as Record<string, unknown>)?.variant as
    | string
    | undefined;
  const ctaTrackingPaths = resolveBoundCtaPaths(sectionFieldEditors, currentEditorVariant);

  const { data: componentRegistryData } = useQuery<{
    components: Array<{ type: string; behaviors?: string[] }>;
  }>({
    queryKey: ["/api/component-registry"],
    staleTime: 60000,
  });
  const hasEcommerceBehavior = Boolean(
    componentRegistryData?.components?.find((c) => c.type === sectionType)?.behaviors?.includes(
      "ecommerce",
    ),
  );

  const showFormsTab = formSettingsPath !== null;
  const showEcommerceTab = showEcommerceEditorTab(sectionFieldEditors, currentEditorVariant);

  useEffect(() => {
    if (activeTab === "ecommerce" && !showEcommerceTab) {
      setActiveTab("props");
      return;
    }
    if (activeTab === "conversion" && !showFormsTab) {
      setActiveTab("props");
    }
  }, [activeTab, showEcommerceTab, showFormsTab]);

  const { data: ecommerceProductsData } = useQuery<{
    products: Array<{
      product_id: string;
      name: string;
      content_slug: string;
      actively_selling?: boolean;
      active?: boolean;
    }>;
  }>({
    queryKey: ["/api/ecommerce/products"],
    staleTime: 60000,
    enabled: showEcommerceTab,
  });
  const editorTabCount = 2 + (showFormsTab ? 1 : 0) + (showEcommerceTab ? 1 : 0);

  // Join helper: "" means form settings at section root (lead_form).
  const formProp = (relative: string) => joinFormSettingsPath(formSettingsPath, relative);

  /** Nested form-settings may be absent (CTA-only). Root bind always has a form object (the section). */
  const boundFormObjectPresent = (() => {
    if (formSettingsPath == null) return false;
    if (formSettingsPath === "") return true;
    const node = getValueAtFieldPath(parsedSection, formSettingsPath);
    return node != null && typeof node === "object" && !Array.isArray(node);
  })();

  const resolvedParsedSection: Record<string, unknown> | null = (() => {
    if (!parsedSection || formSettingsPath == null) return parsedSection ?? null;
    const conversionName = String(
      getValueAtFieldPath(parsedSection, formProp("conversion_name")) ?? ""
    );
    if (!conversionName) return parsedSection;
    const event = trackingSettings?.conversion_events?.find((e) => e.name === conversionName);
    if (!event) return parsedSection;
    return resolveFormDefaults(
      parsedSection,
      {
        name: event.name,
        automations: event.automations,
        tags: event.tags,
        consent: event.consent,
        webhook: event.webhook,
        success: event.success,
      },
      formSettingsPath
    );
  })();

  // Get configured fields for current section type, filtering by variant
  const configuredFields = (() => {
    const rawFields = allFieldEditors?.[sectionType] || {};
    const result: Record<string, EditorType> = {};

    // Get current variant from parsed section
    const currentVariant = parsedSection?.variant as string | undefined;

    for (const [fieldPath, editorType] of Object.entries(rawFields)) {
      // Check if field path has variant prefix (e.g., "productShowcase:left_images[].src")
      const colonIndex = fieldPath.indexOf(":");
      if (colonIndex > 0 && !fieldPath.startsWith("color-picker:")) {
        // This is a variant-specific field
        const variantPrefix = fieldPath.substring(0, colonIndex);
        const actualFieldPath = fieldPath.substring(colonIndex + 1);

        // Only include if current variant matches
        if (currentVariant === variantPrefix) {
          result[actualFieldPath] = editorType;
        }
      } else {
        // Global field - include for all variants
        result[fieldPath] = editorType;
      }
    }

    return result;
  })();

  // Render icon from name using shared icon utility
  const renderIconByName = (iconName: string) => {
    if (!iconName) {
      return <HelpCircle className="h-5 w-5 text-muted-foreground" />;
    }
    const IconComponent = getIcon(iconName);
    if (!IconComponent) {
      return <HelpCircle className="h-5 w-5 text-muted-foreground" />;
    }
    return <IconComponent className="h-5 w-5" />;
  };

  // Handle icon picker selection
  const handleIconSelect = (iconName: string) => {
    if (nestedUpdateFn) {
      nestedUpdateFn(iconName);
      setNestedUpdateFn(null);
      setIconPickerTarget(null);
    } else if (iconPickerTarget?.simpleFieldPath) {
      updateProperty(iconPickerTarget.simpleFieldPath, iconName);
      setIconPickerTarget(null);
    } else if (iconPickerTarget) {
      updateArrayItemField(
        iconPickerTarget.arrayField,
        iconPickerTarget.index,
        iconPickerTarget.field,
        iconName,
      );
      setIconPickerTarget(null);
    }
  };

  // Shared save logic - returns true on success
  const saveToServer = async (clearedTemplatePaths?: string[]): Promise<{
    success: boolean;
    warning?: string;
    shared_template_html_cache?: string;
  }> => {
    if (!contentType || !slug || !locale) {
      return { success: false };
    }

    let parsed: Section;
    try {
      parsed = safeYamlLoad(yamlContent) as Section;
      if (!parsed || typeof parsed !== "object") {
        setParseError("Invalid section structure");
        return { success: false };
      }
    } catch (error) {
      if (error instanceof Error) {
        setParseError(error.message);
      }
      return { success: false };
    }

    setIsSaving(true);
    setSaveError(null);

    // Save page snapshot for undo before making changes
    if (pageHistory && allSections) {
      pageHistory.pushSnapshot(
        allSections,
        `Antes de editar sección ${sectionIndex + 1}`,
      );
    }

    try {
      // Shared-template A/B drafts live at single.{variant}.{locale}.yml (type_single).
      // Entry A/B drafts (e.g. programs/ai-flex/v2.es.yml) must not use type_single —
      // only pass the variant name so the server writes the entry variant file.
      const _urlParams = new URLSearchParams(window.location.search);
      const forceVariant = _urlParams.get("force_variant");
      const urlVariant = _urlParams.get("variant");
      const effectiveVariant = forceVariant ?? urlVariant ?? variant;
      const writeSharedTemplateVariant = !!(isSharedTemplate && effectiveVariant);
      const pathsToClear =
        clearedTemplatePaths ?? pendingClearedTemplatePaths;
      const pathsToUnbind = computeUnboundTemplatePaths();
      const result = await editContent({
        contentType,
        slug,
        locale,
        variant: effectiveVariant,
        version: writeSharedTemplateVariant ? undefined : version,
        ...(writeSharedTemplateVariant ? { layoutTarget: "type_single" } : {}),
        operations: [
          {
            action: "update_section",
            index: sectionIndex,
            section: parsed as Record<string, unknown>,
            ...(pathsToClear.length > 0
              ? { clearedTemplatePaths: pathsToClear }
              : {}),
            ...(pathsToUnbind.length > 0
              ? { unboundTemplatePaths: pathsToUnbind }
              : {}),
          },
        ],
      });

      if (result.success) {
        // Use server-confirmed section data if available, fallback to local parsed
        const confirmedSection = result.updatedSections?.[sectionIndex] as
          | Section
          | undefined;
        if (!confirmedSection) {
          console.warn(
            "Server did not return updated section, using local parsed data",
          );
        }
        onUpdate(
          mergeSavedSectionForLivePreview(
            section as Record<string, unknown>,
            (confirmedSection || parsed) as Record<string, unknown>,
          ) as Section,
        );
        setHasChanges(false);
        setPendingClearedTemplatePaths([]);
        setPendingUnboundTemplateDetails([]);
        sessionUnboundPathsRef.current = new Set();

        // Update initial state reference so next undo session starts from saved state
        initialYamlRef.current = yamlContent;

        // Shared-template editor loads YAML from a cached query — refresh so
        // reopening the editor shows what was actually written to the template.
        await refreshTemplateYamlFromServer();

        // Emit event to trigger page refresh
        emitContentUpdated({ contentType, slug, locale });

        // Return warning if present (for GitHub sync failures)
        return {
          success: true,
          warning: result.warning,
          shared_template_html_cache: result.shared_template_html_cache,
        };
      } else {
        setSaveError(result.error || "Failed to save changes");
        return { success: false };
      }
    } catch (error) {
      console.error("Error saving changes:", error);
      setSaveError(error instanceof Error ? error.message : "Network error");
      return { success: false };
    } finally {
      setIsSaving(false);
    }
  };

  const computeClearedTemplatePaths = (): string[] => {
    const vf = (section as Record<string, unknown>)._variableFields as
      | Record<string, string>
      | undefined;
    return detectClearedTemplatePaths(
      initialYamlRef.current ?? "",
      yamlContent,
      vf,
    );
  };

  const computeUnboundTemplatePaths = (): string[] => {
    const vf = (section as Record<string, unknown>)._variableFields as
      | Record<string, string>
      | undefined;
    const originalPaths = buildOriginalTemplatePaths(
      initialYamlRef.current ?? "",
      vf,
    );
    try {
      const current = safeYamlLoad(yamlContent) as Record<string, unknown>;
      if (!current || typeof current !== "object") return [];
      return detectUnboundTemplatePaths(originalPaths, current);
    } catch {
      return [];
    }
  };

  const computeUnboundTemplateDetails = (): Array<{ path: string; literal: string }> => {
    const vf = (section as Record<string, unknown>)._variableFields as
      | Record<string, string>
      | undefined;
    const originalPaths = buildOriginalTemplatePaths(
      initialYamlRef.current ?? "",
      vf,
    );
    try {
      const current = safeYamlLoad(yamlContent) as Record<string, unknown>;
      if (!current || typeof current !== "object") return [];
      return detectUnboundTemplatePaths(originalPaths, current).map((path) => ({
        path,
        literal: String(getValueAtFieldPath(current, path) ?? ""),
      }));
    } catch {
      return [];
    }
  };

  /** Prepare shared-template confirm: stash cleared bindings for the enriched dialog. */
  const openSharedTemplateConfirm = () => {
    setPendingClearedTemplatePaths(computeClearedTemplatePaths());
    setPendingUnboundTemplateDetails(computeUnboundTemplateDetails());
    setTemplateSaveConfirmOpen(true);
  };

  const proceedAfterSharedTemplateConfirm = async () => {
    setTemplateSaveConfirmOpen(false);
    if (boundSiblings.length > 0) {
      setBindingConfirmOpen(true);
    } else {
      await executeSave();
    }
  };

  // Save without closing editor
  const executeSave = async () => {
    const result = await saveToServer();
    if (result && result.success) {
      if (result.warning) {
        toast({
          title: "Changes saved with warning",
          description: result.warning,
          variant: "destructive",
        });
      } else if (isSharedTemplate || result.shared_template_html_cache) {
        toast({
          title: "Changes saved",
          description:
            result.shared_template_html_cache ||
            "Shared template updated. This page (and any bound pages) are fresh; other public URLs that share this template may show previous HTML for up to a few minutes. Advanced: server/content-write-flush.ts, server/html-page-cache.ts, server/content-index.ts.",
        });
      } else {
        toast({
          title: "Changes saved",
          description: "Your section has been updated successfully.",
        });
      }
    }
  };

  // Save section only for this specific DB entry (per-entry override)
  const savePerEntryOnly = async () => {
    if (!contentType || !slug || !locale) return;
    setScopeDialogOpen(false);
    let parsed: Section;
    try {
      parsed = safeYamlLoad(yamlContent) as Section;
      if (!parsed || typeof parsed !== "object") {
        setSaveError("Invalid section structure");
        return;
      }
    } catch (error) {
      if (error instanceof Error) setSaveError(error.message);
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    if (pageHistory && allSections) {
      pageHistory.pushSnapshot(allSections, `Antes de editar sección ${sectionIndex + 1}`);
    }
    try {
      const token = getDebugToken();
      const resp = await fetch("/api/per-entry-section-update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Token ${token}` } : {}),
        },
        body: JSON.stringify(encodeHtmlValues({
          contentType,
          slug,
          locale,
          sectionIndex,
          sectionData: parsed as Record<string, unknown>,
        })),
      });
      const data = await resp.json();
      if (data.success) {
        onUpdate(
          mergeSavedSectionForLivePreview(
            section as Record<string, unknown>,
            parsed as Record<string, unknown>,
          ) as Section,
        );
        setHasChanges(false);
        initialYamlRef.current = yamlContent;
        emitContentUpdated({ contentType, slug, locale });
        toast({ title: "Changes saved", description: "Section updated for this entry only." });
      } else {
        setSaveError(data.error || "Failed to save per-entry section");
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Network error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    const isPerEntrySection = !!(section as Record<string, unknown>)._perEntrySource;
    if (isSharedTemplate && singleEntry && !isPerEntrySection) {
      if (!allowEntryStructuralOverrides) {
        // Attached shared-layout: only template saves — confirm blast radius first
        openSharedTemplateConfirm();
        return;
      }
      // Skip the scope dialog when previewing a variant — destination is already the variant file.
      const _vp = new URLSearchParams(window.location.search);
      const inVariantPreview = !!(_vp.get("force_variant") || _vp.get("variant"));
      if (!inVariantPreview) {
        // On a DB entry page with a shared-template section: ask scope first.
        // Binding confirmation (if needed) is handled inside the scope dialog's
        // "Update shared template" branch.
        setScopeDialogOpen(true);
        return;
      }
      // Variant preview: still confirm when unbinding template fields.
      const cleared = computeClearedTemplatePaths();
      const unbound = computeUnboundTemplateDetails();
      if (cleared.length > 0 || unbound.length > 0) {
        setPendingClearedTemplatePaths(cleared);
        setPendingUnboundTemplateDetails(unbound);
        setTemplateSaveConfirmOpen(true);
        return;
      }
      // Fall through to executeSave, which writes to the variant template.
    }
    if (boundSiblings.length > 0) {
      setBindingConfirmOpen(true);
      return;
    }
    await executeSave();
  };

  // Handle close with unsaved changes warning
  const handleClose = () => {
    if (hasChanges) {
      const confirmed = window.confirm(
        "You have unsaved changes. Are you sure you want to close without saving?",
      );
      if (!confirmed) return;
    }
    setTableEditorMode(null);
    if (onPreviewChange) {
      onPreviewChange(null);
    }
    onClose();
  };

  const STORAGE_KEY = "section-editor-width";
  const DEFAULT_WIDTH = 480;
  const MIN_WIDTH = 320;
  const MAX_WIDTH_RATIO = 0.8;

  const [panelWidth, setPanelWidth] = useState(() => {
    const screenCap = typeof window !== 'undefined' ? window.innerWidth : DEFAULT_WIDTH;
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed) && parsed >= MIN_WIDTH) return Math.min(parsed, screenCap);
      }
    } catch {}
    return Math.min(DEFAULT_WIDTH, screenCap);
  });
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(DEFAULT_WIDTH);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, String(panelWidth));
    } catch {}
  }, [panelWidth]);

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = panelWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = dragStartXRef.current - ev.clientX;
      const maxW = window.innerWidth * MAX_WIDTH_RATIO;
      const newWidth = Math.max(MIN_WIDTH, Math.min(maxW, dragStartWidthRef.current + delta));
      setPanelWidth(newWidth);
    };
    const handleMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  return (
    <div
      className="fixed right-0 top-0 bottom-0 bg-background border-l shadow-xl z-[9999] flex flex-col"
      style={{ width: `${Math.min(panelWidth, typeof window !== 'undefined' ? window.innerWidth : panelWidth)}px` }}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 hover:bg-primary/20 active:bg-primary/30 transition-colors"
        onMouseDown={handleDragStart}
        data-testid="panel-resize-handle"
      />
      {/* Header */}
      <div className="flex items-center justify-between px-4 border-b" style={{ paddingTop: "5px", paddingBottom: "5px" }}>
        <div>
          <h2 className="font-semibold" style={{ fontSize: "25px", lineHeight: "1.2" }}>Edit Section</h2>
          <p className="text-sm text-muted-foreground">
            {sectionType}{parsedSection?.variant ? ` — ${parsedSection.variant}` : ""} (Section {sectionIndex + 1})
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setExampleDialogOpen(true)}
            title="View full code example"
            data-testid="button-view-example"
          >
            <IconFileCode className="h-4 w-4" />
          </Button>
          {contentType && slug && !isSharedTemplate && (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => { refetchBinding(); setBindingDialogOpen(true); }}
              title={bindingGroup ? `Bound to ${boundSiblings.length} page${boundSiblings.length !== 1 ? 's' : ''} — click to manage` : "Manage bindings"}
              className="relative"
              data-testid="button-binding-header"
            >
              {bindingGroup ? (
                <>
                  <Link className="h-4 w-4" />
                  <span
                    className="absolute -top-0.5 -right-0.5 flex items-center justify-center rounded-full bg-amber-400 text-[9px] font-bold text-amber-950 min-w-[16px] px-0.5 leading-none py-0.5"
                    data-testid="badge-binding-count"
                  >
                    {bindingGroup.members.length}
                  </span>
                </>
              ) : (
                <Unlink className="h-4 w-4" />
              )}
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            onClick={undo}
            disabled={!canUndo}
            title="Deshacer (Ctrl+Z)"
            data-testid="button-undo"
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={redo}
            disabled={!canRedo}
            title="Rehacer (Ctrl+Shift+Z)"
            data-testid="button-redo"
          >
            <Redo2 className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleClose}
            data-testid="button-close-editor"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Binding Banner - warning style, full width, inside header area */}
      {boundSiblings.length > 0 && (
        <div
          className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 px-4 py-2 text-xs flex items-center gap-2 cursor-pointer hover-elevate"
          onClick={() => { refetchBinding(); setBindingDialogOpen(true); }}
          data-testid="binding-banner"
        >
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
          <span className="text-amber-800 dark:text-amber-200">
            Synced with {boundSiblings.length} page{boundSiblings.length > 1 ? "s" : ""}: {boundSiblings.map(s => s.slug).join(", ")}
          </span>
        </div>
      )}

      {sectionType === "schema_org" && (() => {
        let schemaType = "";
        try {
          const parsed = safeYamlLoad(yamlContent) as Record<string, unknown> | null;
          const fromYaml =
            (typeof parsed?.schema_type === "string" && parsed.schema_type) ||
            (typeof (parsed as { schemaType?: unknown } | null)?.schemaType === "string"
              ? String((parsed as { schemaType?: string }).schemaType)
              : "");
          const fromSection = (section as Record<string, unknown>).schema_type
            ?? (section as Record<string, unknown>).schemaType;
          schemaType = fromYaml || (typeof fromSection === "string" ? fromSection : "");
        } catch {
          const fromSection = (section as Record<string, unknown>).schema_type
            ?? (section as Record<string, unknown>).schemaType;
          schemaType = typeof fromSection === "string" ? fromSection : "";
        }
        if (schemaType !== "WebSite" && schemaType !== "Organization") return null;
        return (
          <div
            className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 px-4 py-2 text-xs flex items-start gap-2"
            data-testid="banner-schema-org-prefill"
          >
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <span className="text-amber-800 dark:text-amber-200">
              This {schemaType} section is <strong className="font-medium">page-local</strong>.
              Values were prefilled from site <code className="font-mono">schema-org.yml</code> templates —
              edits here do not update the global Organization/Website definitions under SEO &amp; GEO → Schema.org.
            </span>
          </div>
        );
      })()}

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 flex flex-col min-h-0"
      >
        <TabsList
          className={`mx-4 mt-2 grid w-auto ${
            editorTabCount === 4
              ? "grid-cols-4"
              : editorTabCount === 3
                ? "grid-cols-3"
                : "grid-cols-2"
          }`}
        >
          <TabsTrigger value="code" className="gap-1.5" data-testid="tab-code">
            <Code className="h-4 w-4" />
            Code
          </TabsTrigger>
          <TabsTrigger
            value="props"
            className="gap-1.5"
            data-testid="tab-props"
          >
            <Settings className="h-4 w-4" />
            Props
          </TabsTrigger>
          {showFormsTab && (
            <TabsTrigger
              value="conversion"
              className="gap-1.5"
              data-testid="tab-forms"
            >
              <IconTargetArrow className="h-4 w-4" />
              Forms
            </TabsTrigger>
          )}
          {showEcommerceTab && (
            <TabsTrigger
              value="ecommerce"
              className="gap-1.5"
              data-testid="tab-ecommerce"
            >
              <IconShoppingCart className="h-4 w-4" />
              Ecommerce
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent
          value="code"
          className="flex-1 flex flex-col min-h-0 mt-0 data-[state=inactive]:hidden"
        >
          <div className="flex-1 min-h-0" data-section-index={sectionIndex}>
            <CodeMirror
              key={`${slug}-${sectionIndex}`}
              value={yamlContent}
              height="100%"
              extensions={cmExtensions}
              theme={oneDark}
              onChange={handleYamlChange}
              onCreateEditor={(view) => {
                editorViewRef.current = view;
              }}
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLine: true,
              }}
              className="h-full [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto"
            />
          </div>
        </TabsContent>

        <TabsContent
          value="props"
          className="flex-1 overflow-auto p-4 mt-0 data-[state=inactive]:hidden"
        >
          <div className="space-y-6">
            {/* DB Entry Overrides Panel */}
            {hasVariableFields && hasDbOverrides && (
              <div
                className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-3"
                data-testid="panel-db-overrides"
              >
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                  <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
                    Active entry overrides
                  </span>
                  <Badge
                    variant="secondary"
                    className="ml-auto text-xs bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200"
                    data-testid="badge-override-count"
                  >
                    {Object.keys(dbOverrides).length}
                  </Badge>
                </div>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  These fields have been customised for this entry and override the original API value.
                </p>
                <div className="space-y-2">
                  {Object.entries(dbOverrides).map(([templateKey, value]) => (
                    <div
                      key={templateKey}
                      className="flex items-center gap-2 bg-background/60 rounded-md px-2 py-1.5"
                      data-testid={`override-row-${templateKey}`}
                    >
                      <span className="font-mono text-xs text-muted-foreground flex-shrink-0">
                        {templateKey}
                      </span>
                      <span
                        className="text-xs text-foreground truncate flex-1"
                        title={String(value)}
                      >
                        {typeof value === "string" && (value.startsWith("/") || value.startsWith("http"))
                          ? value.split("/").pop() || value
                          : String(value)}
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="flex-shrink-0 text-amber-700 dark:text-amber-300"
                        title={`Reset "${templateKey}" to original API value`}
                        data-testid={`button-reset-override-${templateKey}`}
                        disabled={resettingField === templateKey}
                        onClick={async () => {
                          if (resettingField) return;
                          setResettingField(templateKey);
                          try {
                            const res = await fetch(
                              `/api/content-types/${contentType}/db-overrides/${slug}?field=${encodeURIComponent(templateKey)}`,
                              { method: "DELETE" }
                            );
                            if (!res.ok) {
                              const data = await res.json().catch(() => ({})) as { error?: string };
                              toast({ title: "Failed to reset override", description: data.error || res.statusText, variant: "destructive" });
                              return;
                            }
                            await refetchDbOverrides();
                            if (contentType && slug && locale) {
                              emitContentUpdated({ contentType, slug, locale });
                            }
                            toast({ title: "Override reset", description: `"${templateKey}" reverted to original value.` });
                          } catch (err) {
                            toast({ title: "Error", description: String(err), variant: "destructive" });
                          } finally {
                            setResettingField(null);
                          }
                        }}
                      >
                        {resettingField === templateKey
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <RefreshCw className="h-3.5 w-3.5" />
                        }
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <ShowOnLocationsPicker
              value={currentShowOnLocations}
              onChange={(value) =>
                updateArrayProperty("showOnLocations", value)
              }
            />
            <ShowOnPicker
              value={currentShowOn}
              onChange={(value) => updateProperty("showOn", value)}
            />

            <div className="flex items-center justify-between gap-3">
              <Label className="text-sm font-medium">Hidden until redirect</Label>
              <Switch
                checked={currentHiddenUntilRedirection}
                onCheckedChange={(checked) =>
                  updatePropertyWithValue(
                    "hidden_until_redirection",
                    checked ? true : undefined,
                  )
                }
                data-testid="props-toggle-hidden-until-redirection"
              />
            </div>

            {/* CTA Banner variant picker */}
            {sectionType === "cta_banner" && (
              <VariantPicker
                value={(parsedSection?.variant as string) || "default"}
                onChange={(value) => updateProperty("variant", value)}
                options={[
                  { id: "default", label: "Default (Buttons)" },
                  { id: "form", label: "Form" },
                ]}
              />
            )}
            {/* Features Quad CTA button editor (cta may be absent in YAML, so offer explicit add/remove) */}
            {sectionType === "features_quad" && (
              <div className="space-y-2 border rounded-md p-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">CTA Button</Label>
                  {parsedSection?.cta ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-destructive"
                      onClick={() => updatePropertyWithValue("cta", undefined)}
                      data-testid="props-features-quad-cta-remove"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7"
                      onClick={() =>
                        updatePropertyWithValue("cta", {
                          text: locale === "es" ? "Aplica ahora" : "Apply now",
                          url: "/",
                          variant: "primary",
                        })
                      }
                      data-testid="props-features-quad-cta-add"
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      {locale === "es" ? "Agregar botón" : "Add button"}
                    </Button>
                  )}
                </div>
                {parsedSection?.cta ? (
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Text</Label>
                      <Input
                        value={((parsedSection.cta as Record<string, unknown>).text as string) || ""}
                        onChange={(e) => updateProperty("cta.text", e.target.value)}
                        className="h-8 text-sm"
                        data-testid="props-features-quad-cta-text"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">URL</Label>
                      <LinkPicker
                        value={((parsedSection.cta as Record<string, unknown>).url as string) || ""}
                        onChange={(url) => updateProperty("cta.url", url)}
                        locale={locale}
                        allSections={allSections}
                      />
                    </div>
                    <VariantPicker
                      label="Style"
                      value={((parsedSection.cta as Record<string, unknown>).variant as string) || "secondary"}
                      onChange={(value) => updateProperty("cta.variant", value)}
                      options={[
                        { id: "primary", label: "Primary" },
                        { id: "secondary", label: "Secondary" },
                        { id: "outline", label: "Outline" },
                      ]}
                    />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {locale === "es"
                      ? "Sin botón. Agrégalo y usa el estilo Primary para el azul de marca."
                      : "No button yet. Add one and use the Primary style for the brand blue."}
                  </p>
                )}
              </div>
            )}
            {/* Testimonials (grid, carousel, slide) related features picker */}
            {["testimonials_grid", "testimonials", "testimonials_slide"].includes(sectionType) && (
              <>
                <div
                  className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg flex items-start gap-2"
                  data-testid="alert-testimonials-edit-info"
                >
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800 dark:text-amber-200">
                    {locale === "es"
                      ? sectionType === "testimonials_grid"
                        ? "Los testimonios se cargan del banco centralizado y se filtran por las características seleccionadas."
                        : "Cuando se seleccionan características, los testimonios se cargan del banco centralizado. Sin características, se usan los items por defecto."
                      : sectionType === "testimonials_grid"
                        ? "Testimonials are loaded from the centralized bank and filtered by the selected features."
                        : "When features are selected, testimonials load from the centralized bank. Without features, default items are used."}
                  </p>
                </div>
                <RelatedFeaturesPicker
                  value={(parsedSection?.related_features as string[]) || []}
                  onChange={(value) =>
                    updateArrayProperty("related_features", value)
                  }
                  locale={locale}
                  context="testimonials"
                />
                <TestimonialItemsPreview
                  relatedFeatures={
                    (parsedSection?.related_features as string[]) || []
                  }
                  itemStyles={
                    sectionType === "testimonials_grid"
                      ? (parsedSection?.item_styles as Record<
                          string,
                          {
                            box_color?: string;
                            name_color?: string;
                            comment_color?: string;
                          }
                        >) || {}
                      : {}
                  }
                  locale={locale || "en"}
                  onUpdateItemStyle={
                    sectionType === "testimonials_grid"
                      ? (studentName, prop, value) => {
                          updateProperty(`item_styles.${studentName}.${prop}`, value);
                        }
                      : undefined
                  }
                  readOnly={sectionType !== "testimonials_grid"}
                />
              </>
            )}
            {sectionType === "dynamic_table" && (
              <VariantPicker
                value={(parsedSection?.variant as string) || "default"}
                onChange={(value) => updateProperty("variant", value)}
                options={[
                  { id: "default", label: "Default", preview: () => <TableVariantPreview variant="default" /> },
                  { id: "striped", label: "Striped", preview: () => <TableVariantPreview variant="striped" /> },
                  { id: "cards", label: "Cards", preview: () => <TableVariantPreview variant="cards" /> },
                  { id: "comparison", label: "Comparison", preview: () => <TableVariantPreview variant="comparison" /> },
                ]}
              />
            )}
            {sectionType === "dynamic_table" && parsedSection?.endpoint && (
              <>
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Max Rows</Label>
                  <Input
                    type="number"
                    min={1}
                    placeholder="Show all rows"
                    value={
                      parsedSection?.max_rows != null
                        ? String(parsedSection.max_rows)
                        : ""
                    }
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      if (val === "") {
                        updatePropertyWithValue("max_rows", undefined);
                      } else {
                        const n = parseInt(val, 10);
                        if (!isNaN(n) && n > 0)
                          updatePropertyWithValue("max_rows", n);
                      }
                    }}
                    data-testid="input-max-rows"
                  />
                  <p className="text-xs text-muted-foreground">
                    Limit visible rows. Users can expand to see all.
                  </p>
                </div>

                <div className="space-y-2 border-t pt-3 mt-3">
                  <Label className="text-xs font-medium">Row Action Button</Label>
                  {parsedSection?.action ? (
                    <div className="space-y-2 p-3 rounded-lg border bg-muted/20">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-xs font-medium text-foreground">Action configured</span>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            try {
                              const parsed = safeYamlLoad(yamlContent) as Record<string, unknown>;
                              if (!parsed || typeof parsed !== "object") return;
                              pushUndoState(yamlContent);
                              delete parsed.action;
                              const newYaml = safeYamlDump(parsed, { lineWidth: -1, noRefs: true, quotingType: '"' });
                              setYamlContent(newYaml);
                              setHasChanges(true);
                              setParseError(null);
                              if (onPreviewChange) onPreviewChange(parsed as Section);
                            } catch (err) {
                              console.error("Error removing action:", err);
                            }
                          }}
                          data-testid="button-remove-action"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      <div className="space-y-1.5">
                        <div>
                          <Label className="text-[10px] text-muted-foreground">Button Label</Label>
                          <Input
                            value={(parsedSection.action as { label?: string })?.label || ""}
                            placeholder="e.g. View, Apply, Details"
                            onChange={(e) => {
                              try {
                                const parsed = safeYamlLoad(yamlContent) as Record<string, unknown>;
                                if (!parsed || typeof parsed !== "object") return;
                                pushUndoState(yamlContent);
                                const action = (parsed.action || {}) as Record<string, string>;
                                action.label = e.target.value;
                                parsed.action = action;
                                const newYaml = safeYamlDump(parsed, { lineWidth: -1, noRefs: true, quotingType: '"' });
                                setYamlContent(newYaml);
                                setHasChanges(true);
                                setParseError(null);
                                if (onPreviewChange) onPreviewChange(parsed as Section);
                              } catch (err) {
                                console.error("Error updating action label:", err);
                              }
                            }}
                            className="text-xs"
                            data-testid="input-action-label"
                          />
                        </div>
                        <div>
                          <Label className="text-[10px] text-muted-foreground">URL Template</Label>
                          <Input
                            value={(parsedSection.action as { href?: string })?.href || ""}
                            placeholder="e.g. https://example.com/item/{id}"
                            onChange={(e) => {
                              try {
                                const parsed = safeYamlLoad(yamlContent) as Record<string, unknown>;
                                if (!parsed || typeof parsed !== "object") return;
                                pushUndoState(yamlContent);
                                const action = (parsed.action || {}) as Record<string, string>;
                                action.href = e.target.value;
                                parsed.action = action;
                                const newYaml = safeYamlDump(parsed, { lineWidth: -1, noRefs: true, quotingType: '"' });
                                setYamlContent(newYaml);
                                setHasChanges(true);
                                setParseError(null);
                                if (onPreviewChange) onPreviewChange(parsed as Section);
                              } catch (err) {
                                console.error("Error updating action href:", err);
                              }
                            }}
                            className="text-xs"
                            data-testid="input-action-href"
                          />
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            Use {"{columnKey}"} for dynamic values, e.g. {"{id}"} or {"{slug}"}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        try {
                          const parsed = safeYamlLoad(yamlContent) as Record<string, unknown>;
                          if (!parsed || typeof parsed !== "object") return;
                          pushUndoState(yamlContent);
                          parsed.action = { label: "View", href: "" };
                          const newYaml = safeYamlDump(parsed, { lineWidth: -1, noRefs: true, quotingType: '"' });
                          setYamlContent(newYaml);
                          setHasChanges(true);
                          setParseError(null);
                          if (onPreviewChange) onPreviewChange(parsed as Section);
                        } catch (err) {
                          console.error("Error adding action:", err);
                        }
                      }}
                      data-testid="button-add-action"
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Add Action Button
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Adds a button column to each row linking to a URL.
                  </p>
                </div>

                <div className="space-y-3 border-t pt-3 mt-3">
                  <div
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${tableEditorMode === "content" ? "border-primary bg-primary/5" : "hover-elevate"}`}
                    onClick={() =>
                      setTableEditorMode(
                        tableEditorMode === "content" ? null : "content",
                      )
                    }
                    data-testid="button-table-content-filter"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Settings className="h-4 w-4 text-foreground flex-shrink-0" />
                      <span className="text-sm font-medium text-foreground">
                        Content Filter
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground pl-6">
                      {locale === "es"
                        ? "Usa IA para elegir qué columnas mostrar, renombrarlas, reordenarlas o cambiar cómo se muestran los valores. Controla la apariencia de la tabla."
                        : "Use AI to choose which columns to display, rename them, reorder, or change how values are shown. Controls the table's appearance."}
                    </p>
                  </div>
                  <div
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${tableEditorMode === "filter" ? "border-primary bg-primary/5" : "hover-elevate"}`}
                    onClick={() =>
                      setTableEditorMode(
                        tableEditorMode === "filter" ? null : "filter",
                      )
                    }
                    data-testid="button-table-global-filter"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Code className="h-4 w-4 text-foreground flex-shrink-0" />
                      <span className="text-sm font-medium text-foreground">
                        Global Filter
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground pl-6">
                      {locale === "es"
                        ? "Usa IA para filtrar qué filas se muestran en la tabla. Soporta filtrado por región del visitante (país, idioma, zona horaria). Controla qué datos son visibles, no cómo se ven."
                        : "Use AI to filter which rows appear in the table. Supports visitor-aware filtering (country, language, timezone). Controls which data is visible — not how it looks."}
                    </p>
                  </div>
                </div>

                {tableEditorMode === "content" && (
                  <TableContentEditor
                    key={`content-${parsedSection.endpoint}`}
                    mode="content"
                    endpoint={parsedSection.endpoint as string}
                    dataPath={parsedSection.data_path as string | undefined}
                    currentColumns={
                      (parsedSection.columns as Array<{
                        key: string;
                        label: string;
                        type:
                          | "text"
                          | "number"
                          | "date"
                          | "image"
                          | "link"
                          | "boolean";
                      }>) || []
                    }
                    currentTitle={parsedSection.title as string | undefined}
                    currentFilter={
                      parsedSection.global_filter as string | undefined
                    }
                    locale={locale}
                    onApplyContent={(config) => {
                      try {
                        const parsed = safeYamlLoad(yamlContent) as Record<
                          string,
                          unknown
                        >;
                        if (!parsed || typeof parsed !== "object") return;
                        pushUndoState(yamlContent);
                        parsed.columns = config.columns;
                        if (config.title) {
                          parsed.title = config.title;
                        } else {
                          delete parsed.title;
                        }
                        const newYaml = safeYamlDump(parsed, {
                          lineWidth: -1,
                          noRefs: true,
                          quotingType: '"',
                        });
                        setYamlContent(newYaml);
                        setHasChanges(true);
                        setParseError(null);
                        if (onPreviewChange) onPreviewChange(parsed as Section);
                      } catch (err) {
                        console.error("Error applying table config:", err);
                      }
                    }}
                    onApplyFilter={() => {}}
                    onRemoveFilter={() => {}}
                    onClose={() => setTableEditorMode(null)}
                  />
                )}

                {tableEditorMode === "filter" && (
                  <TableContentEditor
                    key={`filter-${parsedSection.endpoint}`}
                    mode="filter"
                    endpoint={parsedSection.endpoint as string}
                    dataPath={parsedSection.data_path as string | undefined}
                    currentColumns={
                      (parsedSection.columns as Array<{
                        key: string;
                        label: string;
                        type:
                          | "text"
                          | "number"
                          | "date"
                          | "image"
                          | "link"
                          | "boolean";
                      }>) || []
                    }
                    currentTitle={parsedSection.title as string | undefined}
                    currentFilter={
                      parsedSection.global_filter as string | undefined
                    }
                    locale={locale}
                    onApplyContent={() => {}}
                    onApplyFilter={(filterBase64) => {
                      try {
                        const parsed = safeYamlLoad(yamlContent) as Record<
                          string,
                          unknown
                        >;
                        if (!parsed || typeof parsed !== "object") return;
                        pushUndoState(yamlContent);
                        parsed.global_filter = filterBase64;
                        const newYaml = safeYamlDump(parsed, {
                          lineWidth: -1,
                          noRefs: true,
                          quotingType: '"',
                        });
                        setYamlContent(newYaml);
                        setHasChanges(true);
                        setParseError(null);
                        if (onPreviewChange) onPreviewChange(parsed as Section);
                      } catch (err) {
                        console.error("Error applying global filter:", err);
                      }
                    }}
                    onRemoveFilter={() => {
                      try {
                        const parsed = safeYamlLoad(yamlContent) as Record<
                          string,
                          unknown
                        >;
                        if (!parsed || typeof parsed !== "object") return;
                        pushUndoState(yamlContent);
                        delete parsed.global_filter;
                        const newYaml = safeYamlDump(parsed, {
                          lineWidth: -1,
                          noRefs: true,
                          quotingType: '"',
                        });
                        setYamlContent(newYaml);
                        setHasChanges(true);
                        setParseError(null);
                        if (onPreviewChange) onPreviewChange(parsed as Section);
                      } catch (err) {
                        console.error("Error removing global filter:", err);
                      }
                    }}
                    onClose={() => setTableEditorMode(null)}
                  />
                )}
              </>
            )}

            <ColorPicker
              value={currentBackground}
              onChange={(value) => updateProperty("background", value)}
              type="background"
              testIdPrefix="props-background"
            />
            {/* Render top-level (non-array) color-picker field editors */}
            {Object.entries(configuredFields)
              .filter(([fieldPath, editorTypeRaw]) => {
                if (fieldPath.includes("[]")) return false;
                if (fieldPath === "background") return false;
                if (fieldPath.startsWith("default_")) return false;
                const { type: edType } = parseEditorType(editorTypeRaw);
                return edType === "color-picker";
              })
              .map(([fieldPath, editorTypeRaw]) => {
                const { variant: edVariant } = parseEditorType(editorTypeRaw);
                const currentValue = parsedSection
                  ? String(
                      (parsedSection as Record<string, unknown>)[fieldPath] ||
                        "",
                    )
                  : "";
                const label = getFieldLabel(fieldPath);
                return (
                  <div key={fieldPath} className="mt-3">
                    <ColorPicker
                      value={currentValue}
                      onChange={(value) => updateProperty(fieldPath, value)}
                      type={
                        (edVariant as "background" | "accent" | "text") ||
                        "background"
                      }
                      label={label}
                      testIdPrefix={`props-${fieldPath}`}
                    />
                  </div>
                );
              })}
            {/* Render top-level (non-array) icon-picker field editors */}
            {Object.entries(configuredFields)
              .filter(([fieldPath, editorTypeRaw]) => {
                if (fieldPath.includes("[]")) return false;
                const { type: edType } = parseEditorType(editorTypeRaw);
                return edType === "icon-picker";
              })
              .map(([fieldPath]) => {
                const currentValue = parsedSection
                  ? String((parsedSection as Record<string, unknown>)[fieldPath] || "")
                  : "";
                const fieldLabel = getFieldLabel(fieldPath);
                const IconComponent = currentValue ? getIcon(currentValue) : null;
                return (
                  <div key={fieldPath} className="space-y-2 mt-3">
                    <Label className="text-sm font-medium">{fieldLabel}</Label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setIconPickerTarget({
                            arrayField: "",
                            index: 0,
                            field: fieldPath,
                            label: fieldLabel,
                            currentIcon: currentValue,
                            simpleFieldPath: fieldPath,
                          });
                          setIconPickerOpen(true);
                        }}
                        className="flex items-center justify-center w-10 h-10 rounded border bg-muted/30 hover:bg-muted transition-colors"
                        data-testid={`props-icon-${fieldPath}`}
                        title={`Change ${fieldLabel}`}
                      >
                        {IconComponent ? (
                          <IconComponent className="h-6 w-6 text-foreground" />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </button>
                      {currentValue && (
                        <span className="text-xs text-muted-foreground truncate max-w-[150px]">
                          {currentValue}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            {/* Render top-level (non-array) image-picker field editors */}
            {Object.entries(configuredFields)
              .filter(([fieldPath, editorTypeRaw]) => {
                if (fieldPath.includes("[]")) return false;
                const { type: edType } = parseEditorType(editorTypeRaw);
                return edType === "image-picker";
              })
              .map(([fieldPath, editorTypeRaw]) => {
                const { variant } = parseEditorType(editorTypeRaw);
                const getFieldValue = () => {
                  if (!parsedSection) return "";
                  const pathParts = fieldPath.split(".");
                  let current: unknown = parsedSection;
                  for (const part of pathParts) {
                    if (!current || typeof current !== "object") return "";
                    current = (current as Record<string, unknown>)[part];
                  }
                  return (current as string) || "";
                };
                const currentValue = getFieldValue();
                const fieldLabel = getFieldLabel(fieldPath);
                const isIdField = fieldPath.endsWith("_id");
                const displaySrc = isIdField
                  ? imageRegistry?.images?.[currentValue]?.src || currentValue
                  : currentValue;
                const displayLabel = isIdField
                  ? currentValue
                  : currentValue.split("/").pop() || currentValue;

                const isOverridden = fieldHasOverride(fieldPath);
                const isTemplateVar = isTemplateVarValue(getValueAtFieldPath(parsedSection, fieldPath));
                return (
                  <div key={fieldPath} className="space-y-2 mt-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Label className="text-sm font-medium">
                        {fieldLabel}
                      </Label>
                      {isOverridden && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0 bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700"
                          data-testid={`badge-override-${fieldPath}`}
                        >
                          overridden
                        </Badge>
                      )}
                      {!isOverridden && isTemplateVar && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0 bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700"
                          data-testid={`badge-template-var-${fieldPath}`}
                        >
                          template
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setImagePickerTarget({
                            fieldPath,
                            label: fieldLabel,
                            currentSrc: currentValue,
                            currentAlt: "",
                            tagFilter: variant,
                          });
                          setImagePickerOpen(true);
                        }}
                        className={`relative w-16 h-16 rounded-md border bg-muted/50 hover:bg-muted transition-colors overflow-hidden group ${isOverridden ? "border-amber-400 dark:border-amber-600" : "border-input"}`}
                        data-testid={`props-image-${fieldLabel}`}
                        title={`Change ${fieldLabel}`}
                      >
                        {currentValue ? (
                          <>
                            <img
                              src={displaySrc}
                              alt={fieldLabel}
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <Image className="h-5 w-5 text-white" />
                            </div>
                          </>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Image className="h-6 w-6 text-muted-foreground" />
                          </div>
                        )}
                      </button>
                      {currentValue && (
                        <span className="text-xs text-muted-foreground truncate max-w-[150px]">
                          {displayLabel}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            {/* Render top-level (non-array) video-picker field editors */}
            {Object.entries(configuredFields)
              .filter(([fieldPath, editorTypeRaw]) => {
                if (fieldPath.includes("[]")) return false;
                const { type: edType } = parseEditorType(editorTypeRaw);
                return edType === "video-picker";
              })
              .map(([fieldPath]) => {
                const getFieldValue = () => {
                  if (!parsedSection) return "";
                  const pathParts = fieldPath.split(".");
                  let current: unknown = parsedSection;
                  for (const part of pathParts) {
                    if (!current || typeof current !== "object") return "";
                    current = (current as Record<string, unknown>)[part];
                  }
                  return (current as string) || "";
                };
                const currentValue = getFieldValue();
                const fieldLabel = getFieldLabel(fieldPath);

                const pathParts = fieldPath.split(".");
                const parentPrefix = pathParts.length > 1
                  ? pathParts.slice(0, -1).join(".") + "."
                  : "";

                const getVideoSiblingValue = (prop: string): unknown => {
                  if (!parsedSection) return undefined;
                  const siblingPath = parentPrefix + prop;
                  const parts = siblingPath.split(".");
                  let current: unknown = parsedSection;
                  for (const part of parts) {
                    if (!current || typeof current !== "object") return undefined;
                    current = (current as Record<string, unknown>)[part];
                  }
                  return current;
                };

                const currentRatio = (getVideoSiblingValue("ratio") as string) || "";
                const currentMuted = getVideoSiblingValue("muted");
                const currentAutoplay = getVideoSiblingValue("autoplay");
                const currentLoop = getVideoSiblingValue("loop");
                const currentPreviewImage = (getVideoSiblingValue("preview_image_url") as string) || "";

                const parentLabel = getFieldLabel(
                  parentPrefix ? parentPrefix.replace(/\.$/, "") : "video"
                );

                return (
                  <Collapsible key={fieldPath} className="border rounded-md">
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors"
                        data-testid={`props-video-${fieldLabel}-trigger`}
                      >
                        <div className="w-10 h-10 rounded-md overflow-hidden bg-muted border flex-shrink-0 flex items-center justify-center">
                          <Video className={`h-5 w-5 ${currentValue ? "text-primary" : "text-muted-foreground"}`} />
                        </div>
                        <div className="flex-1 text-left min-w-0">
                          <span className="text-sm font-medium capitalize block">
                            {parentLabel.replace(/_/g, " ")}
                          </span>
                          {currentValue && (
                            <span className="text-xs text-muted-foreground truncate block">
                              {currentValue.split("/").pop() || currentValue}
                            </span>
                          )}
                        </div>
                        <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="p-3 pt-0 space-y-3 border-t">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setVideoPickerTarget({
                                fieldPath,
                                label: fieldLabel,
                                currentUrl: currentValue,
                              });
                              setVideoPickerOpen(true);
                            }}
                            className="relative w-16 h-16 rounded-md border border-input bg-muted/50 hover:bg-muted transition-colors overflow-hidden group"
                            data-testid={`props-video-${fieldLabel}-picker`}
                            title="Change video"
                          >
                            {currentValue ? (
                              <>
                                <div className="w-full h-full flex items-center justify-center bg-muted">
                                  <Video className="h-6 w-6 text-primary" />
                                </div>
                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                  <Video className="h-5 w-5 text-white" />
                                </div>
                              </>
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Video className="h-6 w-6 text-muted-foreground" />
                              </div>
                            )}
                          </button>
                          <div className="flex-1 min-w-0">
                            {currentValue ? (
                              <span className="text-xs text-muted-foreground break-all line-clamp-3">
                                {currentValue}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground italic">
                                No video selected
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setImagePickerTarget({
                                  fieldPath: parentPrefix + "preview_image_url",
                                  label: "Preview Image",
                                  currentSrc: currentPreviewImage,
                                  currentAlt: "",
                                });
                                setImagePickerOpen(true);
                              }}
                              className="relative w-16 h-16 rounded-md border border-input bg-muted/50 hover:bg-muted transition-colors overflow-hidden group flex-shrink-0"
                              data-testid={`props-video-${fieldLabel}-preview-image`}
                              title="Change preview image"
                            >
                              {currentPreviewImage ? (
                                <>
                                  <img
                                    src={currentPreviewImage}
                                    alt="Preview"
                                    className="w-full h-full object-cover"
                                  />
                                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    <Image className="h-4 w-4 text-white" />
                                  </div>
                                </>
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <Image className="h-5 w-5 text-muted-foreground" />
                                </div>
                              )}
                            </button>
                            <div className="flex-1 min-w-0">
                              {currentPreviewImage ? (
                                <div className="flex items-center gap-1">
                                  <span className="text-xs text-muted-foreground truncate flex-1">
                                    {currentPreviewImage.split("/").pop() || currentPreviewImage}
                                  </span>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-6 w-6 flex-shrink-0"
                                    onClick={() => updateProperty(parentPrefix + "preview_image_url", "")}
                                    data-testid={`props-video-${fieldLabel}-preview-image-clear`}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground italic">
                                  No preview image selected
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            Aspect Ratio
                          </Label>
                          <Select
                            value={currentRatio || "16:9"}
                            onValueChange={(value) =>
                              updateProperty(parentPrefix + "ratio", value)
                            }
                          >
                            <SelectTrigger
                              className="h-8 text-sm"
                              data-testid={`props-video-${fieldLabel}-ratio`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
                              <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
                              <SelectItem value="4:3">4:3 (Classic)</SelectItem>
                              <SelectItem value="1:1">1:1 (Square)</SelectItem>
                              <SelectItem value="21:9">21:9 (Ultra-wide)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">
                            Playback Options
                          </Label>
                          <div className="grid grid-cols-1 gap-2">
                            <div className="flex items-center justify-between gap-2">
                              <Label className="text-sm">Muted</Label>
                              <Switch
                                checked={currentMuted !== false}
                                onCheckedChange={(checked) =>
                                  updatePropertyWithValue(parentPrefix + "muted", checked)
                                }
                                data-testid={`props-video-${fieldLabel}-muted`}
                              />
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <Label className="text-sm">Autoplay</Label>
                              <Switch
                                checked={currentAutoplay === true}
                                onCheckedChange={(checked) =>
                                  updatePropertyWithValue(parentPrefix + "autoplay", checked)
                                }
                                data-testid={`props-video-${fieldLabel}-autoplay`}
                              />
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <Label className="text-sm">Loop</Label>
                              <Switch
                                checked={currentLoop !== false}
                                onCheckedChange={(checked) =>
                                  updatePropertyWithValue(parentPrefix + "loop", checked)
                                }
                                data-testid={`props-video-${fieldLabel}-loop`}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            {/* Render grouped array item editors (when multiple field-editors exist for the same array) */}
            {(() => {
              const arrayFieldGroups: Record<
                string,
                {
                  fieldName: string;
                  editorType: string;
                  variant?: string;
                  fullPath: string;
                }[]
              > = {};
              Object.entries(configuredFields).forEach(
                ([fieldPath, editorTypeRaw]) => {
                  if (/^[\w]+\[\]\.[\w]+\[\]\./.test(fieldPath)) return;
                  const match = fieldPath.match(/^([\w.]+)\[\]\.(.+)$/);
                  if (!match) return;
                  const [, arrPath, fieldName] = match;
                  if (!arrayFieldGroups[arrPath])
                    arrayFieldGroups[arrPath] = [];
                  const { type: edType, variant: edVariant } =
                    parseEditorType(editorTypeRaw);
                  arrayFieldGroups[arrPath].push({
                    fieldName,
                    editorType: edType,
                    variant: edVariant,
                    fullPath: fieldPath,
                  });
                },
              );

              const supportedGroupedTypes = new Set([
                "color-picker",
                "image-picker",
                "link-picker",
                "rich-text-editor",
                "variant-picker",
              ]);
              const groupedArrayPaths = new Set(
                Object.entries(arrayFieldGroups)
                  .filter(
                    ([, fields]) =>
                      fields.length >= 2 &&
                      fields.every((f) =>
                        supportedGroupedTypes.has(f.editorType),
                      ),
                  )
                  .map(([arrPath]) => arrPath),
              );

              return Array.from(groupedArrayPaths).map((arrPath) => {
                const fields = arrayFieldGroups[arrPath];
                const getArrayDataForGroup = () => {
                  if (!parsedSection) return [];
                  const pathParts = arrPath.split(".");
                  let current: unknown = parsedSection;
                  for (const part of pathParts) {
                    if (!current || typeof current !== "object") return [];
                    current = (current as Record<string, unknown>)[part];
                  }
                  return Array.isArray(current)
                    ? (current as Record<string, unknown>[])
                    : [];
                };
                const arrData = getArrayDataForGroup();
                if (arrData.length === 0) return null;

                const arrayLabel = arrPath.split(".").pop() || arrPath;

                const fieldLabelMap: Record<string, string> = {
                  name: "Nombre",
                  title: "Título",
                  role: "Rol / Cargo",
                  company: "Empresa",
                  comment: "Comentario",
                  excerpt: "Extracto",
                  rating: "Calificación",
                  box_color: "Fondo de tarjeta",
                  name_color: "Color de nombre",
                  title_color: "Color de título",
                  role_color: "Color de rol",
                  comment_color: "Color de comentario",
                  excerpt_color: "Color de extracto",
                  star_color: "Color de estrellas",
                  linkedin_color: "Color de LinkedIn",
                  link_color: "Color de enlace",
                  avatar: "Foto de perfil",
                  logo: "Logo",
                  linkedin_url: "LinkedIn URL",
                  link_text: "Texto del enlace",
                  link_url: "URL del enlace",
                  logo_height: "Altura del logo (px)",
                  "media.url": "Video / Media URL",
                };

                const hiddenFields = new Set([
                  "type",
                  "media.type",
                  "media.ratio",
                  "ratio",
                  "logo_height",
                ]);
                if (fields.some((f) => f.fieldName === "button_variant")) {
                  hiddenFields.add("variant");
                }

                const getNestedValue = (
                  obj: Record<string, unknown>,
                  path: string,
                ): unknown => {
                  const parts = path.split(".");
                  let cur: unknown = obj;
                  for (const p of parts) {
                    if (!cur || typeof cur !== "object") return undefined;
                    cur = (cur as Record<string, unknown>)[p];
                  }
                  return cur;
                };

                const updateNestedField = (
                  idx: number,
                  fieldName: string,
                  value: unknown,
                ) => {
                  if (fieldName.includes(".")) {
                    const parts = fieldName.split(".");
                    try {
                      const parsed = safeYamlLoad(yamlContent) as Record<
                        string,
                        unknown
                      >;
                      if (!parsed || typeof parsed !== "object") return;
                      pushUndoState(yamlContent);
                      const arrParts = arrPath.split(".");
                      let cur: unknown = parsed;
                      for (const p of arrParts) {
                        if (!cur || typeof cur !== "object") return;
                        cur = (cur as Record<string, unknown>)[p];
                      }
                      if (!Array.isArray(cur)) return;
                      let target: unknown = cur[idx];
                      for (let i = 0; i < parts.length - 1; i++) {
                        if (!target || typeof target !== "object") return;
                        if (
                          !(parts[i] in (target as Record<string, unknown>))
                        ) {
                          (target as Record<string, unknown>)[parts[i]] = {};
                        }
                        target = (target as Record<string, unknown>)[parts[i]];
                      }
                      if (target && typeof target === "object") {
                        (target as Record<string, unknown>)[
                          parts[parts.length - 1]
                        ] = value;
                      }
                      const newYaml = safeYamlDump(parsed, {
                        lineWidth: -1,
                        noRefs: true,
                        quotingType: '"',
                      });
                      setYamlContent(newYaml);
                      setHasChanges(true);
                      setParseError(null);
                      if (onPreviewChange) onPreviewChange(parsed as Section);
                    } catch (e) {
                      console.error("Error updating nested field:", e);
                    }
                  } else {
                    if (
                      typeof value === "string" ||
                      typeof value === "number" ||
                      value === undefined
                    ) {
                      updateArrayItemField(arrPath, idx, fieldName, value as string | number | boolean | undefined);
                    }
                  }
                };

                const collectItemKeys = (
                  items: Record<string, unknown>[],
                ): string[] => {
                  const keySet = new Set<string>();
                  items.forEach((item) => {
                    const flattenKeys = (
                      obj: Record<string, unknown>,
                      prefix: string,
                    ) => {
                      Object.keys(obj).forEach((k) => {
                        const path = prefix ? `${prefix}.${k}` : k;
                        const val = obj[k];
                        if (
                          val &&
                          typeof val === "object" &&
                          !Array.isArray(val)
                        ) {
                          flattenKeys(val as Record<string, unknown>, path);
                        } else {
                          keySet.add(path);
                        }
                      });
                    };
                    flattenKeys(item, "");
                  });
                  return Array.from(keySet);
                };

                const allItemKeys = collectItemKeys(arrData);
                const configuredFieldNames = new Set(
                  fields.map((f) => f.fieldName),
                );
                const textFields = allItemKeys.filter(
                  (k) => !configuredFieldNames.has(k) && !hiddenFields.has(k),
                );

                const fieldOrder: string[] = [
                  ...textFields,
                  ...fields
                    .map((f) => f.fieldName)
                    .filter((fn) => fn === "avatar"),
                  ...fields
                    .map((f) => f.fieldName)
                    .filter((fn) => fn !== "avatar" && !fn.includes("color")),
                  ...fields
                    .map((f) => f.fieldName)
                    .filter((fn) => fn.includes("color")),
                ];

                const buildDefaultItem = (): Record<string, unknown> => {
                  if (arrData.length === 0) return {};
                  const template: Record<string, unknown> = {};
                  const sample = arrData[0];
                  Object.keys(sample).forEach((k) => {
                    const val = sample[k];
                    if (typeof val === "string") template[k] = "";
                    else if (typeof val === "number") template[k] = 0;
                    else if (
                      typeof val === "object" &&
                      val !== null &&
                      !Array.isArray(val)
                    ) {
                      const nested: Record<string, unknown> = {};
                      Object.keys(val as Record<string, unknown>).forEach(
                        (nk) => {
                          const nv = (val as Record<string, unknown>)[nk];
                          if (typeof nv === "string") nested[nk] = "";
                          else if (typeof nv === "number") nested[nk] = 0;
                        },
                      );
                      template[k] = nested;
                    }
                  });
                  const nameKey =
                    "name" in template
                      ? "name"
                      : "title" in template
                        ? "title"
                        : null;
                  if (nameKey)
                    template[nameKey] = `Nuevo item ${arrData.length + 1}`;
                  return template;
                };

                return (
                  <div key={`grouped-${arrPath}`} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium capitalize">
                        {arrayLabel} ({arrData.length})
                      </Label>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          addArrayItem(arrPath, buildDefaultItem())
                        }
                        data-testid={`props-grouped-add-${arrPath}`}
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Agregar
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {arrData.map((item, index) => {
                        const itemLabel =
                          (item.name as string) ||
                          (item.title as string) ||
                          (item.label as string) ||
                          `Item ${index + 1}`;
                        const avatarSrc =
                          (item.avatar as string) ||
                          (item.logo as string) ||
                          "";
                        const displayAvatarSrc =
                          imageRegistry?.images?.[avatarSrc]?.src || avatarSrc;
                        const isLogo = !item.avatar && !!(item.logo as string);

                        return (
                          <Collapsible
                            key={index}
                            className="border rounded-md"
                          >
                            <CollapsibleTrigger asChild>
                              <button
                                type="button"
                                className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors"
                                data-testid={`props-grouped-item-${arrPath}-${index}-trigger`}
                              >
                                {avatarSrc ? (
                                  <div
                                    className={`w-8 h-8 flex-shrink-0 overflow-hidden border ${isLogo ? "rounded-md bg-background p-1" : "rounded-full bg-muted"}`}
                                  >
                                    <img
                                      src={displayAvatarSrc}
                                      alt={itemLabel}
                                      className={`w-full h-full ${isLogo ? "object-contain" : "object-cover"}`}
                                    />
                                  </div>
                                ) : (
                                  <div className="w-8 h-8 rounded-full bg-muted border flex-shrink-0 flex items-center justify-center text-xs font-semibold text-muted-foreground">
                                    {itemLabel
                                      .split(" ")
                                      .map((n) => n[0])
                                      .join("")
                                      .toUpperCase()
                                      .slice(0, 2)}
                                  </div>
                                )}
                                <span className="flex-1 text-left text-sm font-medium truncate">
                                  {itemLabel}
                                </span>
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              </button>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="p-3 pt-0 space-y-3 border-t">
                                <div className="flex justify-end">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-destructive h-7 px-2 text-xs"
                                    onClick={() =>
                                      removeArrayItem(arrPath, index)
                                    }
                                    data-testid={`props-grouped-delete-${arrPath}-${index}`}
                                  >
                                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                                    Eliminar
                                  </Button>
                                </div>
                                {fieldOrder.map((fieldKey) => {
                                  const currentValue = String(
                                    getNestedValue(item, fieldKey) ?? "",
                                  );
                                  const label =
                                    fieldLabelMap[fieldKey] ||
                                    fieldKey
                                      .replace(/_/g, " ")
                                      .replace(/\b\w/g, (c) => c.toUpperCase());
                                  const configuredField = fields.find(
                                    (f) => f.fieldName === fieldKey,
                                  );

                                  if (configuredField) {
                                    if (
                                      configuredField.editorType ===
                                      "icon-picker"
                                    ) {
                                      return (
                                        <div
                                          key={fieldKey}
                                          className="space-y-1"
                                        >
                                          <Label className="text-xs text-muted-foreground">
                                            {label}
                                          </Label>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setIconPickerTarget({
                                                arrayField: arrPath,
                                                index,
                                                field: fieldKey,
                                                label: itemLabel,
                                                currentIcon: currentValue,
                                              });
                                              setIconPickerOpen(true);
                                            }}
                                            className="flex items-center justify-center w-10 h-10 rounded border bg-muted/30 hover:bg-muted transition-colors"
                                            data-testid={`props-grouped-icon-${fieldKey}-${index}`}
                                            title={`${itemLabel}: ${currentValue || "no icon"}`}
                                          >
                                            {renderIconByName(currentValue)}
                                          </button>
                                        </div>
                                      );
                                    }
                                    if (
                                      configuredField.editorType ===
                                      "color-picker"
                                    ) {
                                      const colorType =
                                        (configuredField.variant as ColorPickerVariant) ||
                                        "accent";
                                      return (
                                        <div
                                          key={fieldKey}
                                          className="space-y-1"
                                        >
                                          <Label className="text-xs text-muted-foreground">
                                            {label}
                                          </Label>
                                          <ColorPicker
                                            value={currentValue}
                                            onChange={(value) =>
                                              updateNestedField(
                                                index,
                                                fieldKey,
                                                value,
                                              )
                                            }
                                            type={colorType}
                                            label=" "
                                            allowNone={true}
                                            allowCustom={true}
                                            testIdPrefix={`props-grouped-${fieldKey}-${index}`}
                                          />
                                        </div>
                                      );
                                    }

                                    if (
                                      configuredField.editorType ===
                                      "image-picker"
                                    ) {
                                      const displaySrc =
                                        imageRegistry?.images?.[currentValue]
                                          ?.src || currentValue;
                                      return (
                                        <div
                                          key={fieldKey}
                                          className="space-y-1"
                                        >
                                          <Label className="text-xs text-muted-foreground">
                                            {label}
                                          </Label>
                                          <div className="flex items-center gap-2">
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setImagePickerTarget({
                                                  arrayPath: arrPath,
                                                  index,
                                                  srcField: fieldKey,
                                                  currentSrc: currentValue,
                                                  currentAlt:
                                                    (item.name as string) || "",
                                                  tagFilter:
                                                    configuredField.variant,
                                                });
                                                setImagePickerOpen(true);
                                              }}
                                              className="relative w-12 h-12 rounded-md border border-input bg-muted/50 hover:bg-muted transition-colors overflow-hidden group"
                                              data-testid={`props-grouped-image-${fieldKey}-${index}`}
                                            >
                                              {currentValue ? (
                                                <>
                                                  <img
                                                    src={displaySrc}
                                                    alt={label}
                                                    className="w-full h-full object-cover"
                                                  />
                                                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                    <Image className="h-4 w-4 text-white" />
                                                  </div>
                                                </>
                                              ) : (
                                                <div className="w-full h-full flex items-center justify-center">
                                                  <Image className="h-5 w-5 text-muted-foreground" />
                                                </div>
                                              )}
                                            </button>
                                            {currentValue && (
                                              <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                                                {currentValue
                                                  .split("/")
                                                  .pop() || currentValue}
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    }

                                    if (
                                      configuredField.editorType ===
                                      "link-picker"
                                    ) {
                                      return (
                                        <div
                                          key={fieldKey}
                                          className="space-y-1"
                                        >
                                          <Label className="text-xs text-muted-foreground">
                                            {label}
                                          </Label>
                                          <LinkPicker
                                            value={currentValue}
                                            onChange={(url) =>
                                              updateNestedField(
                                                index,
                                                fieldKey,
                                                url,
                                              )
                                            }
                                            locale={locale}
                                            allSections={allSections}
                                            testId={`props-grouped-link-${fieldKey}-${index}`}
                                          />
                                        </div>
                                      );
                                    }
                                    if (
                                      configuredField.editorType ===
                                      "rich-text-editor"
                                    ) {
                                      return (
                                        <div
                                          key={fieldKey}
                                          className="space-y-1"
                                        >
                                          <Label className="text-xs text-muted-foreground">
                                            {label}
                                          </Label>
                                          <RichTextArea
                                            key={`${sectionIndex}-${arrPath}-${index}-${fieldKey}`}
                                            value={currentValue}
                                            onChange={(html) =>
                                              updateNestedField(
                                                index,
                                                fieldKey,
                                                html,
                                              )
                                            }
                                            placeholder={`Edit ${label}…`}
                                            minHeight="80px"
                                            locale={locale}
                                            customOptions={configuredField.variant ? configuredField.variant.split(",").map((o: string) => o.trim()) : undefined}
                                            data-testid={`props-grouped-richtext-${fieldKey}-${index}`}
                                          />
                                        </div>
                                      );
                                    }
                                    if (
                                      configuredField.editorType ===
                                      "variant-picker"
                                    ) {
                                      const variantOptions =
                                        themeConfig?.button_variants ?? [];
                                      return (
                                        <div
                                          key={fieldKey}
                                          className="space-y-1"
                                        >
                                          <Label className="text-xs text-muted-foreground">
                                            {label}
                                          </Label>
                                          <VariantPicker
                                            value={currentValue || ""}
                                            onChange={(v) =>
                                              updateNestedField(
                                                index,
                                                fieldKey,
                                                v,
                                              )
                                            }
                                            options={variantOptions}
                                            label=""
                                          />
                                        </div>
                                      );
                                    }
                                    return null;
                                  }

                                  const rawValue = getNestedValue(
                                    item,
                                    fieldKey,
                                  );
                                  if (
                                    typeof rawValue === "number" ||
                                    fieldKey === "rating"
                                  ) {
                                    return (
                                      <div key={fieldKey} className="space-y-1">
                                        <Label className="text-xs text-muted-foreground">
                                          {label}
                                        </Label>
                                        <Input
                                          type="number"
                                          value={
                                            rawValue !== undefined
                                              ? String(rawValue)
                                              : ""
                                          }
                                          onChange={(e) => {
                                            const num =
                                              e.target.value === ""
                                                ? undefined
                                                : Number(e.target.value);
                                            updateNestedField(
                                              index,
                                              fieldKey,
                                              num,
                                            );
                                          }}
                                          min={0}
                                          max={
                                            fieldKey === "rating"
                                              ? 5
                                              : undefined
                                          }
                                          className="h-8 text-sm"
                                          data-testid={`props-grouped-number-${fieldKey}-${index}`}
                                        />
                                      </div>
                                    );
                                  }

                                  if (
                                    fieldKey === "client_comments" ||
                                    (typeof rawValue === "string" &&
                                      rawValue.length > 80)
                                  ) {
                                    return (
                                      <div key={fieldKey} className="space-y-1">
                                        <Label className="text-xs text-muted-foreground">
                                          {label}
                                        </Label>
                                        <Textarea
                                          value={currentValue}
                                          onChange={(e) =>
                                            updateNestedField(
                                              index,
                                              fieldKey,
                                              e.target.value,
                                            )
                                          }
                                          rows={3}
                                          className="text-sm resize-none"
                                          data-testid={`props-grouped-text-${fieldKey}-${index}`}
                                        />
                                      </div>
                                    );
                                  }

                                  return (
                                    <div key={fieldKey} className="space-y-1">
                                      <Label className="text-xs text-muted-foreground">
                                        {label}
                                      </Label>
                                      <Input
                                        value={currentValue}
                                        onChange={(e) =>
                                          updateNestedField(
                                            index,
                                            fieldKey,
                                            e.target.value,
                                          )
                                        }
                                        className="h-8 text-sm"
                                        data-testid={`props-grouped-input-${fieldKey}-${index}`}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        );
                      })}
                    </div>
                  </div>
                );
              });
            })()}
            {/* Render double-nested array item editors (e.g., slides[].institution_logos[].image_id) */}
            {(() => {
              const nestedArrayGroups: Record<
                string,
                {
                  parentArr: string;
                  nestedArr: string;
                  leafField: string;
                  editorType: string;
                  variant?: string;
                }[]
              > = {};
              Object.entries(configuredFields).forEach(
                ([fieldPath, editorTypeRaw]) => {
                  const nestedMatch = fieldPath.match(
                    /^([\w]+)\[\]\.([\w]+)\[\]\.(.+)$/,
                  );
                  if (!nestedMatch) return;
                  const [, parentArr, nestedArr, leafField] = nestedMatch;
                  const groupKey = `${parentArr}[].${nestedArr}`;
                  if (!nestedArrayGroups[groupKey])
                    nestedArrayGroups[groupKey] = [];
                  const { type: edType, variant: edVariant } =
                    parseEditorType(editorTypeRaw);
                  nestedArrayGroups[groupKey].push({
                    parentArr,
                    nestedArr,
                    leafField,
                    editorType: edType,
                    variant: edVariant,
                  });
                },
              );

              if (Object.keys(nestedArrayGroups).length === 0) return null;

              return Object.entries(nestedArrayGroups).map(
                ([groupKey, fields]) => {
                  if (!parsedSection) return null;
                  const { parentArr, nestedArr } = fields[0];
                  const parentData = (parsedSection as Record<string, unknown>)[
                    parentArr
                  ];
                  if (!Array.isArray(parentData)) return null;

                  const nestedHiddenFields = new Set(["type"]);

                  return (
                    <div key={`nested-${groupKey}`} className="space-y-3">
                      {parentData.map((parentItem, parentIdx) => {
                        const parentItemObj = parentItem as Record<
                          string,
                          unknown
                        >;
                        const nestedData = parentItemObj[nestedArr];
                        if (!Array.isArray(nestedData)) return null;
                        const nestedItems = nestedData as Record<
                          string,
                          unknown
                        >[];

                        const parentLabel =
                          (parentItemObj.title as string) ||
                          (parentItemObj.name as string) ||
                          `Slide ${parentIdx + 1}`;
                        const resolvedArrPath = `${parentArr}.${parentIdx}.${nestedArr}`;

                        const configuredLeafNames = new Set(
                          fields.map((f) => f.leafField),
                        );
                        const collectNestedKeys = (
                          items: Record<string, unknown>[],
                        ): string[] => {
                          const keySet = new Set<string>();
                          items.forEach((item) => {
                            Object.keys(item).forEach((k) => {
                              if (
                                !configuredLeafNames.has(k) &&
                                !nestedHiddenFields.has(k) &&
                                typeof item[k] !== "object"
                              ) {
                                keySet.add(k);
                              }
                            });
                          });
                          return Array.from(keySet);
                        };
                        const extraTextFields = collectNestedKeys(nestedItems);

                        const fieldOrder = [
                          ...extraTextFields,
                          ...fields.map((f) => f.leafField),
                        ];

                        const buildNestedDefault = (): Record<
                          string,
                          unknown
                        > => {
                          if (nestedItems.length === 0) return {};
                          const template: Record<string, unknown> = {};
                          Object.keys(nestedItems[0]).forEach((k) => {
                            const val = nestedItems[0][k];
                            if (typeof val === "string") template[k] = "";
                            else if (typeof val === "number") template[k] = 0;
                          });
                          return template;
                        };

                        return (
                          <div
                            key={`nested-${groupKey}-${parentIdx}`}
                            className="space-y-2"
                          >
                            <div className="flex items-center justify-between">
                              <Label className="text-xs text-muted-foreground">
                                {nestedArr.replace(/_/g, " ")} — {parentLabel} (
                                {nestedItems.length})
                              </Label>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  addArrayItem(
                                    resolvedArrPath,
                                    buildNestedDefault(),
                                  )
                                }
                                data-testid={`props-nested-add-${resolvedArrPath}`}
                              >
                                <Plus className="h-4 w-4 mr-1" />
                                Agregar
                              </Button>
                            </div>
                            <div className="space-y-2">
                              {nestedItems.map((nestedItem, nestedIdx) => {
                                const itemLabel =
                                  (nestedItem.alt as string) ||
                                  (nestedItem.name as string) ||
                                  (nestedItem.title as string) ||
                                  `Item ${nestedIdx + 1}`;
                                const logoSrc =
                                  (nestedItem.image_id as string) ||
                                  (nestedItem.logo as string) ||
                                  "";
                                const displayLogoSrc =
                                  imageRegistry?.images?.[logoSrc]?.src ||
                                  logoSrc;

                                return (
                                  <Collapsible
                                    key={nestedIdx}
                                    className="border rounded-md"
                                  >
                                    <CollapsibleTrigger asChild>
                                      <button
                                        type="button"
                                        className="w-full flex items-center gap-3 p-2 hover:bg-muted/50 transition-colors"
                                        data-testid={`props-nested-item-${resolvedArrPath}-${nestedIdx}-trigger`}
                                      >
                                        {logoSrc ? (
                                          <div className="w-8 h-8 flex-shrink-0 overflow-hidden border rounded-md bg-background p-1">
                                            <img
                                              src={displayLogoSrc}
                                              alt={itemLabel}
                                              className="w-full h-full object-contain"
                                            />
                                          </div>
                                        ) : (
                                          <div className="w-8 h-8 rounded-md bg-muted border flex-shrink-0 flex items-center justify-center text-xs font-semibold text-muted-foreground">
                                            {itemLabel
                                              .slice(0, 2)
                                              .toUpperCase()}
                                          </div>
                                        )}
                                        <span className="flex-1 text-left text-xs font-medium truncate">
                                          {itemLabel}
                                        </span>
                                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                      </button>
                                    </CollapsibleTrigger>
                                    <CollapsibleContent>
                                      <div className="p-2 pt-0 space-y-2 border-t">
                                        <div className="flex justify-end">
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="text-destructive h-6 px-2 text-xs"
                                            onClick={() =>
                                              removeArrayItem(
                                                resolvedArrPath,
                                                nestedIdx,
                                              )
                                            }
                                            data-testid={`props-nested-delete-${resolvedArrPath}-${nestedIdx}`}
                                          >
                                            <Trash2 className="h-3.5 w-3.5 mr-1" />
                                            Eliminar
                                          </Button>
                                        </div>
                                        {fieldOrder.map((fieldKey) => {
                                          const getLeafValue = (path: string): unknown => {
                                            const parts = path.split(".");
                                            let cur: unknown = nestedItem;
                                            for (const p of parts) {
                                              if (!cur || typeof cur !== "object") return undefined;
                                              cur = (cur as Record<string, unknown>)[p];
                                            }
                                            return cur;
                                          };
                                          const currentValue = String(getLeafValue(fieldKey) ?? "");
                                          const nestedFieldLabelMap: Record<string, string> = {
                                            "action.url": "URL de acción",
                                            "action.message": "Mensaje de acción",
                                            "action.next_question": "Siguiente pregunta",
                                          };
                                          const label = nestedFieldLabelMap[fieldKey] ?? fieldKey
                                            .replace(/_/g, " ")
                                            .replace(/\b\w/g, (c) =>
                                              c.toUpperCase(),
                                            );
                                          const configuredField = fields.find(
                                            (f) => f.leafField === fieldKey,
                                          );

                                          if (
                                            configuredField?.editorType ===
                                            "icon-picker"
                                          ) {
                                            return (
                                              <div
                                                key={fieldKey}
                                                className="space-y-1"
                                              >
                                                <Label className="text-xs text-muted-foreground">
                                                  {label}
                                                </Label>
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    setIconPickerTarget({
                                                      arrayField:
                                                        resolvedArrPath,
                                                      index: nestedIdx,
                                                      field: fieldKey,
                                                      label: `${itemLabel} > ${label}`,
                                                      currentIcon: currentValue,
                                                    });
                                                    setIconPickerOpen(true);
                                                  }}
                                                  className="flex items-center justify-center w-10 h-10 rounded border bg-muted/30 hover:bg-muted transition-colors"
                                                  data-testid={`props-nested-icon-${fieldKey}-${nestedIdx}`}
                                                  title={`${label}: ${currentValue || "no icon"}`}
                                                >
                                                  {renderIconByName(
                                                    currentValue,
                                                  )}
                                                </button>
                                              </div>
                                            );
                                          }

                                          if (
                                            configuredField?.editorType ===
                                            "image-picker"
                                          ) {
                                            const displaySrc =
                                              imageRegistry?.images?.[
                                                currentValue
                                              ]?.src || currentValue;
                                            return (
                                              <div
                                                key={fieldKey}
                                                className="space-y-1"
                                              >
                                                <Label className="text-xs text-muted-foreground">
                                                  {label}
                                                </Label>
                                                <div className="flex items-center gap-2">
                                                  <button
                                                    type="button"
                                                    onClick={() => {
                                                      setImagePickerTarget({
                                                        arrayPath:
                                                          resolvedArrPath,
                                                        index: nestedIdx,
                                                        srcField: fieldKey,
                                                        currentSrc:
                                                          currentValue,
                                                        currentAlt:
                                                          (nestedItem.alt as string) ||
                                                          "",
                                                        tagFilter:
                                                          configuredField.variant,
                                                      });
                                                      setImagePickerOpen(true);
                                                    }}
                                                    className="relative w-10 h-10 rounded-md border border-input bg-muted/50 hover:bg-muted transition-colors overflow-hidden group"
                                                    data-testid={`props-nested-image-${fieldKey}-${nestedIdx}`}
                                                  >
                                                    {currentValue ? (
                                                      <>
                                                        <img
                                                          src={displaySrc}
                                                          alt={label}
                                                          className="w-full h-full object-contain p-0.5"
                                                        />
                                                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                          <Image className="h-3.5 w-3.5 text-white" />
                                                        </div>
                                                      </>
                                                    ) : (
                                                      <div className="w-full h-full flex items-center justify-center">
                                                        <Image className="h-4 w-4 text-muted-foreground" />
                                                      </div>
                                                    )}
                                                  </button>
                                                  {currentValue && (
                                                    <span className="text-xs text-muted-foreground truncate max-w-[100px]">
                                                      {currentValue}
                                                    </span>
                                                  )}
                                                </div>
                                              </div>
                                            );
                                          }

                                          if (
                                            configuredField?.editorType ===
                                            "link-picker"
                                          ) {
                                            return (
                                              <div
                                                key={fieldKey}
                                                className="space-y-1"
                                              >
                                                <Label className="text-xs text-muted-foreground">
                                                  {label}
                                                </Label>
                                                <LinkPicker
                                                  value={currentValue}
                                                  onChange={(url) =>
                                                    updateArrayItemField(
                                                      resolvedArrPath,
                                                      nestedIdx,
                                                      fieldKey,
                                                      url,
                                                    )
                                                  }
                                                  locale={locale}
                                                  allSections={allSections}
                                                  testId={`props-nested-link-${fieldKey.replace(/\./g, "-")}-${nestedIdx}`}
                                                  allowInlineRender={configuredField.variant === "allow-inline-render"}
                                                />
                                              </div>
                                            );
                                          }

                                          if (
                                            typeof getLeafValue(fieldKey) ===
                                            "number"
                                          ) {
                                            return (
                                              <div
                                                key={fieldKey}
                                                className="space-y-1"
                                              >
                                                <Label className="text-xs text-muted-foreground">
                                                  {label}
                                                </Label>
                                                <Input
                                                  type="number"
                                                  value={currentValue}
                                                  onChange={(e) => {
                                                    const num =
                                                      e.target.value === ""
                                                        ? undefined
                                                        : Number(
                                                            e.target.value,
                                                          );
                                                    updateArrayItemField(
                                                      resolvedArrPath,
                                                      nestedIdx,
                                                      fieldKey,
                                                      num as number,
                                                    );
                                                  }}
                                                  className="h-7 text-xs"
                                                  data-testid={`props-nested-number-${fieldKey}-${nestedIdx}`}
                                                />
                                              </div>
                                            );
                                          }

                                          return (
                                            <div
                                              key={fieldKey}
                                              className="space-y-1"
                                            >
                                              <Label className="text-xs text-muted-foreground">
                                                {label}
                                              </Label>
                                              <Input
                                                value={currentValue}
                                                onChange={(e) =>
                                                  updateArrayItemField(
                                                    resolvedArrPath,
                                                    nestedIdx,
                                                    fieldKey,
                                                    e.target.value,
                                                  )
                                                }
                                                className="h-7 text-xs"
                                                data-testid={`props-nested-input-${fieldKey}-${nestedIdx}`}
                                              />
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </CollapsibleContent>
                                  </Collapsible>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                },
              );
            })()}
            {/* Render array fields with configured editors */}
            {Object.entries(configuredFields).map(
              ([fieldPath, editorTypeRaw]) => {
                // Skip double-nested array fields (handled above)
                if (/^[\w]+\[\]\.[\w]+\[\]\./.test(fieldPath)) return null;
                // Skip fields that are already rendered in grouped collapsible items above
                const groupedSkipMatch = fieldPath.match(/^([\w.]+)\[\]\./);
                if (groupedSkipMatch) {
                  const arrPathCheck = groupedSkipMatch[1];
                  const supportedTypes = new Set([
                    "color-picker",
                    "image-picker",
                    "video-picker",
                    "link-picker",
                    "rich-text-editor",
                    "variant-picker",
                  ]);
                  const allForArr = Object.entries(configuredFields).filter(
                    ([fp]) => fp.startsWith(`${arrPathCheck}[].`),
                  );
                  const allSupported = allForArr.every(([, et]) =>
                    supportedTypes.has(parseEditorType(et).type),
                  );
                  if (allForArr.length >= 2 && allSupported) return null;
                }

                // Parse editor type with optional variant (e.g., "color-picker:background")
                const { type: editorType, variant } =
                  parseEditorType(editorTypeRaw);

                // Handle simple field paths (e.g., "image" or "nested.image")
                const isSimpleField = !fieldPath.includes("[]");
                // Simple image-picker and video-picker are already rendered by the dedicated top-level loops above
                if (isSimpleField && (editorType === "image-picker" || editorType === "video-picker")) {
                  return null;
                }

                // For dotted simple fields like "cta_button.url", skip if the parent object doesn't exist in the YAML.
                // Exception: self-initializing editors (e.g. related-features-picker) always show — they create the structure on save.
                const selfInitializingEditors = new Set(["related-features-picker", "faq-visibility-editor", "faq-section-editor", "schema-org-section-editor"]);
                const isSelfInitializing = selfInitializingEditors.has(editorType) || editorType.startsWith("db-field-values-picker");
                if (isSimpleField && fieldPath.includes(".") && !isSelfInitializing && !fieldPath.includes(".*")) {
                  const parentParts = fieldPath.split(".");
                  let parentExists: unknown = parsedSection;
                  for (let i = 0; i < parentParts.length - 1; i++) {
                    if (!parentExists || typeof parentExists !== "object") {
                      parentExists = undefined;
                      break;
                    }
                    parentExists = (parentExists as Record<string, unknown>)[parentParts[i]];
                  }
                  if (parentExists === undefined || parentExists === null) return null;
                }

                // Handle map-key paths like "routes.*.url" — iterate over all object keys
                if (!fieldPath.includes("[]") && fieldPath.includes(".*.") && editorType === "link-picker") {
                  const dotStarIdx = fieldPath.indexOf(".*.");
                  const mapPath = fieldPath.substring(0, dotStarIdx);
                  const subPath = fieldPath.substring(dotStarIdx + 3);
                  const mapValue = parsedSection ? (parsedSection as Record<string, unknown>)[mapPath] : null;
                  if (!mapValue || typeof mapValue !== "object") return null;
                  const entries = Object.entries(mapValue as Record<string, unknown>);
                  if (entries.length === 0) return null;
                  return (
                    <div key={fieldPath} className="space-y-3">
                      <Label className="text-sm font-medium">{getFieldLabel(mapPath)}</Label>
                      {entries.map(([key, val]) => {
                        const entryObj = (typeof val === "object" && val) ? val as Record<string, unknown> : {};
                        const currentUrl = (subPath ? (entryObj[subPath] as string) : (val as string)) || "";
                        return (
                          <div key={key} className="space-y-1">
                            <p className="text-xs font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>{key}</p>
                            <LinkPicker
                              value={currentUrl}
                              onChange={(url) => updateProperty(`${mapPath}.${key}.${subPath}`, url)}
                              locale={locale}
                              allSections={allSections}
                              testId={`props-link-${mapPath}-${key}`}
                              allowInlineRender={variant === "allow-inline-render"}
                            />
                          </div>
                        );
                      })}
                    </div>
                  );
                }

                if (isSimpleField && !fieldPath.includes(".*") && editorType === "link-picker") {
                  const getSimpleLinkValue = () => {
                    if (!parsedSection) return "";
                    const pathParts = fieldPath.split(".");
                    let current: unknown = parsedSection;
                    for (const part of pathParts) {
                      if (!current || typeof current !== "object") return "";
                      current = (current as Record<string, unknown>)[part];
                    }
                    return (current as string) || "";
                  };

                  const currentValue = getSimpleLinkValue();
                  const fieldLabel = getFieldLabel(fieldPath);

                  return (
                    <div key={fieldPath} className="space-y-2">
                      <Label className="text-sm font-medium">
                        {fieldLabel}
                      </Label>
                      <LinkPicker
                        value={currentValue}
                        onChange={(url) => updateProperty(fieldPath, url)}
                        locale={locale}
                        allSections={allSections}
                        testId={`props-link-${fieldPath.replace(/\./g, "-")}`}
                        allowInlineRender={variant === "allow-inline-render"}
                      />
                    </div>
                  );
                }

                // Handle simple field paths with image-with-style-picker (e.g., "left.image" or just "image")
                if (isSimpleField && editorType === "image-with-style-picker") {
                  const getNestedValue = (
                    path: string,
                    defaultValue: unknown = "",
                  ) => {
                    if (!parsedSection) return defaultValue;
                    if (!path) return defaultValue;
                    const pathParts = path.split(".");
                    let current: unknown = parsedSection;
                    for (const part of pathParts) {
                      if (!current || typeof current !== "object")
                        return defaultValue;
                      current = (current as Record<string, unknown>)[part];
                    }
                    return current ?? defaultValue;
                  };

                  const pathParts = fieldPath.split(".");
                  const parentPath = pathParts.slice(0, -1).join(".");
                  const side = pathParts[0];
                  // "image" → image_alt; "form_card_image" → form_card_image_alt
                  const baseName = pathParts[pathParts.length - 1];

                  const hasParent = parentPath.length > 0;
                  const fieldPrefix = hasParent ? `${parentPath}.` : "";
                  const altPath = `${fieldPrefix}${baseName}_alt`;
                  const objectFitPath = `${fieldPrefix}${baseName}_object_fit`;
                  const objectPositionPath = `${fieldPrefix}${baseName}_object_position`;

                  const rawValue = getNestedValue(fieldPath, "");
                  const currentValue = typeof rawValue === "string"
                    ? rawValue
                    : (rawValue && typeof rawValue === "object" && "src" in (rawValue as Record<string, unknown>))
                      ? String((rawValue as Record<string, unknown>).src || "")
                      : "";
                  const currentAlt = (getNestedValue(altPath, "") as string) || (
                    typeof rawValue === "object" && rawValue && "alt" in (rawValue as Record<string, unknown>)
                      ? String((rawValue as Record<string, unknown>).alt || "")
                      : ""
                  );
                  const currentObjectFit = getNestedValue(
                    objectFitPath,
                    "",
                  ) as string;
                  const currentObjectPosition = getNestedValue(
                    objectPositionPath,
                    "",
                  ) as string;

                  const fieldLabel = getFieldLabel(fieldPath);

                  return (
                    <ImageWithStylePicker
                      key={fieldPath}
                      label={fieldLabel}
                      value={currentValue}
                      alt={currentAlt}
                      objectFit={currentObjectFit}
                      objectPosition={currentObjectPosition}
                      tagFilter={variant}
                      testId={`props-image-style-${side}`}
                      onChangeSrc={(src, newAlt) => {
                        const updates: Record<string, string> = { [fieldPath]: src };
                        if (newAlt) updates[altPath] = newAlt;
                        updateProperties(updates);
                      }}
                      onChangeAlt={(newAlt) =>
                        updateProperty(altPath, newAlt)
                      }
                      onChangeObjectFit={(fit) =>
                        updateProperty(objectFitPath, fit)
                      }
                      onChangeObjectPosition={(pos) =>
                        updateProperty(objectPositionPath, pos)
                      }
                      onRemove={() => updateProperty(fieldPath, "")}
                    />
                  );
                }

                // Parse field path - supports single level like "features[].icon"
                // and multi-level nested arrays like "courses[].badges[].icon"
                const arrayBracketCount = (fieldPath.match(/\[\]/g) || [])
                  .length;

                // Multi-level nested array path (e.g., "courses[].badges[].icon")
                if (arrayBracketCount > 1) {
                  const segments = fieldPath.split("[].");
                  const itemField = segments[segments.length - 1];
                  const arraySegments = segments.slice(0, -1);

                  const getNestedLabel = (item: Record<string, unknown>) =>
                    (item.tab_label as string) ||
                    (item.title as string) ||
                    (item.label as string) ||
                    (item.name as string) ||
                    (item.text as string) ||
                    "";

                  type NestedItem = {
                    parentPath: string[];
                    parentIndices: number[];
                    parentLabel: string;
                    item: Record<string, unknown>;
                  };

                  const collectLeafItems = (): NestedItem[] => {
                    if (!parsedSection) return [];
                    const results: NestedItem[] = [];

                    const traverse = (
                      current: unknown,
                      segIdx: number,
                      path: string[],
                      indices: number[],
                      labelParts: string[],
                    ) => {
                      if (segIdx >= arraySegments.length) {
                        if (
                          current &&
                          typeof current === "object" &&
                          !Array.isArray(current)
                        ) {
                          results.push({
                            parentPath: path,
                            parentIndices: indices,
                            parentLabel: labelParts.join(" > "),
                            item: current as Record<string, unknown>,
                          });
                        }
                        return;
                      }

                      const segment = arraySegments[segIdx];
                      const segParts = segment.split(".");
                      let obj: unknown = current;
                      for (const part of segParts) {
                        if (!obj || typeof obj !== "object") return;
                        obj = (obj as Record<string, unknown>)[part];
                      }

                      if (!Array.isArray(obj)) return;

                      obj.forEach((arrayItem, idx) => {
                        const label =
                          getNestedLabel(
                            arrayItem as Record<string, unknown>,
                          ) || `${segParts[segParts.length - 1]} ${idx + 1}`;
                        traverse(
                          arrayItem,
                          segIdx + 1,
                          [...path, segment],
                          [...indices, idx],
                          [...labelParts, label],
                        );
                      });
                    };

                    traverse(parsedSection, 0, [], [], []);
                    return results;
                  };

                  const leafItems = collectLeafItems();
                  if (
                    leafItems.length === 0 &&
                    editorType !== "image-with-style-picker"
                  )
                    return null;

                  const lastSegmentLabel =
                    arraySegments[arraySegments.length - 1].split(".").pop() ||
                    "";

                  const updateNestedField = (
                    nestedItem: NestedItem,
                    value: string | number | boolean,
                  ) => {
                    try {
                      const parsed = safeYamlLoad(yamlContent) as Record<
                        string,
                        unknown
                      >;
                      if (!parsed || typeof parsed !== "object") return;

                      pushUndoState(yamlContent);

                      let current: unknown = parsed;
                      for (let i = 0; i < nestedItem.parentPath.length; i++) {
                        const segParts = nestedItem.parentPath[i].split(".");
                        for (const part of segParts) {
                          if (!current || typeof current !== "object") return;
                          current = (current as Record<string, unknown>)[part];
                        }
                        if (!Array.isArray(current)) return;
                        current = current[nestedItem.parentIndices[i]];
                      }

                      if (!current || typeof current !== "object") return;
                      (current as Record<string, unknown>)[itemField] = value;

                      const newYaml = safeYamlDump(parsed, {
                        lineWidth: -1,
                        noRefs: true,
                        quotingType: '"',
                      });
                      setYamlContent(newYaml);
                      setHasChanges(true);
                      setParseError(null);
                      if (onPreviewChange) onPreviewChange(parsed as Section);
                    } catch (error) {
                      console.error("Error updating nested array item:", error);
                    }
                  };

                  if (editorType === "icon-picker") {
                    const groupedByParent: Record<string, NestedItem[]> = {};
                    leafItems.forEach((leaf) => {
                      const topLabel =
                        leaf.parentLabel.split(" > ")[0] || "Items";
                      if (!groupedByParent[topLabel])
                        groupedByParent[topLabel] = [];
                      groupedByParent[topLabel].push(leaf);
                    });

                    return (
                      <div key={fieldPath} className="space-y-3">
                        <Label className="text-sm font-medium capitalize">
                          {lastSegmentLabel} Icons
                        </Label>
                        {Object.entries(groupedByParent).map(
                          ([groupLabel, items]) => (
                            <div key={groupLabel} className="space-y-1">
                              <span className="text-xs text-muted-foreground">
                                {groupLabel}
                              </span>
                              <div className="flex flex-wrap gap-2">
                                {items.map((leaf, idx) => {
                                  const currentValue = String(
                                    getValueAtFieldPath(leaf.item, itemField) ?? "",
                                  );
                                  const leafLabel =
                                    leaf.parentLabel
                                      .split(" > ")
                                      .slice(1)
                                      .join(" > ") || `Item ${idx + 1}`;
                                  return (
                                    <button
                                      key={idx}
                                      type="button"
                                      onClick={() => {
                                        setIconPickerTarget({
                                          arrayField: "__nested__",
                                          index: 0,
                                          field: itemField,
                                          label: leaf.parentLabel,
                                          currentIcon: currentValue,
                                        });
                                        setNestedUpdateFn(
                                          () => (value: string) =>
                                            updateNestedField(leaf, value),
                                        );
                                        setIconPickerOpen(true);
                                      }}
                                      className="flex items-center justify-center w-10 h-10 rounded border bg-muted/30 hover:bg-muted transition-colors"
                                      data-testid={`props-icon-${lastSegmentLabel}-nested-${idx}`}
                                      title={`${leafLabel}: ${currentValue || "no icon"}`}
                                    >
                                      {renderIconByName(currentValue)}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ),
                        )}
                      </div>
                    );
                  }

                  if (editorType === "image-picker") {
                    const groupedByParent: Record<string, NestedItem[]> = {};
                    leafItems.forEach((leaf) => {
                      const topLabel =
                        leaf.parentLabel.split(" > ")[0] || "Items";
                      if (!groupedByParent[topLabel])
                        groupedByParent[topLabel] = [];
                      groupedByParent[topLabel].push(leaf);
                    });

                    return (
                      <div key={fieldPath} className="space-y-3">
                        <Label className="text-sm font-medium capitalize">
                          {lastSegmentLabel.replace(/_/g, " ")}
                        </Label>
                        {Object.entries(groupedByParent).map(
                          ([groupLabel, items]) => (
                            <div key={groupLabel} className="space-y-1">
                              <span className="text-xs text-muted-foreground">
                                {groupLabel}
                              </span>
                              <div className="flex flex-wrap gap-2">
                                {items.map((leaf, idx) => {
                                  const currentValue = String(
                                    getValueAtFieldPath(leaf.item, itemField) ?? "",
                                  );
                                  const altValue =
                                    (leaf.item.alt as string) || "";
                                  const displaySrc =
                                    imageRegistry?.images?.[currentValue]
                                      ?.src || currentValue;
                                  return (
                                    <button
                                      key={idx}
                                      type="button"
                                      onClick={() => {
                                        setImagePickerTarget({
                                          arrayPath: "__nested__",
                                          index: 0,
                                          srcField: itemField,
                                          currentSrc: currentValue,
                                          currentAlt: altValue,
                                          tagFilter: variant,
                                        });
                                        setNestedUpdateFn(
                                          () => (value: string) =>
                                            updateNestedField(leaf, value),
                                        );
                                        setImagePickerOpen(true);
                                      }}
                                      className="w-12 h-12 rounded-md overflow-hidden bg-muted border border-border hover:border-primary transition-colors flex-shrink-0"
                                      data-testid={`props-image-${lastSegmentLabel}-nested-${idx}`}
                                      title={altValue || `Image ${idx + 1}`}
                                    >
                                      {currentValue ? (
                                        <img
                                          src={displaySrc}
                                          alt={altValue || `Image ${idx + 1}`}
                                          className="w-full h-full object-cover"
                                        />
                                      ) : (
                                        <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                                          ?
                                        </div>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ),
                        )}
                      </div>
                    );
                  }

                  {
                    const renderNestedItemEditor = (
                      leaf: { parentPath: string[]; parentIndices: number[]; parentLabel: string; item: Record<string, unknown> },
                      idx: number,
                    ) => {
                      const currentValue = String(getValueAtFieldPath(leaf.item, itemField) ?? "");
                      const leafLabel = leaf.parentLabel || `Item ${idx + 1}`;
                      const handleNestedChange = (val: string | number | boolean) => updateNestedField(leaf, val);

                      switch (editorType) {
                        case "color-picker": {
                          const colorType = (variant as ColorPickerVariant) || "accent";
                          return (
                            <div key={idx} className="flex items-center gap-2">
                              <span className="text-sm text-muted-foreground min-w-[80px] truncate">{leafLabel}</span>
                              <ColorPicker
                                value={currentValue}
                                onChange={(v) => handleNestedChange(v)}
                                type={colorType}
                                label=" "
                                allowNone={true}
                                allowCustom={true}
                                testIdPrefix={`props-color-nested-${idx}`}
                              />
                            </div>
                          );
                        }
                        case "link-picker":
                          return (
                            <div key={idx} className="space-y-1">
                              <Label className="text-xs text-muted-foreground">{leafLabel}</Label>
                              <LinkPicker
                                value={currentValue}
                                onChange={(url) => handleNestedChange(url)}
                                locale={locale}
                                allSections={allSections}
                                testId={`props-link-nested-${idx}`}
                                allowInlineRender={variant === "allow-inline-render"}
                              />
                            </div>
                          );
                        case "rich-text-editor":
                          return (
                            <div key={idx} className="space-y-1">
                              <Label className="text-xs text-muted-foreground">{leafLabel}</Label>
                              <RichTextArea
                                value={currentValue}
                                onChange={(html) => handleNestedChange(html)}
                                placeholder={`Edit ${leafLabel}…`}
                                minHeight="80px"
                                locale={locale}
                                customOptions={variant ? variant.split(",").map((o: string) => o.trim()) : undefined}
                              />
                            </div>
                          );
                        case "boolean-toggle": {
                          const nestedFieldValue = getValueAtFieldPath(leaf.item, itemField);
                          const boolValue = nestedFieldValue === true || nestedFieldValue === "true";
                          return (
                            <div key={idx} className="flex items-center gap-3">
                              <Label className="text-sm text-muted-foreground">{leafLabel}</Label>
                              <Switch
                                checked={boolValue}
                                onCheckedChange={(checked) => handleNestedChange(checked)}
                              />
                            </div>
                          );
                        }
                        default:
                          return (
                            <div key={idx} className="space-y-1">
                              <Label className="text-xs text-muted-foreground">{leafLabel}</Label>
                              <Input
                                value={currentValue}
                                onChange={(e) => handleNestedChange(e.target.value)}
                                className="h-8 text-sm"
                                data-testid={`props-${editorType}-nested-${idx}`}
                              />
                            </div>
                          );
                      }
                    };

                    return (
                      <div key={fieldPath} className="space-y-3">
                        <Label className="text-sm font-medium capitalize">
                          {lastSegmentLabel.replace(/_/g, " ")}
                        </Label>
                        <div className="space-y-2">
                          {leafItems.map((leaf, idx) => renderNestedItemEditor(leaf, idx))}
                        </div>
                      </div>
                    );
                  }
                }

                // Handle simple field paths with rich-text (e.g., "subtitle", "description")
                if (isSimpleField && editorType === "rich-text-editor") {
                  const getSimpleFieldValue = () => {
                    if (!parsedSection) return "";
                    const pathParts = fieldPath.split(".");
                    let current: unknown = parsedSection;
                    for (const part of pathParts) {
                      if (!current || typeof current !== "object") return "";
                      current = (current as Record<string, unknown>)[part];
                    }
                    return (current as string) || "";
                  };
                  const currentValue = getSimpleFieldValue();
                  const fieldLabel = getFieldLabel(fieldPath);
                  const isFieldTemplateVar = isTemplateVarValue(getValueAtFieldPath(parsedSection, fieldPath));
                  return (
                    <div key={fieldPath} className="space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Label className="text-sm font-medium">
                          {fieldLabel}
                        </Label>
                        {isFieldTemplateVar && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0 bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700"
                            data-testid={`badge-template-var-${fieldPath}`}
                          >
                            template
                          </Badge>
                        )}
                      </div>
                      <RichTextArea
                        key={`${sectionIndex}-${fieldPath}`}
                        value={currentValue}
                        onChange={(html) => updateProperty(fieldPath, html)}
                        placeholder={`Edit ${fieldLabel}…`}
                        minHeight="120px"
                        locale={locale}
                        customOptions={variant ? variant.split(",").map((o: string) => o.trim()) : undefined}
                        data-testid={`props-rich-text-${fieldLabel}`}
                      />
                    </div>
                  );
                }

                // Handle simple field paths with markdown editor (e.g., "content")
                if (isSimpleField && editorType === "markdown") {
                  const getSimpleFieldValue = () => {
                    if (!parsedSection) return "";
                    const pathParts = fieldPath.split(".");
                    let current: unknown = parsedSection;
                    for (const part of pathParts) {
                      if (!current || typeof current !== "object") return "";
                      current = (current as Record<string, unknown>)[part];
                    }
                    return (current as string) || "";
                  };
                  const currentValue = getSimpleFieldValue();
                  const fieldLabel = getFieldLabel(fieldPath);
                  const supportsArticleToc =
                    sectionType === "article" && fieldPath === "content";
                  const showTocValue =
                    parsedSection?.show_toc === true ||
                    parsedSection?.show_toc === "true";
                  return (
                    <div key={fieldPath} className="space-y-2">
                      <MarkdownEditorField
                        key={`${sectionIndex}-${fieldPath}`}
                        value={currentValue}
                        onChange={(md) => updateProperty(fieldPath, md)}
                        label={fieldLabel}
                        {...(supportsArticleToc
                          ? {
                              showToc: showTocValue,
                              onShowTocChange: handleArticleTocToggle,
                            }
                          : {})}
                        data-testid={`props-markdown-${fieldLabel}`}
                      />
                      {supportsArticleToc && articlesOnPage.length > 1 ? (
                        <p
                          className="text-xs text-muted-foreground"
                          data-testid="article-split-education"
                        >
                          This page has multiple article sections — they always continue one
                          piece. Reading time and the mobile table of contents appear on the
                          first article only; the first article&apos;s Table of Contents toggle
                          controls the shared TOC. Desktop side TOC can still appear on later
                          parts.
                        </p>
                      ) : null}
                    </div>
                  );
                }

                // Handle simple field paths with boolean toggle (e.g., "layout_reversed")
                if (isSimpleField && editorType === "boolean-toggle") {
                  const getSimpleFieldValue = () => {
                    if (!parsedSection) return false;
                    const pathParts = fieldPath.split(".");
                    let current: unknown = parsedSection;
                    for (const part of pathParts) {
                      if (!current || typeof current !== "object") return false;
                      current = (current as Record<string, unknown>)[part];
                    }
                    return current === true || current === "true";
                  };
                  const currentValue = getSimpleFieldValue();
                  const fieldLabel = getFieldLabel(fieldPath);
                  return (
                    <div key={fieldPath} className="space-y-2">
                      <div className="flex items-center gap-3">
                        <Label className="text-sm font-medium">
                          {fieldLabel}
                        </Label>
                        <Switch
                          checked={currentValue}
                          onCheckedChange={(checked) =>
                            updatePropertyWithValue(fieldPath, checked)
                          }
                          data-testid={`props-toggle-${fieldLabel}`}
                        />
                      </div>
                    </div>
                  );
                }

                if (isSimpleField && editorType === "string-picker") {
                  const options = variant ? variant.split(",") : [];
                  const getSimpleStringValue = () => {
                    if (!parsedSection) return "";
                    const pathParts = fieldPath.split(".");
                    let current: unknown = parsedSection;
                    for (const part of pathParts) {
                      if (!current || typeof current !== "object") return "";
                      current = (current as Record<string, unknown>)[part];
                    }
                    return typeof current === "string" ? current : "";
                  };
                  const currentValue = getSimpleStringValue();
                  const fieldLabel = getFieldLabel(fieldPath);
                  return (
                    <div key={fieldPath} className="space-y-2">
                      <Label className="text-sm font-medium">{fieldLabel}</Label>
                      <Select
                        value={currentValue || options[0] || ""}
                        onValueChange={(val) => updatePropertyWithValue(fieldPath, val)}
                      >
                        <SelectTrigger data-testid={`props-select-${fieldLabel}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {options.map((opt) => (
                            <SelectItem key={opt} value={opt}>
                              {opt}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                }

                if (isSimpleField && editorType === "db-field-values-picker") {
                  const parts = editorTypeRaw.split(":");
                  const database = parts[1] ?? "";
                  const dbField = parts[2] ?? "";
                  const currentValue = (() => {
                    const dynEntries = parsedSection?.dynamic_entries as Record<string, unknown> | undefined;
                    const permFilters = dynEntries?.permanent_filters;
                    if (Array.isArray(permFilters)) {
                      const item = (permFilters as Array<{ item_property_slug: string; value: unknown }>)
                        .find(f => f.item_property_slug === dbField);
                      if (item) {
                        const v = item.value;
                        return Array.isArray(v) ? (v as string[]) : [String(v)];
                      }
                    }
                    return [];
                  })();
                  return (
                    <div key={fieldPath}>
                      <DbFieldValuesPicker
                        database={database}
                        field={dbField}
                        value={currentValue}
                        onChange={(value) => updateArrayProperty(fieldPath, value)}
                      />
                    </div>
                  );
                }

                if (isSimpleField && editorType === "related-features-picker") {
                  const pickerValue = (() => {
                    const dynEntries = parsedSection?.dynamic_entries as Record<string, unknown> | undefined;
                    const permFilters = dynEntries?.permanent_filters;
                    if (Array.isArray(permFilters)) {
                      const rfItem = (permFilters as Array<{ item_property_slug: string; value: unknown }>)
                        .find(f => f.item_property_slug === "related_features");
                      return (rfItem?.value as string[]) ?? [];
                    }
                    return ((permFilters as Record<string, unknown> | undefined)?.related_features as string[]) ?? [];
                  })();
                  const pickerPermanentFilters = (() => {
                    const dynEntries = parsedSection?.dynamic_entries as Record<string, unknown> | undefined;
                    const permFilters = dynEntries?.permanent_filters;
                    if (Array.isArray(permFilters)) {
                      return permFilters as Array<{ item_property_slug: string; value: string | string[] }>;
                    }
                    return [];
                  })();
                  return (
                    <div key={fieldPath}>
                      <RelatedFeaturesPicker
                        value={pickerValue}
                        onChange={(value) => updateArrayProperty(fieldPath, value)}
                        locale={locale}
                        permanentFilters={pickerPermanentFilters}
                      />
                    </div>
                  );
                }

                if (isSimpleField && editorType === "schema-org-section-editor") {
                  const propsRaw = parsedSection?.properties;
                  const properties =
                    propsRaw && typeof propsRaw === "object" && !Array.isArray(propsRaw)
                      ? (propsRaw as Record<string, unknown>)
                      : {};
                  const currentType =
                    typeof parsedSection?.schema_type === "string"
                      ? parsedSection.schema_type
                      : typeof (parsedSection as { schemaType?: unknown } | null)?.schemaType === "string"
                        ? String((parsedSection as { schemaType?: string }).schemaType)
                        : "";
                  return (
                    <div key={fieldPath}>
                      <SchemaOrgSectionEditorField
                        schemaType={currentType}
                        properties={properties}
                        locale={locale || "en"}
                        onSchemaTypeChange={(value) => updateProperty("schema_type", value)}
                        data-testid="props-schema-org-section-editor"
                      />
                    </div>
                  );
                }

                if (isSimpleField && editorType === "faq-section-editor") {
                  const getPermanentFilters = (): Array<{ item_property_slug: string; value: string | string[] }> => {
                    const dynEntries = parsedSection?.dynamic_entries as Record<string, unknown> | undefined;
                    const permFilters = dynEntries?.permanent_filters;
                    if (Array.isArray(permFilters)) {
                      return permFilters as Array<{ item_property_slug: string; value: string | string[] }>;
                    }
                    return [];
                  };
                  const permanentFilters = getPermanentFilters();
                  const topicsValue = (() => {
                    const rfItem = permanentFilters.find((f) => f.item_property_slug === "related_features");
                    if (rfItem) {
                      const v = rfItem.value;
                      return Array.isArray(v) ? (v as string[]) : [String(v)];
                    }
                    return [];
                  })();
                  const locationsValue = (() => {
                    const locItem = permanentFilters.find((f) => f.item_property_slug === "locations");
                    if (!locItem) return [];
                    const v = locItem.value;
                    return Array.isArray(v) ? (v as string[]) : [String(v)];
                  })();
                  return (
                    <div key={fieldPath}>
                      <FaqSectionEditorField
                        topics={topicsValue}
                        onTopicsChange={(value) =>
                          updateArrayProperty(
                            "dynamic_entries.permanent_filters.related_features",
                            value,
                          )
                        }
                        locations={locationsValue}
                        onLocationsChange={(value) =>
                          updateArrayProperty(
                            "dynamic_entries.permanent_filters.locations",
                            value,
                          )
                        }
                        searchPhrase={(() => {
                          const de = parsedSection?.dynamic_entries as Record<string, unknown> | undefined;
                          return typeof de?.search === "string" ? de.search : "";
                        })()}
                        resolvedSearchPhrase={(() => {
                          const de = parsedSection?.dynamic_entries as Record<string, unknown> | undefined;
                          return resolveFaqSearchPhrase(de?.search, singleEntry);
                        })()}
                        onSearchChange={(value) => {
                          try {
                            const parsed = safeYamlLoad(yamlContent) as Record<string, unknown>;
                            if (!parsed || typeof parsed !== "object") return;
                            pushUndoState(yamlContent);
                            if (Array.isArray(parsed.items) && (parsed.items as unknown[]).length > 0 && !parsed.dynamic_entries && !parsed.hardcoded_entries) {
                              parsed.hardcoded_entries = parsed.items;
                              delete parsed.items;
                            }
                            delete parsed.related_features;
                            if (!parsed.dynamic_entries || typeof parsed.dynamic_entries !== "object") {
                              parsed.dynamic_entries = {};
                            }
                            const de = parsed.dynamic_entries as Record<string, unknown>;
                            if (!de.database) de.database = "frequently_asked_questions";
                            if (de.limit == null) de.limit = 9;
                            if (value == null || value.trim().length === 0) {
                              delete de.search;
                            } else {
                              de.search = value.trim();
                            }
                            const newYaml = safeYamlDump(parsed, { lineWidth: -1, noRefs: true, quotingType: '"' });
                            setYamlContent(newYaml);
                            setHasChanges(true);
                            setParseError(null);
                            if (onPreviewChange) onPreviewChange(parsed as Section);
                          } catch (err) {
                            console.error("Error updating dynamic_entries.search:", err);
                          }
                        }}
                        permanentFilters={permanentFilters}
                        locale={locale || "en"}
                        hardcodedItems={(() => {
                          const hardcoded = resolveFaqHardcodedEntries(
                            (parsedSection as Record<string, unknown>)?.hardcoded_entries,
                            singleEntry,
                          );
                          const rootItems = normalizeFaqEntries(parsedSection?.items);
                          return [...hardcoded, ...rootItems];
                        })()}
                        ignoredEntries={(() => {
                          const de = parsedSection?.dynamic_entries as Record<string, unknown> | undefined;
                          return (de?.ignored_entries as string[]) || [];
                        })()}
                        itemOverrides={
                          (parsedSection?.item_overrides as Record<string, { hideOnLocations?: string[] }>) || {}
                        }
                        onItemOverridesChange={(overrides) => {
                          try {
                            const parsed = safeYamlLoad(yamlContent) as Record<string, unknown>;
                            if (!parsed || typeof parsed !== "object") return;
                            pushUndoState(yamlContent);
                            if (Array.isArray(parsed.items) && (parsed.items as unknown[]).length > 0 && !parsed.dynamic_entries && !parsed.hardcoded_entries) {
                              parsed.hardcoded_entries = parsed.items;
                              delete parsed.items;
                            }
                            if (Object.keys(overrides).length === 0) {
                              delete parsed.item_overrides;
                            } else {
                              parsed.item_overrides = overrides;
                            }
                            const newYaml = safeYamlDump(parsed, { lineWidth: -1, noRefs: true, quotingType: '"' });
                            setYamlContent(newYaml);
                            setHasChanges(true);
                            setParseError(null);
                            if (onPreviewChange) onPreviewChange(parsed as Section);
                          } catch (err) {
                            console.error("Error updating item_overrides:", err);
                          }
                        }}
                        onHardcodedEntriesChange={(entries) => {
                          try {
                            const parsed = safeYamlLoad(yamlContent) as Record<string, unknown>;
                            if (!parsed || typeof parsed !== "object") return;
                            pushUndoState(yamlContent);
                            if (Array.isArray(parsed.items) && (parsed.items as unknown[]).length > 0 && !parsed.dynamic_entries && !parsed.hardcoded_entries) {
                              parsed.hardcoded_entries = parsed.items;
                              delete parsed.items;
                            }
                            if (entries.length === 0) {
                              delete parsed.hardcoded_entries;
                            } else {
                              parsed.hardcoded_entries = entries;
                            }
                            const newYaml = safeYamlDump(parsed, { lineWidth: -1, noRefs: true, quotingType: '"' });
                            setYamlContent(newYaml);
                            setHasChanges(true);
                            setParseError(null);
                            if (onPreviewChange) onPreviewChange(parsed as Section);
                          } catch (err) {
                            console.error("Error updating hardcoded_entries:", err);
                          }
                        }}
                        onIgnoredEntriesChange={(keys) => {
                          try {
                            const parsed = safeYamlLoad(yamlContent) as Record<string, unknown>;
                            if (!parsed || typeof parsed !== "object") return;
                            pushUndoState(yamlContent);
                            if (!parsed.dynamic_entries || typeof parsed.dynamic_entries !== "object") {
                              parsed.dynamic_entries = {};
                            }
                            const de = parsed.dynamic_entries as Record<string, unknown>;
                            if (keys.length === 0) {
                              delete de.ignored_entries;
                            } else {
                              de.ignored_entries = keys;
                            }
                            const newYaml = safeYamlDump(parsed, { lineWidth: -1, noRefs: true, quotingType: '"' });
                            setYamlContent(newYaml);
                            setHasChanges(true);
                            setParseError(null);
                            if (onPreviewChange) onPreviewChange(parsed as Section);
                          } catch (err) {
                            console.error("Error updating ignored_entries:", err);
                          }
                        }}
                        sortField={(() => {
                          const de = parsedSection?.dynamic_entries as Record<string, unknown> | undefined;
                          return typeof de?.sort === "string" ? de.sort : undefined;
                        })()}
                        limit={(() => {
                          const de = parsedSection?.dynamic_entries as Record<string, unknown> | undefined;
                          return typeof de?.limit === "number" && de.limit > 0 ? de.limit : undefined;
                        })()}
                        onLimitChange={(value) => {
                          try {
                            const parsed = safeYamlLoad(yamlContent) as Record<string, unknown>;
                            if (!parsed || typeof parsed !== "object") return;
                            pushUndoState(yamlContent);
                            if (Array.isArray(parsed.items) && (parsed.items as unknown[]).length > 0 && !parsed.dynamic_entries && !parsed.hardcoded_entries) {
                              parsed.hardcoded_entries = parsed.items;
                              delete parsed.items;
                            }
                            if (!parsed.dynamic_entries || typeof parsed.dynamic_entries !== "object") {
                              parsed.dynamic_entries = {};
                            }
                            const de = parsed.dynamic_entries as Record<string, unknown>;
                            if (!de.database) de.database = "frequently_asked_questions";
                            if (value == null || value <= 0) {
                              delete de.limit;
                            } else {
                              de.limit = value;
                            }
                            const newYaml = safeYamlDump(parsed, { lineWidth: -1, noRefs: true, quotingType: '"' });
                            setYamlContent(newYaml);
                            setHasChanges(true);
                            setParseError(null);
                            if (onPreviewChange) onPreviewChange(parsed as Section);
                          } catch (err) {
                            console.error("Error updating dynamic_entries.limit:", err);
                          }
                        }}
                        onLocalizeDbEntry={(entry, ignoredKey) => {
                          try {
                            const parsed = safeYamlLoad(yamlContent) as Record<string, unknown>;
                            if (!parsed || typeof parsed !== "object") return;
                            pushUndoState(yamlContent);
                            if (Array.isArray(parsed.items) && (parsed.items as unknown[]).length > 0 && !parsed.dynamic_entries && !parsed.hardcoded_entries) {
                              parsed.hardcoded_entries = parsed.items;
                              delete parsed.items;
                            }
                            const existing = (parsed.hardcoded_entries as Array<{ question: string; answer: string }>) || [];
                            parsed.hardcoded_entries = [...existing, entry];
                            if (!parsed.dynamic_entries || typeof parsed.dynamic_entries !== "object") {
                              parsed.dynamic_entries = {};
                            }
                            const de = parsed.dynamic_entries as Record<string, unknown>;
                            const existingIgnored = (de.ignored_entries as string[]) || [];
                            if (!existingIgnored.includes(ignoredKey)) {
                              de.ignored_entries = [...existingIgnored, ignoredKey];
                            }
                            const newYaml = safeYamlDump(parsed, { lineWidth: -1, noRefs: true, quotingType: '"' });
                            setYamlContent(newYaml);
                            setHasChanges(true);
                            setParseError(null);
                            if (onPreviewChange) onPreviewChange(parsed as Section);
                          } catch (err) {
                            console.error("Error localizing DB entry:", err);
                          }
                        }}
                        data-testid="props-faq-section-editor"
                      />
                    </div>
                  );
                }

                if (isSimpleField && editorType === "faq-visibility-editor") {
                  return (
                    <div key={fieldPath}>
                      <FaqItemsPicker
                        permanentFilters={(() => {
                          const dynEntries = parsedSection?.dynamic_entries as Record<string, unknown> | undefined;
                          const permFilters = dynEntries?.permanent_filters;
                          if (Array.isArray(permFilters)) {
                            return permFilters as Array<{ item_property_slug: string; value: string | string[] }>;
                          }
                          return [];
                        })()}
                        locale={locale || "en"}
                        hardcodedItems={(() => {
                          const hardcoded = resolveFaqHardcodedEntries(
                            (parsedSection as Record<string, unknown>)?.hardcoded_entries,
                            singleEntry,
                          );
                          const rootItems = normalizeFaqEntries(parsedSection?.items);
                          return [...hardcoded, ...rootItems];
                        })()}
                        ignoredEntries={(() => {
                          const de = parsedSection?.dynamic_entries as Record<string, unknown> | undefined;
                          return (de?.ignored_entries as string[]) || [];
                        })()}
                        itemOverrides={
                          (parsedSection?.item_overrides as Record<string, { hideOnLocations?: string[] }>) || {}
                        }
                        onChange={(overrides) => {
                          try {
                            const parsed = safeYamlLoad(yamlContent) as Record<string, unknown>;
                            if (!parsed || typeof parsed !== "object") return;
                            pushUndoState(yamlContent);
                            if (Array.isArray(parsed.items) && (parsed.items as unknown[]).length > 0 && !parsed.dynamic_entries && !parsed.hardcoded_entries) {
                              parsed.hardcoded_entries = parsed.items;
                              delete parsed.items;
                            }
                            if (Object.keys(overrides).length === 0) {
                              delete parsed.item_overrides;
                            } else {
                              parsed.item_overrides = overrides;
                            }
                            const newYaml = safeYamlDump(parsed, { lineWidth: -1, noRefs: true, quotingType: '"' });
                            setYamlContent(newYaml);
                            setHasChanges(true);
                            setParseError(null);
                            if (onPreviewChange) onPreviewChange(parsed as Section);
                          } catch (err) {
                            console.error("Error updating item_overrides:", err);
                          }
                        }}
                        onHardcodedEntriesChange={(entries) => {
                          try {
                            const parsed = safeYamlLoad(yamlContent) as Record<string, unknown>;
                            if (!parsed || typeof parsed !== "object") return;
                            pushUndoState(yamlContent);
                            if (Array.isArray(parsed.items) && (parsed.items as unknown[]).length > 0 && !parsed.dynamic_entries && !parsed.hardcoded_entries) {
                              parsed.hardcoded_entries = parsed.items;
                              delete parsed.items;
                            }
                            if (entries.length === 0) {
                              delete parsed.hardcoded_entries;
                            } else {
                              parsed.hardcoded_entries = entries;
                            }
                            const newYaml = safeYamlDump(parsed, { lineWidth: -1, noRefs: true, quotingType: '"' });
                            setYamlContent(newYaml);
                            setHasChanges(true);
                            setParseError(null);
                            if (onPreviewChange) onPreviewChange(parsed as Section);
                          } catch (err) {
                            console.error("Error updating hardcoded_entries:", err);
                          }
                        }}
                        onIgnoredEntriesChange={(keys) => {
                          try {
                            const parsed = safeYamlLoad(yamlContent) as Record<string, unknown>;
                            if (!parsed || typeof parsed !== "object") return;
                            pushUndoState(yamlContent);
                            if (!parsed.dynamic_entries || typeof parsed.dynamic_entries !== "object") {
                              parsed.dynamic_entries = {};
                            }
                            const de = parsed.dynamic_entries as Record<string, unknown>;
                            if (keys.length === 0) {
                              delete de.ignored_entries;
                            } else {
                              de.ignored_entries = keys;
                            }
                            const newYaml = safeYamlDump(parsed, { lineWidth: -1, noRefs: true, quotingType: '"' });
                            setYamlContent(newYaml);
                            setHasChanges(true);
                            setParseError(null);
                            if (onPreviewChange) onPreviewChange(parsed as Section);
                          } catch (err) {
                            console.error("Error updating ignored_entries:", err);
                          }
                        }}
                        sortField={(() => {
                          const de = parsedSection?.dynamic_entries as Record<string, unknown> | undefined;
                          return typeof de?.sort === "string" ? de.sort : undefined;
                        })()}
                        limit={(() => {
                          const de = parsedSection?.dynamic_entries as Record<string, unknown> | undefined;
                          return typeof de?.limit === "number" && de.limit > 0 ? de.limit : undefined;
                        })()}
                        onLocalizeDbEntry={(entry, ignoredKey) => {
                          try {
                            const parsed = safeYamlLoad(yamlContent) as Record<string, unknown>;
                            if (!parsed || typeof parsed !== "object") return;
                            pushUndoState(yamlContent);
                            // Migrate root items → hardcoded_entries if needed
                            if (Array.isArray(parsed.items) && (parsed.items as unknown[]).length > 0 && !parsed.dynamic_entries && !parsed.hardcoded_entries) {
                              parsed.hardcoded_entries = parsed.items;
                              delete parsed.items;
                            }
                            // Add the new hardcoded entry
                            const existing = (parsed.hardcoded_entries as Array<{ question: string; answer: string }>) || [];
                            parsed.hardcoded_entries = [...existing, entry];
                            // Add the ignored key — both in the same parse+serialize cycle
                            if (!parsed.dynamic_entries || typeof parsed.dynamic_entries !== "object") {
                              parsed.dynamic_entries = {};
                            }
                            const de = parsed.dynamic_entries as Record<string, unknown>;
                            const existingIgnored = (de.ignored_entries as string[]) || [];
                            if (!existingIgnored.includes(ignoredKey)) {
                              de.ignored_entries = [...existingIgnored, ignoredKey];
                            }
                            const newYaml = safeYamlDump(parsed, { lineWidth: -1, noRefs: true, quotingType: '"' });
                            setYamlContent(newYaml);
                            setHasChanges(true);
                            setParseError(null);
                            if (onPreviewChange) onPreviewChange(parsed as Section);
                          } catch (err) {
                            console.error("Error localizing DB entry:", err);
                          }
                        }}
                      />
                    </div>
                  );
                }

                if (isSimpleField && editorType === "font-size-picker") {
                  const fontSizes = themeConfig?.fontSizes ?? [];
                  const getSimpleStringValue = () => {
                    if (!parsedSection) return "";
                    const pathParts = fieldPath.split(".");
                    let current: unknown = parsedSection;
                    for (const part of pathParts) {
                      if (!current || typeof current !== "object") return "";
                      current = (current as Record<string, unknown>)[part];
                    }
                    return typeof current === "string" ? current : "";
                  };
                  const currentValue = getSimpleStringValue();
                  const fieldLabel = getFieldLabel(fieldPath);
                  return (
                    <div key={fieldPath} className="space-y-2">
                      <Label className="text-sm font-medium">{fieldLabel}</Label>
                      <Select
                        value={currentValue || ""}
                        onValueChange={(val) => updatePropertyWithValue(fieldPath, val)}
                      >
                        <SelectTrigger data-testid={`props-select-${fieldLabel}`}>
                          <SelectValue placeholder="Default" />
                        </SelectTrigger>
                        <SelectContent>
                          {fontSizes.map((size) => (
                            <SelectItem key={size.id} value={size.tailwind}>
                              <span className="flex items-center gap-2">
                                <span style={{ fontSize: size.value }} className="leading-none">{size.label}</span>
                                <span className="text-muted-foreground text-xs">{size.tailwind}</span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                }

                // Handle cta-picker: "cta_buttons[]" or "features[].cta"
                if (editorType === "cta-picker") {
                  // Match "arrayName[]" or "path.arrayName[].subField"
                  const ctaMatchWhole = fieldPath.match(/^([\w.]+)\[\]$/);
                  const ctaMatchNested = fieldPath.match(/^([\w.]+)\[\]\.([\w.]+)$/);

                  if (ctaMatchWhole || ctaMatchNested) {
                    const ctaArrayPath = ctaMatchWhole ? ctaMatchWhole[1] : ctaMatchNested![1];
                    const ctaSubPath = ctaMatchNested ? ctaMatchNested[2] : null;

                    const getCtaArrayData = () => {
                      if (!parsedSection) return undefined;
                      const pathParts = ctaArrayPath.split(".");
                      let current: Record<string, unknown> = parsedSection as Record<string, unknown>;
                      for (const part of pathParts) {
                        if (!current || typeof current !== "object") return undefined;
                        current = current[part] as Record<string, unknown>;
                      }
                      return current as unknown as Record<string, unknown>[] | undefined;
                    };

                    const ctaArrayData = getCtaArrayData();
                    const safeCtaArray = Array.isArray(ctaArrayData) ? ctaArrayData : [];

                    const getCtaField = (item: Record<string, unknown>, field: string): string => {
                      if (ctaSubPath) {
                        const parts = ctaSubPath.split(".");
                        let sub: unknown = item;
                        for (const p of parts) {
                          sub = (sub as Record<string, unknown>)?.[p];
                        }
                        return ((sub as Record<string, unknown>)?.[field] as string) || "";
                      }
                      return (item[field] as string) || "";
                    };

                    const updateCtaField = (index: number, field: string, value: string) => {
                      const fullField = ctaSubPath ? `${ctaSubPath}.${field}` : field;
                      updateArrayItemField(ctaArrayPath, index, fullField, value);
                    };

                    const ctaLabel = getFieldLabel(ctaSubPath || ctaArrayPath);

                    return (
                      <div key={fieldPath} className="space-y-3">
                        <Label className="text-sm font-medium capitalize">
                          {ctaLabel.replace(/_/g, " ")} ({safeCtaArray.length})
                        </Label>
                        <div className="space-y-2">
                          {safeCtaArray.map((item, index) => {
                            const btnText = getCtaField(item, "text") || (item.title as string) || `CTA ${index + 1}`;
                            const btnUrl = getCtaField(item, "url");
                            const btnIcon = getCtaField(item, "icon");
                            const btnVariant = getCtaField(item, "variant");

                            return (
                              <Collapsible key={index} className="border rounded-md">
                                <CollapsibleTrigger asChild>
                                  <button
                                    type="button"
                                    className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors"
                                    data-testid={`props-cta-${index}-trigger`}
                                  >
                                    <div className="w-8 h-8 rounded-md bg-muted border flex-shrink-0 flex items-center justify-center">
                                      {btnIcon ? (
                                        renderIconByName(btnIcon)
                                      ) : (
                                        <span className="text-xs text-muted-foreground">#{index + 1}</span>
                                      )}
                                    </div>
                                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                  </button>
                                </CollapsibleTrigger>
                                <CollapsibleContent>
                                  <div className="p-3 pt-0 space-y-3 border-t">
                                    <div className="space-y-1">
                                      <Label className="text-xs text-muted-foreground">Text</Label>
                                      <Input
                                        value={btnText}
                                        onChange={(e) => updateCtaField(index, "text", e.target.value)}
                                        placeholder="Button text"
                                        data-testid={`props-cta-${index}-text`}
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-xs text-muted-foreground">URL</Label>
                                      <LinkPicker
                                        value={btnUrl}
                                        onChange={(url) => updateCtaField(index, "url", url)}
                                        locale={locale}
                                        allSections={allSections}
                                        testId={`props-cta-${index}-url`}
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-xs text-muted-foreground">Variant</Label>
                                      <Select
                                        value={btnVariant || "primary"}
                                        onValueChange={(val) => updateCtaField(index, "variant", val)}
                                      >
                                        <SelectTrigger data-testid={`props-cta-${index}-variant`}>
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="primary">Primary</SelectItem>
                                          <SelectItem value="secondary">Secondary</SelectItem>
                                          <SelectItem value="outline">Outline</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-xs text-muted-foreground">Icon</Label>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setIconPickerTarget({
                                            arrayField: ctaArrayPath,
                                            index,
                                            field: ctaSubPath ? `${ctaSubPath}.icon` : "icon",
                                            label: btnText,
                                            currentIcon: btnIcon,
                                          });
                                          setIconPickerOpen(true);
                                        }}
                                        className="flex items-center gap-2 w-full transition-colors"
                                        data-testid={`props-cta-${index}-icon`}
                                      >
                                        <div className="w-8 h-8 rounded border bg-background flex items-center justify-center flex-shrink-0">
                                          {btnIcon ? renderIconByName(btnIcon) : (
                                            <Plus className="h-4 w-4 text-muted-foreground" />
                                          )}
                                        </div>
                                        <span className="text-sm text-muted-foreground flex-1 text-left truncate">
                                          {btnIcon || "No icon"}
                                        </span>
                                      </button>
                                    </div>
                                  </div>
                                </CollapsibleContent>
                              </Collapsible>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }
                }

                // Parse field path like "features[].icon" or "signup_card.features[].icon"
                // Matches: optional.nested.path.arrayName[].fieldName
                const match = fieldPath.match(/^([\w.]+)\[\]\.([\w.]+)$/);
                if (!match) return null;

                const [, arrayPath, itemField] = match;

                const getArrayData = () => {
                  if (!parsedSection) return undefined;
                  const pathParts = arrayPath.split(".");
                  let current: Record<string, unknown> =
                    parsedSection as Record<string, unknown>;

                  for (const part of pathParts) {
                    if (!current || typeof current !== "object")
                      return undefined;
                    current = current[part] as Record<string, unknown>;
                  }

                  return current as unknown as
                    | Record<string, unknown>[]
                    | undefined;
                };

                const arrayData = getArrayData();

                if (
                  arrayData === undefined &&
                  editorType !== "image-with-style-picker"
                )
                  return null;

                const safeArrayData = Array.isArray(arrayData) ? arrayData : [];

                const arrayFieldLabel = getFieldLabel(arrayPath);

                if (editorType === "icon-picker") {
                  return (
                    <div key={fieldPath} className="space-y-2">
                      <Label className="text-sm font-medium">
                        {arrayFieldLabel} Icons
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        {safeArrayData.map((item, index) => {
                          const currentValue = String(getValueAtFieldPath(item, itemField) ?? "");
                          const itemLabel =
                            (item.tab_label as string) ||
                            (item.title as string) ||
                            (item.label as string) ||
                            (item.name as string) ||
                            `Item ${index + 1}`;

                          return (
                            <button
                              key={index}
                              type="button"
                              onClick={() => {
                                setIconPickerTarget({
                                  arrayField: arrayPath,
                                  index,
                                  field: itemField,
                                  label: itemLabel,
                                  currentIcon: currentValue,
                                });
                                setIconPickerOpen(true);
                              }}
                              className="flex items-center justify-center w-10 h-10 rounded border bg-muted/30 hover:bg-muted transition-colors"
                              data-testid={`props-icon-${arrayFieldLabel}-${index}`}
                              title={`${itemLabel}: ${currentValue || "no icon"}`}
                            >
                              {renderIconByName(currentValue)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                }

                if (editorType === "image-picker") {
                  // Check if this is a logo picker for items with logoHeight (works for hero marquee, awards_marquee, etc.)
                  // Detects if items have "logo" field and any item has "logoHeight" defined
                  const isLogoMarquee =
                    itemField === "logo" &&
                    safeArrayData.some(
                      (item) => "logoHeight" in item || "logo" in item,
                    );

                  if (isLogoMarquee) {
                    // Use collapsible sections for logo marquee items
                    return (
                      <div key={fieldPath} className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm font-medium">
                            Marquee Logos ({safeArrayData.length})
                          </Label>
                        </div>
                        <div className="space-y-2">
                          {safeArrayData.map((item, index) => {
                            const currentValue = String(getValueAtFieldPath(item, itemField) ?? "");
                            const altValue = (item.alt as string) || "";
                            const logoHeight =
                              (item.logoHeight as string) || "";
                            const displaySrc =
                              imageRegistry?.images?.[currentValue]?.src ||
                              currentValue;

                            return (
                              <Collapsible
                                key={index}
                                className="border rounded-md"
                              >
                                <CollapsibleTrigger asChild>
                                  <button
                                    type="button"
                                    className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors"
                                    data-testid={`props-logo-marquee-${index}-trigger`}
                                  >
                                    <div className="w-10 h-10 rounded-md overflow-hidden bg-muted border flex-shrink-0">
                                      {currentValue ? (
                                        <img
                                          src={displaySrc}
                                          alt={altValue || `Logo ${index + 1}`}
                                          className="w-full h-full object-contain p-1"
                                        />
                                      ) : (
                                        <div className="w-full h-full flex items-center justify-center">
                                          <Image className="h-4 w-4 text-muted-foreground" />
                                        </div>
                                      )}
                                    </div>
                                    <span className="flex-1 text-left text-sm font-medium">
                                      {altValue || `Logo ${index + 1}`}
                                    </span>
                                    <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
                                  </button>
                                </CollapsibleTrigger>
                                <CollapsibleContent>
                                  <div className="p-3 pt-0 space-y-3 border-t">
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setImagePickerTarget({
                                            arrayPath,
                                            index,
                                            srcField: itemField,
                                            currentSrc: currentValue,
                                            currentAlt: altValue,
                                            tagFilter: "logo",
                                          });
                                          setImagePickerOpen(true);
                                        }}
                                        className="relative w-16 h-16 rounded-md border border-input bg-muted/50 hover:bg-muted transition-colors overflow-hidden group"
                                        data-testid={`props-logo-marquee-${index}-picker`}
                                        title="Change logo"
                                      >
                                        {currentValue ? (
                                          <>
                                            <img
                                              src={displaySrc}
                                              alt={altValue}
                                              className="w-full h-full object-contain p-1"
                                            />
                                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                              <Image className="h-5 w-5 text-white" />
                                            </div>
                                          </>
                                        ) : (
                                          <div className="w-full h-full flex items-center justify-center">
                                            <Image className="h-6 w-6 text-muted-foreground" />
                                          </div>
                                        )}
                                      </button>
                                      <div className="flex-1 space-y-1">
                                        <Label className="text-xs text-muted-foreground">
                                          Alt text
                                        </Label>
                                        <Input
                                          value={altValue}
                                          onChange={(e) =>
                                            updateArrayItemField(
                                              arrayPath,
                                              index,
                                              "alt",
                                              e.target.value,
                                            )
                                          }
                                          placeholder="Logo description"
                                          className="h-8 text-sm"
                                          data-testid={`props-logo-marquee-${index}-alt`}
                                        />
                                      </div>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() =>
                                          removeArrayItem(arrayPath, index)
                                        }
                                        className="text-muted-foreground hover:text-destructive"
                                        data-testid={`props-logo-marquee-${index}-delete`}
                                        title="Remove logo"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-xs text-muted-foreground">
                                        Logo Height (CSS classes)
                                      </Label>
                                      <Input
                                        value={logoHeight}
                                        onChange={(e) =>
                                          updateArrayItemField(
                                            arrayPath,
                                            index,
                                            "logoHeight",
                                            e.target.value,
                                          )
                                        }
                                        placeholder="h-10 md:h-14"
                                        className="h-8 text-sm"
                                        data-testid={`props-logo-marquee-${index}-height`}
                                      />
                                    </div>
                                  </div>
                                </CollapsibleContent>
                              </Collapsible>
                            );
                          })}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const defaultItem: Record<string, unknown> = {
                                id: "",
                                [itemField]: "",
                                alt: "",
                                logoHeight: "56px",
                              };
                              addArrayItem(arrayPath, defaultItem);
                            }}
                            className="w-full"
                            data-testid="props-logo-marquee-add"
                          >
                            <Plus className="h-4 w-4 mr-1" />
                            Add Logo
                          </Button>
                        </div>
                      </div>
                    );
                  }

                  // Default image-picker behavior (simple thumbnails)
                  return (
                    <div key={fieldPath} className="space-y-2">
                      <Label className="text-sm font-medium capitalize">
                        {getFieldLabel(itemField)}
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        {safeArrayData.map((item, index) => {
                          const currentValue = String(getValueAtFieldPath(item, itemField) ?? "");
                          const altValue = (item.alt as string) || "";
                          // For ID fields, look up the actual src from registry
                          const displaySrc =
                            imageRegistry?.images?.[currentValue]?.src ||
                            currentValue;

                          return (
                            <button
                              key={index}
                              type="button"
                              onClick={() => {
                                setImagePickerTarget({
                                  arrayPath,
                                  index,
                                  srcField: itemField,
                                  currentSrc: currentValue,
                                  currentAlt: altValue,
                                  tagFilter: variant, // e.g., "logo" from "image-picker:logo"
                                });
                                setImagePickerOpen(true);
                              }}
                              className="w-12 h-12 rounded-md overflow-hidden bg-muted border border-border hover:border-primary transition-colors flex-shrink-0 relative group"
                              data-testid={`props-image-${arrayFieldLabel}-${index}`}
                              title={altValue || `Image ${index + 1}`}
                            >
                              {currentValue ? (
                                <img
                                  src={displaySrc}
                                  alt={altValue || `Image ${index + 1}`}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                                  ?
                                </div>
                              )}
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => {
                            const defaultItem: Record<string, unknown> = {
                              [itemField]: "",
                              alt: "",
                            };
                            addArrayItem(arrayPath, defaultItem);
                          }}
                          className="w-12 h-12 rounded-md border border-dashed border-muted-foreground/50 bg-transparent hover:bg-muted/30 hover:border-muted-foreground transition-colors flex items-center justify-center"
                          data-testid={`props-image-${arrayFieldLabel}-add`}
                          title="Add image"
                        >
                          <Plus className="h-5 w-5 text-muted-foreground" />
                        </button>
                      </div>
                    </div>
                  );
                }

                if (editorType === "image-with-style-picker") {
                  const MAX_IMAGES = 4;
                  const hasImages = safeArrayData.length > 0;

                  // Detect if this is a "tabs" array (bullet_tabs_showcase) which has limited styling options
                  // vs a regular "images" array which has full styling options
                  const isTabsArray =
                    arrayPath === "tabs" || arrayPath.endsWith(".tabs");

                  // Detect if array items have non-image fields (e.g. cards with title, description, video).
                  // In that case, delete should clear the image field instead of removing the whole item.
                  const imageRelatedKeys = new Set(["src", "alt", "object_fit", "object_position", "object_scale", "transform_origin", "border_radius", "width", "height", "max_width", "max_height", "opacity", "filter", "image_id", "image_object_fit", "image_object_position", itemField]);
                  const isMixedItemArray = safeArrayData.length > 0 && Object.keys(safeArrayData[0]).some(k => !imageRelatedKeys.has(k));

                  // For tabs: use image_object_fit/image_object_position (schema naming)
                  // For images: use object_fit/object_position
                  const objectFitField = isTabsArray
                    ? "image_object_fit"
                    : "object_fit";
                  const objectPositionField = isTabsArray
                    ? "image_object_position"
                    : "object_position";

                  const initializeDefaultImages = () => {
                    const defaultImages = [
                      {
                        src: "",
                        alt: "Student 1",
                        object_fit: "cover",
                        object_position: "center top",
                        border_radius: "0.5rem",
                      },
                      {
                        src: "",
                        alt: "Student 2",
                        object_fit: "cover",
                        object_position: "center top",
                        border_radius: "0.5rem",
                      },
                      {
                        src: "",
                        alt: "Student 3",
                        object_fit: "cover",
                        object_position: "center top",
                        border_radius: "0.5rem",
                      },
                      {
                        src: "",
                        alt: "Student 4",
                        object_fit: "cover",
                        object_position: "center top",
                        border_radius: "0.5rem",
                      },
                    ];
                    updateArrayField(arrayPath, defaultImages);
                  };

                  return (
                    <div key={fieldPath} className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">
                          {isTabsArray
                            ? `Imágenes de Tabs (${safeArrayData.length})`
                            : `${getFieldLabel(itemField)} (${safeArrayData.length}/${MAX_IMAGES})`}
                        </Label>
                        {!hasImages && !isTabsArray && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={initializeDefaultImages}
                            data-testid="props-image-style-init"
                          >
                            <Plus className="h-4 w-4 mr-1" />
                            Inicializar imágenes
                          </Button>
                        )}
                      </div>

                      {!hasImages && !isTabsArray && (
                        <div className="p-4 border border-dashed rounded-md text-center text-sm text-muted-foreground">
                          <Image className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p>Este componente usa imágenes por defecto.</p>
                          <p>
                            Haz clic en "Inicializar imágenes" para
                            personalizarlas.
                          </p>
                        </div>
                      )}

                      <div className="space-y-2">
                        {safeArrayData.map((item, index) => {
                          const currentSrc = String(getValueAtFieldPath(item, itemField) ?? "");
                          const currentAlt = (item.alt as string) || "";
                          const displaySrc =
                            imageRegistry?.images?.[currentSrc]?.src ||
                            currentSrc;

                          return (
                            <Collapsible
                              key={index}
                              className="border rounded-md"
                            >
                              <CollapsibleTrigger asChild>
                                <button
                                  type="button"
                                  className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors"
                                  data-testid={`props-image-style-${index}-trigger`}
                                >
                                  <div className="w-10 h-10 rounded-md overflow-hidden bg-muted border flex-shrink-0">
                                    {currentSrc ? (
                                      <img
                                        src={displaySrc}
                                        alt={
                                          currentAlt || `Imagen ${index + 1}`
                                        }
                                        className="w-full h-full object-cover"
                                      />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center">
                                        <Image className="h-4 w-4 text-muted-foreground" />
                                      </div>
                                    )}
                                  </div>
                                  <span className="flex-1 text-left text-sm font-medium">
                                    Imagen {index + 1}
                                  </span>
                                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
                                </button>
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <div className="p-3 pt-0 space-y-3 border-t">
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setImagePickerTarget({
                                          arrayPath,
                                          index,
                                          srcField: itemField,
                                          currentSrc,
                                          currentAlt,
                                          tagFilter: variant,
                                          clearFieldOnly: isMixedItemArray,
                                        });
                                        setImagePickerOpen(true);
                                      }}
                                      className="relative w-16 h-16 rounded-md border border-input bg-muted/50 hover:bg-muted transition-colors overflow-hidden group"
                                      data-testid={`props-image-style-${index}-picker`}
                                      title="Cambiar imagen"
                                    >
                                      {currentSrc ? (
                                        <>
                                          <img
                                            src={displaySrc}
                                            alt={currentAlt}
                                            className="w-full h-full object-cover"
                                          />
                                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                            <Image className="h-5 w-5 text-white" />
                                          </div>
                                        </>
                                      ) : (
                                        <div className="w-full h-full flex items-center justify-center">
                                          <Image className="h-6 w-6 text-muted-foreground" />
                                        </div>
                                      )}
                                    </button>
                                    <div className="flex-1 space-y-1">
                                      <Label className="text-xs text-muted-foreground">
                                        Alt text
                                      </Label>
                                      <Input
                                        value={currentAlt}
                                        onChange={(e) =>
                                          updateArrayItemField(
                                            arrayPath,
                                            index,
                                            "alt",
                                            e.target.value,
                                          )
                                        }
                                        placeholder="Descripción de la imagen"
                                        className="h-8 text-sm"
                                        data-testid={`props-image-style-${index}-alt`}
                                      />
                                    </div>
                                    {!isTabsArray && (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => {
                                          if (isMixedItemArray) {
                                            updateArrayItemField(arrayPath, index, itemField, "");
                                          } else {
                                            removeArrayItem(arrayPath, index);
                                          }
                                        }}
                                        className="text-muted-foreground hover:text-destructive"
                                        data-testid={`props-image-style-${index}-delete`}
                                        title="Eliminar imagen"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    )}
                                  </div>

                                  <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                      <Label className="text-xs text-muted-foreground">
                                        Object Fit
                                      </Label>
                                      <Select
                                        value={
                                          (item[objectFitField] as string) ||
                                          "cover"
                                        }
                                        onValueChange={(value) =>
                                          updateArrayItemField(
                                            arrayPath,
                                            index,
                                            objectFitField,
                                            value,
                                          )
                                        }
                                      >
                                        <SelectTrigger
                                          className="h-8 text-sm"
                                          data-testid={`props-image-style-${index}-object-fit`}
                                        >
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="cover">
                                            Cover
                                          </SelectItem>
                                          <SelectItem value="contain">
                                            Contain
                                          </SelectItem>
                                          <SelectItem value="fill">
                                            Fill
                                          </SelectItem>
                                          <SelectItem value="none">
                                            None
                                          </SelectItem>
                                          <SelectItem value="scale-down">
                                            Scale Down
                                          </SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>

                                    <div className="space-y-1">
                                      <Label className="text-xs text-muted-foreground">
                                        Object Position
                                      </Label>
                                      <Input
                                        value={
                                          (item[
                                            objectPositionField
                                          ] as string) ?? ""
                                        }
                                        onChange={(e) =>
                                          updateArrayItemField(
                                            arrayPath,
                                            index,
                                            objectPositionField,
                                            e.target.value,
                                          )
                                        }
                                        placeholder="center top"
                                        className="h-8 text-sm"
                                        data-testid={`props-image-style-${index}-object-position`}
                                      />
                                    </div>

                                    {!isTabsArray && (
                                      <>
                                        <div className="space-y-1">
                                          <Label className="text-xs text-muted-foreground">
                                            Border Radius
                                          </Label>
                                          <Input
                                            value={
                                              (item.border_radius as string) ??
                                              ""
                                            }
                                            onChange={(e) =>
                                              updateArrayItemField(
                                                arrayPath,
                                                index,
                                                "border_radius",
                                                e.target.value,
                                              )
                                            }
                                            placeholder="0.5rem"
                                            className="h-8 text-sm"
                                            data-testid={`props-image-style-${index}-border-radius`}
                                          />
                                        </div>

                                        <div className="space-y-1">
                                          <Label className="text-xs text-muted-foreground">
                                            Opacidad
                                          </Label>
                                          <Input
                                            type="number"
                                            min={0}
                                            max={1}
                                            step={0.1}
                                            value={
                                              (item.opacity as number) ?? 1
                                            }
                                            onChange={(e) =>
                                              updateArrayItemField(
                                                arrayPath,
                                                index,
                                                "opacity",
                                                parseFloat(e.target.value) || 1,
                                              )
                                            }
                                            placeholder="1"
                                            className="h-8 text-sm"
                                            data-testid={`props-image-style-${index}-opacity`}
                                          />
                                        </div>
                                      </>
                                    )}
                                  </div>

                                  {!isTabsArray && (
                                    <div className="grid grid-cols-2 gap-3">
                                      <div className="space-y-1">
                                        <Label className="text-xs text-muted-foreground">
                                          CSS Filter
                                        </Label>
                                        <Input
                                          value={(item.filter as string) || ""}
                                          onChange={(e) =>
                                            updateArrayItemField(
                                              arrayPath,
                                              index,
                                              "filter",
                                              e.target.value,
                                            )
                                          }
                                          placeholder="grayscale(50%)"
                                          className="h-8 text-sm"
                                          data-testid={`props-image-style-${index}-filter`}
                                        />
                                      </div>
                                      <div className="space-y-1">
                                        <Label className="text-xs text-muted-foreground">
                                          Altura
                                        </Label>
                                        <Input
                                          value={(item.height as string) || ""}
                                          onChange={(e) =>
                                            updateArrayItemField(
                                              arrayPath,
                                              index,
                                              "height",
                                              e.target.value,
                                            )
                                          }
                                          placeholder="400px, 20rem..."
                                          className="h-8 text-sm"
                                          data-testid={`props-image-style-${index}-height`}
                                        />
                                      </div>
                                      <div className="space-y-1">
                                        <Label className="text-xs text-muted-foreground">
                                          Zoom
                                        </Label>
                                        <Input
                                          type="number"
                                          min={1}
                                          max={3}
                                          step={0.05}
                                          defaultValue={
                                            (item.object_scale as number) ?? 1
                                          }
                                          onBlur={(e) =>
                                            updateArrayItemField(
                                              arrayPath,
                                              index,
                                              "object_scale",
                                              parseFloat(e.target.value) || 1,
                                            )
                                          }
                                          placeholder="1"
                                          className="h-8 text-sm"
                                          data-testid={`props-image-style-${index}-scale`}
                                        />
                                      </div>
                                      <div className="space-y-1">
                                        <Label className="text-xs text-muted-foreground">
                                          Transform Origin
                                        </Label>
                                        <Input
                                          defaultValue={
                                            (item.transform_origin as string) ?? "50% 50%"
                                          }
                                          onBlur={(e) =>
                                            updateArrayItemField(
                                              arrayPath,
                                              index,
                                              "transform_origin",
                                              e.target.value || "50% 50%",
                                            )
                                          }
                                          placeholder="50% 50%"
                                          className="h-8 text-sm"
                                          data-testid={`props-image-style-${index}-transform-origin`}
                                        />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </CollapsibleContent>
                            </Collapsible>
                          );
                        })}

                        {!isTabsArray &&
                          safeArrayData.length > 0 &&
                          safeArrayData.length < MAX_IMAGES && (
                            <button
                              type="button"
                              onClick={() => {
                                const defaultItem: Record<string, unknown> = {
                                  src: "",
                                  alt: `Student ${safeArrayData.length + 1}`,
                                  object_fit: "cover",
                                  object_position: "center top",
                                  border_radius: "0.5rem",
                                };
                                addArrayItem(arrayPath, defaultItem);
                              }}
                              className="w-full py-2 rounded-md border border-dashed border-muted-foreground/50 bg-transparent hover:bg-muted/30 hover:border-muted-foreground transition-colors flex items-center justify-center gap-2 text-sm text-muted-foreground"
                              data-testid="props-image-style-add"
                              title="Añadir imagen"
                            >
                              <Plus className="h-4 w-4" />
                              Añadir imagen ({safeArrayData.length}/{MAX_IMAGES}
                              )
                            </button>
                          )}
                      </div>
                    </div>
                  );
                }

                if (editorType === "video-picker") {
                  const resolveNestedValue = (obj: Record<string, unknown>, path: string): unknown => {
                    const parts = path.split(".");
                    let cur: unknown = obj;
                    for (const p of parts) {
                      if (!cur || typeof cur !== "object") return undefined;
                      cur = (cur as Record<string, unknown>)[p];
                    }
                    return cur;
                  };

                  const itemFieldParts = itemField.split(".");
                  const parentPrefix = itemFieldParts.length > 1
                    ? itemFieldParts.slice(0, -1).join(".") + "."
                    : "";

                  return (
                    <div key={fieldPath} className="space-y-3">
                      <Label className="text-sm font-medium capitalize">
                        {getFieldLabel(itemField)} Videos
                      </Label>
                      <div className="space-y-2">
                        {safeArrayData.map((item, index) => {
                          const currentUrl = (resolveNestedValue(item, itemField) as string) || "";
                          const currentRatio = (resolveNestedValue(item, parentPrefix + "ratio") as string) || "";
                          const currentMuted = resolveNestedValue(item, parentPrefix + "muted");
                          const currentAutoplay = resolveNestedValue(item, parentPrefix + "autoplay");
                          const currentLoop = resolveNestedValue(item, parentPrefix + "loop");
                          const currentPreviewImage = (resolveNestedValue(item, parentPrefix + "preview_image_url") as string) || "";
                          const itemLabel =
                            (item.title as string) ||
                            (item.name as string) ||
                            (item.label as string) ||
                            `Item ${index + 1}`;

                          return (
                            <Collapsible key={index} className="border rounded-md">
                              <CollapsibleTrigger asChild>
                                <button
                                  type="button"
                                  className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors"
                                  data-testid={`props-video-${arrayFieldLabel}-${index}-trigger`}
                                >
                                  <div className="w-10 h-10 rounded-md overflow-hidden bg-muted border flex-shrink-0 flex items-center justify-center">
                                    <Video className={`h-5 w-5 ${currentUrl ? "text-primary" : "text-muted-foreground"}`} />
                                  </div>
                                  <div className="flex-1 text-left min-w-0">
                                    <span className="text-sm font-medium block">
                                      {itemLabel}
                                    </span>
                                    {currentUrl && (
                                      <span className="text-xs text-muted-foreground truncate block">
                                        {currentUrl.split("/").pop() || currentUrl}
                                      </span>
                                    )}
                                  </div>
                                  <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                </button>
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <div className="p-3 pt-0 space-y-3 border-t">
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setVideoPickerTarget({
                                          arrayPath,
                                          index,
                                          field: itemField,
                                          currentUrl,
                                          label: `${itemLabel} Video`,
                                        });
                                        setVideoPickerOpen(true);
                                      }}
                                      className="relative w-16 h-16 rounded-md border border-input bg-muted/50 hover:bg-muted transition-colors overflow-hidden group"
                                      data-testid={`props-video-${arrayFieldLabel}-${index}-picker`}
                                      title="Change video"
                                    >
                                      {currentUrl ? (
                                        <>
                                          <div className="w-full h-full flex items-center justify-center bg-muted">
                                            <Video className="h-6 w-6 text-primary" />
                                          </div>
                                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                            <Video className="h-5 w-5 text-white" />
                                          </div>
                                        </>
                                      ) : (
                                        <div className="w-full h-full flex items-center justify-center">
                                          <Video className="h-6 w-6 text-muted-foreground" />
                                        </div>
                                      )}
                                    </button>
                                    <div className="flex-1 min-w-0">
                                      {currentUrl ? (
                                        <span className="text-xs text-muted-foreground break-all line-clamp-3">
                                          {currentUrl}
                                        </span>
                                      ) : (
                                        <span className="text-xs text-muted-foreground italic">
                                          No video selected
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setImagePickerTarget({
                                            arrayPath,
                                            index,
                                            srcField: parentPrefix + "preview_image_url",
                                            currentSrc: currentPreviewImage,
                                            currentAlt: "",
                                          });
                                          setImagePickerOpen(true);
                                        }}
                                        className="relative w-16 h-16 rounded-md border border-input bg-muted/50 hover:bg-muted transition-colors overflow-hidden group flex-shrink-0"
                                        data-testid={`props-video-${arrayFieldLabel}-${index}-preview-image`}
                                        title="Change preview image"
                                      >
                                        {currentPreviewImage ? (
                                          <>
                                            <img
                                              src={currentPreviewImage}
                                              alt="Preview"
                                              className="w-full h-full object-cover"
                                            />
                                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                              <Image className="h-4 w-4 text-white" />
                                            </div>
                                          </>
                                        ) : (
                                          <div className="w-full h-full flex items-center justify-center">
                                            <Image className="h-5 w-5 text-muted-foreground" />
                                          </div>
                                        )}
                                      </button>
                                      <div className="flex-1 min-w-0">
                                        {currentPreviewImage ? (
                                          <div className="flex items-center gap-1">
                                            <span className="text-xs text-muted-foreground truncate flex-1">
                                              {currentPreviewImage.split("/").pop() || currentPreviewImage}
                                            </span>
                                            <Button
                                              size="icon"
                                              variant="ghost"
                                              className="h-6 w-6 flex-shrink-0"
                                              onClick={() => updateArrayItemField(arrayPath, index, parentPrefix + "preview_image_url", "")}
                                              data-testid={`props-video-${arrayFieldLabel}-${index}-preview-image-clear`}
                                            >
                                              <X className="h-3 w-3" />
                                            </Button>
                                          </div>
                                        ) : (
                                          <span className="text-xs text-muted-foreground italic">
                                            No preview image selected
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">
                                      Aspect Ratio
                                    </Label>
                                    <Select
                                      value={currentRatio || "16:9"}
                                      onValueChange={(value) =>
                                        updateArrayItemField(arrayPath, index, parentPrefix + "ratio", value)
                                      }
                                    >
                                      <SelectTrigger
                                        className="h-8 text-sm"
                                        data-testid={`props-video-${arrayFieldLabel}-${index}-ratio`}
                                      >
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
                                        <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
                                        <SelectItem value="4:3">4:3 (Classic)</SelectItem>
                                        <SelectItem value="1:1">1:1 (Square)</SelectItem>
                                        <SelectItem value="21:9">21:9 (Ultra-wide)</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>

                                  <div className="space-y-2">
                                    <Label className="text-xs text-muted-foreground">
                                      Playback Options
                                    </Label>
                                    <div className="grid grid-cols-1 gap-2">
                                      <div className="flex items-center justify-between gap-2">
                                        <Label className="text-sm">Muted</Label>
                                        <Switch
                                          checked={currentMuted !== false}
                                          onCheckedChange={(checked) =>
                                            updateArrayItemField(arrayPath, index, parentPrefix + "muted", checked)
                                          }
                                          data-testid={`props-video-${arrayFieldLabel}-${index}-muted`}
                                        />
                                      </div>
                                      <div className="flex items-center justify-between gap-2">
                                        <Label className="text-sm">Autoplay</Label>
                                        <Switch
                                          checked={currentAutoplay === true}
                                          onCheckedChange={(checked) =>
                                            updateArrayItemField(arrayPath, index, parentPrefix + "autoplay", checked)
                                          }
                                          data-testid={`props-video-${arrayFieldLabel}-${index}-autoplay`}
                                        />
                                      </div>
                                      <div className="flex items-center justify-between gap-2">
                                        <Label className="text-sm">Loop</Label>
                                        <Switch
                                          checked={currentLoop !== false}
                                          onCheckedChange={(checked) =>
                                            updateArrayItemField(arrayPath, index, parentPrefix + "loop", checked)
                                          }
                                          data-testid={`props-video-${arrayFieldLabel}-${index}-loop`}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </CollapsibleContent>
                            </Collapsible>
                          );
                        })}
                      </div>
                    </div>
                  );
                }

                {
                  const getItemLabel = (item: Record<string, unknown>, idx: number) =>
                    (item.tab_label as string) ||
                    (item.title as string) ||
                    (item.label as string) ||
                    (item.name as string) ||
                    (item.text as string) ||
                    `Item ${idx + 1}`;

                  const renderItemEditor = (
                    item: Record<string, unknown>,
                    index: number,
                  ) => {
                    const currentValue = String(getValueAtFieldPath(item, itemField) ?? "");
                    const itemLabel = getItemLabel(item, index);
                    const handleChange = (val: string | number | boolean) =>
                      updateArrayItemField(arrayPath, index, itemField, val);

                    switch (editorType) {
                      case "color-picker": {
                        const colorType = (variant as ColorPickerVariant) || "accent";
                        return (
                          <div key={index} className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground min-w-[80px] truncate">
                              {itemLabel}
                            </span>
                            <ColorPicker
                              value={currentValue}
                              onChange={(v) => handleChange(v)}
                              type={colorType}
                              label=" "
                              allowNone={true}
                              allowCustom={true}
                              testIdPrefix={`props-color-${arrayFieldLabel}-${index}`}
                            />
                          </div>
                        );
                      }
                      case "link-picker":
                        return (
                          <div key={index} className="space-y-1">
                            <Label className="text-xs text-muted-foreground">{itemLabel}</Label>
                            <LinkPicker
                              value={currentValue}
                              onChange={(url) => handleChange(url)}
                              locale={locale}
                              allSections={allSections}
                              testId={`props-link-${arrayFieldLabel}-${index}`}
                            />
                          </div>
                        );
                      case "rich-text-editor":
                        return (
                          <div key={index} className="space-y-1">
                            <Label className="text-xs text-muted-foreground">{itemLabel}</Label>
                            <RichTextArea
                              key={`${sectionIndex}-${arrayPath}-${index}-${itemField}`}
                              value={currentValue}
                              onChange={(html) => handleChange(html)}
                              placeholder={`Edit ${itemLabel}…`}
                              minHeight="80px"
                              locale={locale}
                              customOptions={variant ? variant.split(",").map((o: string) => o.trim()) : undefined}
                              data-testid={`props-richtext-${arrayFieldLabel}-${index}`}
                            />
                          </div>
                        );
                      case "markdown":
                        return (
                          <div key={index} className="space-y-1">
                            <MarkdownEditorField
                              key={`${sectionIndex}-${arrayPath}-${index}-${itemField}`}
                              value={currentValue}
                              onChange={(md) => handleChange(md)}
                              label={itemLabel}
                              data-testid={`props-markdown-${arrayFieldLabel}-${index}`}
                            />
                          </div>
                        );
                      case "boolean-toggle": {
                        const fieldValue = getValueAtFieldPath(item, itemField);
                        const boolValue = fieldValue === true || fieldValue === "true";
                        return (
                          <div key={index} className="flex items-center gap-3">
                            <Label className="text-sm text-muted-foreground">{itemLabel}</Label>
                            <Switch
                              checked={boolValue}
                              onCheckedChange={(checked) => handleChange(checked)}
                              data-testid={`props-toggle-${arrayFieldLabel}-${index}`}
                            />
                          </div>
                        );
                      }
                      default:
                        return (
                          <div key={index} className="space-y-1">
                            <Label className="text-xs text-muted-foreground">{itemLabel}</Label>
                            <Input
                              value={currentValue}
                              onChange={(e) => handleChange(e.target.value)}
                              className="h-8 text-sm"
                              data-testid={`props-${editorType}-${arrayFieldLabel}-${index}`}
                            />
                          </div>
                        );
                    }
                  };

                  return (
                    <div key={fieldPath} className="space-y-3">
                      <Label className="text-sm font-medium capitalize">
                        {getFieldLabel(itemField)}
                      </Label>
                      <div className="space-y-2">
                        {safeArrayData.map((item, index) => renderItemEditor(item, index))}
                      </div>
                    </div>
                  );
                }
              },
            )}
          </div>
        </TabsContent>

        {/* Conversion Tab */}
        <TabsContent
          value="conversion"
          className="flex-1 overflow-auto p-4 mt-0 data-[state=inactive]:hidden"
        >
          {formSettingsPath === null ? (
            <div
              className="flex flex-col items-center justify-center h-full min-h-[160px] text-center gap-3"
              data-testid="conversion-empty-state"
            >
              <IconTargetArrow className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                This section has no conversion or telemetry components, goals or activity.
              </p>
            </div>
          ) : !boundFormObjectPresent ? (
            <div
              className="flex flex-col items-center justify-center h-full min-h-[160px] text-center gap-3 px-4"
              data-testid="conversion-cta-only-empty-state"
            >
              <IconTargetArrow className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground max-w-sm">
                No inline lead form on this section (CTA-only is fine). Lead conversion is
                configured on the form that actually submits — often a modal opened by the
                button — not on the CTA click itself. CTA ecommerce intent lives under the
                Ecommerce tab (<code className="text-[10px]">tracking</code>).
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {(() => {
                const storedConversionName = String(getValueAtFieldPath(parsedSection, formProp("conversion_name")) ?? "");
                const fieldsVal = getValueAtFieldPath(parsedSection, formProp("fields"));
                // LeadForm `fields` is a keyed object (email, first_name, …), not an array.
                const hasFields =
                  fieldsVal != null &&
                  typeof fieldsVal === "object" &&
                  !Array.isArray(fieldsVal) &&
                  Object.keys(fieldsVal as object).length > 0;
                const formNode = formSettingsPath === ""
                  ? parsedSection
                  : getValueAtFieldPath(parsedSection, formSettingsPath);
                const hasFormNode = formNode != null && typeof formNode === "object";
                const incomplete = Boolean(storedConversionName || hasFormNode) && !hasFields;
                if (!incomplete) return null;
                return (
                  <div
                    className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2"
                    data-testid="forms-incomplete-warning"
                  >
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                      This form looks incomplete (conversion name or form data without fields). Clear orphaned form data, or add fields.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      data-testid="button-clear-form"
                      onClick={() => {
                        if (formSettingsPath === "" || formSettingsPath == null) {
                          updatePropertyWithValue("conversion_name", undefined);
                          updatePropertyWithValue("fields", undefined);
                          updatePropertyWithValue("routes", undefined);
                          updatePropertyWithValue("webhook", undefined);
                          updatePropertyWithValue("success", undefined);
                          updatePropertyWithValue("consent", undefined);
                          updatePropertyWithValue("tags", undefined);
                          updatePropertyWithValue("automations", undefined);
                        } else {
                          updatePropertyWithValue(formSettingsPath, undefined);
                        }
                      }}
                    >
                      Clear form
                    </Button>
                  </div>
                );
              })()}
              {(() => {
                const formNode =
                  formSettingsPath === ""
                    ? parsedSection
                    : (getValueAtFieldPath(parsedSection, formSettingsPath ?? "") as
                        | Record<string, unknown>
                        | undefined);
                if (!formNode || typeof formNode !== "object") return null;
                const rootVal = formNode.conversion_name;
                const routes = formNode.routes;
                let routeHasName = false;
                if (Array.isArray(routes)) {
                  for (const r of routes) {
                    if (
                      r &&
                      typeof r === "object" &&
                      typeof (r as Record<string, unknown>).conversion_name === "string" &&
                      String((r as Record<string, unknown>).conversion_name).trim()
                    ) {
                      routeHasName = true;
                      break;
                    }
                  }
                }
                const missing =
                  !("conversion_name" in formNode) && !routeHasName;
                if (!missing) return null;
                return (
                  <div
                    className="rounded-md border border-destructive/40 bg-destructive/10 p-3 space-y-1"
                    data-testid="banner-conversion-name-required"
                  >
                    <p className="text-sm font-medium text-destructive">
                      Conversion name required
                    </p>
                    <p className="text-xs text-muted-foreground">
                      This field is missing (often after duplicate). Choose a conversion event, or turn
                      conversion off with <strong>None</strong> (<code className="text-[10px]">null</code>).
                      Save and publish will fail until you decide.
                    </p>
                  </div>
                );
              })()}
              {/* Conversion Name */}
              {(() => {
                const rawConversion = getValueAtFieldPath(parsedSection, formProp("conversion_name"));
                const isOff = rawConversion === null;
                const storedConversionName =
                  typeof rawConversion === "string" ? rawConversion : "";
                const showPicker = conversionNameEditing || (!storedConversionName && !isOff);
                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label
                        htmlFor="conversion-name"
                        className="text-sm font-medium"
                        data-testid="label-conversion-name"
                      >
                        Conversion Name
                      </Label>
                      {(storedConversionName || isOff) && !showPicker && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={() => setConversionNameEditing(true)}
                          data-testid="button-edit-conversion-name"
                        >
                          <IconPencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {showPicker && (storedConversionName || isOff) && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={() => setConversionNameEditing(false)}
                          data-testid="button-cancel-edit-conversion-name"
                        >
                          <IconX className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>

                    {!showPicker ? (
                      <div
                        className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/50 border"
                        data-testid="display-conversion-name"
                      >
                        <IconTargetArrow className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <span className="text-sm font-mono">
                          {isOff ? "— Off (null) —" : storedConversionName}
                        </span>
                      </div>
                    ) : (
                      <Select
                        value={isOff ? "__clear__" : storedConversionName || undefined}
                        onValueChange={(val) => {
                          updatePropertyWithValue(
                            formProp("conversion_name"),
                            val === "__clear__" ? null : val,
                          );
                          setConversionNameEditing(false);
                        }}
                        data-testid="select-conversion-name"
                        open={conversionNameEditing || (!storedConversionName && !isOff) ? undefined : false}
                      >
                        <SelectTrigger className="w-full" data-testid="combobox-conversion-name">
                          <SelectValue placeholder="Select conversion event…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__clear__" data-testid="conversion-name-option-clear">
                            <span className="text-muted-foreground">— None (turn off) —</span>
                          </SelectItem>
                          {conversionNames.length === 0 && (
                            <SelectItem value="__loading__" disabled>
                              {conversionNamesLoading ? "Loading…" : "No events configured"}
                            </SelectItem>
                          )}
                          {conversionNames.map((name) => (
                            <SelectItem key={name} value={name} data-testid={`conversion-name-option-${name}`}>
                              {name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}

                    <p className="text-xs text-muted-foreground">
                      GTM event fired on form submission. Must match a configured conversion event.
                    </p>
                  </div>
                );
              })()}

              {/* Require Signup toggle (form-level is_signup flag) */}
              {(() => {
                const isSignupEnabled =
                  getValueAtFieldPath(parsedSection, formProp("is_signup")) === true;
                return (
                  <RequireSignupCard
                    enabled={isSignupEnabled}
                    onChange={(enabled) => {
                      // Delete the key when off so the YAML stays clean
                      updatePropertyWithValue(
                        formProp("is_signup"),
                        enabled ? true : undefined,
                      );
                    }}
                  />
                );
              })()}

              {/* Success behavior (post-submit message or redirect) */}
              {(() => {
                const successMessage = String(
                  getValueAtFieldPath(parsedSection, formProp("success.message")) ?? ""
                );
                const successUrl = String(
                  getValueAtFieldPath(parsedSection, formProp("success.url")) ?? ""
                );
                const convName = String(
                  getValueAtFieldPath(parsedSection, formProp("conversion_name")) ?? ""
                );
                const convEvent = convName
                  ? trackingSettings?.conversion_events?.find((e) => e.name === convName)
                  : undefined;
                return (
                  <SuccessCard
                    message={successMessage}
                    url={successUrl}
                    editing={successEditing}
                    onEditingChange={setSuccessEditing}
                    locale={locale}
                    allSections={allSections}
                    inheritedMessage={convEvent?.success?.message}
                    inheritedUrl={convEvent?.success?.url}
                    onChange={(field, value) => {
                      // updateProperty deletes the key on empty values and prunes
                      // empty parents, so clearing both removes `success` entirely
                      // and falls back to the conversion event default.
                      updateProperty(formProp(`success.${field}`), value);
                    }}
                  />
                );
              })()}

              {/* Form fields already present in YAML (visible / required / default) */}
              {(() => {
                const fieldsRaw = getValueAtFieldPath(parsedSection, formProp("fields"));
                const fields: Record<string, Record<string, unknown>> =
                  fieldsRaw && typeof fieldsRaw === "object" && !Array.isArray(fieldsRaw)
                    ? (fieldsRaw as Record<string, Record<string, unknown>>)
                    : {};
                return (
                  <FormFieldsCard
                    fields={fields}
                    onFieldChange={(fieldName, key, value) => {
                      if (key === "visible" || key === "required") {
                        updatePropertyWithValue(
                          formProp(`fields.${fieldName}.${key}`),
                          value as boolean,
                        );
                        return;
                      }
                      updateProperty(
                        formProp(`fields.${fieldName}.${key}`),
                        String(value),
                      );
                    }}
                  />
                );
              })()}

              {/* Automations + Tags grouped card */}
              {(() => {
                const convName = String(getValueAtFieldPath(parsedSection, formProp("conversion_name")) ?? "");
                const convEvent = convName
                  ? trackingSettings?.conversion_events?.find((e) => e.name === convName)
                  : undefined;
                const inheritedAutomation = convEvent?.automations ?? undefined;
                const inheritedTags: string[] | undefined = convEvent?.tags
                  ? (Array.isArray(convEvent.tags) ? convEvent.tags : [String(convEvent.tags)])
                  : undefined;
                const rawAutomationVal = getValueAtFieldPath(parsedSection, formProp("automations"));
                const automationOverridden = rawAutomationVal !== undefined;
                const rawTagsVal = getValueAtFieldPath(parsedSection, formProp("tags"));
                const tagsOverridden = rawTagsVal !== undefined;
                return (
                  <AutomationsTagsCard
                    automation={
                      rawAutomationVal && !Array.isArray(rawAutomationVal)
                        ? String(rawAutomationVal)
                        : ""
                    }
                    tags={(() => {
                      if (Array.isArray(rawTagsVal)) return rawTagsVal as string[];
                      return rawTagsVal && !Array.isArray(rawTagsVal)
                        ? String(rawTagsVal).split(",").map((t) => t.trim()).filter(Boolean)
                        : [];
                    })()}
                    onAutomationChange={(val) => {
                      if (automationOverridden && !val) {
                        updatePropertyWithValue(formProp("automations"), []);
                      } else {
                        updateProperty(formProp("automations"), val);
                      }
                    }}
                    onTagsChange={(vals) => {
                      if (vals.length > 0) {
                        updatePropertyWithValue(formProp("tags"), vals);
                      } else if (tagsOverridden) {
                        updatePropertyWithValue(formProp("tags"), []);
                      } else {
                        updatePropertyWithValue(formProp("tags"), undefined);
                      }
                    }}
                    automationSuggestions={formStateSuggestions?.automations ?? []}
                    tagSuggestions={formStateSuggestions?.tags ?? []}
                    inheritedAutomation={inheritedAutomation}
                    inheritedTags={inheritedTags}
                    automationOverridden={automationOverridden}
                    tagsOverridden={tagsOverridden}
                    onAutomationOverrideChange={(override) => {
                      if (override) {
                        if (inheritedAutomation) {
                          updateProperty(formProp("automations"), inheritedAutomation);
                        } else {
                          updatePropertyWithValue(formProp("automations"), []);
                        }
                      } else {
                        updatePropertyWithValue(formProp("automations"), undefined);
                      }
                    }}
                    onTagsOverrideChange={(override) => {
                      if (override) {
                        if (inheritedTags && inheritedTags.length > 0) {
                          updatePropertyWithValue(formProp("tags"), inheritedTags);
                        } else {
                          updatePropertyWithValue(formProp("tags"), []);
                        }
                      } else {
                        updatePropertyWithValue(formProp("tags"), undefined);
                      }
                    }}
                  />
                );
              })()}

              {/* Consents card */}
              {sectionType === "apply_form" ? (
                /* apply_form: free-text consent strings at root — keep inline */
                (() => {
                  const applyConsentMarketing = String(getValueAtFieldPath(parsedSection, "consent_marketing") ?? "");
                  const applyConsentSms       = String(getValueAtFieldPath(parsedSection, "consent_sms") ?? "");
                  const applyTermsUrl         = String(getValueAtFieldPath(parsedSection, "terms_link_url") ?? "");
                  const applyPrivacyUrl       = String(getValueAtFieldPath(parsedSection, "privacy_link_url") ?? "");
                  const activeChannels = [
                    applyConsentMarketing ? "Marketing" : null,
                    applyConsentSms ? "SMS" : null,
                  ].filter(Boolean) as string[];
                  return (
                    <div className="rounded-md border bg-muted/20 p-3 space-y-3" data-testid="card-consents">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <IconShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-sm font-medium">Consents</span>
                        </div>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={() => setConsentsEditing((v) => !v)}
                          data-testid="button-edit-consents"
                        >
                          {consentsEditing ? <IconX className="h-3.5 w-3.5" /> : <IconPencil className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                      {!consentsEditing ? (
                        <div className="space-y-1.5">
                          <div className="flex items-start gap-2">
                            <span className="text-xs text-muted-foreground w-20 flex-shrink-0 pt-0.5">Channels</span>
                            {activeChannels.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {activeChannels.map((ch) => (
                                  <Badge key={ch} variant="secondary" className="text-[11px] px-1.5 py-0 leading-4 font-normal">
                                    {ch}
                                  </Badge>
                                ))}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground italic">none enabled</span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Marketing consent text</Label>
                            <Textarea
                              rows={3}
                              value={applyConsentMarketing}
                              onChange={(e) => updateProperty("consent_marketing", e.target.value)}
                              placeholder="I agree to receive information through email, WhatsApp..."
                              className="text-xs resize-none"
                              data-testid="input-consent-marketing-text"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">SMS consent text</Label>
                            <Textarea
                              rows={3}
                              value={applyConsentSms}
                              onChange={(e) => updateProperty("consent_sms", e.target.value)}
                              placeholder="I agree to receive SMS/text messages..."
                              className="text-xs resize-none"
                              data-testid="input-consent-sms-text"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Terms URL</Label>
                              <Input
                                value={applyTermsUrl}
                                onChange={(e) => updateProperty("terms_link_url", e.target.value)}
                                placeholder="/terms-conditions"
                                className="text-xs h-8"
                                data-testid="input-consent-terms-url"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Privacy URL</Label>
                              <Input
                                value={applyPrivacyUrl}
                                onChange={(e) => updateProperty("privacy_link_url", e.target.value)}
                                placeholder="/privacy-policy"
                                className="text-xs h-8"
                                data-testid="input-consent-privacy-url"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()
              ) : (() => {
                /* hero / lead_form: boolean toggles — use shared ConsentCard */
                const convName = String(getValueAtFieldPath(parsedSection, formProp("conversion_name")) ?? "");
                  const convEvent = convName
                    ? trackingSettings?.conversion_events?.find((e) => e.name === convName)
                    : undefined;

                  const rawConsent = getValueAtFieldPath(parsedSection, formProp("consent"));
                  const extraConsentFields = [
                    ...new Set([
                      ...consentCardChannels(Object.keys(consentSettings ?? {}), consentFallback)
                        .map((c) => c.yamlField)
                        .filter((f) => f !== "marketing" && f !== "sms" && f !== "whatsapp"),
                      ...collectExtraConsentYamlFields(
                        Object.keys(consentSettings ?? {}),
                        rawConsent && typeof rawConsent === "object"
                          ? (rawConsent as Record<string, unknown>)
                          : undefined,
                        convEvent?.consent,
                      ).filter((f) => consentKeyFromYamlField(f) !== consentFallback),
                    ]),
                  ];

                  const rawMarketing   = getValueAtFieldPath(parsedSection, formProp("consent.marketing"));
                  const rawSms         = getValueAtFieldPath(parsedSection, formProp("consent.sms"));
                  const rawWhatsapp    = getValueAtFieldPath(parsedSection, formProp("consent.whatsapp"));
                  const rawSmsUsaOnly  = getValueAtFieldPath(parsedSection, formProp("consent.sms_usa_only"));
                  const rawShowTerms   = getValueAtFieldPath(parsedSection, formProp("show_terms"));

                  const specificFields: Partial<Record<string, boolean>> = {
                    marketing:  rawMarketing  !== null && rawMarketing  !== undefined,
                    sms:        rawSms        !== null && rawSms        !== undefined,
                    whatsapp:   rawWhatsapp   !== null && rawWhatsapp   !== undefined,
                    smsUsaOnly: rawSmsUsaOnly !== null && rawSmsUsaOnly !== undefined,
                    showTerms:  rawShowTerms  !== null && rawShowTerms  !== undefined,
                    termsUrl:   false,
                    privacyUrl: false,
                  };
                  for (const field of extraConsentFields) {
                    const raw = getValueAtFieldPath(parsedSection, formProp(`consent.${field}`));
                    specificFields[field] = raw !== null && raw !== undefined;
                  }

                  const extraValues = Object.fromEntries(
                    extraConsentFields.map((field) => [
                      field,
                      !!getValueAtFieldPath(resolvedParsedSection, formProp(`consent.${field}`)),
                    ]),
                  );
                  const extraInherited = Object.fromEntries(
                    extraConsentFields.map((field) => [field, !!convEvent?.consent?.[field]]),
                  );

                  const inheritedValues: Partial<ConsentValues> | undefined = convEvent
                    ? {
                        marketing:  !!convEvent.consent?.marketing,
                        sms:        !!convEvent.consent?.sms,
                        whatsapp:   !!convEvent.consent?.whatsapp,
                        smsUsaOnly: !!convEvent.consent?.sms_usa_only,
                        showTerms:  !!convEvent.consent?.show_terms,
                        termsUrl:   convEvent.consent?.terms_url ?? "",
                        privacyUrl: convEvent.consent?.privacy_url ?? "",
                        ...extraInherited,
                      }
                    : undefined;

                  const isConsentOverridden = Object.values(specificFields).some(Boolean);
                  return (
                    <ConsentCard
                      values={{
                        marketing: !!getValueAtFieldPath(resolvedParsedSection, formProp("consent.marketing")),
                        sms: !!getValueAtFieldPath(resolvedParsedSection, formProp("consent.sms")),
                        whatsapp: !!getValueAtFieldPath(resolvedParsedSection, formProp("consent.whatsapp")),
                        smsUsaOnly: !!getValueAtFieldPath(resolvedParsedSection, formProp("consent.sms_usa_only")),
                        showTerms: !!getValueAtFieldPath(resolvedParsedSection, formProp("show_terms")),
                        termsUrl: String(getValueAtFieldPath(resolvedParsedSection, formProp("terms_url")) ?? ""),
                        privacyUrl: String(getValueAtFieldPath(resolvedParsedSection, formProp("privacy_url")) ?? ""),
                        ...extraValues,
                      }}
                      inheritedValues={inheritedValues}
                      specificFields={specificFields}
                      isOverridden={isConsentOverridden}
                      onChange={(field, value) => {
                        const pathMap: Record<string, string> = {
                          marketing: formProp("consent.marketing"),
                          sms: formProp("consent.sms"),
                          whatsapp: formProp("consent.whatsapp"),
                          smsUsaOnly: formProp("consent.sms_usa_only"),
                          showTerms: formProp("show_terms"),
                          termsUrl: formProp("terms_url"),
                          privacyUrl: formProp("privacy_url"),
                        };
                        const path = pathMap[field] ?? formProp(`consent.${field}`);
                        if (typeof value === "boolean") {
                          updatePropertyWithValue(path, value);
                        } else {
                          updateProperty(path, value);
                        }
                      }}
                      onOverrideChange={(override) => {
                        try {
                          const parsed = safeYamlLoad(yamlContent) as Record<string, unknown>;
                          if (!parsed || typeof parsed !== "object") return;
                          pushUndoState(yamlContent);
                          const setProp = (path: string, val: unknown) => {
                            const parts = path.split(".");
                            let cur = parsed as Record<string, unknown>;
                            for (let i = 0; i < parts.length - 1; i++) {
                              if (!cur[parts[i]] || typeof cur[parts[i]] !== "object") cur[parts[i]] = {};
                              cur = cur[parts[i]] as Record<string, unknown>;
                            }
                            const k = parts[parts.length - 1];
                            if (val !== undefined) { cur[k] = val; } else { delete cur[k]; }
                          };
                          if (override) {
                            const eff = (p: string) => getValueAtFieldPath(resolvedParsedSection, p);
                            setProp(formProp("consent.marketing"),    !!eff(formProp("consent.marketing")));
                            setProp(formProp("consent.sms"),          !!eff(formProp("consent.sms")));
                            setProp(formProp("consent.whatsapp"),     !!eff(formProp("consent.whatsapp")));
                            setProp(formProp("consent.sms_usa_only"), !!eff(formProp("consent.sms_usa_only")));
                            setProp(formProp("show_terms"),           !!eff(formProp("show_terms")));
                            for (const field of extraConsentFields) {
                              setProp(formProp(`consent.${field}`), !!eff(formProp(`consent.${field}`)));
                            }
                          } else {
                            setProp(formProp("consent.marketing"),    undefined);
                            setProp(formProp("consent.sms"),          undefined);
                            setProp(formProp("consent.whatsapp"),     undefined);
                            setProp(formProp("consent.sms_usa_only"), undefined);
                            setProp(formProp("show_terms"),           undefined);
                            for (const field of extraConsentFields) {
                              setProp(formProp(`consent.${field}`), undefined);
                            }
                          }
                          setYamlContent(safeYamlDump(parsed, { lineWidth: -1, noRefs: true, quotingType: '"' }));
                          setHasChanges(true);
                          setParseError(null);
                        } catch (e) {
                          console.error("Error updating consent override:", e);
                        }
                      }}
                    />
                  );
                })()}

              {/* Locations */}
              {(() => {
                const rawLocs = getValueAtFieldPath(parsedSection, formProp("locations"));
                const selectedLocs: string[] = Array.isArray(rawLocs)
                  ? (rawLocs as string[])
                  : rawLocs
                  ? [String(rawLocs)]
                  : [];
                // Purely data-driven: auto when no locations stored
                const isAutoDetect = selectedLocs.length === 0;

                const locationOptions = (formOptions?.locations ?? []).map((loc) => ({
                  value: loc.slug,
                  label: `${loc.name} — ${loc.city}`,
                  group: loc.region,
                  badgeLabel: loc.city,
                  searchTerms: [loc.city, loc.country, loc.slug, loc.name],
                }));

                const groupLabels = Object.fromEntries(
                  (formOptions?.regions ?? []).map((r) => [r.slug, r.label])
                );

                return (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <Label className="text-sm font-medium" data-testid="label-conversion-locations">
                        Locations
                      </Label>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {isAutoDetect ? "Auto-detect" : "Manual"}
                        </span>
                        <Switch
                          checked={isAutoDetect}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              // ON → clear locations, back to auto-detect
                              updatePropertyWithValue(formProp("locations"), undefined);
                              setLocationsPickerOpen(false);
                            } else {
                              // OFF → open picker so user can choose campuses immediately
                              setLocationsPickerOpen(true);
                            }
                          }}
                          data-testid="switch-locations-auto-detect"
                        />
                      </div>
                    </div>
                    {isAutoDetect && !locationsPickerOpen ? (
                      <p className="text-xs text-muted-foreground">
                        Location is auto-detected from the visitor's IP address.
                      </p>
                    ) : (
                      <SearchableMultiSelect
                        options={locationOptions}
                        value={selectedLocs}
                        onChange={(vals) => {
                          updatePropertyWithValue(
                            formProp("locations"),
                            vals.length > 0 ? vals : undefined
                          );
                          if (vals.length === 0) setLocationsPickerOpen(false);
                        }}
                        open={locationsPickerOpen && isAutoDetect ? locationsPickerOpen : undefined}
                        onOpenChange={(o) => {
                          // Only manage externally when in the transient "picker open, no selections" state
                          if (isAutoDetect) setLocationsPickerOpen(o);
                        }}
                        label="Select campuses"
                        searchPlaceholder="Search locations…"
                        groupLabels={groupLabels}
                        isLoading={formOptionsLoading}
                        testIdPrefix="location"
                        emptyMessage="No locations found"
                      />
                    )}
                  </div>
                );
              })()}

              {/* Webhook */}
              {(() => {
                const rawSectionWebhookUrl = String(
                  getValueAtFieldPath(parsedSection, formProp("webhook.url")) ?? ""
                );
                const storedConversionName = String(
                  getValueAtFieldPath(parsedSection, formProp("conversion_name")) ?? ""
                );
                const eventWebhookUrl =
                  storedConversionName
                    ? (trackingSettings?.conversion_events?.find(
                        (e) => e.name === storedConversionName
                      )?.webhook?.url ?? "")
                    : "";
                const globalWebhookUrl = trackingSettings?.webhook?.url ?? "";
                const webhookSource: WebhookSource = rawSectionWebhookUrl
                  ? "section"
                  : eventWebhookUrl
                  ? "event"
                  : globalWebhookUrl
                  ? "global"
                  : "none";
                const webhookHint =
                  webhookSource === "section"
                    ? "This section overrides the event default and global webhook. Clear the URL to fall back to the next level."
                    : webhookSource === "event"
                    ? "No section URL set — currently falling back to the event default. Enter a URL here to override it for this section only."
                    : webhookSource === "global"
                    ? "No section URL set — currently falling back to the global webhook. Enter a URL here to override it for this section only."
                    : "No webhook configured at any level. Enter a URL to receive form submissions via webhook.";
                const sectionSource = resolvedParsedSection ?? parsedSection ?? {};
                const webhookSamplePayload = buildWebhookSamplePayload(
                  sectionSource,
                  formSettingsPath,
                  session,
                  { singleEntry },
                );
                return (
                  <WebhookCard
                    url={rawSectionWebhookUrl}
                    method={
                      (getValueAtFieldPath(
                        parsedSection,
                        formProp("webhook.method")
                      ) as "POST" | "GET") ?? "POST"
                    }
                    authHeader={String(
                      getValueAtFieldPath(
                        parsedSection,
                        formProp("webhook.auth_header")
                      ) ?? ""
                    )}
                    editing={webhookEditing}
                    onEditingChange={setWebhookEditing}
                    onChange={(field, value) => {
                      if (field === "url") {
                        if (!value) {
                          // Clear the entire webhook block to avoid orphaned keys (method, auth_header)
                          updatePropertyWithValue(formProp("webhook"), undefined);
                        } else {
                          updateProperty(formProp("webhook.url"), value);
                        }
                      } else if (field === "method") {
                        updateProperty(formProp("webhook.method"), value);
                      } else if (field === "authHeader") {
                        updateProperty(formProp("webhook.auth_header"), value);
                      }
                    }}
                    hint={webhookHint}
                    source={webhookSource}
                    inheritedUrl={
                      webhookSource === "event"
                        ? eventWebhookUrl
                        : webhookSource === "global"
                        ? globalWebhookUrl
                        : undefined
                    }
                    samplePayload={webhookSamplePayload}
                    onTest={async () => {
                      try {
                        const res = await apiRequest("POST", "/api/tracking/webhook/test", {
                          payload: webhookSamplePayload,
                        });
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok || !(data as any).ok) {
                          return { ok: false, error: (data as any).error || `HTTP ${res.status}` };
                        }
                        return { ok: true, status: (data as any).status };
                      } catch (e: any) {
                        return { ok: false, error: e.message };
                      }
                    }}
                    testIdPrefix="section-webhook"
                  />
                );
              })()}
            </div>
          )}
        </TabsContent>

        {/* Ecommerce Tab */}
        {showEcommerceTab && (
        <TabsContent
          value="ecommerce"
          className="flex-1 overflow-auto p-4 mt-0 data-[state=inactive]:hidden"
        >
          <div className="space-y-6" data-testid="ecommerce-tab-content">
            <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-sm text-muted-foreground">
              <p className="text-foreground font-medium">How ecommerce differs from Forms</p>
              <p>
                This tab appears only when the current variant binds{" "}
                <code className="text-xs bg-muted px-1 rounded">cta-tracking</code> or{" "}
                <code className="text-xs bg-muted px-1 rounded">ecommerce-products</code>
                {" "}(hero: course CTA; enrollment: summary CTAs; pricing plans: product field).
                CTA-only heroes have no Ecommerce tab.
              </p>
              <p>
                Ecommerce funnel events are purchasable-gated and separate from lead Forms.
                Products need <code className="text-xs bg-muted px-1 rounded">_ecommerce.yml</code> with{" "}
                <code className="text-xs bg-muted px-1 rounded">purchasable: true</code>.
                Purchase completes off-site — this site never fires <code className="text-xs">purchase</code>.
              </p>
              <details className="text-xs">
                <summary className="cursor-pointer text-foreground font-medium">Read more (advanced)</summary>
                <ul className="mt-2 list-disc pl-5 font-mono space-y-1">
                  <li>shared/component-behaviors.ts</li>
                  <li>client/src/lib/tracking.ts</li>
                  <li>docs/component-behaviors.md</li>
                  <li>shared/component-registry/hero/v1.0/field-editors.ts</li>
                </ul>
              </details>
            </div>

            {hasEcommerceBehavior && (
              <div
                className="rounded-md border bg-muted/30 p-3 space-y-1 text-sm"
                data-testid="banner-funnel-products-on-page"
              >
                <p className="font-medium text-foreground">Product scope lives on the Funnel tab</p>
                <p className="text-xs text-muted-foreground">
                  Set <code className="text-[10px]">funnel.stage</code> and{" "}
                  <code className="text-[10px]">funnel.products</code> on this entry&apos;s{" "}
                  <code className="text-[10px]">_common.yml</code> (SEO modal → Funnel). Section{" "}
                  <code className="text-[10px]">ecommerce_products</code> is no longer used.
                  Enrollment <code className="text-[10px]">programs[].id</code> still controls card
                  rendering only.
                </p>
              </div>
            )}

            <div className="space-y-3">
              <h3 className="text-sm font-medium">CTA inventory</h3>
              {ctaTrackingPaths.map((ctaPath) => {
                const raw = getValueAtFieldPath(parsedSection, ctaPath);
                const ctas: Array<{ path: string; text?: string; url?: string; tracking?: string }> = [];
                const visit = (v: unknown, hint: string) => {
                  if (Array.isArray(v)) {
                    v.forEach((item, i) => visit(item, `${hint}[${i}]`));
                    return;
                  }
                  if (v && typeof v === "object") {
                    const o = v as Record<string, unknown>;
                    if (typeof o.url === "string" && typeof o.text === "string") {
                      ctas.push({
                        path: hint || ctaPath,
                        text: o.text,
                        url: o.url,
                        tracking: typeof o.tracking === "string" ? o.tracking : undefined,
                      });
                    }
                  }
                };
                visit(raw, ctaPath);
                if (ctas.length === 0) {
                  return (
                    <p key={ctaPath} className="text-xs text-muted-foreground font-mono">{ctaPath}: (empty)</p>
                  );
                }
                return ctas.map((cta) => {
                  const unlinked =
                    cta.tracking &&
                    cta.tracking !== "none" &&
                    !(typeof cta.url === "string" && /[?&]program=/.test(cta.url));
                  return (
                    <div
                      key={cta.path}
                      className="rounded-md border p-3 space-y-2"
                      data-testid={`cta-inventory-${cta.path}`}
                    >
                      <p className="text-xs font-mono text-muted-foreground">{cta.path}</p>
                      <p className="text-sm">{cta.text}</p>
                      <p className="text-xs text-muted-foreground break-all">{cta.url}</p>
                      <div className="flex items-center gap-2">
                        <Label className="text-xs">tracking</Label>
                        <Select
                          value={cta.tracking || "none"}
                          onValueChange={(val) => {
                            const target =
                              cta.path === ctaPath || !cta.path.includes("[")
                                ? `${ctaPath}.tracking`
                                : `${cta.path}.tracking`;
                            updatePropertyWithValue(target, val);
                          }}
                        >
                          <SelectTrigger className="w-[180px]" data-testid={`select-cta-tracking-${cta.path}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">none</SelectItem>
                            <SelectItem value="add_to_cart">add_to_cart</SelectItem>
                            <SelectItem value="click_begin_checkout">click_begin_checkout</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {unlinked && (
                        <p className="text-xs text-amber-700 dark:text-amber-300" data-testid="cta-unlinked-hint">
                          Unlinked: non-none tracking without <code>?program=</code> in URL — ensure page product or enrollment program resolves, or set tracking to none.
                        </p>
                      )}
                    </div>
                  );
                });
              })}
            </div>
          </div>
        </TabsContent>
        )}
      </Tabs>

      {parseError && (
        <div className="p-2 bg-destructive/10 text-destructive text-sm border-t">
          {parseError}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between p-4 border-t bg-muted/30">
        <div className="text-sm">
          {saveError ? (
            <span className="text-destructive">{saveError}</span>
          ) : hasChanges ? (
            <span className="text-muted-foreground flex items-center gap-1.5 flex-wrap">
              Unsaved changes{variant && (
                <>
                  {" for version "}
                  <Badge variant="secondary" className="text-[11px] px-1.5 py-0 leading-4 gap-1 font-normal">
                    <IconGitBranch className="h-3 w-3" />
                    {variant.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
                  </Badge>
                </>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">No changes</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleClose}
            data-testid="button-cancel-edit"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!!parseError || isSaving}
            data-testid="button-save-section"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Icon Picker Modal */}
      <IconPickerModal
        open={iconPickerOpen}
        onOpenChange={setIconPickerOpen}
        currentValue={iconPickerTarget?.currentIcon || ""}
        itemLabel={iconPickerTarget?.label}
        onSelect={handleIconSelect}
      />

      {/* Video Picker Modal */}
      <Dialog
        open={videoPickerOpen}
        onOpenChange={(open) => {
          setVideoPickerOpen(open);
          if (!open) {
            setVideoGallerySearch("");
            setVideoPickerMode("url");
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Select Video</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden flex flex-col gap-4 py-2">
            <div className="flex rounded-md border overflow-visible">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={`flex-1 rounded-none toggle-elevate ${videoPickerMode === "url" ? "toggle-elevated bg-muted" : ""}`}
                onClick={() => setVideoPickerMode("url")}
                data-testid="button-video-picker-url"
              >
                <Video className="h-4 w-4 mr-1.5" />
                URL
              </Button>
              <div className="w-px bg-border" />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={`flex-1 rounded-none toggle-elevate ${videoPickerMode === "browse" ? "toggle-elevated bg-muted" : ""}`}
                onClick={() => setVideoPickerMode("browse")}
                data-testid="button-video-picker-browse"
              >
                <Search className="h-4 w-4 mr-1.5" />
                Browse
              </Button>
              <div className="w-px bg-border" />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={`flex-1 rounded-none toggle-elevate ${videoPickerMode === "upload" ? "toggle-elevated bg-muted" : ""}`}
                onClick={() => setVideoPickerMode("upload")}
                data-testid="button-video-picker-upload"
              >
                <Upload className="h-4 w-4 mr-1.5" />
                Upload
              </Button>
            </div>

            {videoPickerMode === "url" && (
              <div className="space-y-3">
                <Input
                  value={videoPickerTarget?.currentUrl || ""}
                  onChange={(e) => {
                    if (videoPickerTarget) {
                      setVideoPickerTarget({
                        ...videoPickerTarget,
                        currentUrl: e.target.value,
                      });
                    }
                  }}
                  placeholder="Paste a YouTube, Vimeo, or direct video URL..."
                  className="text-sm"
                  data-testid="input-video-url"
                />
                <p className="text-xs text-muted-foreground">
                  Supports YouTube, Vimeo, and direct video file URLs (.mp4, .webm, .mov)
                </p>
              </div>
            )}

            {videoPickerMode === "browse" && (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search videos..."
                    value={videoGallerySearch}
                    onChange={(e) => setVideoGallerySearch(e.target.value)}
                    className="pl-10"
                    data-testid="input-video-gallery-search"
                  />
                </div>
                <div className="flex-1 overflow-y-auto min-h-0">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {filteredGalleryVideos
                      .slice(0, visibleVideoCount)
                      .map(([id, vid]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => {
                            if (videoPickerTarget) {
                              setVideoPickerTarget({
                                ...videoPickerTarget,
                                currentUrl: vid.src,
                              });
                            }
                          }}
                          className={`rounded-md bg-muted border-2 transition-colors p-3 text-left ${
                            videoPickerTarget?.currentUrl === vid.src
                              ? "border-primary"
                              : "border-transparent hover:border-muted-foreground/50"
                          }`}
                          title={vid.alt}
                          data-testid={`gallery-video-${id}`}
                        >
                          <div className="flex items-center gap-2">
                            <Video className="h-5 w-5 text-primary flex-shrink-0" />
                            <div className="min-w-0">
                              <p className="text-xs font-medium truncate">{id}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                {vid.src.split("/").pop()}
                              </p>
                            </div>
                          </div>
                        </button>
                      ))}
                  </div>
                  {visibleVideoCount < filteredGalleryVideos.length && (
                    <div className="py-3 flex justify-center">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setVisibleVideoCount((prev) =>
                            Math.min(prev + 24, filteredGalleryVideos.length),
                          )
                        }
                        data-testid="button-load-more-videos"
                      >
                        Load more ({filteredGalleryVideos.length - visibleVideoCount} remaining)
                      </Button>
                    </div>
                  )}
                  {filteredGalleryVideos.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      No videos found in the media gallery
                    </div>
                  )}
                </div>
              </>
            )}

            {videoPickerMode === "upload" && (
              <div className="flex-1 flex flex-col items-center justify-center min-h-[200px]">
                {hasCloudProvider || mediaStatus?.defaultProvider === "local" ? (
                  <>
                    <input
                      ref={videoFileInputRef}
                      type="file"
                      accept=".mp4,.webm,.mov,.ogg,.m4v"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files?.length)
                          handleVideoUpload(e.target.files);
                        e.target.value = "";
                      }}
                      data-testid="input-video-file-upload"
                    />
                    <div
                      className={`w-full rounded-md border-2 border-dashed p-8 text-center transition-colors cursor-pointer ${
                        videoDragOver
                          ? "border-primary bg-primary/5"
                          : "border-muted-foreground/30 hover:border-muted-foreground/50"
                      }`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setVideoDragOver(true);
                      }}
                      onDragLeave={() => setVideoDragOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setVideoDragOver(false);
                        if (e.dataTransfer.files.length)
                          handleVideoUpload(e.dataTransfer.files);
                      }}
                      onClick={() => videoFileInputRef.current?.click()}
                      data-testid="dropzone-video-upload"
                    >
                      {videoUploading ? (
                        <div className="flex flex-col items-center gap-2">
                          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                          <p className="text-sm text-muted-foreground">Uploading video...</p>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2">
                          <CloudUpload className="h-8 w-8 text-muted-foreground" />
                          <p className="text-sm font-medium">Drop a video here or click to browse</p>
                          <p className="text-xs text-muted-foreground">
                            MP4, WebM, MOV, OGG, M4V (max 100 MB)
                          </p>
                          {hasCloudProvider && mediaStatus?.gcs && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Uploading to {mediaStatus.gcs.bucket}/{mediaStatus.gcs.basePath}
                            </p>
                          )}
                          {!hasCloudProvider && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Saving to marketing-content/images/
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
                      Configure a cloud provider in the Media Gallery settings, or place video files directly in the{" "}
                      <code className="bg-muted px-1 rounded text-xs">marketing-content/images/</code> folder.
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="border-t pt-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-16 h-16 rounded-md overflow-hidden bg-muted border flex-shrink-0 flex items-center justify-center">
                  {videoPickerTarget?.currentUrl ? (
                    <Video className="h-6 w-6 text-primary" />
                  ) : (
                    <div className="text-muted-foreground text-xs">None</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {videoPickerTarget?.currentUrl
                      ? videoPickerTarget.currentUrl.split("/").pop() || videoPickerTarget.currentUrl
                      : "No video selected"}
                  </p>
                  {videoPickerTarget?.currentUrl && (
                    <p className="text-xs text-muted-foreground truncate">
                      {videoPickerTarget.currentUrl}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="flex-row gap-2 sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (videoPickerTarget?.arrayPath != null && videoPickerTarget.index != null && videoPickerTarget.field) {
                  updateArrayItemField(videoPickerTarget.arrayPath, videoPickerTarget.index, videoPickerTarget.field, "");
                } else if (videoPickerTarget?.fieldPath) {
                  updateProperty(videoPickerTarget.fieldPath, "");
                }
                setVideoPickerOpen(false);
                setVideoPickerTarget(null);
              }}
              data-testid="button-video-remove"
            >
              <X className="h-4 w-4 mr-2" />
              Remove
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setVideoPickerOpen(false);
                  setVideoPickerTarget(null);
                }}
                data-testid="button-video-cancel"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (videoPickerTarget?.arrayPath != null && videoPickerTarget.index != null && videoPickerTarget.field) {
                    updateArrayItemField(videoPickerTarget.arrayPath, videoPickerTarget.index, videoPickerTarget.field, videoPickerTarget.currentUrl);
                  } else if (videoPickerTarget?.fieldPath) {
                    updateProperty(videoPickerTarget.fieldPath, videoPickerTarget.currentUrl);
                  }
                  setVideoPickerOpen(false);
                  setVideoPickerTarget(null);
                }}
                data-testid="button-video-save"
              >
                <Check className="h-4 w-4 mr-2" />
                Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Image Picker Modal */}
      <Dialog
        open={imagePickerOpen}
        onOpenChange={(open) => {
          setImagePickerOpen(open);
          if (!open) {
            setImageGallerySearch("");
            setImagePickerMode("browse");
            setCropPanelOpen(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {imagePickerTarget?.tagFilter
                ? `Select ${imagePickerTarget.tagFilter.charAt(0).toUpperCase() + imagePickerTarget.tagFilter.slice(1)}`
                : "Select Image"}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden flex flex-col gap-4 py-2">
            <div className="flex rounded-md border overflow-visible">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={`flex-1 rounded-none toggle-elevate ${imagePickerMode === "browse" ? "toggle-elevated bg-muted" : ""}`}
                onClick={() => setImagePickerMode("browse")}
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
                className={`flex-1 rounded-none toggle-elevate ${imagePickerMode === "upload" ? "toggle-elevated bg-muted" : ""}`}
                onClick={() => setImagePickerMode("upload")}
                data-testid="button-picker-upload"
              >
                <Upload className="h-4 w-4 mr-1.5" />
                Upload
              </Button>
            </div>

            {imagePickerMode === "browse" ? (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search images..."
                    value={imageGallerySearch}
                    onChange={(e) => setImageGallerySearch(e.target.value)}
                    className="pl-10"
                    data-testid="input-image-gallery-search"
                  />
                </div>

                <div className="flex-1 overflow-y-auto min-h-0">
                  <div className="columns-4 sm:columns-5 md:columns-6 gap-2">
                    {filteredGalleryImages
                      .slice(0, visibleImageCount)
                      .map(([id, img]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => {
                            if (imagePickerTarget) {
                              const fieldName =
                                imagePickerTarget.srcField ||
                                imagePickerTarget.fieldPath ||
                                "";
                              const isIdField = fieldName.endsWith("_id");
                              setImagePickerTarget({
                                ...imagePickerTarget,
                                currentSrc: isIdField ? id : img.src,
                                currentAlt: img.alt,
                                currentRegistryId: id,
                              });
                            }
                          }}
                          className={`mb-2 rounded-md overflow-hidden bg-muted border-2 transition-colors block w-full ${
                            imagePickerTarget?.currentSrc === img.src ||
                            imagePickerTarget?.currentSrc === id
                              ? "border-primary"
                              : "border-transparent hover:border-muted-foreground/50"
                          }`}
                          title={img.alt}
                          data-testid={`gallery-image-${id}`}
                        >
                          <img
                            src={img.src}
                            alt={img.alt}
                            className="w-full h-auto"
                            loading="lazy"
                          />
                        </button>
                      ))}
                  </div>
                  {visibleImageCount < filteredGalleryImages.length && (
                    <div className="py-3 flex justify-center">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setVisibleImageCount((prev) =>
                            Math.min(prev + 24, filteredGalleryImages.length),
                          )
                        }
                        data-testid="button-load-more-images"
                      >
                        Load more (
                        {filteredGalleryImages.length - visibleImageCount}{" "}
                        remaining)
                      </Button>
                    </div>
                  )}
                  {filteredGalleryImages.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      No images found
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center min-h-[200px]">
                {hasCloudProvider ||
                mediaStatus?.defaultProvider === "local" ? (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".png,.jpg,.jpeg,.webp,.svg,.avif,.gif"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files?.length)
                          handleImageUpload(e.target.files);
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
                        if (e.dataTransfer.files.length)
                          handleImageUpload(e.dataTransfer.files);
                      }}
                      onClick={() => fileInputRef.current?.click()}
                      data-testid="dropzone-upload"
                    >
                      {uploading ? (
                        <div className="flex flex-col items-center gap-2">
                          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                          <p className="text-sm text-muted-foreground">
                            Uploading...
                          </p>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2">
                          <CloudUpload className="h-8 w-8 text-muted-foreground" />
                          <p className="text-sm font-medium">
                            Drop an image here or click to browse
                          </p>
                          <p className="text-xs text-muted-foreground">
                            PNG, JPG, WebP, SVG, AVIF, GIF (max 10 MB)
                          </p>
                          {hasCloudProvider && mediaStatus?.gcs && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Uploading to {mediaStatus.gcs.bucket}/
                              {mediaStatus.gcs.basePath}
                            </p>
                          )}
                          {!hasCloudProvider && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Saving to marketing-content/images/
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="text-center space-y-3 p-4">
                    <Upload className="h-8 w-8 text-muted-foreground mx-auto" />
                    <p className="text-sm font-medium">
                      No storage provider configured
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Drop images directly into the{" "}
                      <code className="bg-muted px-1 rounded text-xs">
                        marketing-content/images/
                      </code>{" "}
                      folder, then scan the registry to include them. Or
                      configure a cloud provider in the Media Gallery settings.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Selected image preview and fields */}
            <div className="border-t pt-4 space-y-3">
              <div className="flex gap-3">
                <div className="w-16 h-16 rounded-md overflow-hidden bg-muted border flex-shrink-0">
                  {imagePickerTarget?.currentSrc ? (
                    <img
                      src={
                        // If currentSrc is an ID, look up the actual src from registry
                        imageRegistry?.images?.[imagePickerTarget.currentSrc]
                          ?.src || imagePickerTarget.currentSrc
                      }
                      alt={imagePickerTarget.currentAlt || "Preview"}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                      None
                    </div>
                  )}
                </div>
                <div className="flex-1 space-y-2">
                  <div className="flex gap-2">
                    <Input
                      value={imagePickerTarget?.currentSrc || ""}
                      onChange={(e) => {
                        if (imagePickerTarget) {
                          setImagePickerTarget({
                            ...imagePickerTarget,
                            currentSrc: e.target.value,
                          });
                        }
                      }}
                      placeholder="Image URL"
                      className="text-sm flex-1"
                      data-testid="input-image-url"
                    />
                    {imagePickerTarget?.currentRegistryId && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setCropState({ unit: "%", x: 0, y: 0, width: 100, height: 100 });
                          // Smart crop defaults: use registry dimensions if available
                          if (imagePickerTarget?.currentRegistryId && imageRegistry?.images?.[imagePickerTarget.currentRegistryId]) {
                            const entry = imageRegistry.images[imagePickerTarget.currentRegistryId];
                            if (entry.width && entry.height) {
                              setCropTargetWidth(entry.width);
                              setCropTargetHeight(entry.height);
                            } else {
                              setCropTargetWidth(800);
                              setCropTargetHeight(600);
                            }
                          } else {
                            setCropTargetWidth(800);
                            setCropTargetHeight(600);
                          }
                          setCropPanelOpen(true);
                        }}
                        data-testid="button-crop-resize"
                      >
                        <Image className="h-4 w-4 mr-1.5" />
                        Crop & Resize
                      </Button>
                    )}
                  </div>
                  <div className="flex">
                    <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 bg-muted text-muted-foreground text-xs select-none">
                      Alt
                    </span>
                    <Input
                      value={imagePickerTarget?.currentAlt || ""}
                      onChange={(e) => {
                        if (imagePickerTarget) {
                          setImagePickerTarget({
                            ...imagePickerTarget,
                            currentAlt: e.target.value,
                          });
                        }
                      }}
                      placeholder="Alt text"
                      className="text-sm rounded-l-none"
                      data-testid="input-image-alt"
                    />
                  </div>
                </div>
              </div>

            </div>
          </div>
          <DialogFooter className="flex-row gap-2 sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (imagePickerTarget) {
                  if (nestedUpdateFn) {
                    nestedUpdateFn("");
                    setNestedUpdateFn(null);
                  } else if (imagePickerTarget.fieldPath) {
                    // Simple field - clear the value
                    updateProperty(imagePickerTarget.fieldPath, "");
                  } else if (
                    imagePickerTarget.arrayPath &&
                    imagePickerTarget.index !== undefined
                  ) {
                    if (imagePickerTarget.clearFieldOnly && imagePickerTarget.srcField) {
                      updateArrayItemField(
                        imagePickerTarget.arrayPath,
                        imagePickerTarget.index,
                        imagePickerTarget.srcField,
                        "",
                      );
                    } else {
                      const pathParts = imagePickerTarget.arrayPath.split(".");
                      let current: Record<string, unknown> | null = parsedSection;
                      for (let i = 0; i < pathParts.length - 1 && current; i++) {
                        current = current[pathParts[i]] as Record<
                          string,
                          unknown
                        > | null;
                      }
                      const arrayField = pathParts[pathParts.length - 1];
                      const array =
                        (current?.[arrayField] as Record<string, unknown>[]) ||
                        [];
                      const newArray = [...array];
                      newArray.splice(imagePickerTarget.index, 1);
                      updateArrayField(imagePickerTarget.arrayPath, newArray);
                    }
                  }
                }
                setImagePickerOpen(false);
                setImagePickerTarget(null);
              }}
              data-testid="button-image-remove"
            >
              <X className="h-4 w-4 mr-2" />
              Remove
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setImagePickerOpen(false);
                  setImagePickerTarget(null);
                }}
                data-testid="button-image-cancel"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (imagePickerTarget) {
                    if (nestedUpdateFn) {
                      nestedUpdateFn(imagePickerTarget.currentSrc);
                      setNestedUpdateFn(null);
                    } else if (imagePickerTarget.fieldPath) {
                      updateProperty(
                        imagePickerTarget.fieldPath,
                        imagePickerTarget.currentSrc,
                      );
                    } else if (
                      imagePickerTarget.arrayPath !== undefined &&
                      imagePickerTarget.index !== undefined &&
                      imagePickerTarget.srcField
                    ) {
                      const updates: Record<string, string> = {
                        [imagePickerTarget.srcField]:
                          imagePickerTarget.currentSrc,
                        alt: imagePickerTarget.currentAlt,
                      };
                      if (imagePickerTarget.currentRegistryId) {
                        updates.id =
                          imagePickerTarget.currentRegistryId.replace(
                            /_/g,
                            "-",
                          );
                      }
                      updateArrayItemFields(
                        imagePickerTarget.arrayPath,
                        imagePickerTarget.index,
                        updates,
                      );
                    } else if (imagePickerTarget._fromImageClick && (imagePickerTarget._oldRegistryId || imagePickerTarget._oldSrc)) {
                      // YAML-level string replace fallback: no fieldPath or arrayPath provided.
                      // Type-preserving substitution:
                      //   - old registry ID occurrences -> new registry ID
                      //   - old src URL occurrences -> new src URL
                      const newRegistryId = imagePickerTarget.currentRegistryId;
                      const newSrc = newRegistryId
                        ? (imageRegistry?.images?.[newRegistryId]?.src || imagePickerTarget.currentSrc)
                        : imagePickerTarget.currentSrc;

                      // Build pairs: [oldValue, newValue] for each type
                      const replacementPairs: Array<[string, string]> = [];
                      if (imagePickerTarget._oldRegistryId && newRegistryId && imagePickerTarget._oldRegistryId !== newRegistryId) {
                        replacementPairs.push([imagePickerTarget._oldRegistryId, newRegistryId]);
                      }
                      if (imagePickerTarget._oldSrc && newSrc && imagePickerTarget._oldSrc !== newSrc) {
                        // Only replace src if it differs from the registry ID replacement (avoid double-replacement)
                        const alreadyHandled = replacementPairs.some(([old]) => old === imagePickerTarget._oldSrc);
                        if (!alreadyHandled) {
                          replacementPairs.push([imagePickerTarget._oldSrc, newSrc]);
                        }
                      }

                      if (replacementPairs.length > 0) {
                        let newYaml = yamlContent;
                        for (const [oldVal, newVal] of replacementPairs) {
                          const escaped = oldVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                          newYaml = newYaml.replace(new RegExp(escaped, 'g'), newVal);
                        }
                        if (newYaml !== yamlContent) {
                          pushUndoState(yamlContent);
                          setYamlContent(newYaml);
                          setHasChanges(true);
                          try {
                            const parsed = safeYamlLoad(newYaml) as Section;
                            if (parsed && onPreviewChange) onPreviewChange(parsed);
                          } catch (_err) { /* ignore parse errors */ }
                        }
                      }
                    }

                    if (imagePickerTarget.currentRegistryId) {
                      const classifyId = imagePickerTarget.currentRegistryId;
                      const classifyContext = imagePickerTarget.tagFilter
                        ? { tagFilter: imagePickerTarget.tagFilter }
                        : undefined;
                      fetch(`/api/media/classify/${encodeURIComponent(classifyId)}`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ context: classifyContext }),
                      })
                        .then((r) => {
                          if (!r.ok) {
                            console.warn(`[ImageClassify] ${classifyId}: HTTP ${r.status}`);
                            return null;
                          }
                          return r.json();
                        })
                        .then((data) => {
                          if (data?.added && data.added.length > 0) {
                            toast({
                              title: "Tags added",
                              description: `Added ${data.added.length} tag(s): ${data.added.join(", ")}`,
                            });
                          }
                        })
                        .catch((err) => {
                          console.warn(`[ImageClassify] ${classifyId}:`, err);
                        });
                    }
                  }
                  setImagePickerOpen(false);
                  setImagePickerTarget(null);
                }}
                data-testid="button-image-save"
              >
                <Check className="h-4 w-4 mr-2" />
                Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Crop & Resize Modal */}
      <Dialog
        open={cropPanelOpen}
        onOpenChange={(open) => {
          setCropPanelOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Crop & Resize</DialogTitle>
            <DialogDescription>Select a crop area and set target dimensions to create a new optimized image.</DialogDescription>
          </DialogHeader>
          {imagePickerTarget?.currentRegistryId && (() => {
            const regId = imagePickerTarget.currentRegistryId;
            const imgEntry = imageRegistry?.images?.[regId];
            const imgSrc = imgEntry?.src || imagePickerTarget.currentSrc;
            return (
              <div className="flex-1 overflow-y-auto space-y-4 py-2">
                <div className="flex justify-center">
                  <ReactCrop
                    crop={cropState}
                    onChange={(_, percentCrop) => {
                      setCropState(percentCrop);
                    }}
                    aspect={cropAspectLock && cropTargetWidth > 0 && cropTargetHeight > 0 ? cropTargetWidth / cropTargetHeight : undefined}
                  >
                    <img
                      src={imgSrc}
                      alt="Crop source"
                      className="max-w-full max-h-80"
                      data-testid="crop-source-image"
                    />
                  </ReactCrop>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Target Width (px)</label>
                    <Input
                      type="number"
                      min={1}
                      value={cropTargetWidth}
                      onChange={(e) => {
                        const w = parseInt(e.target.value, 10) || 1;
                        setCropTargetWidth(w);
                      }}
                      className="text-sm"
                      data-testid="input-crop-width"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Target Height (px)</label>
                    <Input
                      type="number"
                      min={1}
                      value={cropTargetHeight}
                      onChange={(e) => {
                        const h = parseInt(e.target.value, 10) || 1;
                        setCropTargetHeight(h);
                      }}
                      className="text-sm"
                      data-testid="input-crop-height"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Switch
                    checked={cropAspectLock}
                    onCheckedChange={setCropAspectLock}
                    id="crop-aspect-lock"
                    data-testid="toggle-crop-aspect-lock"
                  />
                  <label htmlFor="crop-aspect-lock" className="text-sm cursor-pointer">
                    Lock aspect ratio
                  </label>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground">Quality</label>
                    <span className="text-xs text-muted-foreground" data-testid="text-crop-quality">{cropQuality}%</span>
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
                </div>
              </div>
            );
          })()}
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
              onClick={async () => {
                if (!imagePickerTarget?.currentRegistryId) return;
                const cX = (cropState.x ?? 0) / 100;
                const cY = (cropState.y ?? 0) / 100;
                const cW = (cropState.width ?? 100) / 100;
                const cH = (cropState.height ?? 100) / 100;
                setCropProcessing(true);
                try {
                  const resp = await fetch("/api/media/crop-resize", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      imageId: imagePickerTarget.currentRegistryId,
                      crop: { x: cX, y: cY, width: cW, height: cH },
                      targetWidth: cropTargetWidth,
                      targetHeight: cropTargetHeight,
                      quality: cropQuality,
                    }),
                  });
                  const contentType = resp.headers.get("content-type") || "";
                  if (!contentType.includes("application/json")) {
                    throw new Error(`Server returned an unexpected response (${resp.status}). Please try again or check the server logs.`);
                  }
                  if (!resp.ok) {
                    const data = await resp.json();
                    throw new Error(data.error || "Processing failed");
                  }
                  const result = await resp.json() as { id: string; src: string; width: number; height: number };
                  const fieldName = imagePickerTarget.srcField || imagePickerTarget.fieldPath || "";
                  const isIdField = fieldName.endsWith("_id");
                  setImagePickerTarget({
                    ...imagePickerTarget,
                    currentSrc: isIdField ? result.id : result.src,
                    currentRegistryId: result.id,
                  });
                  setCropPanelOpen(false);
                  refetchRegistry();
                  toast({ title: "Image processed", description: `Saved as ${result.width}×${result.height} WebP` });
                } catch (err: any) {
                  toast({ title: "Processing failed", description: err.message || "Unknown error", variant: "destructive" });
                } finally {
                  setCropProcessing(false);
                }
              }}
              data-testid="button-crop-process"
            >
              {cropProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Process & Use
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Section Binding Dialog */}
      {contentType && slug && locale && (
        <SectionBindingDialog
          open={bindingDialogOpen}
          onOpenChange={setBindingDialogOpen}
          contentType={contentType}
          slug={slug}
          sectionIndex={sectionIndex}
          component={sectionComponentType}
          locale={locale}
          existingGroup={bindingGroup}
          onBindingChanged={() => refetchBinding()}
        />
      )}

      <ReplaceBindingModal
        open={replaceBindingOpen}
        onOpenChange={(open) => {
          setReplaceBindingOpen(open);
          if (!open) setPendingReplaceBinding(null);
        }}
        expression={pendingReplaceBinding?.span.expr ?? ""}
        fieldPath={pendingReplaceBinding?.fieldPath}
        suggestedDefault={pendingReplaceBinding?.suggestedDefault ?? ""}
        isMixedString={pendingReplaceBinding?.isMixedString ?? false}
        isSharedTemplate={!!isSharedTemplate}
        onConfirm={handleConfirmReplaceBinding}
      />

      <BindingConfirmDialog
        open={bindingConfirmOpen}
        onOpenChange={setBindingConfirmOpen}
        boundSiblings={boundSiblings}
        onConfirm={executeSave}
        confirmLabel="Save to all"
        confirmIcon={<Save className="h-4 w-4 mr-2" />}
      />

      {/* Component Example Dialog */}
      <Dialog open={exampleDialogOpen} onOpenChange={setExampleDialogOpen}>
        <DialogContent className="max-w-3xl h-[80vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-5 pt-5 pb-3 shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <IconFileCode className="h-4 w-4 shrink-0" />
              {sectionType}{currentVariantForExample && currentVariantForExample !== "default" ? ` — ${currentVariantForExample}` : ""} — Code example
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {componentExamples.length === 0 && !examplesLoading
                ? "No examples found for this component type."
                : "Use this example as a guide on how to fill the component YML"}
            </DialogDescription>
          </DialogHeader>

          {/* CodeMirror viewer */}
          <div className="flex-1 min-h-0 relative">
            {examplesLoading ? (
              <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading example…</span>
              </div>
            ) : componentExamples.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <span className="text-sm">No examples registered for <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">{sectionType}</code></span>
              </div>
            ) : (() => {
              const ex = componentExamples[Math.max(0, bestExampleIdx)];
              return (
                <>
                  {ex.description && (
                    <p className="px-4 py-2 text-xs text-muted-foreground border-b bg-muted/30 shrink-0">{ex.description}</p>
                  )}
                  <div className="absolute inset-0 top-0">
                    <CodeMirror
                      value={ex.yaml}
                      height="100%"
                      extensions={[yaml()]}
                      theme={oneDark}
                      editable={false}
                      basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false }}
                      className="h-full [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto"
                    />
                  </div>
                </>
              );
            })()}
          </div>

          {/* Footer with copy button */}
          {componentExamples.length > 0 && !examplesLoading && (
            <div className="px-5 py-3 border-t shrink-0 flex items-center justify-end gap-3">
              {(() => {
                const ex = componentExamples[Math.max(0, bestExampleIdx)];
                return (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(ex?.yaml ?? "").then(() => {
                        setExampleCopied(true);
                        setTimeout(() => setExampleCopied(false), 2000);
                      });
                    }}
                    data-testid="button-copy-example"
                    className="shrink-0 gap-1.5"
                  >
                    {exampleCopied ? <Check className="h-3.5 w-3.5" /> : <IconFileCode className="h-3.5 w-3.5" />}
                    {exampleCopied ? "Copied!" : "Copy YAML"}
                  </Button>
                );
              })()}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={templateSaveConfirmOpen}
        onOpenChange={(o) => {
          if (!o && !isSaving) {
            setTemplateSaveConfirmOpen(false);
            setPendingClearedTemplatePaths([]);
            setPendingUnboundTemplateDetails([]);
          }
        }}
      >
        <DialogContent className="sm:max-w-md" data-testid="dialog-template-save-confirm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Update shared template?
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  This page is attached to the shared template
                  {contentType ? (
                    <>
                      {" "}for the content type <strong className="text-foreground">{contentType.replace(/_/g, " ")}</strong>
                    </>
                  ) : null}
                  . Saving will update{" "}
                  <code className="text-xs">single.{locale ?? "en"}.yml</code> and apply these changes to all
                  attached {contentType ? contentType.replace(/_/g, " ") : "content type"} entries.
                </p>
                <p>
                  This page uses a shared layout file (
                  <code className="text-xs">single.{locale ?? "en"}.yml</code>
                  ). Saving replaces live per-post data with fixed text for{" "}
                  <strong className="text-foreground">every</strong> page attached to this layout in
                  this language—not only the page you are viewing. To change one page only, detach
                  from the shared template or use a per-entry save when available.
                </p>
                <p>
                  If you only want this change on this item, detach it from the shared template first,
                  then edit again.
                </p>
                {pendingUnboundTemplateDetails.length > 0 && (
                  <div
                    className="rounded-md border border-blue-500/40 bg-blue-500/10 p-3 space-y-2 text-foreground"
                    data-testid="unbound-template-bindings-notice"
                  >
                    <p className="font-medium text-sm">
                      Replacing template bindings with static text
                    </p>
                    <p className="text-xs text-muted-foreground">
                      These fields keep their YAML key but stop pulling from entry data. Sibling
                      locales are not updated.
                    </p>
                    <ul className="list-none pl-0 text-xs font-mono space-y-1">
                      {pendingUnboundTemplateDetails.map(({ path, literal }) => (
                        <li key={path}>
                          {path} → &quot;{literal}&quot;
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {pendingClearedTemplatePaths.length > 0 && (
                  <div
                    className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-2 text-foreground"
                    data-testid="cleared-template-bindings-notice"
                  >
                    <p className="font-medium text-sm">
                      Removing template bindings
                    </p>
                    <p className="text-xs text-muted-foreground">
                      These <code className="text-[11px]">{"{{ single.* }}"}</code> fields will be
                      removed from this locale&apos;s{" "}
                      <code className="text-[11px]">single.{locale ?? "en"}.yml</code> only
                      (sibling locales are not updated). Other bindings stay protected.
                    </p>
                    <ul className="list-disc pl-4 text-xs font-mono space-y-0.5">
                      {pendingClearedTemplatePaths.map((path) => (
                        <li key={path}>{path}</li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted-foreground">
                      Does not delete entry database images, OG images, or media registry assets.
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Advanced: placeholder restore is{" "}
                      <code className="text-[10px]">restoreTemplatePlaceholders</code> in{" "}
                      <code className="text-[10px]">server/content-editor.ts</code>.
                    </p>
                  </div>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => {
                setTemplateSaveConfirmOpen(false);
                setPendingClearedTemplatePaths([]);
                setPendingUnboundTemplateDetails([]);
              }}
              disabled={isSaving}
              data-testid="button-template-save-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={() => void proceedAfterSharedTemplateConfirm()}
              disabled={isSaving}
              data-testid="button-template-save-confirm"
            >
              Update shared template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={scopeDialogOpen} onOpenChange={(o) => { if (!o && !isSaving) setScopeDialogOpen(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Save section — choose scope
            </DialogTitle>
            <DialogDescription>
              This section comes from the shared template. How should the change be saved?
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            {allowEntryStructuralOverrides && (
            <Button
              variant="outline"
              className="w-full justify-start gap-3 h-auto py-3 px-4"
              onClick={savePerEntryOnly}
              disabled={isSaving}
              data-testid="button-save-scope-entry-only"
            >
              <div className="flex flex-col items-start gap-0.5 text-left whitespace-normal">
                <span className="font-medium">Save for this entry only</span>
                <span className="text-xs text-muted-foreground">Overrides this section just for the current entry. Other entries remain unchanged.</span>
              </div>
            </Button>
            )}
            <Button
              variant="outline"
              className="w-full justify-start gap-3 h-auto py-3 px-4"
              onClick={async () => {
                setScopeDialogOpen(false);
                const cleared = computeClearedTemplatePaths();
                const unbound = computeUnboundTemplateDetails();
                if (cleared.length > 0 || unbound.length > 0) {
                  setPendingClearedTemplatePaths(cleared);
                  setPendingUnboundTemplateDetails(unbound);
                  setTemplateSaveConfirmOpen(true);
                  return;
                }
                setPendingClearedTemplatePaths([]);
                setPendingUnboundTemplateDetails([]);
                if (boundSiblings.length > 0) {
                  setBindingConfirmOpen(true);
                } else {
                  await executeSave();
                }
              }}
              disabled={isSaving}
              data-testid="button-save-scope-shared-template"
            >
              <div className="flex flex-col items-start gap-0.5 text-left whitespace-normal">
                <span className="font-medium">Update shared template</span>
                <span className="text-xs text-muted-foreground">Applies the change to the shared template — affects all entries of this content type.</span>
              </div>
            </Button>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setScopeDialogOpen(false)} disabled={isSaving} data-testid="button-save-scope-cancel">
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
