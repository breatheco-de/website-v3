import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import { AlertTriangle, ArrowDown, ArrowLeftRight, ArrowUp, Check, ChevronLeft, ChevronRight, Clock3, Code, Copy, Eye, History, Link, Loader2, Monitor, MoreVertical, Pencil, Smartphone, Space, Sparkles, Trash2, Unlink, X } from "lucide-react";
import { IconPin, IconEdit, IconArrowBackUp, IconPencil, IconChevronDown } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import type { Section, SectionLayout, ShowOn, ResponsiveSpacing } from "@shared/schema";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEditModeOptional } from "@/contexts/EditModeContext";
import { getLocationBySlug } from "@/lib/locations";
import { usePageHistoryOptional } from "@/contexts/PageHistoryContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DbTemplateWarningDialog } from "@/components/editing/DbTemplateWarningDialog";
import {
  WorkLabelModal,
  normalizeWorkLabel,
  type WorkLabel,
} from "@/components/editing/WorkLabelModal";
import { getDebugToken, resolveAuthorName, resolveStaffId, getDebugStaffId } from "@/hooks/useDebugAuth";
import { useContentTypes, useContentTypesRaw, getFolderFromType } from "@/hooks/useContentTypes";
import { useToast } from "@/hooks/use-toast";
import { emitContentUpdated, emitEditStarted } from "@/lib/contentEvents";
import { renderSection } from "@/components/SectionRenderer";
import { SectionContextProvider } from "@/contexts/SectionContext";
import yaml from "js-yaml";
import { escapeTemplateVars, unescapeObjectVars } from "@shared/templateVars";
import { canonicalSectionId } from "@shared/sectionIdentity";
import * as CountryFlags from "country-flag-icons/react/3x2";

/** Matches server HIDDEN_LOCATION_SENTINEL — section hidden from public until label is cleared. */
const HIDDEN_LOCATION_SENTINEL = "__none__";

function isHiddenViaSentinel(section: Record<string, unknown>): boolean {
  const locs = section.showOnLocations;
  return Array.isArray(locs) && locs.length === 1 && locs[0] === HIDDEN_LOCATION_SENTINEL;
}

const LazyYamlEditor = lazy(() => import("./YamlEditor"));

function deslugify(str: string): string {
  return str
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function collectImageIds(obj: unknown, ids: string[] = []): string[] {
  if (!obj || typeof obj !== "object") return ids;
  if (Array.isArray(obj)) {
    for (const item of obj) collectImageIds(item, ids);
    return ids;
  }
  const record = obj as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if ((key === "image_id" || key.endsWith("_image_id")) && typeof value === "string" && value.trim()) {
      ids.push(value.trim());
    } else {
      collectImageIds(value, ids);
    }
  }
  return ids;
}

function CountryFlag({ code, className = "h-3 w-4 rounded-[1px]" }: { code: string; className?: string }) {
  const FlagComponent = (CountryFlags as Record<string, React.ComponentType<{ className?: string }>>)[code.toUpperCase()];
  if (!FlagComponent) return null;
  return <FlagComponent className={className} />;
}

function getUniqueCountryCodes(locationSlugs: string[]): string[] {
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const slug of locationSlugs) {
    const loc = getLocationBySlug(slug);
    if (loc && !seen.has(loc.country_code)) {
      seen.add(loc.country_code);
      codes.push(loc.country_code);
    }
  }
  return codes;
}

const SectionEditorPanel = lazy(() => 
  import("./SectionEditorPanel").then(mod => ({ default: mod.SectionEditorPanel }))
);

const SectionBindingDialog = lazy(() =>
  import("./SectionBindingDialog").then(mod => ({ default: mod.SectionBindingDialog }))
);

const BindingConfirmDialog = lazy(() =>
  import("./BindingConfirmDialog").then(mod => ({ default: mod.BindingConfirmDialog }))
);

const X_SPACING_PRESETS = [
  { label: "None", value: "none" },
  { label: "S", value: "sm" },
  { label: "M", value: "md" },
  { label: "L", value: "lg" },
  { label: "XL", value: "xl" },
];

const MAX_WIDTH_PRESETS = [
  { label: "None", value: "none" },
  { label: "SM", value: "sm" },
  { label: "MD", value: "md" },
  { label: "LG", value: "lg" },
  { label: "XL", value: "xl" },
  { label: "2XL", value: "2xl" },
  { label: "Full", value: "full" },
];

interface MaxWidthValues {
  mobile: string;
  desktop: string;
}

function parseMaxWidth(value: ResponsiveSpacing | undefined): MaxWidthValues {
  if (!value) return { mobile: "none", desktop: "none" };
  const desktop = value.desktop ?? value.mobile ?? "none";
  const mobile = value.mobile ? value.mobile : "none";
  return { mobile, desktop };
}

function toMaxWidthResponsiveSpacing(values: MaxWidthValues): ResponsiveSpacing {
  if (values.mobile === "none") {
    return { desktop: values.desktop };
  }
  return { mobile: values.mobile, desktop: values.desktop };
}

type XBreakpoint = "mobile" | "desktop";

interface ContentTypeXDefaults {
  paddingX?: ResponsiveSpacing;
  marginX?: ResponsiveSpacing;
  maxWidth?: ResponsiveSpacing;
}

/** Value for one breakpoint from a ResponsiveSpacing default; null if not set for that bp. */
function getDefaultTokenForBreakpoint(
  value: ResponsiveSpacing | undefined,
  breakpoint: XBreakpoint,
): string | null {
  if (!value || typeof value !== "object") return null;
  if (breakpoint === "mobile") {
    return typeof value.mobile === "string" && value.mobile.trim() ? value.mobile : null;
  }
  if (typeof value.desktop === "string" && value.desktop.trim()) return value.desktop;
  if (typeof value.mobile === "string" && value.mobile.trim()) return value.mobile;
  return null;
}

interface XSpacingValues {
  mobile: { left: string; right: string };
  desktop: { left: string; right: string };
}

function parseLR(value: string | undefined): { left: string; right: string } {
  if (!value || value === "none") return { left: "none", right: "none" };
  const parts = value.trim().split(/\s+/);
  if (parts.length === 1) return { left: parts[0], right: parts[0] };
  return { left: parts[0], right: parts[1] || parts[0] };
}

function combineLR(left: string, right: string): string {
  const l = left || "none";
  const r = right || "none";
  if (l === r) return l;
  return `${l} ${r}`;
}

function parseXSpacing(value: ResponsiveSpacing | undefined): XSpacingValues {
  if (!value) {
    return { mobile: { left: "none", right: "none" }, desktop: { left: "none", right: "none" } };
  }
  const desktopValue = value.desktop ?? value.mobile ?? "none";
  const desktopParsed = parseLR(desktopValue);
  const mobileParsed = value.mobile ? parseLR(value.mobile) : { left: "none", right: "none" };
  return { mobile: mobileParsed, desktop: desktopParsed };
}

function getXEffective(values: XSpacingValues, breakpoint: XBreakpoint, pos: "left" | "right"): string {
  if (breakpoint === "mobile") return values.mobile[pos];
  return values.desktop[pos];
}

