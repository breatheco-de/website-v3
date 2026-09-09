import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import { AlertTriangle, ArrowDown, ArrowLeftRight, ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, Code, Copy, Eye, FileDiff, History, Info, Link as LinkIcon, Loader2, Monitor, MoreVertical, Pencil, Smartphone, Space, Trash2, Unlink, X } from "lucide-react";
import { IconPin, IconEdit, IconArrowBackUp, IconPencil, IconChevronDown } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import type { Section, SectionLayout, ShowOn, ResponsiveSpacing } from "@shared/schema";
import { parseAutoSyncCommitAuthor, parseCommitAuthorTag } from "@shared/git-commit-attribution";
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
import { AgentIcon } from "@/components/pipeline/AgentIcon";
import { formatAgentLabel, resolveAgentId } from "@/components/pipeline/agentIcons";
import { buildEntryActivityEventFocusHref } from "@/components/pipeline/EntryActivityBadge";
import { formatAttributionEntry, type EventAttributionEntry } from "@/lib/formatIssueActor";
import {
  SectionHistoryDiffModal,
  type SectionHistoryDiffTarget,
} from "@/components/editing/SectionHistoryDiffModal";
import {
  WorkLabelModal,
  normalizeWorkLabel,
  type WorkLabel,
} from "@/components/editing/WorkLabelModal";
import { getDebugToken, resolveAuthorName, resolveStaffId, getDebugStaffId } from "@/hooks/useDebugAuth";
import { useContentTypes, useContentTypesRaw, getFolderFromType } from "@/hooks/useContentTypes";
import { useToast } from "@/hooks/use-toast";
import { useVariableDefinitions, useVariableContext } from "@/hooks/useVariables";
import { prepareSectionForVariableHighlights } from "@/lib/variable-manager";
import { emitContentUpdated, emitEditStarted } from "@/lib/contentEvents";
import { editContent } from "@/lib/contentApi";
import { mergeSavedSectionForLivePreview } from "@/components/editing/restoreVariableFieldsForEditor";
import { VariableHighlightProvider } from "@/components/editing/VariableHighlight";
import { renderSection } from "@/components/SectionRenderer";
import { SectionContextProvider } from "@/contexts/SectionContext";
import yaml from "js-yaml";
import { escapeTemplateVars, unescapeObjectVars } from "@shared/templateVars";
import { canonicalSectionId, sectionMatchesId } from "@shared/sectionIdentity";
import * as CountryFlags from "country-flag-icons/react/3x2";

function isHistoryCausePopoverTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest("[data-history-cause-popover]");
}

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
              {linked ? <LinkIcon className="h-3.5 w-3.5" /> : <Unlink className="h-3.5 w-3.5 text-muted-foreground" />}
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