async function updateSectionXField(
  contentType: string,
  slug: string,
  locale: string,
  sectionIndex: number,
  field: string,
  value: ResponsiveSpacing,
  variant?: string,
  version?: number
): Promise<{ success: boolean; error?: string }> {
  const token = getDebugToken();
  const author = await resolveAuthorName();
  const response = await fetch("/api/content/edit-sections", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Token ${token}` } : {}),
    },
    body: JSON.stringify({
      contentType,
      slug,
      locale,
      author,
      ...(variant ? { variant } : {}),
      ...(version !== undefined ? { version } : {}),
      operations: [{ action: "update_field", path: `sections.${sectionIndex}.${field}`, value }],
    }),
  });
  return response.json();
}

function XSpacingPresetButtons({
  value,
  onChange,
  testId,
  defaultValues,
}: {
  value: string;
  onChange: (value: string) => void;
  testId: string;
  /** Preset values marked as content-type defaults (amber dot). */
  defaultValues?: string[];
}) {
  const defaults = defaultValues ?? [];
  return (
    <div className="flex items-center gap-1">
      {X_SPACING_PRESETS.map((preset) => {
        const isDefault = defaults.includes(preset.value);
        return (
          <Button
            key={preset.value}
            variant={value === preset.value ? "default" : "outline"}
            size="sm"
            className="relative"
            onClick={() => onChange(preset.value)}
            data-testid={`x-spacing-preset-${testId}-${preset.value}`}
            title={isDefault ? "Content-type default (_common.template.yml)" : undefined}
          >
            {isDefault ? (
              <span
                className="absolute -top-0.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-amber-500 ring-1 ring-background"
                aria-hidden
              />
            ) : null}
            {preset.label}
          </Button>
        );
      })}
    </div>
  );
}

function XSpacingGroup({
  label,
  leftValue,
  rightValue,
  linked,
  onChangeLeft,
  onChangeRight,
  onChangeBoth,
  onToggleLink,
  testIdPrefix,
  defaultLeft,
  defaultRight,
}: {
  label: string;
  leftValue: string;
  rightValue: string;
  linked: boolean;
  onChangeLeft: (v: string) => void;
  onChangeRight: (v: string) => void;
  onChangeBoth: (v: string) => void;
  onToggleLink: () => void;
  testIdPrefix: string;
  defaultLeft?: string | null;
  defaultRight?: string | null;
}) {
  const linkedDefaults = [
    ...new Set([defaultLeft, defaultRight].filter((v): v is string => !!v)),
  ];
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleLink}
              data-testid={`${testIdPrefix}-link-toggle`}
            >
              {linked ? <Link className="h-3.5 w-3.5" /> : <Unlink className="h-3.5 w-3.5 text-muted-foreground" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="text-xs">{linked ? "Left & right synced — click to set independently" : "Left & right independent — click to sync"}</p>
          </TooltipContent>
        </Tooltip>
      </div>
      {linked ? (
        <XSpacingPresetButtons
          value={leftValue}
          onChange={onChangeBoth}
          testId={`${testIdPrefix}-both`}
          defaultValues={linkedDefaults}
        />
      ) : (
        <div className="space-y-1.5">
          <div>
            <Label className="text-xs text-muted-foreground">Left</Label>
            <XSpacingPresetButtons
              value={leftValue}
              onChange={onChangeLeft}
              testId={`${testIdPrefix}-left`}
              defaultValues={defaultLeft ? [defaultLeft] : undefined}
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Right</Label>
            <XSpacingPresetButtons
              value={rightValue}
              onChange={onChangeRight}
              testId={`${testIdPrefix}-right`}
              defaultValues={defaultRight ? [defaultRight] : undefined}
            />
          </div>
        </div>
      )}
    </div>
  );
}

interface EditableSectionProps {
  children: React.ReactNode;
  section: Section;
  index: number;
  sectionType: string;
  contentType?: string;
  slug?: string;
  locale?: string;
  variant?: string;
  version?: number;
  totalSections?: number;
  allSections?: Section[];
  isSharedTemplate?: boolean;
  singleEntry?: Record<string, unknown>;
  allowEntryStructuralOverrides?: boolean;
  onMoveUp?: (index: number) => void;
  onMoveDown?: (index: number) => void;
  onDelete?: (index: number) => void;
  onDuplicate?: (index: number) => void;
}

function parseAutoSyncAuthor(subject: string): string | null {
  const m = subject.match(/^\[Auto-sync\] (.+?) updated /);
  return m ? m[1] : null;
}

/** Returns a singular human-readable noun for a content type, e.g. "course" from "Courses". */
function getSingularLabel(ct: string | undefined, rawTypes: import("@/hooks/useContentTypes").ContentTypeApiItem[] | undefined): string {
  if (!ct) return "entry";
  const found = rawTypes?.find((t) => t.name === ct);
  const label = found?.label ?? ct.replace(/_/g, " ");
  const lower = label.toLowerCase();
  if (lower.endsWith("ies")) return lower.slice(0, -3) + "y"; // categories → category
  if (lower.endsWith("ses") || lower.endsWith("xes") || lower.endsWith("zes")) return lower.slice(0, -2); // classes → class
  if (lower.endsWith("s") && lower.length > 2) return lower.slice(0, -1); // courses → course
  return lower;
}

export function EditableSection({ children, section, index, sectionType, contentType, slug, locale, variant, version, totalSections = 0, allSections, isSharedTemplate, singleEntry, allowEntryStructuralOverrides = true, onMoveUp, onMoveDown, onDelete, onDuplicate }: EditableSectionProps) {
  const editMode = useEditModeOptional();
  const pageHistory = usePageHistoryOptional();
  const { toast } = useToast();
  const contentTypesMap = useContentTypes();
  const { data: rawContentTypes } = useContentTypesRaw();
  const singularLabel = getSingularLabel(contentType, rawContentTypes);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [currentSection, setCurrentSection] = useState<Section>(section);
  const [wasLocallyUpdated, setWasLocallyUpdated] = useState(false);
  
  // Sync currentSection when the prop changes (e.g., after refetch or slug navigation)
  useEffect(() => {
    setCurrentSection(section);
    setWasLocallyUpdated(false);
  }, [section, slug]);
  
  const canMoveUp = index > 0;
  const canMoveDown = totalSections > 0 && index < totalSections - 1;
  
  // Swap popover state
  const [swapPopoverOpen, setSwapPopoverOpen] = useState(false);
  const [versions, setVersions] = useState<string[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string>("");
  const [variants, setVariants] = useState<string[]>([]); // Unique variant slugs from examples
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);
  const [selectedExampleIndex, setSelectedExampleIndex] = useState(0); // Index within current variant's examples
  const [examplesWithVariants, setExamplesWithVariants] = useState<{filename: string, variant: string, name: string, yaml: string}[]>([]);
  const [previewSection, setPreviewSection] = useState<Section | null>(null);
  const [isLoadingSwap, setIsLoadingSwap] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [showVersionPicker, setShowVersionPicker] = useState(false);
  
  // AI adaptation state
  const [isAdapting, setIsAdapting] = useState(false);
  const [adaptedSection, setAdaptedSection] = useState<Section | null>(null);
  const [hasAdapted, setHasAdapted] = useState(false);
  
  // X-spacing popover state
  const [xSpacingOpen, setXSpacingOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [xSpacingBreakpoint, setXSpacingBreakpoint] = useState<XBreakpoint>("desktop");
  const [xPadding, setXPadding] = useState<XSpacingValues>(() => parseXSpacing((section as SectionLayout).paddingX));
  const [xMargin, setXMargin] = useState<XSpacingValues>(() => parseXSpacing((section as SectionLayout).marginX));
  const [xMaxWidth, setXMaxWidth] = useState<MaxWidthValues>(() => parseMaxWidth((section as SectionLayout).maxWidth));
  const [xSaving, setXSaving] = useState(false);
  const [padLinked, setPadLinked] = useState(() => {
    const p = parseXSpacing((section as SectionLayout).paddingX);
    return p.desktop.left === p.desktop.right;
  });
  const [marLinked, setMarLinked] = useState(() => {
    const m = parseXSpacing((section as SectionLayout).marginX);
    return m.desktop.left === m.desktop.right;
  });

  // Per-entry patch reset state
  const [resetPatchOpen, setResetPatchOpen] = useState(false);
  const [isResettingPatch, setIsResettingPatch] = useState(false);

  // Work label (_label) modal
  const [workLabelOpen, setWorkLabelOpen] = useState(false);
  const [workLabelEditing, setWorkLabelEditing] = useState<WorkLabel | null>(null);
  const [workLabelStaffId, setWorkLabelStaffId] = useState<string>(getDebugStaffId());

  // DB template structural warning dialog state
  const [swapWarnOpen, setSwapWarnOpen] = useState(false);
  const pendingSwapFn = useRef<(() => Promise<void>) | null>(null);

  // X-spacing default confirmation dialog state
  const [xDefaultConfirmOpen, setXDefaultConfirmOpen] = useState(false);
  const [xDefaultConfirmData, setXDefaultConfirmData] = useState<{
    sectionDefaults: Record<string, unknown>;
    token: string | null;
    changedFields: string[];
  } | null>(null);
  /** Layout defaults from _common.template.yml for the content type (X spacing keys only). */
  const [contentTypeXDefaults, setContentTypeXDefaults] = useState<ContentTypeXDefaults | null>(null);

  // YAML source modal state
  const [showYamlModal, setShowYamlModal] = useState(false);
  
  // Review code modal state (for reviewing AI-adapted content before applying)
  const [showReviewCodeModal, setShowReviewCodeModal] = useState(false);
  const [reviewCodeYaml, setReviewCodeYaml] = useState("");
  const [reviewCodeError, setReviewCodeError] = useState<string | null>(null);

  // Section history (time-travel) state
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<{ sha: string; date: string; author: string; subject: string }[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPreviewSha, setHistoryPreviewSha] = useState<string | null>(null);
  const [historyPreviewSection, setHistoryPreviewSection] = useState<Section | null>(null);
  const [historyPreviewDate, setHistoryPreviewDate] = useState<string | null>(null);
  const [historyPreviewAuthor, setHistoryPreviewAuthor] = useState<string | null>(null);
  const [historyPreviewLoading, setHistoryPreviewLoading] = useState(false);

  const { data: bindingData, refetch: refetchBindingData } = useQuery<{ group: { id: string; members: unknown[] } | null }>({
    queryKey: ["/api/bindings/section", contentType, slug, index, locale],
    queryFn: () => fetch(`/api/bindings/section?contentType=${contentType}&slug=${slug}&sectionIndex=${index}&locale=${locale || ""}`).then(r => r.json()),
    enabled: !!editMode?.isEditMode && !!contentType && !!slug && !isSharedTemplate,
    staleTime: 30_000,
  });
  const isBound = !!bindingData?.group;

  const { data: imageRegistry } = useQuery<{ images: Record<string, unknown> }>({
    queryKey: ["/api/image-registry"],
    staleTime: 60_000,
    enabled: !!editMode?.isEditMode,
  });

  const brokenImageIds = (() => {
    if (!imageRegistry?.images) return [];
    const ids = collectImageIds(section);
    return Array.from(new Set(ids.filter(id => !(id in imageRegistry.images))));
  })();
  const boundSiblingCount = isBound ? (bindingData.group!.members.length - 1) : 0;
  const boundSiblings = (bindingData?.group?.members ?? [])
    .filter((m) => {
      const member = m as { contentType: string; slug: string; sectionIndex: number };
      return !(member.contentType === contentType && member.slug === slug && member.sectionIndex === index);
    }) as { contentType: string; slug: string; sectionIndex: number }[];
  const [bindingDialogOpen, setBindingDialogOpen] = useState(false);
  const [bindingConfirmForAI, setBindingConfirmForAI] = useState(false);
  const [anchorCopied, setAnchorCopied] = useState(false);
  const pendingAIApply = useRef<(() => Promise<void>) | null>(null);

  // Gate any section action behind the first-edit prompt when on a promoted page
  const gatedAction = useCallback((action: () => void): void => {
    emitEditStarted({
      contentType: contentType || "",
      slug: slug || "",
      locale: locale || "en",
      variant: variant || "",
      resume: action,
    });
  }, [contentType, slug, locale, variant]);

  const openBindingDialog = () => {
    gatedAction(() => {
      refetchBindingData();
      setBindingDialogOpen(true);
    });
  };

  const selectedVariant = variants[selectedVariantIndex] || "";
  
  // Get examples for the currently selected variant
  const examplesForCurrentVariant = examplesWithVariants.filter(e => e.variant === selectedVariant);
  
  const currentExample = examplesForCurrentVariant[selectedExampleIndex] || null;

  // Get current section's version from the section object
  const currentSectionVersion = (section as { version?: string }).version || "";
  
  // Ref to track active version for race condition prevention
  const activeVersionRef = useRef<string>("");

  // Fetch versions when popover opens
  useEffect(() => {
    if (!swapPopoverOpen || !sectionType) return;
    setIsLoadingSwap(true);
    const token = getDebugToken();
    fetch(`/api/component-registry/${sectionType}/versions`, {
      headers: token ? { 'X-Debug-Token': token } : {}
    })
      .then(res => res.json())
      .then(data => {
        const vers: string[] = data.versions || [];
        setVersions(vers);
        // Use current section's version if available, otherwise use latest
        if (currentSectionVersion && vers.includes(currentSectionVersion)) {
          setSelectedVersion(currentSectionVersion);
        } else if (vers.length > 0) {
          setSelectedVersion(vers[vers.length - 1]);
        }
      })
      .catch(() => setVersions([]))
      .finally(() => setIsLoadingSwap(false));
  }, [swapPopoverOpen, sectionType, currentSectionVersion]);

  // Fetch examples and extract variants when version changes
  useEffect(() => {
    if (!swapPopoverOpen || !sectionType || !selectedVersion) return;
    
    // Reset state immediately when version changes to prevent stale data
    setExamplesWithVariants([]);
    setVariants([]);
    setPreviewSection(null);
    setIsLoadingSwap(true);
    
    // Track this as the active version request
    const requestedVersion = selectedVersion;
    activeVersionRef.current = requestedVersion;
    
    const token = getDebugToken();
    
    fetch(`/api/component-registry/${sectionType}/${selectedVersion}/examples`, {
      headers: token ? { 'X-Debug-Token': token } : {}
    })
      .then(res => res.json())
      .then((data) => {
        // Bail if a newer version request has started
        if (activeVersionRef.current !== requestedVersion) return;
        
        // API returns examples with variant and yaml properties
        const exs: {name: string, filename?: string, variant?: string, yaml?: string}[] = data.examples || [];
        
        // Map examples to our format - include yaml for parsing
        const examplesData = exs.map(ex => ({
          filename: ex.filename || ex.name?.toLowerCase().replace(/\s+/g, '-') + '.yml',
          variant: ex.variant || "default",
          name: ex.name || "",
          yaml: ex.yaml || ""
        }));
        
        setExamplesWithVariants(examplesData);
        
        // Extract unique variants
        const uniqueVariants = Array.from(new Set(examplesData.map(e => e.variant)));
        setVariants(uniqueVariants);
        
        // Try to select current section's variant, or first available
        const currentVariant = (section as { variant?: string }).variant || "default";
        const currentIdx = uniqueVariants.indexOf(currentVariant);
        setSelectedVariantIndex(currentIdx >= 0 ? currentIdx : 0);
      })
      .catch(() => {
        if (activeVersionRef.current === requestedVersion) {
          setExamplesWithVariants([]);
          setVariants([]);
        }
      })
      .finally(() => {
        if (activeVersionRef.current === requestedVersion) {
          setIsLoadingSwap(false);
        }
      });
  }, [swapPopoverOpen, sectionType, selectedVersion, section]);

  // Reset example index and adaptation state when variant changes
  useEffect(() => {
    setSelectedExampleIndex(0);
    setAdaptedSection(null);
    setHasAdapted(false);
  }, [selectedVariantIndex]);
  
  // Reset adaptation state when example changes
  useEffect(() => {
    setAdaptedSection(null);
    setHasAdapted(false);
  }, [selectedExampleIndex]);

  // Update preview when variant or example changes - parse YAML content locally
  useEffect(() => {
    if (!swapPopoverOpen || !sectionType || !currentExample || !currentExample.yaml) {
      setPreviewSection(null);
      return;
    }
    
    // Parse YAML content locally (escape template vars like {{ }} before parsing)
    try {
      const { escaped, map } = escapeTemplateVars(currentExample.yaml);
      const parsed = unescapeObjectVars(yaml.load(escaped), map);
      // Handle both array format (sections list) and object format (single section)
      let sectionData: Record<string, unknown>;
      if (Array.isArray(parsed) && parsed.length > 0) {
        sectionData = parsed[0] as Record<string, unknown>;
      } else if (parsed && typeof parsed === 'object') {
        sectionData = parsed as Record<string, unknown>;
      } else {
        setPreviewSection(null);
        return;
      }
      setPreviewSection({ type: sectionType, ...sectionData } as Section);
    } catch (err) {
      console.error("Failed to parse example YAML:", err);
      setPreviewSection(null);
    }
  }, [swapPopoverOpen, sectionType, currentExample]);

  // Cycle through variants
  const cycleVariant = (direction: number) => {
    if (variants.length === 0) return;
    setSelectedVariantIndex(prev => {
      let next = prev + direction;
      if (next < 0) next = variants.length - 1;
      if (next >= variants.length) next = 0;
      return next;
    });
  };

  // Cycle through examples within current variant
  const cycleExample = (direction: number) => {
    if (examplesForCurrentVariant.length <= 1) return;
    setSelectedExampleIndex(prev => {
      let next = prev + direction;
      if (next < 0) next = examplesForCurrentVariant.length - 1;
      if (next >= examplesForCurrentVariant.length) next = 0;
      return next;
    });
  };

  // Handle AI adaptation of the selected variant
  const handleAdaptWithAI = async () => {
    if (!currentExample?.yaml || !contentType || !slug || !sectionType) return;
    
    setIsAdapting(true);
    try {
      const token = getDebugToken();
      
      // Map contentType prop format to API format
      const contentTypeMap: Record<string, string> = {
        'program': 'programs',
        'landing': 'landings',
        'location': 'locations',
        'page': 'pages'
      };
      
      const res = await fetch('/api/content/adapt-with-ai', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(token ? { 'X-Debug-Token': token } : {})
        },
        body: JSON.stringify({
          contentType: contentTypeMap[contentType] || contentType,
          contentSlug: slug,
          targetComponent: sectionType,
          targetVersion: selectedVersion || 'v1.0',
          targetVariant: selectedVariant || currentExample.variant || 'default',
          sourceYaml: currentExample.yaml,
          targetExampleYaml: currentExample.yaml // Pass example as reference template for AI
        })
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to adapt content with AI');
      }
      
      const data = await res.json();
      
      // Parse the adapted YAML (escape template vars like {{ }} before parsing)
      const adaptedYaml = data.adaptedYaml || data.yaml;
      if (!adaptedYaml) {
        throw new Error('No adapted content returned');
      }
      
      const { escaped: escapedAdapted, map: adaptedMap } = escapeTemplateVars(adaptedYaml);
      const parsed = unescapeObjectVars(yaml.load(escapedAdapted), adaptedMap);
      let sectionData: Record<string, unknown>;
      if (Array.isArray(parsed) && parsed.length > 0) {
        sectionData = parsed[0] as Record<string, unknown>;
      } else if (parsed && typeof parsed === 'object') {
        sectionData = parsed as Record<string, unknown>;
      } else {
        throw new Error('Invalid adapted content format');
      }
      
      const adapted = { type: sectionType, ...sectionData } as Section;
      setAdaptedSection(adapted);
      setHasAdapted(true);
      toast({ title: "Content adapted", description: "AI has adapted the content. Click 'Review Code' to view, edit, and apply." });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to adapt content';
      toast({ title: "AI Adaptation Error", description: message, variant: "destructive" });
    } finally {
      setIsAdapting(false);
    }
  };

  const executeSwap = async (sectionToSave: Section) => {
    if (!contentType || !slug) return;
    setIsConfirming(true);
    try {
      const token = getDebugToken();
      const author = await resolveAuthorName();
      const res = await fetch('/api/content/edit-sections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'X-Debug-Token': token } : {})
        },
        body: JSON.stringify({
          contentType,
          slug,
          locale: locale || 'en',
          variant: variant || 'default',
          version: version || 1,
          author,
          operations: [{
            action: 'update_section',
            index,
            section: sectionToSave,
            structural: isSharedTemplate ? true : undefined,
          }],
        })
      });
      if (!res.ok) throw new Error('Failed to swap section');
      setCurrentSection(sectionToSave);
      setSwapPopoverOpen(false);
      setAdaptedSection(null);
      setHasAdapted(false);
      emitContentUpdated({ contentType: contentType!, slug: slug!, locale: locale || 'en' });
      toast({ title: "Section swapped", description: "The section variant has been updated." });
    } catch (err) {
      toast({ title: "Error", description: "Failed to swap section variant.", variant: "destructive" });
    } finally {
      setIsConfirming(false);
    }
  };

  const handleConfirmSwap = async () => {
    const sectionToSave = hasAdapted && adaptedSection ? adaptedSection : previewSection;
    if (!sectionToSave || !contentType || !slug) return;

    if (isSharedTemplate) {
      pendingSwapFn.current = () => executeSwap(sectionToSave);
      setSwapWarnOpen(true);
      return;
    }

    await executeSwap(sectionToSave);
  };
  
  // Open review code modal with adapted section YAML
  const handleOpenReviewCode = () => {
    if (!adaptedSection) return;
    // Convert adapted section to YAML for editing
    const { type, ...sectionData } = adaptedSection as Record<string, unknown>;
    const yamlStr = yaml.dump(sectionData, { lineWidth: -1, quotingType: '"', forceQuotes: false });
    setReviewCodeYaml(yamlStr);
    setReviewCodeError(null); // Clear any previous errors
    setShowReviewCodeModal(true);
  };
  
  // Core AI apply logic — parse reviewed YAML and save
  const executeAIApply = async () => {
    if (!contentType || !slug) return;
    setIsConfirming(true);
    setReviewCodeError(null);

    if (pageHistory) {
      pageHistory.saveCurrentSnapshot(`Antes de aplicar adaptación en sección ${index + 1}`);
    }

    try {
      const { escaped: escapedReview, map: reviewMap } = escapeTemplateVars(reviewCodeYaml);
      const parsed = unescapeObjectVars(yaml.load(escapedReview), reviewMap);
      let sectionData: Record<string, unknown>;
      if (Array.isArray(parsed) && parsed.length > 0) {
        sectionData = parsed[0] as Record<string, unknown>;
      } else if (parsed && typeof parsed === 'object') {
        sectionData = parsed as Record<string, unknown>;
      } else {
        throw new Error('Invalid YAML format');
      }

      const sectionToSave = { type: sectionType, ...sectionData } as Section;
      const token = getDebugToken();
      const author = await resolveAuthorName();
      const res = await fetch('/api/content/edit-sections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'X-Debug-Token': token } : {})
        },
        body: JSON.stringify({
          contentType,
          slug,
          locale: locale || 'en',
          variant: variant || 'default',
          version: version || 1,
          author,
          operations: [{
            action: 'update_section',
            index,
            section: sectionToSave,
            structural: isSharedTemplate ? true : undefined,
          }],
        })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        setReviewCodeError(errorData.error || 'Failed to apply section');
        return;
      }

      setCurrentSection(sectionToSave);
      setWasLocallyUpdated(true);
      setShowReviewCodeModal(false);
      setSwapPopoverOpen(false);
      setAdaptedSection(null);
      setHasAdapted(false);
      emitContentUpdated({ contentType: contentType!, slug: slug!, locale: locale || 'en' });
      toast({ title: "Section applied", description: "The reviewed section has been saved." });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to apply section';
      setReviewCodeError(message);
    } finally {
      setIsConfirming(false);
    }
  };

  // Apply changes from the review code modal — gates through DB template warning (if shared), then binding confirm if bound
  const handleApplyReviewedCode = async () => {
    if (!contentType || !slug) return;

    const doApply = async () => {
      if (isBound && boundSiblings.length > 0) {
        pendingAIApply.current = executeAIApply;
        setBindingConfirmForAI(true);
      } else {
        await executeAIApply();
      }
    };

    if (isSharedTemplate) {
      pendingSwapFn.current = doApply;
      setSwapWarnOpen(true);
      return;
    }

    await doApply();
  };
  
  const handleXSpacingOpen = (open: boolean) => {
    setXSpacingOpen(open);
    if (open) {
      const pad = parseXSpacing((currentSection as SectionLayout).paddingX);
      const mar = parseXSpacing((currentSection as SectionLayout).marginX);
      const mw = parseMaxWidth((currentSection as SectionLayout).maxWidth);
      setXPadding(pad);
      setXMargin(mar);
      setXMaxWidth(mw);
      setPadLinked(pad.desktop.left === pad.desktop.right);
      setMarLinked(mar.desktop.left === mar.desktop.right);
      setContentTypeXDefaults(null);
      if (contentType) {
        const token = getDebugToken();
        fetch(`/api/content-type/${contentType}/single-defaults`, {
          headers: token ? { Authorization: `Token ${token}` } : {},
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            const defaults = (data?.defaults ?? {}) as Record<string, unknown>;
            const legacy = (defaults.section_defaults && typeof defaults.section_defaults === "object"
              ? defaults.section_defaults
              : {}) as Record<string, unknown>;
            const next: ContentTypeXDefaults = {};
            const padX = defaults.paddingX ?? legacy.paddingX;
            const marX = defaults.marginX ?? legacy.marginX;
            const mw = defaults.maxWidth ?? legacy.maxWidth;
            if (padX && typeof padX === "object") {
              next.paddingX = padX as ResponsiveSpacing;
            }
            if (marX && typeof marX === "object") {
              next.marginX = marX as ResponsiveSpacing;
            }
            if (mw && typeof mw === "object") {
              next.maxWidth = mw as ResponsiveSpacing;
            }
            if (next.paddingX || next.marginX || next.maxWidth) {
              setContentTypeXDefaults(next);
            } else {
              setContentTypeXDefaults(null);
            }
          })
          .catch(() => setContentTypeXDefaults(null));
      }
    } else {
      setContentTypeXDefaults(null);
    }
  };

  const updateXValue = (
    setter: React.Dispatch<React.SetStateAction<XSpacingValues>>,
    breakpoint: XBreakpoint,
    pos: "left" | "right",
    value: string
  ) => {
    setter(prev => {
      if (breakpoint === "desktop") {
        return { ...prev, desktop: { ...prev.desktop, [pos]: value } };
      }
      return { ...prev, mobile: { ...prev.mobile, [pos]: value } };
    });
  };

  const updateXBoth = (
    setter: React.Dispatch<React.SetStateAction<XSpacingValues>>,
    breakpoint: XBreakpoint,
    value: string
  ) => {
    setter(prev => {
      if (breakpoint === "desktop") {
        return { ...prev, desktop: { left: value, right: value } };
      }
      return { ...prev, mobile: { left: value, right: value } };
    });
  };

  const toXResponsiveSpacing = (values: XSpacingValues): ResponsiveSpacing => {
    const desktopStr = combineLR(values.desktop.left, values.desktop.right);
    const mobileStr = combineLR(values.mobile.left, values.mobile.right);
    if (mobileStr === "none") {
      return { desktop: desktopStr };
    }
    return { mobile: mobileStr, desktop: desktopStr };
  };

  const handleApplyXSpacing = async () => {
    if (!contentType || !slug || !locale) return;
    setXSaving(true);
    try {
      const ops: Promise<{ success: boolean; error?: string }>[] = [];
      const origPadding = parseXSpacing((currentSection as SectionLayout).paddingX);
      const origMargin = parseXSpacing((currentSection as SectionLayout).marginX);
      const origMaxWidth = parseMaxWidth((currentSection as SectionLayout).maxWidth);
      const padChanged = origPadding.desktop.left !== xPadding.desktop.left ||
        origPadding.desktop.right !== xPadding.desktop.right ||
        origPadding.mobile.left !== xPadding.mobile.left ||
        origPadding.mobile.right !== xPadding.mobile.right;
      const marChanged = origMargin.desktop.left !== xMargin.desktop.left ||
        origMargin.desktop.right !== xMargin.desktop.right ||
        origMargin.mobile.left !== xMargin.mobile.left ||
        origMargin.mobile.right !== xMargin.mobile.right;
      const mwChanged = origMaxWidth.desktop !== xMaxWidth.desktop ||
        origMaxWidth.mobile !== xMaxWidth.mobile;
      if (padChanged) ops.push(updateSectionXField(contentType, slug, locale, index, "paddingX", toXResponsiveSpacing(xPadding), variant, version));
      if (marChanged) ops.push(updateSectionXField(contentType, slug, locale, index, "marginX", toXResponsiveSpacing(xMargin), variant, version));
      if (mwChanged) ops.push(updateSectionXField(contentType, slug, locale, index, "maxWidth", toMaxWidthResponsiveSpacing(xMaxWidth), variant, version));
      const results = await Promise.all(ops);
      const failed = results.filter(r => !r.success);
      if (failed.length > 0) {
        toast({ title: "Failed to update X spacing", description: failed[0].error, variant: "destructive" });
      } else if (ops.length > 0) {
        toast({ title: "X spacing updated" });
        emitContentUpdated({ contentType, slug, locale });
        try {
          const token = getDebugToken();
          const defaultsResp = await fetch(`/api/content-type/${contentType}/single-defaults`, {
            headers: token ? { Authorization: `Token ${token}` } : {},
          });
          if (defaultsResp.ok) {
            const { defaults } = await defaultsResp.json();
            const legacy = defaults?.section_defaults;
            const hasPadX = defaults?.paddingX ?? legacy?.paddingX;
            const hasMarX = defaults?.marginX ?? legacy?.marginX;
            const hasMW = defaults?.maxWidth ?? legacy?.maxWidth;
            if (!hasPadX && !hasMarX && !hasMW && (padChanged || marChanged || mwChanged)) {
              const sectionDefaults: Record<string, unknown> = {};
              const changedFields: string[] = [];
              if (padChanged) { sectionDefaults.paddingX = toXResponsiveSpacing(xPadding); changedFields.push("padding"); }
              if (marChanged) { sectionDefaults.marginX = toXResponsiveSpacing(xMargin); changedFields.push("margin"); }
              if (mwChanged) { sectionDefaults.maxWidth = toMaxWidthResponsiveSpacing(xMaxWidth); changedFields.push("max width"); }
              setXDefaultConfirmData({ sectionDefaults, token, changedFields });
              setXDefaultConfirmOpen(true);
            }
          }
        } catch {}
      }
      setXSpacingOpen(false);
    } catch (error) {
      toast({ title: "Error updating X spacing", description: String(error), variant: "destructive" });
    } finally {
      setXSaving(false);
    }
  };

  const handleResetPatch = async () => {
    if (!contentType || !slug || !locale) return;
    const sectionId = canonicalSectionId(section as Record<string, unknown>) ?? null;
    if (!sectionId) return;
    setIsResettingPatch(true);
    try {
      const token = getDebugToken();
      const res = await fetch("/api/per-entry-section-patch-reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Token ${token}` } : {}),
        },
        body: JSON.stringify({ contentType, slug, locale, sectionId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to reset section");
      }
      setResetPatchOpen(false);
      emitContentUpdated({ contentType: contentType!, slug: slug!, locale: locale! });
      toast({ title: "Section reset", description: "Section is now showing shared template content." });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to reset section", variant: "destructive" });
    } finally {
      setIsResettingPatch(false);
    }
  };

  // Auto-open when the user just created a variant and navigated here
  useEffect(() => {
    if (typeof sessionStorage === "undefined") return;
    const raw = sessionStorage.getItem("firstEdit_autoOpen");
    if (!raw) return;
    try {
      const { sectionIndex: savedIndex } = JSON.parse(raw);
      if (savedIndex === index) {
        sessionStorage.removeItem("firstEdit_autoOpen");
        setIsEditorOpen(true);
      }
    } catch {
      sessionStorage.removeItem("firstEdit_autoOpen");
    }
  }, [index]);

  const handleOpenEditor = (e: React.MouseEvent) => {
    e.stopPropagation();
    emitEditStarted({
      contentType: contentType || "",
      slug: slug || "",
      locale: locale || "en",
      sectionIndex: index,
      variant: variant || "",
      resume: () => setIsEditorOpen(true),
    });
  };
  
  const handleCloseEditor = () => {
    setIsEditorOpen(false);
  };

  // Floating components (e.g. contact_bubble) render outside the section's
  // in-flow slot, so their own edit buttons request the editor via this event.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ sectionIndex?: number }>).detail;
      if (!detail || detail.sectionIndex !== index) return;
      emitEditStarted({
        contentType: contentType || "",
        slug: slug || "",
        locale: locale || "en",
        sectionIndex: index,
        variant: variant || "",
        resume: () => setIsEditorOpen(true),
      });
    };
    window.addEventListener("contact-bubble:edit", handler);
    return () => window.removeEventListener("contact-bubble:edit", handler);
  }, [index, contentType, slug, locale, variant]);

  const handleXDefaultConfirm = async () => {
    if (!xDefaultConfirmData || !contentType) return;
    try {
      await fetch(`/api/content-type/${contentType}/single-defaults`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(xDefaultConfirmData.token ? { Authorization: `Token ${xDefaultConfirmData.token}` } : {}),
        },
        body: JSON.stringify(xDefaultConfirmData.sectionDefaults),
      });
      toast({ title: "Default X spacing saved for content type" });
    } catch {}
    setXDefaultConfirmOpen(false);
    setXDefaultConfirmData(null);
  };

  const handleUpdate = (updatedSection: Section) => {
    setCurrentSection(updatedSection);
    setWasLocallyUpdated(true);
  };

  const sectionWorkLabel = normalizeWorkLabel(
    ((currentSection as Section & { _label?: Record<string, unknown> })._label ??
      {}) as {
      needs?: string;
      note?: string;
      requester?: unknown;
      owner?: unknown;
    },
  );

  const persistSectionFieldOps = async (
    operations: Array<{ action: string; path?: string; value?: unknown; index?: number; section?: unknown }>,
  ) => {
    if (!contentType || !slug) throw new Error("Missing content type or slug");
    const token = getDebugToken();
    const author = await resolveAuthorName();
    const res = await fetch("/api/content/edit-sections", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Token ${token}` } : {}),
      },
      body: JSON.stringify({
        contentType,
        slug,
        locale: locale || "en",
        ...(variant ? { variant } : {}),
        ...(version !== undefined ? { version } : {}),
        author,
        operations,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    emitContentUpdated({ contentType, slug, locale: locale || "en" });
    return data;
  };

  const handleSaveWorkLabel = async (next: WorkLabel) => {
    await persistSectionFieldOps([
      { action: "update_field", path: `sections.${index}._label`, value: next },
    ]);
    setCurrentSection({ ...currentSection, _label: next } as Section);
    setWasLocallyUpdated(true);
    toast({ title: "Label updated" });
  };

  const handleRemoveWorkLabel = async () => {
    const ops: Array<{ action: string; path: string; value: unknown }> = [
      { action: "update_field", path: `sections.${index}._label`, value: null },
    ];
    const raw = currentSection as Record<string, unknown>;
    if (isHiddenViaSentinel(raw)) {
      ops.push({
        action: "update_field",
        path: `sections.${index}.showOnLocations`,
        value: null,
      });
    }
    await persistSectionFieldOps(ops);
    const next = { ...raw };
    delete next._label;
    if (isHiddenViaSentinel(raw)) delete next.showOnLocations;
    setCurrentSection(next as Section);
    setWasLocallyUpdated(true);
    toast({ title: "Label removed", description: "Section is no longer marked for work." });
  };
  
  // Wrap locally re-rendered sections in a SectionContextProvider so components
  // that rely on sectionIndex (e.g. contact_bubble's edit button and row
  // ordering) keep working after a local update replaces the original children.
  const renderedContent = wasLocallyUpdated ? (
    <SectionContextProvider
      value={{
        isPriority: true,
        sectionIndex: index,
        contentType: contentType || "",
        slug: slug || "",
        locale: locale || "en",
        imageSizes: {},
      }}
    >
      {renderSection(currentSection, index)}
    </SectionContextProvider>
  ) : children;

  // If not in edit mode context or edit mode is not active, render children directly
  if (!editMode || !editMode.isEditMode) {
    return <>{renderedContent}</>;
  }
  
  return (
    <div 
      className="relative group min-h-10"
      data-edit-section-index={index}
      data-edit-section-type={sectionType}
    >
      {/* Edit overlay - only visible on hover when in edit mode */}
      <div 
        className={`
          absolute inset-0 z-40 pointer-events-none transition-all duration-150
          ${isEditorOpen 
            ? "ring-2 ring-primary ring-offset-2" 
            : swapPopoverOpen
              ? "border-l-2 border-r-2 border-b-2 border-primary"
              : "group-hover:ring-2 group-hover:ring-primary/50 group-hover:ring-offset-1"
          }
        `}
      />
      
      {/* Edit controls - visible on hover */}
      <div 
        className={`
          absolute top-2 right-2 z-30 flex items-center gap-1 
          transition-opacity duration-150
          ${isEditorOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"}
        `}
      >
        <button
          onClick={handleOpenEditor}
          className="p-2 bg-primary text-primary-foreground rounded-md shadow-lg hover-elevate flex items-center gap-1.5"
          data-testid={`button-edit-section-${index}`}
        >
          <Pencil className="h-4 w-4" />
          <span className="hidden md:inline text-xs font-medium">{sectionType}</span>
        </button>
        {!isSharedTemplate && (
        <button
          onClick={(e) => { e.stopPropagation(); openBindingDialog(); }}
          className={`hidden md:flex p-2 rounded-md shadow-lg hover-elevate items-center gap-1 ${
            isBound
              ? "bg-muted text-yellow-600 dark:text-yellow-500 animate-[binding-pulse_2s_ease-in-out_infinite]"
              : "bg-muted text-muted-foreground"
          }`}
          data-testid={`button-binding-indicator-${index}`}
          title={
            isBound
              ? `Bound to ${boundSiblingCount} other page${boundSiblingCount !== 1 ? "s" : ""}`
              : "Not bound – click to manage bindings"
          }
        >
          {isBound ? (
            <>
              <Link className="h-4 w-4" />
              <span className="text-xs font-medium">{boundSiblingCount}</span>
            </>
          ) : (
            <Unlink className="h-4 w-4" />
          )}
        </button>
        )}
        {onMoveUp && (
          <button
            onClick={(e) => { e.stopPropagation(); gatedAction(() => onMoveUp!(index)); }}
            disabled={!canMoveUp}
            className={`p-2 bg-muted text-muted-foreground rounded-md shadow-lg hover-elevate ${!canMoveUp ? 'opacity-40 cursor-not-allowed' : ''}`}
            data-testid={`button-move-up-section-${index}`}
            title="Move section up"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        )}
        {onMoveDown && (
          <button
            onClick={(e) => { e.stopPropagation(); gatedAction(() => onMoveDown!(index)); }}
            disabled={!canMoveDown}
            className={`p-2 bg-muted text-muted-foreground rounded-md shadow-lg hover-elevate ${!canMoveDown ? 'opacity-40 cursor-not-allowed' : ''}`}
            data-testid={`button-move-down-section-${index}`}
            title="Move section down"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        )}
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); gatedAction(() => onDelete!(index)); }}
            className="hidden md:block p-2 bg-muted text-destructive rounded-md shadow-lg hover-elevate"
            data-testid={`button-delete-section-${index}`}
            title="Delete section"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
        {onDuplicate && (
          <button
            onClick={(e) => { e.stopPropagation(); gatedAction(() => onDuplicate!(index)); }}
            className="hidden md:block p-2 bg-muted text-muted-foreground rounded-md shadow-lg hover-elevate"
            data-testid={`button-duplicate-section-${index}`}
            title="Duplicate section"
          >
            <Copy className="h-4 w-4" />
          </button>
        )}
        <Popover open={xSpacingOpen} onOpenChange={handleXSpacingOpen}>
          <PopoverTrigger asChild>
            <button
              className="sr-only md:not-sr-only md:p-2 md:bg-muted md:text-muted-foreground md:rounded-md md:shadow-lg md:hover-elevate"
              title="Horizontal spacing"
              data-testid={`button-x-spacing-section-${index}`}
            >
              <Space className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto min-w-[340px] p-3" onClick={(e) => e.stopPropagation()}>
            <div className="space-y-3">
              {contentTypeXDefaults ? (
                <div
                  className="rounded-md border border-amber-500/40 bg-amber-500/15 px-2.5 py-1.5 text-[11px] leading-snug text-amber-950 dark:text-amber-100"
                  data-testid={`x-spacing-type-defaults-${index}`}
                >
                  Some values have already been set on the{" "}
                  <span className="font-medium">_common</span> template.
                  <span className="text-amber-800/80 dark:text-amber-200/80">
                    {" "}Amber dots mark those defaults for{" "}
                    {xSpacingBreakpoint === "desktop" ? "desktop" : "mobile"}.
                  </span>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">X Spacing</span>
                <div className="flex items-center gap-1 rounded-md border p-0.5">
                  <Button
                    variant={xSpacingBreakpoint === "desktop" ? "default" : "ghost"}
                    size="sm"
                    className="h-6 px-2"
                    onClick={() => setXSpacingBreakpoint("desktop")}
                    data-testid={`x-spacing-bp-desktop-${index}`}
                  >
                    <Monitor className="h-3.5 w-3.5 mr-1" />
                    <span className="text-xs">Desktop</span>
                  </Button>
                  <Button
                    variant={xSpacingBreakpoint === "mobile" ? "default" : "ghost"}
                    size="sm"
                    className="h-6 px-2"
                    onClick={() => setXSpacingBreakpoint("mobile")}
                    data-testid={`x-spacing-bp-mobile-${index}`}
                  >
                    <Smartphone className="h-3.5 w-3.5 mr-1" />
                    <span className="text-xs">Mobile</span>
                  </Button>
                </div>
              </div>
              {(() => {
                const mwDefault = getDefaultTokenForBreakpoint(
                  contentTypeXDefaults?.maxWidth,
                  xSpacingBreakpoint,
                );
                const padToken = getDefaultTokenForBreakpoint(
                  contentTypeXDefaults?.paddingX,
                  xSpacingBreakpoint,
                );
                const marToken = getDefaultTokenForBreakpoint(
                  contentTypeXDefaults?.marginX,
                  xSpacingBreakpoint,
                );
                const padSides = padToken ? parseLR(padToken) : null;
                const marSides = marToken ? parseLR(marToken) : null;
                return (
                  <>
              <div className="space-y-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Max Width</span>
                <div className="flex items-center gap-1">
                  {MAX_WIDTH_PRESETS.map((preset) => {
                    const isDefault = mwDefault === preset.value;
                    return (
                    <Button
                      key={preset.value}
                      variant={xMaxWidth[xSpacingBreakpoint] === preset.value ? "default" : "outline"}
                      size="sm"
                      className="relative"
                      onClick={() => setXMaxWidth(prev => ({ ...prev, [xSpacingBreakpoint]: preset.value }))}
                      data-testid={`x-mw-preset-${index}-${preset.value}`}
                      title={isDefault ? "Content-type default (_common.template.yml)" : undefined}
                    >
                      {isDefault ? (
                        <span
                          className="absolute -top-0.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-amber-500 ring-1 ring-background"
                          aria-hidden
                        />
                      ) : null}
                      {preset.label}
                    </Button>
                    );
                  })}
                </div>
              </div>
              <XSpacingGroup
                label="Padding"
                leftValue={getXEffective(xPadding, xSpacingBreakpoint, "left")}
                rightValue={getXEffective(xPadding, xSpacingBreakpoint, "right")}
                linked={padLinked}
                onChangeLeft={(v) => updateXValue(setXPadding, xSpacingBreakpoint, "left", v)}
                onChangeRight={(v) => updateXValue(setXPadding, xSpacingBreakpoint, "right", v)}
                onChangeBoth={(v) => updateXBoth(setXPadding, xSpacingBreakpoint, v)}
                onToggleLink={() => setPadLinked(prev => !prev)}
                testIdPrefix={`x-pad-${index}`}
                defaultLeft={padSides?.left}
                defaultRight={padSides?.right}
              />
              {(xMaxWidth.desktop === "none" && xMaxWidth.mobile === "none") && (
                <XSpacingGroup
                  label="Margin"
                  leftValue={getXEffective(xMargin, xSpacingBreakpoint, "left")}
                  rightValue={getXEffective(xMargin, xSpacingBreakpoint, "right")}
                  linked={marLinked}
                  onChangeLeft={(v) => updateXValue(setXMargin, xSpacingBreakpoint, "left", v)}
                  onChangeRight={(v) => updateXValue(setXMargin, xSpacingBreakpoint, "right", v)}
                  onChangeBoth={(v) => updateXBoth(setXMargin, xSpacingBreakpoint, v)}
                  onToggleLink={() => setMarLinked(prev => !prev)}
                  testIdPrefix={`x-mar-${index}`}
                  defaultLeft={marSides?.left}
                  defaultRight={marSides?.right}
                />
              )}
                  </>
                );
              })()}
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setXSpacingOpen(false)}
                  data-testid={`x-spacing-cancel-${index}`}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleApplyXSpacing}
                  disabled={xSaving}
                  data-testid={`x-spacing-apply-${index}`}
                >
                  {xSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                  Apply
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
        <Popover open={mobileMoreOpen} onOpenChange={setMobileMoreOpen}>
          <PopoverTrigger asChild>
            <button
              className="md:hidden p-2 bg-muted text-muted-foreground rounded-md shadow-lg hover-elevate"
              title="More actions"
              data-testid={`button-section-more-${index}`}
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto min-w-[160px] p-1" align="end" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col">
              {!isSharedTemplate && (
              <button
                onClick={(e) => { e.stopPropagation(); setMobileMoreOpen(false); openBindingDialog(); }}
                className={`flex items-center gap-2 px-3 py-2 text-sm rounded-md hover-elevate ${
                  isBound ? "text-yellow-600 dark:text-yellow-500" : "text-muted-foreground"
                }`}
                data-testid={`button-binding-indicator-mobile-${index}`}
              >
                {isBound ? <Link className="h-4 w-4" /> : <Unlink className="h-4 w-4" />}
                {isBound ? `Bindings (${boundSiblingCount})` : "Bindings"}
              </button>
              )}
              {onDelete && (
                <button
                  onClick={(e) => { e.stopPropagation(); setMobileMoreOpen(false); gatedAction(() => onDelete!(index)); }}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-destructive rounded-md hover-elevate"
                  data-testid={`button-delete-section-mobile-${index}`}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
              )}
              {onDuplicate && (
                <button
                  onClick={(e) => { e.stopPropagation(); setMobileMoreOpen(false); gatedAction(() => onDuplicate!(index)); }}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground rounded-md hover-elevate"
                  data-testid={`button-duplicate-section-mobile-${index}`}
                >
                  <Copy className="h-4 w-4" />
                  Duplicate
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); setMobileMoreOpen(false); handleXSpacingOpen(true); }}
                className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground rounded-md hover-elevate"
                data-testid={`button-x-spacing-section-mobile-${index}`}
              >
                <Space className="h-4 w-4" />
                Horizontal spacing
              </button>
              {contentType && slug && locale && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMobileMoreOpen(false);
                    setHistoryOpen(true);
                    if (historyEntries.length === 0) {
                      setHistoryLoading(true);
                      const contentDir = contentTypesMap ? getFolderFromType(contentTypesMap, contentType) : contentType;
                      const filePath = `4geeks-com/${contentDir}/${slug}/${locale}.yml`;
                      fetch(`/api/git/file-history?file=${encodeURIComponent(filePath)}&limit=20`)
                        .then(r => r.json())
                        .then(data => { setHistoryEntries(data.entries || []); })
                        .catch(() => { setHistoryEntries([]); })
                        .finally(() => setHistoryLoading(false));
                    }
                  }}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground rounded-md hover-elevate"
                  data-testid={`button-time-machine-mobile-${index}`}
                >
                  <Clock3 className="h-4 w-4" />
                  Time Machine
                </button>
              )}
            </div>
          </PopoverContent>
        </Popover>
        {contentType && slug && locale && (
          <Popover open={historyOpen} onOpenChange={(open) => {
            setHistoryOpen(open);
            if (open && historyEntries.length === 0) {
              setHistoryLoading(true);
              const contentDir = contentTypesMap ? getFolderFromType(contentTypesMap, contentType) : contentType;
              const filePath = `4geeks-com/${contentDir}/${slug}/${locale}.yml`;
              fetch(`/api/git/file-history?file=${encodeURIComponent(filePath)}&limit=20`)
                .then(r => r.json())
                .then(data => { setHistoryEntries(data.entries || []); })
                .catch(() => { setHistoryEntries([]); })
                .finally(() => setHistoryLoading(false));
            }
            if (!open) {
              setHistoryPreviewSha(null);
              setHistoryPreviewSection(null);
              setHistoryPreviewDate(null);
              setHistoryPreviewAuthor(null);
            }
          }}>
            <PopoverTrigger asChild>
              <button
                className="p-2 bg-muted text-muted-foreground rounded-md shadow-lg hover-elevate hidden md:block"
                title="Section history"
                data-testid={`button-history-section-${index}`}
              >
                <Clock3 className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-[min(500px,calc(100vw-1rem))] p-2" onClick={(e) => e.stopPropagation()}>
              {historyLoading ? (
                <div className="flex items-center justify-center py-3 px-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mr-2" />
                  <span className="text-xs text-muted-foreground">Loading history...</span>
                </div>
              ) : historyEntries.length === 0 ? (
                <p className="text-xs text-muted-foreground px-2 py-2">No git history found for this file.</p>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-center justify-between px-2 pb-1 border-b">
                    <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                      <History className="h-3.5 w-3.5" />
                      File history — select a version to preview
                    </span>
                    {historyPreviewSha && (
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-xs"
                          onClick={() => {
                            setHistoryPreviewSha(null);
                            setHistoryPreviewSection(null);
                            setHistoryPreviewDate(null);
                            setHistoryPreviewAuthor(null);
                          }}
                          data-testid={`button-history-cancel-${index}`}
                        >
                          <X className="h-3 w-3 mr-1" />
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => {
                            if (historyPreviewSection) {
                              handleUpdate(historyPreviewSection);
                              setHistoryOpen(false);
                              setHistoryPreviewSha(null);
                              setHistoryPreviewSection(null);
                            }
                          }}
                          disabled={!historyPreviewSection}
                          data-testid={`button-history-restore-${index}`}
                        >
                          <Check className="h-3 w-3 mr-1" />
                          Restore
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="max-h-[260px] overflow-y-auto space-y-0.5">
                    {historyEntries.map((entry) => {
                      const isSelected = entry.sha === historyPreviewSha;
                      const isLoading = historyPreviewLoading && isSelected;
                      const d = new Date(entry.date);
                      const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                      const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
                      const displayAuthor = parseAutoSyncAuthor(entry.subject) ?? entry.author;
                      return (
                        <button
                          key={entry.sha}
                          className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-start gap-2 hover-elevate ${isSelected ? 'bg-primary/10 ring-1 ring-primary/30' : ''}`}
                          onClick={async () => {
                            if (isSelected) return;
                            setHistoryPreviewSha(entry.sha);
                            setHistoryPreviewDate(entry.date);
                            setHistoryPreviewAuthor(displayAuthor);
                            setHistoryPreviewSection(null);
                            setHistoryPreviewLoading(true);
                            try {
                              const contentDir = contentTypesMap ? getFolderFromType(contentTypesMap, contentType) : contentType;
                              const filePath = `4geeks-com/${contentDir}/${slug}/${locale}.yml`;
                              const res = await fetch(`/api/git/file-at?file=${encodeURIComponent(filePath)}&sha=${entry.sha}`);
                              if (!res.ok) throw new Error("not found");
                              const text = await res.text();
                              const parsed = yaml.load(text) as Record<string, unknown>;
                              const sections = (parsed?.sections as unknown[]) || [];
                              const historicalSection = sections[index] as Section | undefined;
                              if (historicalSection) {
                                setHistoryPreviewSection(historicalSection);
                              } else {
                                setHistoryPreviewSection(null);
                              }
                            } catch {
                              setHistoryPreviewSection(null);
                            } finally {
                              setHistoryPreviewLoading(false);
                            }
                          }}
                          data-testid={`button-history-entry-${entry.sha.slice(0, 7)}-${index}`}
                        >
                          {isLoading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0 mt-0.5" />
                          ) : (
                            <code className="text-[10px] text-muted-foreground shrink-0 mt-0.5">{entry.sha.slice(0, 7)}</code>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium text-foreground">{entry.subject}</div>
                            <div className="text-muted-foreground">{dateStr} {timeStr} · {displayAuthor}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </PopoverContent>
          </Popover>
        )}
        <Popover open={swapPopoverOpen} onOpenChange={setSwapPopoverOpen}>
          <PopoverTrigger asChild>
            <button 
              className="p-2 bg-muted text-muted-foreground rounded-md shadow-lg hover-elevate" 
              title="Swap variant"
              data-testid={`button-swap-section-${index}`}
            >
              <ArrowLeftRight className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto min-w-[500px] max-w-[700px] p-2" onClick={(e) => e.stopPropagation()}>
            {isLoadingSwap ? (
              <div className="flex items-center justify-center py-2 px-4" data-testid={`loader-swap-section-${index}`}>
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mr-2" />
                <span className="text-xs text-muted-foreground">Loading variants...</span>
              </div>
            ) : versions.length === 0 ? (
              <p className="text-xs text-muted-foreground px-2" data-testid={`text-no-variants-${index}`}>No versions available</p>
            ) : (
              <div className="flex items-center gap-3">
                {/* Left: Component + Version badges */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <span 
                    className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-muted"
                    data-testid={`badge-component-${index}`}
                  >
                    {sectionType}
                  </span>
                  <span 
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-muted ${versions.length > 1 ? 'cursor-pointer hover-elevate' : ''}`}
                    onClick={() => versions.length > 1 && setShowVersionPicker(!showVersionPicker)}
                    data-testid={`badge-version-${index}`}
                  >
                    {selectedVersion || versions[0] || ""}
                    {versions.length > 1 && <Pencil className="h-3 w-3" />}
                  </span>
                </div>
                
                {/* Divider */}
                <div className="w-px h-6 bg-border shrink-0" />
                
                {/* Center: Variant navigation */}
                {variants.length > 0 ? (
                  <div className="flex items-center gap-1 min-w-0 flex-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => cycleVariant(-1)} disabled={variants.length <= 1} data-testid={`button-variant-prev-${index}`}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-xs font-medium truncate min-w-[80px] text-center" data-testid={`text-variant-${index}`}>
                      {deslugify(selectedVariant || "default")}
                      {examplesForCurrentVariant.length > 1 && (
                        <span className="text-muted-foreground ml-1">({selectedExampleIndex + 1}/{examplesForCurrentVariant.length})</span>
                      )}
                    </span>
                    <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => cycleVariant(1)} disabled={variants.length <= 1} data-testid={`button-variant-next-${index}`}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    {/* Example navigation (only if multiple examples in variant) */}
                    {examplesForCurrentVariant.length > 1 && (
                      <>
                        <div className="w-px h-4 bg-border/50 shrink-0" />
                        <div className="flex flex-col items-center gap-0.5 shrink-0">
                          <span className="text-[9px] text-muted-foreground uppercase tracking-wide">Examples</span>
                          <div className="flex items-center">
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => cycleExample(-1)} data-testid={`button-example-prev-${index}`}>
                              <ChevronLeft className="h-3 w-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => cycleExample(1)} data-testid={`button-example-next-${index}`}>
                              <ChevronRight className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </>
                    )}
                    {/* View YAML source - always visible */}
                    <div className="w-px h-4 bg-border/50 shrink-0" />
                    <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => setShowYamlModal(true)} title="View YAML source" data-testid={`button-view-yaml-${index}`}>
                      <Code className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">No variants</span>
                )}
                
                {/* Divider */}
                <div className="w-px h-6 bg-border shrink-0" />
                
                {/* Right: Action buttons */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setSwapPopoverOpen(false); setAdaptedSection(null); setHasAdapted(false); }} data-testid={`button-cancel-swap-${index}`} title="Cancel">
                    <X className="h-4 w-4" />
                  </Button>
                  {hasAdapted ? (
                    <>
                      <Button size="sm" variant="outline" className="h-7 px-3" onClick={handleConfirmSwap} disabled={!adaptedSection || isConfirming} data-testid={`button-use-this-${index}`}>
                        {isConfirming ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
                        Use This
                      </Button>
                      <Button size="sm" className="h-7 px-3" onClick={handleOpenReviewCode} disabled={!adaptedSection} data-testid={`button-review-code-${index}`}>
                        <Code className="h-3 w-3 mr-1" />
                        Review Code
                      </Button>
                    </>
                  ) : (
                    <>
                      {previewSection && (
                        <Button size="sm" variant="outline" className="h-7 px-3" onClick={handleConfirmSwap} disabled={isConfirming} data-testid={`button-use-this-${index}`}>
                          {isConfirming ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
                          Use This
                        </Button>
                      )}
                      <Button size="sm" className="h-7 px-3" onClick={handleAdaptWithAI} disabled={!previewSection || isAdapting} data-testid={`button-adapt-ai-${index}`}>
                        {isAdapting ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <Sparkles className="h-3 w-3 mr-1" />
                        )}
                        {isAdapting ? 'Adapting...' : 'Adapt'}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}
            {/* Version picker dropdown (shown conditionally) */}
            {showVersionPicker && versions.length > 1 && (
              <div className="mt-2 pt-2 border-t">
                <Select value={selectedVersion} onValueChange={(val) => { setSelectedVersion(val); setShowVersionPicker(false); }}>
                  <SelectTrigger className="w-full h-8 text-xs" data-testid={`select-version-${index}`}>
                    <SelectValue placeholder="Select version" />
                  </SelectTrigger>
                  <SelectContent>
                    {versions.map(ver => (
                      <SelectItem key={ver} value={ver} data-testid={`option-version-${ver}-${index}`}>{ver}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
      
      {(() => {
        const showOn = (section as SectionLayout).showOn || 'all';
        const showOnLocations = (section as SectionLayout).showOnLocations || [];
        const showOnRegions = (section as SectionLayout).showOnRegions || [];
        
        const hasDeviceFilter = showOn !== 'all';
        const hasLocationFilter = showOnLocations.length > 0 || showOnRegions.length > 0;
        
        if (!hasDeviceFilter && !hasLocationFilter) return null;
        
        const countryCodes = hasLocationFilter ? getUniqueCountryCodes(showOnLocations) : [];
        
        const flagRows: string[][] = [];
        for (let i = 0; i < countryCodes.length; i += 6) {
          flagRows.push(countryCodes.slice(i, i + 6));
        }
        
        return (
          <div 
            className="absolute right-2 z-30 flex flex-col items-end gap-0.5 px-2 py-1 bg-amber-500/90 text-amber-950 text-xs font-medium rounded"
            style={{ top: ((section as any)._perEntryPatched || (section as any)._perEntrySource) ? "4.5rem" : "3rem" }}
            title="Special Visibility Conditions"
            data-testid={`badge-visibility-${index}`}
          >
            <div className="flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Special Visibility Conditions</span>
              <span className="md:hidden">Visibility</span>
              {hasDeviceFilter && (
                showOn === 'desktop' 
                  ? <Monitor className="h-3.5 w-3.5" /> 
                  : <Smartphone className="h-3.5 w-3.5" />
              )}
              {flagRows.length > 0 && flagRows[0].map((code) => (
                <CountryFlag key={code} code={code} />
              ))}
            </div>
            {flagRows.slice(1).map((row, ri) => (
              <div key={ri} className="flex items-center gap-1.5">
                {row.map((code) => (
                  <CountryFlag key={code} code={code} />
                ))}
              </div>
            ))}
          </div>
        );
      })()}

      
      {/* Hidden-until-redirection badge — same style as other edit-mode badges */}
      {(section as SectionLayout).hidden_until_redirection && (
        <div
          className="absolute top-2 right-2 z-30 flex items-center gap-1 px-2 py-1 bg-amber-500/90 text-amber-950 text-xs font-medium rounded"
          title={`Hidden from page — revealed via inline#${(section as SectionLayout).section_id ?? "…"}`}
          data-testid={`badge-hidden-redirect-${index}`}
        >
          <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden md:inline">Hidden until redirect</span>
        </div>
      )}

      {/* Locale work label — needs edit/review (_label.note is required when writing labels) */}
      {sectionWorkLabel?.needs ? (
        <button
          type="button"
          className="absolute right-2 z-30 flex items-center gap-1 px-2 py-1 bg-rose-500/90 text-white text-xs font-medium rounded hover:bg-rose-500 cursor-pointer"
          style={{ top: ((currentSection as any)._perEntryPatched || (currentSection as any)._perEntrySource) ? "4.5rem" : "3rem" }}
          title={
            sectionWorkLabel.note
              ? `${sectionWorkLabel.note}${
                  sectionWorkLabel.requester ? ` · by ${sectionWorkLabel.requester}` : ""
                }${
                  sectionWorkLabel.owner ? ` · assigned to ${sectionWorkLabel.owner}` : ""
                }`
              : `Needs ${sectionWorkLabel.needs}`
          }
          data-testid={`badge-section-label-${index}`}
          onClick={async (e) => {
            e.stopPropagation();
            const staffId = (await resolveStaffId()) || getDebugStaffId();
            setWorkLabelStaffId(staffId);
            setWorkLabelEditing(sectionWorkLabel);
            setWorkLabelOpen(true);
          }}
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden md:inline">Needs {sectionWorkLabel.needs}</span>
        </button>
      ) : null}

      {workLabelEditing ? (
        <WorkLabelModal
          open={workLabelOpen}
          onOpenChange={(open) => {
            setWorkLabelOpen(open);
            if (!open) setWorkLabelEditing(null);
          }}
          label={workLabelEditing}
          currentStaffId={workLabelStaffId || undefined}
          onSave={handleSaveWorkLabel}
          onRemove={handleRemoveWorkLabel}
          testIdPrefix={`section-label-${index}`}
        />
      ) : null}

      {/* Per-entry origin badge — below toolbar (same row as "Overridden" / above visibility) */}
      {(section as any)._perEntrySource && (
        <div
          className="absolute right-2 z-30 flex items-center gap-1 px-2 py-1 bg-primary/90 text-primary-foreground text-xs font-medium rounded"
          style={{ top: "3rem" }}
          title="This section is specific to this entry only"
          data-testid={`badge-per-entry-${index}`}
        >
          <IconPin className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden md:inline">Only this {singularLabel}</span>
        </div>
      )}

      {/* Per-entry patch badge (visible when a shared-template section has entry-specific overrides) */}
      {(section as any)._perEntryPatched && !isSharedTemplate && (
        <Popover open={resetPatchOpen} onOpenChange={setResetPatchOpen}>
          <PopoverTrigger asChild>
            <button
              className="absolute right-2 z-30 flex items-center gap-1 px-2 py-1 bg-amber-400/90 text-amber-950 text-xs font-medium rounded hover-elevate"
              style={{ top: "3rem" }}
              title="This section has entry-specific overrides — click to reset"
              data-testid={`badge-per-entry-patched-${index}`}
              onClick={(e) => e.stopPropagation()}
            >
              <IconEdit className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden md:inline">Overridden</span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto max-w-xs p-3" side="bottom" align="end" onClick={(e) => e.stopPropagation()}>
            <div className="space-y-2">
              <p className="text-xs font-medium flex items-center gap-1.5">
                <IconEdit className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                Entry-specific override
              </p>
              <p className="text-xs text-muted-foreground">
                This section has been customized for this {singularLabel} only. The shared template content is not shown.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-1.5"
                onClick={handleResetPatch}
                disabled={isResettingPatch}
                data-testid={`button-reset-patch-${index}`}
              >
                {isResettingPatch
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <IconArrowBackUp className="h-3.5 w-3.5" />
                }
                Reset to shared template
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Top-left row: broken image badge (always visible) + section labels (on hover) */}
      <div className="absolute top-2 left-2 z-30 flex flex-row flex-wrap items-center gap-1.5">
        {brokenImageIds.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="flex items-center gap-1 px-2 py-1 bg-destructive/90 text-destructive-foreground rounded text-xs font-medium shadow-lg hover-elevate"
                title="Broken image references"
                data-testid={`badge-broken-images-${index}`}
                onClick={(e) => e.stopPropagation()}
              >
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden md:inline">{brokenImageIds.length} broken image{brokenImageIds.length !== 1 ? "s" : ""}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto max-w-xs p-3" side="bottom" align="start" onClick={(e) => e.stopPropagation()}>
              <div className="space-y-2">
                <p className="text-xs font-medium flex items-center gap-1.5 text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Missing image {brokenImageIds.length !== 1 ? "references" : "reference"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {brokenImageIds.length !== 1 ? "These image IDs are" : "This image ID is"} not found in the image registry. Open the section editor to fix {brokenImageIds.length !== 1 ? "them" : "it"}.
                </p>
                <ul className="space-y-1">
                  {brokenImageIds.map(id => (
                    <li key={id} className="flex items-center gap-1.5">
                      <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-destructive">{id}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </PopoverContent>
          </Popover>
        )}

        {/* Section labels (visible on hover or when editor is open) */}
        <div 
          className={`
            flex flex-col md:flex-row items-start md:items-center gap-1 md:gap-1.5
            transition-opacity duration-150
            ${isEditorOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"}
          `}
        >
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="px-2 py-1 bg-muted/90 backdrop-blur-sm rounded text-xs text-muted-foreground hover-elevate cursor-pointer"
              data-testid={`badge-section-anchor-${index}`}
            >
              #{(currentSection as { section_id?: string }).section_id ?? `${sectionType}-${index}`}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto max-w-xs p-3 text-xs" side="bottom" align="start" onClick={(e) => e.stopPropagation()}>
            <p className="text-muted-foreground">
              Include <span className="font-mono font-medium text-foreground">#{(currentSection as { section_id?: string }).section_id ?? `${sectionType}-${index}`}</span> on the website URL to take the user to this section scroll position directly.
            </p>
            <button
              className="mt-2 flex items-center gap-1.5 text-muted-foreground hover-elevate rounded px-1.5 py-1 -mx-1.5"
              data-testid={`button-copy-anchor-link-${index}`}
              onClick={(e) => {
                e.stopPropagation();
                const anchorId = (currentSection as { section_id?: string }).section_id ?? `${sectionType}-${index}`;
                const path = window.location.pathname.startsWith('/private/preview/')
                  ? `/${locale}/${contentType}/${slug}`
                  : window.location.pathname;
                const url = `${window.location.origin}${path}#${anchorId}`;
                navigator.clipboard.writeText(url);
                setAnchorCopied(true);
                setTimeout(() => setAnchorCopied(false), 2000);
              }}
            >
              {anchorCopied ? (
                <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              <span>{anchorCopied ? "Copied!" : "Copy link to this section"}</span>
            </button>
          </PopoverContent>
        </Popover>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-1 px-2 py-1 bg-muted/90 backdrop-blur-sm rounded text-xs text-muted-foreground hover-elevate cursor-pointer"
              data-testid={`badge-variant-${index}`}
            >
              Variant: {deslugify((currentSection as { variant?: string }).variant || "default")}
              <IconChevronDown className="h-3 w-3 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="start" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem
              className="flex items-center gap-2 cursor-pointer"
              onSelect={() => {
                const variantName = (currentSection as { variant?: string }).variant || "default";
                const params = new URLSearchParams({ variant: variantName });
                if (version) params.set("version", String(version));
                window.open(`/private/component-showcase/${sectionType}?${params.toString()}`, "_blank");
              }}
            >
              <IconPencil className="h-4 w-4 shrink-0" />
              Edit this variant
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>
      
      {/* Content with pointer events enabled - show preview section when cycling variants */}
      <div className="relative">
        {historyOpen && historyPreviewSha ? (
          <>
            {/* History preview indicator banner */}
            <div className="absolute top-0 left-0 right-0 z-30 text-xs px-3 py-1.5 bg-amber-600 text-amber-50">
              <span className="font-medium flex items-center gap-2">
                {historyPreviewLoading ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading historical version...
                  </>
                ) : historyPreviewSection ? (
                  <>
                    <Clock3 className="h-3 w-3" />
                    {historyPreviewDate
                      ? `Version from ${new Date(historyPreviewDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}${historyPreviewAuthor ? ` by ${historyPreviewAuthor}` : ''} — read only`
                      : "Historical version — read only"}
                  </>
                ) : (
                  <>
                    <X className="h-3 w-3" />
                    Section did not exist at this point in history
                  </>
                )}
              </span>
            </div>
            <div className="pt-8 relative">
              {historyPreviewSection ? (
                renderSection(historyPreviewSection, index)
              ) : historyPreviewLoading ? (
                <>
                  {renderedContent}
                  <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                </>
              ) : (
                renderedContent
              )}
            </div>
          </>
        ) : swapPopoverOpen ? (
          <>
            {/* Preview indicator banner */}
            <div className={`absolute top-0 left-0 right-0 z-30 text-xs px-3 py-1.5 ${hasAdapted ? 'bg-green-600' : 'bg-primary/90'} text-primary-foreground`}>
              <span className="font-medium flex items-center gap-2">
                {isLoadingSwap ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading preview...
                  </>
                ) : isAdapting ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Adapting content with AI...
                  </>
                ) : hasAdapted ? (
                  <>
                    <Sparkles className="h-3 w-3" />
                    AI Adapted: {selectedVariant || "default"}{examplesForCurrentVariant.length > 1 && currentExample?.name ? ` - ${currentExample.name}` : ""}
                  </>
                ) : (
                  <>Preview: {selectedVariant || "default"}{examplesForCurrentVariant.length > 1 && currentExample?.name ? ` - ${currentExample.name}` : ""}</>
                )}
              </span>
            </div>
            {/* Render the preview section or original with loading overlay */}
            <div className="pt-8 relative">
              {hasAdapted && adaptedSection ? (
                renderSection(adaptedSection, index)
              ) : previewSection ? (
                renderSection(previewSection, index)
              ) : (
                <>
                  {renderedContent}
                  {(isLoadingSwap || isAdapting) && (
                    <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        {isAdapting && <span className="text-sm text-muted-foreground">Adapting with AI...</span>}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        ) : (
          renderedContent
        )}
      </div>
      
      {/* Editor Panel - slides in when open */}
      {isEditorOpen && (
        <Suspense fallback={null}>
          <SectionEditorPanel
            section={currentSection}
            sectionIndex={index}
            contentType={contentType}
            slug={slug}
            locale={locale}
            variant={variant}
            version={version}
            onUpdate={handleUpdate}
            onClose={handleCloseEditor}
            allSections={allSections}
            isSharedTemplate={isSharedTemplate}
            singleEntry={singleEntry}
            allowEntryStructuralOverrides={allowEntryStructuralOverrides}
          />
        </Suspense>
      )}
      
      {/* YAML Source Modal */}
      <Dialog open={showYamlModal} onOpenChange={setShowYamlModal}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Code className="h-5 w-5" />
              {currentExample?.name || selectedVariant || "Variant"} - YAML Source
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto rounded border">
            <Suspense fallback={<div className="flex items-center justify-center h-40"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
              <LazyYamlEditor
                value={currentExample?.yaml || ""}
                readOnly
                highlightActiveLine={false}
                className="text-sm"
              />
            </Suspense>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Review Code Modal - editable YAML for AI-adapted content */}
      <Dialog open={showReviewCodeModal} onOpenChange={setShowReviewCodeModal}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Review AI-Generated Code
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Review and edit the YAML below. Fix any issues before applying.
          </p>
          <div className="flex-1 overflow-auto rounded border min-h-[300px]">
            <Suspense fallback={<div className="flex items-center justify-center h-40"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
              <LazyYamlEditor
                value={reviewCodeYaml}
                onChange={(value) => setReviewCodeYaml(value)}
                highlightActiveLine
                className="text-sm"
              />
            </Suspense>
          </div>
          {reviewCodeError && (
            <div className="rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive max-h-[150px] overflow-auto" data-testid={`error-review-code-${index}`}>
              <p className="font-medium mb-1">Validation Error:</p>
              <pre className="whitespace-pre-wrap text-xs">{reviewCodeError}</pre>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowReviewCodeModal(false)} data-testid={`button-cancel-review-${index}`}>
              Cancel
            </Button>
            <Button onClick={handleApplyReviewedCode} disabled={isConfirming} data-testid={`button-apply-review-${index}`}>
              {isConfirming ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              Apply Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* X Spacing Default Confirmation Dialog */}
      <Dialog open={xDefaultConfirmOpen} onOpenChange={(open) => { if (!open) { setXDefaultConfirmOpen(false); setXDefaultConfirmData(null); } }}>
        <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Apply as default spacing?</DialogTitle>
            <DialogDescription>
              Do you want to apply this spacing by default to all {contentType}&apos;s?
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-2">
            <Button onClick={handleXDefaultConfirm} data-testid={`x-default-confirm-yes-${index}`}>
              Yes, all {contentType}&apos;s must have this {xDefaultConfirmData?.changedFields.join(" & ")}
            </Button>
            <Button variant="outline" onClick={() => { setXDefaultConfirmOpen(false); setXDefaultConfirmData(null); }} data-testid={`x-default-confirm-no-${index}`}>
              No, only this {sectionType}-{index} section
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Section Binding Dialog */}
      {bindingDialogOpen && contentType && slug && locale && (
        <Suspense fallback={null}>
          <SectionBindingDialog
            open={bindingDialogOpen}
            onOpenChange={setBindingDialogOpen}
            contentType={contentType}
            slug={slug}
            sectionIndex={index}
            component={sectionType}
            locale={locale}
            existingGroup={bindingData?.group as { id: string; name?: string; component: string; locale: string; members: Array<{ contentType: string; slug: string; sectionIndex: number }> } | null}
            onBindingChanged={() => {}}
          />
        </Suspense>
      )}

      {/* Binding confirmation for AI adaptation */}
      {bindingConfirmForAI && (
        <Suspense fallback={null}>
          <BindingConfirmDialog
            open={bindingConfirmForAI}
            onOpenChange={setBindingConfirmForAI}
            boundSiblings={boundSiblings}
            onConfirm={async () => {
              if (pendingAIApply.current) {
                await pendingAIApply.current();
                pendingAIApply.current = null;
              }
            }}
            confirmLabel="Apply to all"
            confirmIcon={<Sparkles className="h-4 w-4 mr-2" />}
          />
        </Suspense>
      )}

      {/* DB template structural warning dialog */}
      <DbTemplateWarningDialog
        open={swapWarnOpen}
        onClose={() => {
          setSwapWarnOpen(false);
          pendingSwapFn.current = null;
        }}
        onConfirm={async () => {
          if (pendingSwapFn.current) {
            await pendingSwapFn.current();
            pendingSwapFn.current = null;
          }
          setSwapWarnOpen(false);
        }}
        operation="update"
        contentType={contentType || "page"}
        isLoading={isConfirming}
      />
    </div>
  );
}