function resolveHistoryAuthorDisplay(entry: {
  author: string;
  subject: string;
  event?: {
    attribution?: EventAttributionEntry[];
  };
}): { label: string; agentId: ReturnType<typeof resolveAgentId> } {
  const attribution = entry.event?.attribution;
  if (attribution && attribution.length > 0) {
    const agentId = resolveAgentId(attribution);
    const author = attribution[0]?.author?.trim();
    if (author) return { label: author, agentId };
    if (agentId) return { label: formatAgentLabel(agentId), agentId };
    return { label: formatAttributionEntry(attribution[0]!), agentId: null };
  }
  const tag = parseCommitAuthorTag(entry.subject);
  const agentId = tag
    ? resolveAgentId([{ actor: { type: "mcp", model: tag } }])
    : null;
  const staff = parseAutoSyncCommitAuthor(entry.subject) ?? entry.author;
  return { label: staff, agentId };
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
  const { data: varDefinitions } = useVariableDefinitions();
  const varContext = useVariableContext();
  const historyVarContext = {
    ...varContext,
    locale: locale || varContext.locale,
  };
  const { data: siteInfo } = useQuery<{ contentFolder: string }>({
    queryKey: ["/api/site/info"],
  });
  const singularLabel = getSingularLabel(contentType, rawContentTypes);

  const buildPageYamlPath = useCallback(() => {
    if (!contentType || !slug || !locale || !siteInfo?.contentFolder) return null;
    const contentDir = contentTypesMap ? getFolderFromType(contentTypesMap, contentType) : contentType;
    return `${siteInfo.contentFolder}/${contentDir}/${slug}/${locale}.yml`;
  }, [contentType, slug, locale, siteInfo?.contentFolder, contentTypesMap]);
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
  
  // Section history (time-travel) state
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<{
    sha: string;
    date: string;
    author: string;
    subject: string;
    parentSha?: string | null;
    additions?: number;
    deletions?: number;
    event?: {
      id: number;
      cause?: string;
      created_at: number;
      attribution: EventAttributionEntry[];
    };
  }[]>([]);
  const [historyRepoUrl, setHistoryRepoUrl] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyPreviewSha, setHistoryPreviewSha] = useState<string | null>(null);
  /** Which history row has the cause Popover open (nested inside Time Machine). */
  const [historyCauseOpenSha, setHistoryCauseOpenSha] = useState<string | null>(null);
  const [historyRestoring, setHistoryRestoring] = useState(false);
  /** Collapse commit list; header (+ preview) stay. */
  const [historyListCollapsed, setHistoryListCollapsed] = useState(false);
  /** Raw YAML section (for Restore). May lack resolved listing `items`. */
  const [historyPreviewRawSection, setHistoryPreviewRawSection] = useState<Section | null>(null);
  /** Display section — raw, or after dynamic_entries resolve against current DB. */
  const [historyPreviewSection, setHistoryPreviewSection] = useState<Section | null>(null);
  const [historyPreviewDate, setHistoryPreviewDate] = useState<string | null>(null);
  const [historyPreviewAuthor, setHistoryPreviewAuthor] = useState<string | null>(null);
  const [historyPreviewLoading, setHistoryPreviewLoading] = useState(false);
  const [historyDiffTarget, setHistoryDiffTarget] = useState<SectionHistoryDiffTarget | null>(null);

  const loadSectionHistory = useCallback(async (opts?: { cursor?: string | null; append?: boolean }) => {
    const filePath = buildPageYamlPath();
    if (!filePath) {
      if (!opts?.append) {
        setHistoryEntries([]);
        setHistoryHasMore(false);
        setHistoryCursor(null);
      }
      return;
    }
    const sectionId = canonicalSectionId(currentSection as Record<string, unknown>);
    const params = new URLSearchParams({
      file: filePath,
      sectionIndex: String(index),
      limit: "10",
    });
    if (sectionId) params.set("sectionId", sectionId);
    if (opts?.cursor) params.set("cursor", opts.cursor);

    const data = await fetch(`/api/git/section-history?${params.toString()}`).then((r) => r.json());
    const entries = Array.isArray(data.entries) ? data.entries : [];
    if (typeof data.repoUrl === "string" && data.repoUrl.trim()) {
      setHistoryRepoUrl(data.repoUrl.replace(/\.git$/, "").replace(/\/$/, ""));
    }
    if (opts?.append) {
      setHistoryEntries((prev) => {
        const seen = new Set(prev.map((e) => e.sha));
        return [...prev, ...entries.filter((e: { sha: string }) => e.sha && !seen.has(e.sha))];
      });
    } else {
      setHistoryEntries(entries);
    }
    setHistoryHasMore(!!data.hasMore);
    setHistoryCursor(typeof data.nextCursor === "string" ? data.nextCursor : null);
  }, [buildPageYamlPath, currentSection, index]);

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
  const [bindingDialogOpen, setBindingDialogOpen] = useState(false);
  const [anchorCopied, setAnchorCopied] = useState(false);

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

  // Reset example index when variant changes
  useEffect(() => {
    setSelectedExampleIndex(0);
  }, [selectedVariantIndex]);

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
      emitContentUpdated({ contentType: contentType!, slug: slug!, locale: locale || 'en' });
      toast({ title: "Section swapped", description: "The section variant has been updated." });
    } catch (err) {
      toast({ title: "Error", description: "Failed to swap section variant.", variant: "destructive" });
    } finally {
      setIsConfirming(false);
    }
  };

  const handleConfirmSwap = async () => {
    const sectionToSave = previewSection;
    if (!sectionToSave || !contentType || !slug) return;

    if (isSharedTemplate) {
      pendingSwapFn.current = () => executeSwap(sectionToSave);
      setSwapWarnOpen(true);
      return;
    }

    await executeSwap(sectionToSave);
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

  /** Same path as SectionEditorPanel save: edit-sections → validate → write → auto-commit / on-save validators. */
  const handleHistoryRestore = async () => {
    if (!historyPreviewRawSection || !contentType || !slug || !locale) return;
    setHistoryRestoring(true);
    try {
      if (pageHistory && allSections) {
        pageHistory.pushSnapshot(allSections, `Antes de restaurar sección ${index + 1}`);
      }
      const urlParams = new URLSearchParams(window.location.search);
      const forceVariant = urlParams.get("force_variant");
      const urlVariant = urlParams.get("variant");
      const effectiveVariant = forceVariant ?? urlVariant ?? variant;
      const writeSharedTemplateVariant = !!(isSharedTemplate && effectiveVariant);
      const result = await editContent({
        contentType,
        slug,
        locale,
        variant: effectiveVariant || undefined,
        version: writeSharedTemplateVariant ? undefined : version,
        ...(writeSharedTemplateVariant ? { layoutTarget: "type_template" } : {}),
        operations: [
          {
            action: "update_section",
            index,
            section: historyPreviewRawSection as Record<string, unknown>,
          },
        ],
      });
      if (!result.success) {
        toast({
          title: "Restore failed",
          description: result.error || "Could not restore this section.",
          variant: "destructive",
        });
        return;
      }
      const confirmed = result.updatedSections?.[index] as Section | undefined;
      handleUpdate(
        mergeSavedSectionForLivePreview(
          currentSection as Record<string, unknown>,
          (confirmed ?? historyPreviewRawSection) as Record<string, unknown>,
        ) as Section,
      );
      emitContentUpdated({ contentType, slug, locale });
      setHistoryOpen(false);
      setHistoryPreviewSha(null);
      setHistoryPreviewSection(null);
      setHistoryPreviewRawSection(null);
      setHistoryPreviewDate(null);
      setHistoryPreviewAuthor(null);
      setHistoryCauseOpenSha(null);
      if (result.warning) {
        toast({
          title: "Section restored with warning",
          description: result.warning,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Section restored",
          description: "Historical version saved (same path as a normal section save).",
        });
      }
    } catch (err) {
      toast({
        title: "Restore failed",
        description: err instanceof Error ? err.message : "Network error",
        variant: "destructive",
      });
    } finally {
      setHistoryRestoring(false);
    }
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
              <LinkIcon className="h-4 w-4" />
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
                {isBound ? <LinkIcon className="h-4 w-4" /> : <Unlink className="h-4 w-4" />}
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
                      loadSectionHistory()
                        .catch(() => {
                          setHistoryEntries([]);
                          setHistoryHasMore(false);
                          setHistoryCursor(null);
                        })
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
            // Keep Time Machine open while the section diff Dialog has focus.
            // Nested cause popover is handled via onInteractOutside / onFocusOutside below.
            if (!open && historyDiffTarget) return;
            setHistoryOpen(open);
            if (open && historyEntries.length === 0) {
              setHistoryLoading(true);
              loadSectionHistory()
                .catch(() => {
                  setHistoryEntries([]);
                  setHistoryHasMore(false);
                  setHistoryCursor(null);
                })
                .finally(() => setHistoryLoading(false));
            }
            if (!open) {
              setHistoryPreviewSha(null);
              setHistoryPreviewSection(null);
              setHistoryPreviewRawSection(null);
              setHistoryPreviewDate(null);
              setHistoryPreviewAuthor(null);
              setHistoryCauseOpenSha(null);
              setHistoryListCollapsed(false);
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
            <PopoverContent
              className="w-[min(500px,calc(100vw-1rem))] p-2"
              onClick={(e) => e.stopPropagation()}
              onInteractOutside={(e) => {
                if (isHistoryCausePopoverTarget(e.target) || historyDiffTarget) e.preventDefault();
              }}
              onFocusOutside={(e) => {
                if (isHistoryCausePopoverTarget(e.target) || historyDiffTarget) e.preventDefault();
              }}
              onPointerDownOutside={(e) => {
                if (isHistoryCausePopoverTarget(e.target) || historyDiffTarget) e.preventDefault();
              }}
            >
              {historyLoading ? (
                <div className="flex items-center justify-center py-3 px-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mr-2" />
                  <span className="text-xs text-muted-foreground">Loading history...</span>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-center justify-between px-2 pb-1 border-b gap-2">
                    <span className="text-xs font-medium text-muted-foreground flex items-center gap-1 min-w-0">
                      <button
                        type="button"
                        className="inline-flex shrink-0 rounded-sm p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted/60"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setHistoryListCollapsed((c) => !c);
                        }}
                        aria-expanded={!historyListCollapsed}
                        aria-label={historyListCollapsed ? "Expand history list" : "Collapse history list"}
                        data-testid={`button-history-collapse-${index}`}
                        title={historyListCollapsed ? "Expand list" : "Collapse list"}
                      >
                        <ChevronDown
                          className={`h-3.5 w-3.5 transition-transform ${historyListCollapsed ? "-rotate-90" : ""}`}
                        />
                      </button>
                      <History className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">Versions where this section changed</span>
                    </span>
                    {historyPreviewSha && (
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-xs"
                          onClick={() => {
                            setHistoryPreviewSha(null);
                            setHistoryPreviewSection(null);
                            setHistoryPreviewRawSection(null);
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
                            void handleHistoryRestore();
                          }}
                          disabled={!historyPreviewRawSection || historyRestoring}
                          data-testid={`button-history-restore-${index}`}
                        >
                          {historyRestoring ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <Check className="h-3 w-3 mr-1" />
                          )}
                          Restore
                        </Button>
                      </div>
                    )}
                  </div>
                  {!historyListCollapsed && (
                    <>
                  {historyEntries.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-2 py-2">
                      No recent changes for this section
                    </p>
                  ) : (
                    <div className="max-h-[260px] overflow-y-auto space-y-0.5">
                      {historyEntries.map((entry) => {
                      const isSelected = entry.sha === historyPreviewSha;
                      const isLoading = historyPreviewLoading && isSelected;
                      const d = new Date(entry.date);
                      const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                      const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
                      const { label: displayAuthor, agentId } = resolveHistoryAuthorDisplay(entry);
                      const commitHref = historyRepoUrl
                        ? `${historyRepoUrl}/commit/${entry.sha}`
                        : null;
                      const eventAttach = entry.event;
                      const eventCause =
                        typeof eventAttach?.cause === "string" && eventAttach.cause.trim()
                          ? eventAttach.cause.trim()
                          : null;
                      const showEventInfo = !!eventAttach?.id;
                      const eventLogHref =
                        eventAttach?.id != null && typeof eventAttach.created_at === "number"
                          ? buildEntryActivityEventFocusHref(eventAttach.id, eventAttach.created_at)
                          : null;
                      const selectHistoryEntry = async () => {
                        if (isSelected) return;
                        setHistoryCauseOpenSha(null);
                        setHistoryPreviewSha(entry.sha);
                        setHistoryPreviewDate(entry.date);
                        setHistoryPreviewAuthor(displayAuthor);
                        setHistoryPreviewSection(null);
                        setHistoryPreviewRawSection(null);
                        setHistoryPreviewLoading(true);
                        try {
                          const filePath = buildPageYamlPath();
                          if (!filePath) throw new Error("missing path");
                          const res = await fetch(`/api/git/file-at?file=${encodeURIComponent(filePath)}&sha=${entry.sha}`);
                          if (!res.ok) throw new Error("not found");
                          const text = await res.text();
                          const { escaped, map } = escapeTemplateVars(text);
                          const rawParsed = yaml.load(escaped);
                          const parsed = (rawParsed
                            ? unescapeObjectVars(rawParsed, map)
                            : rawParsed) as Record<string, unknown> | null;
                          const sections = (parsed?.sections as unknown[]) || [];
                          const sid = canonicalSectionId(currentSection as Record<string, unknown>);
                          let historicalSection: Section | undefined;
                          if (sid) {
                            historicalSection = sections.find(
                              (s) => s && typeof s === "object" && sectionMatchesId(s as Record<string, unknown>, sid),
                            ) as Section | undefined;
                          } else if (index >= 0 && index < sections.length) {
                            // Legacy sections without section_id: index only.
                            historicalSection = sections[index] as Section | undefined;
                          }
                          if (!historicalSection) {
                            setHistoryPreviewRawSection(null);
                            setHistoryPreviewSection(null);
                            return;
                          }
                          setHistoryPreviewRawSection(historicalSection);

                          const de = (historicalSection as { dynamic_entries?: { database?: string; content_type?: string } })
                            .dynamic_entries;
                          const needsDb = !!(de && (de.database || de.content_type));
                          let sectionForPreview: Section = historicalSection;
                          if (needsDb) {
                            const headers: Record<string, string> = {
                              "Content-Type": "application/json",
                            };
                            const token = getDebugToken();
                            if (token) headers.Authorization = `Token ${token}`;
                            const previewRes = await fetch("/api/listings/section-preview", {
                              method: "POST",
                              headers,
                              body: JSON.stringify({
                                section: historicalSection,
                                locale: locale || "en",
                                singleEntry,
                              }),
                            });
                            if (previewRes.ok) {
                              const previewData = (await previewRes.json()) as { section?: Section };
                              if (previewData.section && typeof previewData.section === "object") {
                                sectionForPreview = previewData.section;
                              }
                            }
                          }

                          setHistoryPreviewSection(
                            prepareSectionForVariableHighlights(
                              sectionForPreview,
                              varDefinitions,
                              historyVarContext,
                              {
                                singleEntry,
                                variableFieldsSource: historicalSection as Record<string, unknown>,
                              },
                            ) as Section,
                          );
                        } catch {
                          setHistoryPreviewSection(null);
                          setHistoryPreviewRawSection(null);
                        } finally {
                          setHistoryPreviewLoading(false);
                        }
                      };
                      return (
                        <div
                          key={entry.sha}
                          className={`w-full rounded text-xs flex items-stretch gap-0 ${isSelected ? 'bg-primary/10 ring-1 ring-primary/30' : ''}`}
                        >
                          <div className="min-w-0 flex-1 flex items-start gap-2 px-2 py-1.5">
                            {isLoading ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0 mt-0.5" />
                            ) : commitHref ? (
                              <a
                                href={commitHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] font-mono text-primary hover:underline shrink-0 mt-0.5"
                                onClick={(e) => e.stopPropagation()}
                                data-testid={`link-history-commit-${entry.sha.slice(0, 7)}-${index}`}
                                title="Open commit on GitHub"
                              >
                                {entry.sha.slice(0, 7)}
                              </a>
                            ) : (
                              <code className="text-[10px] text-muted-foreground shrink-0 mt-0.5">{entry.sha.slice(0, 7)}</code>
                            )}
                            <div className="min-w-0 flex-1">
                              <button
                                type="button"
                                className="w-full text-left hover-elevate rounded-sm px-1 py-0.4 -mx-0.5"
                                onClick={selectHistoryEntry}
                                data-testid={`button-history-entry-${entry.sha.slice(0, 7)}-${index}`}
                              >
                                <div className="truncate font-medium text-foreground leading-snug">
                                  {entry.subject}
                                </div>
                              </button>
                              <div className="text-muted-foreground flex items-center gap-1 min-w-0 px-1 pb-0.5">
                                <span className="shrink-0">{dateStr} {timeStr} ·</span>
                                {agentId ? (
                                  <AgentIcon agentId={agentId} size="sm" className="shrink-0" />
                                ) : null}
                                <span className="truncate">{displayAuthor}</span>
                                {showEventInfo ? (
                                  <Popover
                                    open={historyCauseOpenSha === entry.sha}
                                    onOpenChange={(open) => {
                                      setHistoryCauseOpenSha(open ? entry.sha : null);
                                    }}
                                  >
                                    <PopoverTrigger asChild>
                                      <button
                                        type="button"
                                        className="inline-flex shrink-0 rounded-sm p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted/60"
                                        onClick={(e) => e.stopPropagation()}
                                        aria-label="Cause of this change"
                                        data-testid={`button-history-cause-${entry.sha.slice(0, 7)}-${index}`}
                                      >
                                        <Info className="h-3.5 w-3.5" />
                                      </button>
                                    </PopoverTrigger>
                                    <PopoverContent
                                      side="bottom"
                                      align="start"
                                      className="w-64 p-3 space-y-2 z-[10001] pointer-events-auto"
                                      data-history-cause-popover=""
                                      onClick={(e) => e.stopPropagation()}
                                      onOpenAutoFocus={(e) => e.preventDefault()}
                                      onCloseAutoFocus={(e) => e.preventDefault()}
                                    >
                                      <div className="space-y-1">
                                        <p className="text-[11px] font-medium text-foreground">
                                          Cause of this change
                                        </p>
                                        <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                                          {eventCause ?? "No cause was recorded for this save."}
                                        </p>
                                      </div>
                                      {eventLogHref ? (
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          className="h-7 w-full text-xs"
                                          asChild
                                        >
                                          <Link
                                            href={eventLogHref}
                                            data-testid={`link-history-event-log-${entry.sha.slice(0, 7)}-${index}`}
                                          >
                                            View event log
                                          </Link>
                                        </Button>
                                      ) : null}
                                    </PopoverContent>
                                  </Popover>
                                ) : null}
                              </div>
                            </div>
                          </div>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="shrink-0 self-stretch w-14 px-1 border-l border-border/60 flex flex-col items-center justify-center gap-0.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-r"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  const filePath = buildPageYamlPath();
                                  if (!filePath) return;
                                  setHistoryDiffTarget({
                                    filePath,
                                    headSha: entry.sha,
                                    parentSha: entry.parentSha ?? null,
                                    sectionId: canonicalSectionId(currentSection as Record<string, unknown>),
                                    sectionIndex: index,
                                    subject: entry.subject,
                                  });
                                }}
                                data-testid={`button-history-diff-${entry.sha.slice(0, 7)}-${index}`}
                                aria-label="View section diff"
                              >
                                <FileDiff className="h-3.5 w-3.5" />
                                {(typeof entry.additions === "number" || typeof entry.deletions === "number") && (
                                  <span className="flex items-center gap-0.5 font-mono text-[11px] leading-none tabular-nums">
                                    <span className="text-emerald-600 dark:text-emerald-400">
                                      +{entry.additions ?? 0}
                                    </span>
                                    <span className="text-destructive">
                                      −{entry.deletions ?? 0}
                                    </span>
                                  </span>
                                )}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="left"><p>View section diff</p></TooltipContent>
                          </Tooltip>
                        </div>
                      );
                    })}
                    </div>
                  )}
                  {historyHasMore && (
                    <div className="px-2 pt-1 border-t">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="w-full h-7 text-xs"
                        disabled={historyLoadingMore}
                        onClick={() => {
                          if (!historyCursor || historyLoadingMore) return;
                          setHistoryLoadingMore(true);
                          loadSectionHistory({ cursor: historyCursor, append: true })
                            .catch(() => {})
                            .finally(() => setHistoryLoadingMore(false));
                        }}
                        data-testid={`button-history-load-more-${index}`}
                      >
                        {historyLoadingMore ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                            Loading…
                          </>
                        ) : (
                          "Load more"
                        )}
                      </Button>
                    </div>
                  )}
                    </>
                  )}
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
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setSwapPopoverOpen(false); }} data-testid={`button-cancel-swap-${index}`} title="Cancel">
                    <X className="h-4 w-4" />
                  </Button>
                  {previewSection && (
                    <Button size="sm" variant="outline" className="h-7 px-3" onClick={handleConfirmSwap} disabled={isConfirming} data-testid={`button-use-this-${index}`}>
                      {isConfirming ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
                      Use This
                    </Button>
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

      
      {/* Hide-until-opened badge — same style as other edit-mode badges */}
      {(section as SectionLayout).hidden_until_redirection && (
        <div
          className="absolute top-2 right-2 z-30 flex items-center gap-1 px-2 py-1 bg-amber-500/90 text-amber-950 text-xs font-medium rounded"
          title="Not shown to visitors until something on the page opens it"
          data-testid={`badge-hidden-redirect-${index}`}
        >
          <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden md:inline">Hidden until opened</span>
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
                  <VariableHighlightProvider
                    sectionIndex={index}
                    contentType={contentType}
                    hasSingleVars={!!singleEntry}
                    singleEntry={singleEntry}
                  >
                    {renderSection(historyPreviewSection, index)}
                  </VariableHighlightProvider>
                </SectionContextProvider>
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
            <div className="absolute top-0 left-0 right-0 z-30 text-xs px-3 py-1.5 bg-primary/90 text-primary-foreground">
              <span className="font-medium flex items-center gap-2">
                {isLoadingSwap ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading preview...
                  </>
                ) : (
                  <>Preview: {selectedVariant || "default"}{examplesForCurrentVariant.length > 1 && currentExample?.name ? ` - ${currentExample.name}` : ""}</>
                )}
              </span>
            </div>
            <div className="pt-8 relative">
              {previewSection ? (
                renderSection(previewSection, index)
              ) : (
                <>
                  {renderedContent}
                  {isLoadingSwap && (
                    <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
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
      
      <SectionHistoryDiffModal
        target={historyDiffTarget}
        onOpenChange={(open) => {
          if (!open) setHistoryDiffTarget(null);
        }}
      />

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
